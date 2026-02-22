import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../gateway/call.js", () => ({
  callGateway: vi.fn(),
  randomIdempotencyKey: () => "idem-1",
  buildGatewayConnectionDetails: vi.fn(() => ({
    url: "ws://127.0.0.1:18789",
    urlSource: "test",
    message: "Gateway target: ws://127.0.0.1:18789",
  })),
}));
vi.mock("./agent.js", () => ({
  agentCommand: vi.fn(),
}));
vi.mock("../gateway/client.js", () => {
  class MockGatewayClient {
    static instances: MockGatewayClient[] = [];
    private opts: Record<string, unknown>;

    constructor(opts: Record<string, unknown>) {
      this.opts = opts;
      MockGatewayClient.instances.push(this);
    }

    start() {
      setTimeout(async () => {
        const onHelloOk = this.opts.onHelloOk as (() => Promise<void>) | undefined;
        await onHelloOk?.();
      }, 0);
    }

    async request(method: string, params?: Record<string, unknown>) {
      if (method === "agent.subscribe") {
        const sessionKey = typeof params?.sessionKey === "string" ? params.sessionKey : "";
        const onEvent = this.opts.onEvent as ((evt: Record<string, unknown>) => void) | undefined;
        onEvent?.({
          event: "agent",
          payload: {
            sessionKey,
            stream: "assistant",
            data: { delta: "match" },
            globalSeq: 11,
          },
        });
        onEvent?.({
          event: "agent",
          payload: {
            sessionKey: "agent:main:web:other",
            stream: "assistant",
            data: { delta: "ignore" },
            globalSeq: 12,
          },
        });
      }
      return {};
    }

    stop() {}
  }

  return { GatewayClient: MockGatewayClient };
});

import type { OpenClawConfig } from "../config/config.js";
import * as configModule from "../config/config.js";
import { callGateway } from "../gateway/call.js";
import type { RuntimeEnv } from "../runtime.js";
import { agentCliCommand, emitNdjsonLine } from "./agent-via-gateway.js";
import { agentCommand } from "./agent.js";

const runtime: RuntimeEnv = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(),
};

const configSpy = vi.spyOn(configModule, "loadConfig");

function mockConfig(storePath: string, overrides?: Partial<OpenClawConfig>) {
  configSpy.mockReturnValue({
    agents: {
      defaults: {
        timeoutSeconds: 600,
        ...overrides?.agents?.defaults,
      },
    },
    session: {
      store: storePath,
      mainKey: "main",
      ...overrides?.session,
    },
    gateway: overrides?.gateway,
  });
}

