import { describe, expect, it, afterEach } from "vitest";

import {
  cancelActiveRun,
  clearAllSessionsForTest,
  createSession,
  getSessionByRunId,
  setActiveRun,
} from "./session.js";

describe("acp session manager", () => {
  afterEach(() => {
    clearAllSessionsForTest();
  });

  it("tracks active runs and clears on cancel", () => {
    const session = createSession({
      sessionKey: "acp:test",
      cwd: "/tmp",
    });
    const controller = new AbortController();
    setActiveRun(session.sessionId, "run-1", controller);

    expect(getSessionByRunId("run-1")?.sessionId).toBe(session.sessionId);

    const cancelled = cancelActiveRun(session.sessionId);
    expect(cancelled).toBe(true);
    expect(getSessionByRunId("run-1")).toBeUndefined();
  });
});
