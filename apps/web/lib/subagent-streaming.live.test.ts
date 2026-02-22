/**
 * Live E2E tests for subagent streaming.
 *
 * These tests verify that:
 * - Subagent registration works with real disk persistence
 * - Events can be persisted and reloaded from disk
 * - The profile-scoped subagent index works end-to-end
 *
 * Requires: LIVE=1 or OPENCLAW_LIVE_TEST=1
 * Does NOT require a running gateway — tests the subagent run manager directly.
 */
import fs from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

const LIVE =
  process.env.LIVE === "1" ||
  process.env.OPENCLAW_LIVE_TEST === "1" ||
  process.env.CLAWDBOT_LIVE_TEST === "1";

const describeLive = LIVE ? describe : describe.skip;

describeLive("subagent streaming (live)", () => {
  let tempDir: string;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "subagent-live-"));
    process.env.OPENCLAW_HOME = tempDir;
    process.env.OPENCLAW_STATE_DIR = path.join(tempDir, ".openclaw");
    mkdirSync(path.join(tempDir, ".openclaw"), { recursive: true });
    // Reset subagent singleton
    delete (globalThis as Record<string, unknown>)[
      "__openclaw_subagentRuns"
    ];
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    delete (globalThis as Record<string, unknown>)[
      "__openclaw_subagentRuns"
    ];
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("persists subagent index to disk on registration", async () => {
    const webChatDir = path.join(tempDir, ".openclaw", "web-chat");
    mkdirSync(webChatDir, { recursive: true });

    const {
      registerSubagent,
    } = await import("./subagent-runs.js");

    registerSubagent("parent-session", {
      sessionKey: "sub:p:live1",
      runId: "run-live-1",
      task: "live test task",
      label: "live label",
    });

    const indexPath = path.join(webChatDir, "subagent-index.json");
    expect(existsSync(indexPath)).toBe(true);

    const index = JSON.parse(readFileSync(indexPath, "utf-8"));
    expect(index["sub:p:live1"]).toBeDefined();
    expect(index["sub:p:live1"].task).toBe("live test task");
    expect(index["sub:p:live1"].status).toBe("running");
  }, 10_000);

  it("persists user messages to event JSONL file", async () => {
    const webChatDir = path.join(tempDir, ".openclaw", "web-chat");
    mkdirSync(webChatDir, { recursive: true });

    const {
      registerSubagent,
      persistUserMessage,
    } = await import("./subagent-runs.js");

    registerSubagent("parent-session", {
      sessionKey: "sub:p:live2",
      runId: "run-live-2",
      task: "msg persistence test",
    });

    persistUserMessage("sub:p:live2", { text: "hello from live test" });

    const eventsDir = path.join(webChatDir, "subagent-events");
    expect(existsSync(eventsDir)).toBe(true);

    const eventFile = path.join(eventsDir, "sub_p_live2.jsonl");
    expect(existsSync(eventFile)).toBe(true);

    const lines = readFileSync(eventFile, "utf-8")
      .split("\n")
      .filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);

    const event = JSON.parse(lines[0]);
    expect(event.type).toBe("user-message");
    expect(event.text).toBe("hello from live test");
  }, 10_000);

  it("multiple subagents for same parent are tracked independently", async () => {
    const webChatDir = path.join(tempDir, ".openclaw", "web-chat");
    mkdirSync(webChatDir, { recursive: true });

    const {
      registerSubagent,
      getSubagentsForSession,
    } = await import("./subagent-runs.js");

    registerSubagent("parent-multi", {
      sessionKey: "sub:p:multi1",
      runId: "r-m1",
      task: "task 1",
    });
    registerSubagent("parent-multi", {
      sessionKey: "sub:p:multi2",
      runId: "r-m2",
      task: "task 2",
    });

    const subs = getSubagentsForSession("parent-multi");
    expect(subs).toHaveLength(2);
    const keys = subs.map((s) => s.sessionKey);
    expect(keys).toContain("sub:p:multi1");
    expect(keys).toContain("sub:p:multi2");
  }, 10_000);

  it("subscriber receives events in real-time", async () => {
    const webChatDir = path.join(tempDir, ".openclaw", "web-chat");
    mkdirSync(webChatDir, { recursive: true });

    const {
      registerSubagent,
      subscribeToSubagent,
      persistUserMessage,
    } = await import("./subagent-runs.js");

    registerSubagent("parent-sub", {
      sessionKey: "sub:p:realtime",
      runId: "r-rt",
      task: "realtime test",
    });

    const received: Array<Record<string, unknown>> = [];
    subscribeToSubagent(
      "sub:p:realtime",
      (event) => {
        if (event) {received.push(event as Record<string, unknown>);}
      },
      { replay: false },
    );

    persistUserMessage("sub:p:realtime", { text: "msg 1" });
    persistUserMessage("sub:p:realtime", { text: "msg 2" });

    expect(received).toHaveLength(2);
    expect(received[0].text).toBe("msg 1");
    expect(received[1].text).toBe("msg 2");
  }, 10_000);

  it("replay delivers buffered events on subscribe", async () => {
    const webChatDir = path.join(tempDir, ".openclaw", "web-chat");
    mkdirSync(webChatDir, { recursive: true });

    const {
      registerSubagent,
      persistUserMessage,
      subscribeToSubagent,
    } = await import("./subagent-runs.js");

    registerSubagent("parent-replay", {
      sessionKey: "sub:p:replay",
      runId: "r-rp",
      task: "replay test",
    });

    persistUserMessage("sub:p:replay", { text: "buffered 1" });
    persistUserMessage("sub:p:replay", { text: "buffered 2" });

    const received: Array<Record<string, unknown>> = [];
    subscribeToSubagent("sub:p:replay", (event) => {
      if (event) {received.push(event as Record<string, unknown>);}
    });

    expect(received.length).toBeGreaterThanOrEqual(2);
  }, 10_000);
}, 60_000);