async function withTempStore(
  fn: (ctx: { dir: string; store: string }) => Promise<void>,
  overrides?: Partial<OpenClawConfig>,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-cli-"));
  const store = path.join(dir, "sessions.json");
  mockConfig(store, overrides);
  try {
    await fn({ dir, store });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function mockGatewaySuccessReply(text = "hello") {
  vi.mocked(callGateway).mockResolvedValue({
    runId: "idem-1",
    status: "ok",
    result: {
      payloads: [{ text }],
      meta: { stub: true },
    },
  });
}

function mockLocalAgentReply(text = "local") {
  vi.mocked(agentCommand).mockImplementationOnce(async (_opts, rt) => {
    rt?.log?.(text);
    return {
      payloads: [{ text }],
      meta: { durationMs: 1, agentMeta: { sessionId: "s", provider: "p", model: "m" } },
    } as unknown as Awaited<ReturnType<typeof agentCommand>>;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("agentCliCommand", () => {
  it("uses a timer-safe max gateway timeout when --timeout is 0", async () => {
    await withTempStore(async () => {
      mockGatewaySuccessReply();

      await agentCliCommand({ message: "hi", to: "+1555", timeout: "0" }, runtime);

      expect(callGateway).toHaveBeenCalledTimes(1);
      const request = vi.mocked(callGateway).mock.calls[0]?.[0] as { timeoutMs?: number };
      expect(request.timeoutMs).toBe(2_147_000_000);
    });
  });

  it("uses gateway by default", async () => {
    await withTempStore(async () => {
      mockGatewaySuccessReply();

      await agentCliCommand({ message: "hi", to: "+1555" }, runtime);

      expect(callGateway).toHaveBeenCalledTimes(1);
      expect(agentCommand).not.toHaveBeenCalled();
      expect(runtime.log).toHaveBeenCalledWith("hello");
    });
  });

  it("falls back to embedded agent when gateway fails", async () => {
    await withTempStore(async () => {
      vi.mocked(callGateway).mockRejectedValue(new Error("gateway not connected"));
      mockLocalAgentReply();

      await agentCliCommand({ message: "hi", to: "+1555" }, runtime);

      expect(callGateway).toHaveBeenCalledTimes(1);
      expect(agentCommand).toHaveBeenCalledTimes(1);
      expect(runtime.log).toHaveBeenCalledWith("local");
    });
  });

  it("skips gateway when --local is set", async () => {
    await withTempStore(async () => {
      mockLocalAgentReply();

      await agentCliCommand(
        {
          message: "hi",
          to: "+1555",
          local: true,
        },
        runtime,
      );

      expect(callGateway).not.toHaveBeenCalled();
      expect(agentCommand).toHaveBeenCalledTimes(1);
      expect(runtime.log).toHaveBeenCalledWith("local");
    });
  });

  it("routes to streaming gateway path when --stream-json is set", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-cli-"));
    const store = path.join(dir, "sessions.json");
    mockConfig(store);

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    // callGateway should receive an onEvent callback when streaming
    vi.mocked(callGateway).mockImplementation(async (opts) => {
      // Simulate a couple of gateway events via the onEvent callback
      const onEvent = (opts as { onEvent?: (evt: unknown) => void }).onEvent;
      if (onEvent) {
        onEvent({
          event: "chat",
          payload: { runId: "r1", state: "delta", message: { text: "he" } },
          seq: 1,
        });
        onEvent({
          event: "chat",
          payload: { runId: "r1", state: "final", message: { text: "hello" } },
          seq: 2,
        });
      }
      return { runId: "r1", status: "ok", result: { payloads: [{ text: "hello" }] } };
    });

    try {
      await agentCliCommand({ message: "hi", to: "+1555", streamJson: true }, runtime);

      expect(callGateway).toHaveBeenCalledTimes(1);
      // Verify onEvent was passed to callGateway
      const callOpts = vi.mocked(callGateway).mock.calls[0][0] as Record<string, unknown>;
      expect(typeof callOpts.onEvent).toBe("function");

      // Verify NDJSON lines were written to stdout (2 events + 1 result)
      const writes = stdoutSpy.mock.calls.map(([data]) => String(data));
      expect(writes).toHaveLength(3);
      for (const line of writes) {
        // Each line should be valid JSON followed by a newline
        expect(line.endsWith("\n")).toBe(true);
        expect(() => JSON.parse(line)).not.toThrow();
      }

      // The last line should be the result event
      const lastLine = JSON.parse(writes[2]);
      expect(lastLine.event).toBe("result");
      expect(lastLine.status).toBe("ok");

      // Normal log output should NOT be called (NDJSON-only)
      expect(runtime.log).not.toHaveBeenCalled();
    } finally {
      stdoutSpy.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes --stream-json through to embedded agent when --local is set", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-cli-"));
    const store = path.join(dir, "sessions.json");
    mockConfig(store);

    mockLocalAgentReply();

    try {
      await agentCliCommand({ message: "hi", to: "+1555", local: true, streamJson: true }, runtime);

      expect(callGateway).not.toHaveBeenCalled();
      expect(agentCommand).toHaveBeenCalledTimes(1);
      const passedOpts = vi.mocked(agentCommand).mock.calls[0][0] as Record<string, unknown>;
      expect(passedOpts.streamJson).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps subscribe mode alive until signaled and filters to target session", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-cli-"));
    const store = path.join(dir, "sessions.json");
    mockConfig(store);

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      const promise = agentCliCommand(
        {
          message: "unused",
          streamJson: true,
          subscribeSessionKey: "agent:main:web:target",
          afterSeq: "10",
        } as unknown as Parameters<typeof agentCliCommand>[0],
        runtime,
      );

      // Subscribe mode should not resolve immediately.
      let settled = false;
      void promise.then(() => {
        settled = true;
      });
      await new Promise((r) => setTimeout(r, 20));
      expect(settled).toBe(false);

      // Trigger signal-driven shutdown.
      (process as unknown as { emit: (event: string) => boolean }).emit("SIGTERM");
      await promise;

      expect(callGateway).not.toHaveBeenCalled();
      const writes = stdoutSpy.mock.calls.map(([data]) => String(data));
      const parsed = writes.map((line) => JSON.parse(line));
      const agentEvents = parsed.filter((evt) => evt.event === "agent");
      expect(agentEvents).toHaveLength(1);
      expect(agentEvents[0].sessionKey).toBe("agent:main:web:target");
      expect(parsed[parsed.length - 1]).toMatchObject({ event: "aborted", reason: "signal" });
    } finally {
      stdoutSpy.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("emitNdjsonLine", () => {
  it("writes valid JSON followed by a newline", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      emitNdjsonLine({
        event: "agent",
        runId: "r1",
        stream: "lifecycle",
        data: { phase: "start" },
      });
      expect(spy).toHaveBeenCalledTimes(1);
      const output = String(spy.mock.calls[0][0]);
      expect(output.endsWith("\n")).toBe(true);
      const parsed = JSON.parse(output);
      expect(parsed.event).toBe("agent");
      expect(parsed.runId).toBe("r1");
      expect(parsed.data).toEqual({ phase: "start" });
    } finally {
      spy.mockRestore();
    }
  });
});
