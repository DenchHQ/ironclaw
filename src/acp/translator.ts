import { randomUUID } from "node:crypto";

import type {
  Agent,
  AgentSideConnection,
  AuthenticateRequest,
  AuthenticateResponse,
  CancelNotification,
  ContentBlock,
  ImageContent,
  InitializeRequest,
  InitializeResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  SetSessionModeRequest,
  SetSessionModeResponse,
  StopReason,
  ToolKind,
} from "@agentclientprotocol/sdk";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";

import type { GatewayClient } from "../gateway/client.js";
import type { EventFrame } from "../gateway/protocol/index.js";
import type { SessionsListResult } from "../gateway/session-utils.js";
import { ACP_AGENT_INFO, type AcpServerOptions } from "./types.js";
import {
  cancelActiveRun,
  clearActiveRun,
  createSession,
  getSession,
  setActiveRun,
} from "./session.js";

type PendingPrompt = {
  sessionId: string;
  sessionKey: string;
  idempotencyKey: string;
  resolve: (response: PromptResponse) => void;
  reject: (err: Error) => void;
  sentTextLength?: number;
  sentText?: string;
  toolCalls?: Set<string>;
};

type SessionMeta = {
  sessionKey?: string;
  sessionLabel?: string;
  resetSession?: boolean;
  requireExisting?: boolean;
  prefixCwd?: boolean;
};

export class AcpGatewayAgent implements Agent {
  private connection: AgentSideConnection;
  private gateway: GatewayClient;
  private opts: AcpServerOptions;
  private log: (msg: string) => void;
  private pendingPrompts = new Map<string, PendingPrompt>();

  constructor(
    connection: AgentSideConnection,
    gateway: GatewayClient,
    opts: AcpServerOptions = {},
  ) {
    this.connection = connection;
    this.gateway = gateway;
    this.opts = opts;
    this.log = opts.verbose
      ? (msg: string) => process.stderr.write(`[acp] ${msg}\n`)
      : () => {};
  }

  start(): void {
    this.log("ready");
  }

  handleGatewayReconnect(): void {
    this.log("gateway reconnected");
  }

  handleGatewayDisconnect(reason: string): void {
    this.log(`gateway disconnected: ${reason}`);
    for (const pending of this.pendingPrompts.values()) {
      pending.reject(new Error(`Gateway disconnected: ${reason}`));
      clearActiveRun(pending.sessionId);
    }
    this.pendingPrompts.clear();
  }

