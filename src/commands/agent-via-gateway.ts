import type { CliDeps } from "../cli/deps.js";
import type { RuntimeEnv } from "../runtime.js";
import { listAgentIds } from "../agents/agent-scope.js";
import { DEFAULT_CHAT_CHANNEL } from "../channels/registry.js";
import { formatCliCommand } from "../cli/command-format.js";
import { withProgress } from "../cli/progress.js";
import { loadConfig, resolveConfigPath, resolveStateDir } from "../config/config.js";
import {
  buildGatewayConnectionDetails,
  callGateway,
  randomIdempotencyKey,
} from "../gateway/call.js";
import { GatewayClient } from "../gateway/client.js";
import { PROTOCOL_VERSION } from "../gateway/protocol/index.js";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { loadGatewayTlsRuntime } from "../infra/tls/gateway.js";
import { normalizeAgentId } from "../routing/session-key.js";
import {
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
  normalizeMessageChannel,
} from "../utils/message-channel.js";
import { agentCommand } from "./agent.js";
import { resolveSessionKeyForRequest } from "./agent/session.js";

/** Write a single NDJSON line to stdout. */
export function emitNdjsonLine(obj: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

type AgentGatewayResult = {
  payloads?: Array<{
    text?: string;
    mediaUrl?: string | null;
    mediaUrls?: string[];
  }>;
  meta?: unknown;
};

type GatewayAgentResponse = {
  runId?: string;
  status?: string;
  summary?: string;
  result?: AgentGatewayResult;
};

const NO_GATEWAY_TIMEOUT_MS = 2_147_000_000;

export type AgentCliOpts = {
  message: string;
  agent?: string;
  to?: string;
  sessionId?: string;
  sessionKey?: string;
  thinking?: string;
  verbose?: string;
  json?: boolean;
  /** Stream NDJSON events to stdout during the agent run. */
  streamJson?: boolean;
  timeout?: string;
  deliver?: boolean;
  channel?: string;
  replyTo?: string;
  replyChannel?: string;
  replyAccount?: string;
  bestEffortDeliver?: boolean;
  lane?: string;
  runId?: string;
  extraSystemPrompt?: string;
  local?: boolean;
};

function parseTimeoutSeconds(opts: { cfg: ReturnType<typeof loadConfig>; timeout?: string }) {
  const raw =
    opts.timeout !== undefined
      ? Number.parseInt(String(opts.timeout), 10)
      : (opts.cfg.agents?.defaults?.timeoutSeconds ?? 600);
  if (Number.isNaN(raw) || raw < 0) {
    throw new Error("--timeout must be a non-negative integer (seconds; 0 means no timeout)");
  }
  return raw;
}

function formatPayloadForLog(payload: {
  text?: string;
  mediaUrls?: string[];
  mediaUrl?: string | null;
}) {
  const lines: string[] = [];
  if (payload.text) {
    lines.push(payload.text.trimEnd());
  }
  const mediaUrl =
    typeof payload.mediaUrl === "string" && payload.mediaUrl.trim()
      ? payload.mediaUrl.trim()
      : undefined;
  const media = payload.mediaUrls ?? (mediaUrl ? [mediaUrl] : []);
  for (const url of media) {
    lines.push(`MEDIA:${url}`);
  }
  return lines.join("\n").trimEnd();
}

export async function agentViaGatewayCommand(opts: AgentCliOpts, runtime: RuntimeEnv) {
  const body = (opts.message ?? "").trim();
  if (!body) {
    throw new Error("Message (--message) is required");
  }
  if (!opts.to && !opts.sessionId && !opts.sessionKey && !opts.agent) {
    throw new Error(
      "Pass --to <E.164>, --session-id, --session-key, or --agent to choose a session",
    );
  }

  const cfg = loadConfig();
  const agentIdRaw = opts.agent?.trim();
  const agentId = agentIdRaw ? normalizeAgentId(agentIdRaw) : undefined;
  if (agentId) {
    const knownAgents = listAgentIds(cfg);
    if (!knownAgents.includes(agentId)) {
      throw new Error(
        `Unknown agent id "${agentIdRaw}". Use "${formatCliCommand("openclaw agents list")}" to see configured agents.`,
      );
    }
  }
  const timeoutSeconds = parseTimeoutSeconds({ cfg, timeout: opts.timeout });
  const gatewayTimeoutMs =
    timeoutSeconds === 0
      ? NO_GATEWAY_TIMEOUT_MS // no timeout (timer-safe max)
      : Math.max(10_000, (timeoutSeconds + 30) * 1000);

  const sessionKey = resolveSessionKeyForRequest({
    cfg,
    agentId,
    to: opts.to,
    sessionId: opts.sessionId,
    sessionKey: opts.sessionKey,
  }).sessionKey;

  const channel = normalizeMessageChannel(opts.channel) ?? DEFAULT_CHAT_CHANNEL;
  const idempotencyKey = opts.runId?.trim() || randomIdempotencyKey();

  const response = await withProgress(
    {
      label: "Waiting for agent reply…",
      indeterminate: true,
      enabled: opts.json !== true,
    },
    async () =>
      await callGateway<GatewayAgentResponse>({
        method: "agent",
        params: {
          message: body,
          agentId,
          to: opts.to,
          replyTo: opts.replyTo,
          sessionId: opts.sessionId,
          sessionKey,
          thinking: opts.thinking,
          deliver: Boolean(opts.deliver),
          channel,
          replyChannel: opts.replyChannel,
          replyAccountId: opts.replyAccount,
          timeout: timeoutSeconds,
          lane: opts.lane,
          extraSystemPrompt: opts.extraSystemPrompt,
          idempotencyKey,
        },
        expectFinal: true,
        timeoutMs: gatewayTimeoutMs,
        clientName: GATEWAY_CLIENT_NAMES.CLI,
        mode: GATEWAY_CLIENT_MODES.CLI,
      }),
  );

  if (opts.json) {
    runtime.log(JSON.stringify(response, null, 2));
    return response;
  }

  const result = response?.result;
  const payloads = result?.payloads ?? [];

  if (payloads.length === 0) {
    runtime.log(response?.summary ? String(response.summary) : "No reply from agent.");
    return response;
  }

  for (const payload of payloads) {
    const out = formatPayloadForLog(payload);
    if (out) {
      runtime.log(out);
    }
  }

  return response;
}

/**
 * Gateway agent call with live NDJSON event streaming to stdout.
 * Reuses callGateway with an onEvent callback to emit each gateway event as an NDJSON line.
 */
async function agentViaGatewayStreamJson(opts: AgentCliOpts, _runtime: RuntimeEnv) {
  const body = (opts.message ?? "").trim();
  if (!body) {
    throw new Error("Message (--message) is required");
  }
  if (!opts.to && !opts.sessionId && !opts.sessionKey && !opts.agent) {
    throw new Error(
      "Pass --to <E.164>, --session-id, --session-key, or --agent to choose a session",
    );
  }

  const cfg = loadConfig();
  const agentIdRaw = opts.agent?.trim();
  const agentId = agentIdRaw ? normalizeAgentId(agentIdRaw) : undefined;
  if (agentId) {
    const knownAgents = listAgentIds(cfg);
    if (!knownAgents.includes(agentId)) {
      throw new Error(
        `Unknown agent id "${agentIdRaw}". Use "${formatCliCommand("openclaw agents list")}" to see configured agents.`,
      );
    }
  }
  const timeoutSeconds = parseTimeoutSeconds({ cfg, timeout: opts.timeout });
  const gatewayTimeoutMs = Math.max(10_000, (timeoutSeconds + 30) * 1000);

  const sessionKey = resolveSessionKeyForRequest({
    cfg,
    agentId,
    to: opts.to,
    sessionId: opts.sessionId,
    sessionKey: opts.sessionKey,
  }).sessionKey;

  const channel = normalizeMessageChannel(opts.channel) ?? DEFAULT_CHAT_CHANNEL;
  const idempotencyKey = opts.runId?.trim() || randomIdempotencyKey();

  // Capture the runId from early gateway events so we can abort the
  // correct run when the process receives SIGTERM/SIGINT.
  let capturedRunId: string | undefined;
  const abortController = new AbortController();
  const onSignal = () => {
    if (!abortController.signal.aborted) {
      abortController.abort();
    }
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);

  try {
    const response = await callGateway<GatewayAgentResponse>({
      method: "agent",
      params: {
        message: body,
        agentId,
        to: opts.to,
        replyTo: opts.replyTo,
        sessionId: opts.sessionId,
        sessionKey,
        thinking: opts.thinking,
        deliver: Boolean(opts.deliver),
        channel,
        replyChannel: opts.replyChannel,
        replyAccountId: opts.replyAccount,
        timeout: timeoutSeconds,
        lane: opts.lane,
        extraSystemPrompt: opts.extraSystemPrompt,
        idempotencyKey,
      },
      expectFinal: true,
      timeoutMs: gatewayTimeoutMs,
      clientName: GATEWAY_CLIENT_NAMES.CLI,
      mode: GATEWAY_CLIENT_MODES.CLI,
      // Request tool-events capability so the gateway streams tool start/result
      // events alongside assistant text, thinking, and lifecycle events.
      caps: ["tool-events"],
      signal: abortController.signal,
      onEvent: (evt) => {
        // Capture runId from the first event that carries one (lifecycle/accepted).
        if (!capturedRunId) {
          const payload = evt.payload as Record<string, unknown> | undefined;
          const rid = payload?.runId;
          if (typeof rid === "string" && rid.trim()) {
            capturedRunId = rid.trim();
          } else if (typeof rid === "number") {
            capturedRunId = String(rid);
          }
        }
        // Emit each gateway event as an NDJSON line (chat deltas, agent tool/lifecycle events).
        emitNdjsonLine({ event: evt.event, ...(evt.payload as Record<string, unknown>) });
      },
      onAbort: async (client) => {
        // Best-effort: tell the gateway to abort the agent run before we exit.
        if (capturedRunId) {
          await client.request("chat.abort", { sessionKey, runId: capturedRunId }).catch(() => {});
        }
      },
    });

    // Emit the final result as the last NDJSON line.
    emitNdjsonLine({ event: "result", ...response });

    return response;
  } catch (err) {
    // Re-throw everything except AbortError (expected on SIGTERM/SIGINT).
    if (err instanceof DOMException && err.name === "AbortError") {
      emitNdjsonLine({ event: "aborted", reason: "signal" });
      return {} as GatewayAgentResponse;
    }
    throw err;
  } finally {
    process.removeListener("SIGTERM", onSignal);
    process.removeListener("SIGINT", onSignal);
  }
}

/**
 * Subscribe to a session key's events via the gateway `agent.subscribe` RPC.
 * Streams NDJSON to stdout until SIGTERM/SIGINT.
 */
async function agentSubscribeStreamJson(
  sessionKey: string,
  afterSeq: number,
  _runtime: RuntimeEnv,
): Promise<void> {
  const cfg = loadConfig();
  const isRemoteMode = cfg.gateway?.mode === "remote";
  const remote = isRemoteMode ? cfg.gateway?.remote : undefined;
  const remoteUrl =
    typeof remote?.url === "string" && remote.url.trim().length > 0 ? remote.url.trim() : undefined;
  if (isRemoteMode && !remoteUrl) {
    const configPath = resolveConfigPath(process.env, resolveStateDir(process.env));
    throw new Error(
      [
        "gateway remote mode misconfigured: gateway.remote.url missing",
        `Config: ${configPath}`,
        "Fix: set gateway.remote.url, or set gateway.mode=local.",
      ].join("\n"),
    );
  }
  const connectionDetails = buildGatewayConnectionDetails({ config: cfg });
  const useLocalTls =
    cfg.gateway?.tls?.enabled === true && !remoteUrl && connectionDetails.url.startsWith("wss://");
  const tlsRuntime = useLocalTls ? await loadGatewayTlsRuntime(cfg.gateway?.tls) : undefined;
  const tlsFingerprint =
    (isRemoteMode && remoteUrl && typeof remote?.tlsFingerprint === "string"
      ? remote.tlsFingerprint.trim()
      : undefined) || (tlsRuntime?.enabled ? tlsRuntime.fingerprintSha256 : undefined);
  const authToken = cfg.gateway?.auth?.token;
  const authPassword = cfg.gateway?.auth?.password;
  const token =
    isRemoteMode && remoteUrl
      ? typeof remote?.token === "string" && remote.token.trim().length > 0
        ? remote.token.trim()
        : undefined
      : process.env.OPENCLAW_GATEWAY_TOKEN?.trim() ||
        process.env.CLAWDBOT_GATEWAY_TOKEN?.trim() ||
        (typeof authToken === "string" && authToken.trim().length > 0
          ? authToken.trim()
          : undefined);
  const password =
    process.env.OPENCLAW_GATEWAY_PASSWORD?.trim() ||
    process.env.CLAWDBOT_GATEWAY_PASSWORD?.trim() ||
    (isRemoteMode && remoteUrl
      ? typeof remote?.password === "string" && remote.password.trim().length > 0
        ? remote.password.trim()
        : undefined
      : typeof authPassword === "string" && authPassword.trim().length > 0
        ? authPassword.trim()
        : undefined);

  let cursor = Math.max(0, Number.isFinite(afterSeq) ? afterSeq : 0);
  const abortController = new AbortController();
  let client: GatewayClient | null = null;
  const onSignal = () => {
    if (!abortController.signal.aborted) {
      abortController.abort();
    }
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let aborting = false;

      const settle = (err?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        if (err) {
          reject(err);
          return;
        }
        resolve();
      };

      const onAbort = () => {
        if (aborting) {
          return;
        }
        aborting = true;
        const unsubscribeAndStop = async () => {
          try {
            await client?.request("agent.unsubscribe", { sessionKey }).catch(() => {});
          } finally {
            client?.stop();
            emitNdjsonLine({ event: "aborted", reason: "signal" });
            settle();
          }
        };
        void unsubscribeAndStop();
      };

      if (abortController.signal.aborted) {
        onAbort();
        return;
      }
      abortController.signal.addEventListener("abort", onAbort, { once: true });

      client = new GatewayClient({
        url: connectionDetails.url,
        token,
        password,
        tlsFingerprint,
        instanceId: randomIdempotencyKey(),
        clientName: GATEWAY_CLIENT_NAMES.CLI,
        clientVersion: "dev",
        platform: process.platform,
        mode: GATEWAY_CLIENT_MODES.CLI,
        role: "operator",
        scopes: ["operator.admin", "operator.approvals", "operator.pairing"],
        caps: ["tool-events"],
        deviceIdentity: loadOrCreateDeviceIdentity(),
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        onHelloOk: async () => {
          try {
            await client?.request("agent.subscribe", { sessionKey, afterSeq: cursor });
          } catch (err) {
            client?.stop();
            const error = err instanceof Error ? err : new Error(String(err));
            settle(error);
          }
        },
        onEvent: (evt) => {
          if (evt.event !== "agent") {
            return;
          }
          const payload =
            evt.payload && typeof evt.payload === "object"
              ? (evt.payload as Record<string, unknown>)
              : undefined;
          if (!payload || payload.sessionKey !== sessionKey) {
            return;
          }
          const globalSeq = typeof payload.globalSeq === "number" ? payload.globalSeq : undefined;
          if (globalSeq !== undefined && globalSeq > cursor) {
            cursor = globalSeq;
          }
          emitNdjsonLine({ event: evt.event, ...payload });
        },
        onConnectError: (err) => {
          if (aborting || settled) {
            return;
          }
          client?.stop();
          settle(err);
        },
        onClose: (code, reason) => {
          if (aborting || settled || abortController.signal.aborted) {
            return;
          }
          // For reconnectable closes, let GatewayClient retry.
          if (code === 1000) {
            return;
          }
          client?.stop();
          const reasonText = reason?.trim() || "no close reason";
          settle(
            new Error(
              `gateway subscribe closed (${code}): ${reasonText}\n${connectionDetails.message}`,
            ),
          );
        },
      });
      client.start();
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      emitNdjsonLine({ event: "aborted", reason: "signal" });
      return;
    }
    throw err;
  } finally {
    process.removeListener("SIGTERM", onSignal);
    process.removeListener("SIGINT", onSignal);
  }
}

