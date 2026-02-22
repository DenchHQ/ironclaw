import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config/config.js";
import { registerAgentRunContext, resetAgentRunContextForTest } from "../infra/agent-events.js";
import { resolveHeartbeatVisibility } from "../infra/heartbeat-visibility.js";
import {
  createAgentEventHandler,
  createChatRunState,
  createToolEventRecipientRegistry,
  createSessionEventLog,
  createSessionSubscriptionRegistry,
} from "./server-chat.js";

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("../infra/heartbeat-visibility.js", () => ({
  resolveHeartbeatVisibility: vi.fn(() => ({
    showOk: false,
    showAlerts: true,
    useIndicator: true,
  })),
}));

describe("agent event handler", () => {
  beforeEach(() => {
    vi.mocked(loadConfig).mockReturnValue({});
    vi.mocked(resolveHeartbeatVisibility).mockReturnValue({
      showOk: false,
      showAlerts: true,
      useIndicator: true,
    });
    resetAgentRunContextForTest();
  });

  afterEach(() => {
    resetAgentRunContextForTest();
  });

  function createHarness(params?: {
    now?: number;
    resolveSessionKeyForRun?: (runId: string) => string | undefined;
  }) {
    const nowSpy =
      params?.now === undefined ? undefined : vi.spyOn(Date, "now").mockReturnValue(params.now);
    const broadcast = vi.fn();
    const broadcastToConnIds = vi.fn();
    const nodeSendToSession = vi.fn();
    const agentRunSeq = new Map<string, number>();
    const chatRunState = createChatRunState();
    const toolEventRecipients = createToolEventRecipientRegistry();

    const sessionEventLog = createSessionEventLog();
    const sessionSubscriptions = createSessionSubscriptionRegistry();

    const handler = createAgentEventHandler({
      broadcast,
      broadcastToConnIds,
      nodeSendToSession,
      agentRunSeq,
      chatRunState,
      resolveSessionKeyForRun: params?.resolveSessionKeyForRun ?? (() => undefined),
      clearAgentRunContext: vi.fn(),
      toolEventRecipients,
      sessionEventLog,
      sessionSubscriptions,
    });

    return {
      nowSpy,
      broadcast,
      broadcastToConnIds,
      nodeSendToSession,
      agentRunSeq,
      chatRunState,
      toolEventRecipients,
      sessionEventLog,
      sessionSubscriptions,
      handler,
    };
  }

  function emitRun1AssistantText(
    harness: ReturnType<typeof createHarness>,
    text: string,
  ): ReturnType<typeof createHarness> {
    harness.chatRunState.registry.add("run-1", {
      sessionKey: "session-1",
      clientRunId: "client-1",
    });
    harness.handler({
      runId: "run-1",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text },
    });
    return harness;
  }

  function chatBroadcastCalls(broadcast: ReturnType<typeof vi.fn>) {
    return broadcast.mock.calls.filter(([event]) => event === "chat");
  }

  function sessionChatCalls(nodeSendToSession: ReturnType<typeof vi.fn>) {
    return nodeSendToSession.mock.calls.filter(([, event]) => event === "chat");
  }

  it("emits chat delta for assistant text-only events", () => {
    const { broadcast, nodeSendToSession, nowSpy } = emitRun1AssistantText(
      createHarness({ now: 1_000 }),
      "Hello world",
    );
    const chatCalls = chatBroadcastCalls(broadcast);
    expect(chatCalls).toHaveLength(1);
    const payload = chatCalls[0]?.[1] as {
      state?: string;
      message?: { content?: Array<{ text?: string }> };
    };
    expect(payload.state).toBe("delta");
    expect(payload.message?.content?.[0]?.text).toBe("Hello world");
    expect(sessionChatCalls(nodeSendToSession)).toHaveLength(1);
    nowSpy?.mockRestore();
  });

  it("strips inline directives from assistant chat events", () => {
    const { broadcast, nodeSendToSession, nowSpy } = emitRun1AssistantText(
      createHarness({ now: 1_000 }),
      "Hello [[reply_to_current]] world [[audio_as_voice]]",
    );
    const chatCalls = chatBroadcastCalls(broadcast);
    expect(chatCalls).toHaveLength(1);
    const payload = chatCalls[0]?.[1] as {
      message?: { content?: Array<{ text?: string }> };
    };
    expect(payload.message?.content?.[0]?.text).toBe("Hello  world ");
    expect(sessionChatCalls(nodeSendToSession)).toHaveLength(1);
    nowSpy?.mockRestore();
  });

  it("does not emit chat delta for NO_REPLY streaming text", () => {
    const { broadcast, nodeSendToSession, nowSpy } = emitRun1AssistantText(
      createHarness({ now: 1_000 }),
      " NO_REPLY  ",
    );
    expect(chatBroadcastCalls(broadcast)).toHaveLength(0);
    expect(sessionChatCalls(nodeSendToSession)).toHaveLength(0);
    nowSpy?.mockRestore();
  });

  it("does not include NO_REPLY text in chat final message", () => {
    const { broadcast, nodeSendToSession, chatRunState, handler, nowSpy } = createHarness({
      now: 2_000,
    });
    chatRunState.registry.add("run-2", { sessionKey: "session-2", clientRunId: "client-2" });

    handler({
      runId: "run-2",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "NO_REPLY" },
    });
    handler({
      runId: "run-2",
      seq: 2,
      stream: "lifecycle",
      ts: Date.now(),
      data: { phase: "end" },
    });

    const chatCalls = chatBroadcastCalls(broadcast);
    expect(chatCalls).toHaveLength(1);
    const payload = chatCalls[0]?.[1] as { state?: string; message?: unknown };
    expect(payload.state).toBe("final");
    expect(payload.message).toBeUndefined();
    expect(sessionChatCalls(nodeSendToSession)).toHaveLength(1);
    nowSpy?.mockRestore();
  });

  it("cleans up agent run sequence tracking when lifecycle completes", () => {
    const { agentRunSeq, chatRunState, handler, nowSpy } = createHarness({ now: 2_500 });
    chatRunState.registry.add("run-cleanup", {
      sessionKey: "session-cleanup",
      clientRunId: "client-cleanup",
    });

    handler({
      runId: "run-cleanup",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "done" },
    });
    expect(agentRunSeq.get("run-cleanup")).toBe(1);

    handler({
      runId: "run-cleanup",
      seq: 2,
      stream: "lifecycle",
      ts: Date.now(),
      data: { phase: "end" },
    });

    expect(agentRunSeq.has("run-cleanup")).toBe(false);
    expect(agentRunSeq.has("client-cleanup")).toBe(false);
    nowSpy?.mockRestore();
  });

  it("routes tool events only to registered recipients when verbose is enabled", () => {
    const { broadcast, broadcastToConnIds, toolEventRecipients, handler } = createHarness({
      resolveSessionKeyForRun: () => "session-1",
    });

    registerAgentRunContext("run-tool", { sessionKey: "session-1", verboseLevel: "on" });
    toolEventRecipients.add("run-tool", "conn-1");

    handler({
      runId: "run-tool",
      seq: 1,
      stream: "tool",
      ts: Date.now(),
      data: { phase: "start", name: "read", toolCallId: "t1" },
    });

    expect(broadcast).not.toHaveBeenCalled();
    expect(broadcastToConnIds).toHaveBeenCalledTimes(1);
    resetAgentRunContextForTest();
  });

  it("broadcasts tool events to WS recipients even when verbose is off, but skips node send", () => {
    const { broadcastToConnIds, nodeSendToSession, toolEventRecipients, handler } = createHarness({
      resolveSessionKeyForRun: () => "session-1",
    });

    registerAgentRunContext("run-tool-off", { sessionKey: "session-1", verboseLevel: "off" });
    toolEventRecipients.add("run-tool-off", "conn-1");

    handler({
      runId: "run-tool-off",
      seq: 1,
      stream: "tool",
      ts: Date.now(),
      data: { phase: "start", name: "read", toolCallId: "t2" },
    });

    // Tool events always broadcast to registered WS recipients
    expect(broadcastToConnIds).toHaveBeenCalledTimes(1);
    // But node/channel subscribers should NOT receive when verbose is off
    const nodeToolCalls = nodeSendToSession.mock.calls.filter(([, event]) => event === "agent");
    expect(nodeToolCalls).toHaveLength(0);
    resetAgentRunContextForTest();
  });

  it("strips tool output when verbose is on", () => {
    const { broadcastToConnIds, toolEventRecipients, handler } = createHarness({
      resolveSessionKeyForRun: () => "session-1",
    });

    registerAgentRunContext("run-tool-on", { sessionKey: "session-1", verboseLevel: "on" });
    toolEventRecipients.add("run-tool-on", "conn-1");

    handler({
      runId: "run-tool-on",
      seq: 1,
      stream: "tool",
      ts: Date.now(),
      data: {
        phase: "result",
        name: "exec",
        toolCallId: "t3",
        result: { content: [{ type: "text", text: "secret" }] },
        partialResult: { content: [{ type: "text", text: "partial" }] },
      },
    });

    expect(broadcastToConnIds).toHaveBeenCalledTimes(1);
    const payload = broadcastToConnIds.mock.calls[0]?.[1] as { data?: Record<string, unknown> };
    expect(payload.data?.result).toBeUndefined();
    expect(payload.data?.partialResult).toBeUndefined();
    resetAgentRunContextForTest();
  });

  it("keeps tool output when verbose is full", () => {
    const { broadcastToConnIds, toolEventRecipients, handler } = createHarness({
      resolveSessionKeyForRun: () => "session-1",
    });

    registerAgentRunContext("run-tool-full", { sessionKey: "session-1", verboseLevel: "full" });
    toolEventRecipients.add("run-tool-full", "conn-1");

    const result = { content: [{ type: "text", text: "secret" }] };
    handler({
      runId: "run-tool-full",
      seq: 1,
      stream: "tool",
      ts: Date.now(),
      data: {
        phase: "result",
        name: "exec",
        toolCallId: "t4",
        result,
      },
    });

    expect(broadcastToConnIds).toHaveBeenCalledTimes(1);
    const payload = broadcastToConnIds.mock.calls[0]?.[1] as { data?: Record<string, unknown> };
    expect(payload.data?.result).toEqual(result);
    resetAgentRunContextForTest();
  });

  // ── Session event log + replay cursor tests ──

  it("assigns globalSeq to broadcast events and logs them", () => {
    const { broadcast, sessionEventLog, handler } = createHarness({
      resolveSessionKeyForRun: () => "session-log",
    });

    handler({
      runId: "run-log",
      seq: 1,
      stream: "lifecycle",
      ts: Date.now(),
      data: { phase: "start" },
    });
    handler({
      runId: "run-log",
      seq: 2,
      stream: "assistant",
      ts: Date.now(),
      data: { delta: "hello" },
    });

    expect(broadcast).toHaveBeenCalledTimes(2);
    const firstPayload = broadcast.mock.calls[0]?.[1] as { globalSeq?: number };
    const secondPayload = broadcast.mock.calls[1]?.[1] as { globalSeq?: number };
    expect(typeof firstPayload.globalSeq).toBe("number");
    expect(typeof secondPayload.globalSeq).toBe("number");
    expect(secondPayload.globalSeq).toBeGreaterThan(firstPayload.globalSeq!);
    expect(sessionEventLog.currentSeq()).toBe(2);
  });

  it("routes events to session subscribers and replays from cursor", () => {
    const { broadcastToConnIds, sessionEventLog, sessionSubscriptions, handler } = createHarness({
      resolveSessionKeyForRun: () => "session-sub",
    });

    // Emit two events before subscribing.
    handler({ runId: "run-sub", seq: 1, stream: "lifecycle", ts: 1000, data: { phase: "start" } });
    handler({ runId: "run-sub", seq: 2, stream: "assistant", ts: 1001, data: { delta: "hi" } });

    const seqAfterTwo = sessionEventLog.currentSeq();

    // Subscribe with cursor 0 — should be able to replay both events.
    const replayed = sessionEventLog.replayAfter("session-sub", 0);
    expect(replayed.length).toBe(2);
    expect(replayed[0].globalSeq).toBe(seqAfterTwo - 1);
    expect(replayed[1].globalSeq).toBe(seqAfterTwo);

    // Subscribe after first event — should replay only the second.
    const partial = sessionEventLog.replayAfter("session-sub", seqAfterTwo - 1);
    expect(partial.length).toBe(1);
    expect(partial[0].globalSeq).toBe(seqAfterTwo);

    // Register a session subscriber and emit a new event.
    sessionSubscriptions.add("session-sub", "conn-1");
    broadcastToConnIds.mockClear();

    handler({ runId: "run-sub", seq: 3, stream: "assistant", ts: 1002, data: { delta: " world" } });

    // Session subscriber should receive the event via broadcastToConnIds (twice:
    // once from the general tool/broadcast path, once from session subscriber routing).
    const subCalls = broadcastToConnIds.mock.calls.filter((c) => {
      const connIds = c[2] as ReadonlySet<string>;
      return connIds.has("conn-1");
    });
    expect(subCalls.length).toBeGreaterThanOrEqual(1);
    const subPayload = subCalls[0]?.[1] as { globalSeq?: number };
    expect(typeof subPayload.globalSeq).toBe("number");
  });

  it("replays nothing for unknown session key", () => {
    const { sessionEventLog, handler } = createHarness({
      resolveSessionKeyForRun: () => "session-x",
    });

    handler({ runId: "run-x", seq: 1, stream: "lifecycle", ts: 1000, data: { phase: "start" } });

    const replayed = sessionEventLog.replayAfter("unknown-session", 0);
    expect(replayed.length).toBe(0);
  });

  it("replays nothing when afterSeq >= current cursor", () => {
    const { sessionEventLog, handler } = createHarness({
      resolveSessionKeyForRun: () => "session-y",
    });

    handler({ runId: "run-y", seq: 1, stream: "lifecycle", ts: 1000, data: { phase: "start" } });
    const current = sessionEventLog.currentSeq();

    const replayed = sessionEventLog.replayAfter("session-y", current);
    expect(replayed.length).toBe(0);
  });
});