  async handleGatewayEvent(evt: EventFrame): Promise<void> {
    if (evt.event === "chat") {
      await this.handleChatEvent(evt);
      return;
    }
    if (evt.event === "agent") {
      await this.handleAgentEvent(evt);
    }
  }

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: {
          image: true,
          audio: false,
          embeddedContext: true,
        },
        mcpCapabilities: {
          http: false,
          sse: false,
        },
        sessionCapabilities: {
          list: {},
        },
      },
      agentInfo: ACP_AGENT_INFO,
      authMethods: [],
    };
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    if (params.mcpServers.length > 0) {
      this.log(`ignoring ${params.mcpServers.length} MCP servers`);
    }

    const sessionId = randomUUID();
    const meta = this.parseSessionMeta(params._meta);
    const sessionKey = await this.resolveSessionKey(meta, `acp:${sessionId}`);
    await this.resetSessionIfNeeded(meta, sessionKey);

    const session = createSession({
      sessionId,
      sessionKey,
      cwd: params.cwd,
    });
    this.log(`newSession: ${session.sessionId} -> ${session.sessionKey}`);
    return { sessionId: session.sessionId };
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    if (params.mcpServers.length > 0) {
      this.log(`ignoring ${params.mcpServers.length} MCP servers`);
    }

    const meta = this.parseSessionMeta(params._meta);
    const sessionKey = await this.resolveSessionKey(meta, params.sessionId);
    await this.resetSessionIfNeeded(meta, sessionKey);

    const session = createSession({
      sessionId: params.sessionId,
      sessionKey,
      cwd: params.cwd,
    });
    this.log(`loadSession: ${session.sessionId} -> ${session.sessionKey}`);
    return {};
  }

  async unstable_listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
    const limit = readNumber(params._meta, ["limit"]) ?? 100;
    const result = await this.gateway.request<SessionsListResult>("sessions.list", { limit });
    const cwd = params.cwd ?? process.cwd();
    return {
      sessions: result.sessions.map((session) => ({
        sessionId: session.key,
        cwd,
        title: session.displayName ?? session.label ?? session.key,
        updatedAt: session.updatedAt ? new Date(session.updatedAt).toISOString() : undefined,
        _meta: {
          sessionKey: session.key,
          kind: session.kind,
          channel: session.channel,
        },
      })),
      nextCursor: null,
    };
  }

  async authenticate(_params: AuthenticateRequest): Promise<AuthenticateResponse> {
    return {};
  }

  async setSessionMode(
    params: SetSessionModeRequest,
  ): Promise<SetSessionModeResponse | void> {
    const session = getSession(params.sessionId);
    if (!session) {
      throw new Error(`Session ${params.sessionId} not found`);
    }
    if (!params.modeId) return {};
    try {
      await this.gateway.request("sessions.patch", {
        key: session.sessionKey,
        thinkingLevel: params.modeId,
      });
      this.log(`setSessionMode: ${session.sessionId} -> ${params.modeId}`);
    } catch (err) {
      this.log(`setSessionMode error: ${String(err)}`);
    }
    return {};
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const session = getSession(params.sessionId);
    if (!session) {
      throw new Error(`Session ${params.sessionId} not found`);
    }

    if (session.abortController) {
      cancelActiveRun(params.sessionId);
    }

    const abortController = new AbortController();
    const runId = randomUUID();
    setActiveRun(params.sessionId, runId, abortController);

    const meta = this.parseSessionMeta(params._meta);
    const userText = this.extractTextFromPrompt(params.prompt);
    const attachments = this.extractAttachmentsFromPrompt(params.prompt);
    const prefixCwd = meta.prefixCwd ?? this.opts.prefixCwd ?? true;
    const message = prefixCwd ? `[Working directory: ${session.cwd}]\n\n${userText}` : userText;

    return new Promise<PromptResponse>((resolve, reject) => {
      this.pendingPrompts.set(params.sessionId, {
        sessionId: params.sessionId,
        sessionKey: session.sessionKey,
        idempotencyKey: runId,
        resolve,
        reject,
      });

      this.gateway
        .request(
          "chat.send",
          {
            sessionKey: session.sessionKey,
            message,
            attachments: attachments.length > 0 ? attachments : undefined,
            idempotencyKey: runId,
            thinking: readString(params._meta, ["thinking", "thinkingLevel"]),
            deliver: readBool(params._meta, ["deliver"]),
            timeoutMs: readNumber(params._meta, ["timeoutMs"]),
          },
          { expectFinal: true },
        )
        .catch((err) => {
          this.pendingPrompts.delete(params.sessionId);
          clearActiveRun(params.sessionId);
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }

  async cancel(params: CancelNotification): Promise<void> {
    const session = getSession(params.sessionId);
    if (!session) return;

    cancelActiveRun(params.sessionId);
    try {
      await this.gateway.request("chat.abort", { sessionKey: session.sessionKey });
    } catch (err) {
      this.log(`cancel error: ${String(err)}`);
    }

    const pending = this.pendingPrompts.get(params.sessionId);
    if (pending) {
      this.pendingPrompts.delete(params.sessionId);
      pending.resolve({ stopReason: "cancelled" });
    }
  }

  private async handleAgentEvent(evt: EventFrame): Promise<void> {
    const payload = evt.payload as Record<string, unknown> | undefined;
    if (!payload) return;
    const stream = payload.stream as string | undefined;
    const data = payload.data as Record<string, unknown> | undefined;
    const sessionKey = payload.sessionKey as string | undefined;
    if (!stream || !data || !sessionKey) return;

    if (stream !== "tool") return;
    const phase = data.phase as string | undefined;
    const name = data.name as string | undefined;
    const toolCallId = data.toolCallId as string | undefined;
    if (!toolCallId) return;

    const pending = this.findPendingBySessionKey(sessionKey);
    if (!pending) return;

    if (phase === "start") {
      if (!pending.toolCalls) pending.toolCalls = new Set();
      if (pending.toolCalls.has(toolCallId)) return;
      pending.toolCalls.add(toolCallId);
      const args = data.args as Record<string, unknown> | undefined;
      await this.connection.sessionUpdate({
        sessionId: pending.sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId,
          title: formatToolTitle(name, args),
          status: "in_progress",
          rawInput: args,
          kind: inferToolKind(name),
        },
      });
      return;
    }

    if (phase === "result") {
      const isError = Boolean(data.isError);
      await this.connection.sessionUpdate({
        sessionId: pending.sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: isError ? "failed" : "completed",
          rawOutput: data.result,
        },
      });
    }
  }

  private async handleChatEvent(evt: EventFrame): Promise<void> {
    const payload = evt.payload as Record<string, unknown> | undefined;
    if (!payload) return;

    const sessionKey = payload.sessionKey as string | undefined;
    const state = payload.state as string | undefined;
    const runId = payload.runId as string | undefined;
    const messageData = payload.message as Record<string, unknown> | undefined;
    if (!sessionKey || !state) return;

    const pending = this.findPendingBySessionKey(sessionKey);
    if (!pending) return;
    if (runId && pending.idempotencyKey !== runId) return;

    if (state === "delta" && messageData) {
      await this.handleDeltaEvent(pending.sessionId, messageData);
      return;
    }

    if (state === "final") {
      this.finishPrompt(pending.sessionId, pending, "end_turn");
      return;
    }
    if (state === "aborted") {
      this.finishPrompt(pending.sessionId, pending, "cancelled");
      return;
    }
    if (state === "error") {
      this.finishPrompt(pending.sessionId, pending, "refusal");
    }
  }

  private async handleDeltaEvent(
    sessionId: string,
    messageData: Record<string, unknown>,
  ): Promise<void> {
    const content = messageData.content as Array<{ type: string; text?: string }> | undefined;
    const fullText = content?.find((c) => c.type === "text")?.text ?? "";
    const pending = this.pendingPrompts.get(sessionId);
    if (!pending) return;

    const sentSoFar = pending.sentTextLength ?? 0;
    if (fullText.length <= sentSoFar) return;

    const newText = fullText.slice(sentSoFar);
    pending.sentTextLength = fullText.length;
    pending.sentText = fullText;

    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: newText },
      },
    });
  }

  private finishPrompt(
    sessionId: string,
    pending: PendingPrompt,
    stopReason: StopReason,
  ): void {
    this.pendingPrompts.delete(sessionId);
    clearActiveRun(sessionId);
    pending.resolve({ stopReason });
  }

  private findPendingBySessionKey(sessionKey: string): PendingPrompt | undefined {
    for (const pending of this.pendingPrompts.values()) {
      if (pending.sessionKey === sessionKey) return pending;
    }
    return undefined;
  }

  private extractTextFromPrompt(prompt: ContentBlock[]): string {
    const parts: string[] = [];
    for (const block of prompt) {
      if (block.type === "text") {
        parts.push(block.text);
        continue;
      }
      if (block.type === "resource") {
        const resource = block.resource as { text?: string } | undefined;
        if (resource?.text) parts.push(resource.text);
        continue;
      }
      if (block.type === "resource_link") {
        const title = block.title ? ` (${block.title})` : "";
        const uri = block.uri ?? "";
        const line = uri ? `[Resource link${title}] ${uri}` : `[Resource link${title}]`;
        parts.push(line);
      }
    }
    return parts.join("\n");
  }

  private extractAttachmentsFromPrompt(
    prompt: ContentBlock[],
  ): Array<{ type: string; mimeType: string; content: string }> {
    const attachments: Array<{ type: string; mimeType: string; content: string }> = [];
    for (const block of prompt) {
      if (block.type !== "image") continue;
      const image = block as ImageContent;
      if (!image.data || !image.mimeType) continue;
      attachments.push({
        type: "image",
        mimeType: image.mimeType,
        content: image.data,
      });
    }
    return attachments;
  }

  private parseSessionMeta(meta: unknown): SessionMeta {
    if (!meta || typeof meta !== "object") return {};
    const record = meta as Record<string, unknown>;
    return {
      sessionKey: readString(record, ["sessionKey", "session", "key"]),
      sessionLabel: readString(record, ["sessionLabel", "label"]),
      resetSession: readBool(record, ["resetSession", "reset"]),
      requireExisting: readBool(record, ["requireExistingSession", "requireExisting"]),
      prefixCwd: readBool(record, ["prefixCwd"]),
    };
  }

  private async resolveSessionKey(meta: SessionMeta, fallbackKey: string): Promise<string> {
    const requestedKey = meta.sessionKey ?? this.opts.defaultSessionKey;
    const requestedLabel = meta.sessionLabel ?? this.opts.defaultSessionLabel;
    const requireExisting =
      meta.requireExisting ?? this.opts.requireExistingSession ?? false;

    if (requestedLabel) {
      const resolved = await this.gateway.request<{ ok: true; key: string }>(
        "sessions.resolve",
        { label: requestedLabel },
      );
      if (!resolved?.key) {
        throw new Error(`Unable to resolve session label: ${requestedLabel}`);
      }
      return resolved.key;
    }

    if (requestedKey) {
      if (!requireExisting) return requestedKey;
      const resolved = await this.gateway.request<{ ok: true; key: string }>(
        "sessions.resolve",
        { key: requestedKey },
      );
      if (!resolved?.key) {
        throw new Error(`Session key not found: ${requestedKey}`);
      }
      return resolved.key;
    }

    return fallbackKey;
  }

  private async resetSessionIfNeeded(meta: SessionMeta, sessionKey: string): Promise<void> {
    const resetSession = meta.resetSession ?? this.opts.resetSession ?? false;
    if (!resetSession) return;
    await this.gateway.request("sessions.reset", { key: sessionKey });
  }
}