export async function agentCliCommand(opts: AgentCliOpts, runtime: RuntimeEnv, deps?: CliDeps) {
  // Subscribe-only mode: tail events for a session key with replay cursor.
  const subscribeKey = (opts as Record<string, unknown>).subscribeSessionKey as string | undefined;
  if (subscribeKey && opts.streamJson) {
    const rawAfterSeq = (opts as Record<string, unknown>).afterSeq;
    const afterSeq = Number.parseInt(typeof rawAfterSeq === "string" ? rawAfterSeq : "0", 10) || 0;
    return await agentSubscribeStreamJson(subscribeKey.trim(), afterSeq, runtime);
  }

  // --message is required for all non-subscribe paths.
  if (!opts.message?.trim()) {
    throw new Error("Message (--message) is required");
  }

  const localOpts = {
    ...opts,
    agentId: opts.agent,
    replyAccountId: opts.replyAccount,
  };
  if (opts.local === true) {
    return await agentCommand(localOpts, runtime, deps);
  }

  // Stream NDJSON via the gateway (no embedded fallback — streaming should fail loud).
  if (opts.streamJson) {
    return await agentViaGatewayStreamJson(opts, runtime);
  }

  try {
    return await agentViaGatewayCommand(opts, runtime);
  } catch (err) {
    runtime.error?.(`Gateway agent failed; falling back to embedded: ${String(err)}`);
    return await agentCommand(localOpts, runtime, deps);
  }
}