function readString(
  meta: Record<string, unknown> | null | undefined,
  keys: string[],
): string | undefined {
  if (!meta) return undefined;
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function readBool(
  meta: Record<string, unknown> | null | undefined,
  keys: string[],
): boolean | undefined {
  if (!meta) return undefined;
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function readNumber(
  meta: Record<string, unknown> | null | undefined,
  keys: string[],
): number | undefined {
  if (!meta) return undefined;
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function formatToolTitle(
  name: string | undefined,
  args: Record<string, unknown> | undefined,
): string {
  const base = name ?? "tool";
  if (!args || Object.keys(args).length === 0) return base;
  const parts = Object.entries(args).map(([key, value]) => {
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    const safe = raw.length > 100 ? `${raw.slice(0, 100)}...` : raw;
    return `${key}: ${safe}`;
  });
  return `${base}: ${parts.join(", ")}`;
}

function inferToolKind(name?: string): ToolKind | undefined {
  if (!name) return "other";
  const normalized = name.toLowerCase();
  if (normalized.includes("read")) return "read";
  if (normalized.includes("write") || normalized.includes("edit")) return "edit";
  if (normalized.includes("delete") || normalized.includes("remove")) return "delete";
  if (normalized.includes("move") || normalized.includes("rename")) return "move";
  if (normalized.includes("search") || normalized.includes("find")) return "search";
  if (normalized.includes("exec") || normalized.includes("run") || normalized.includes("bash")) {
    return "execute";
  }
  if (normalized.includes("fetch") || normalized.includes("http")) return "fetch";
  return "other";
}
