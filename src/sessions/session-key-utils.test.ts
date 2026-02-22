import { describe, expect, it } from "vitest";
import { getSubagentDepth, isCronSessionKey, isWebSessionKey } from "./session-key-utils.js";

describe("getSubagentDepth", () => {
  it("returns 0 for non-subagent session keys", () => {
    expect(getSubagentDepth("agent:main:main")).toBe(0);
    expect(getSubagentDepth("main")).toBe(0);
    expect(getSubagentDepth(undefined)).toBe(0);
  });

  it("returns 1 for depth-1 subagent session keys", () => {
    expect(getSubagentDepth("agent:main:subagent:123")).toBe(1);
  });

  it("returns 2 for nested subagent session keys", () => {
    expect(getSubagentDepth("agent:main:subagent:parent:subagent:child")).toBe(2);
  });
});

describe("isCronSessionKey", () => {
  it("matches base and run cron agent session keys", () => {
    expect(isCronSessionKey("agent:main:cron:job-1")).toBe(true);
    expect(isCronSessionKey("agent:main:cron:job-1:run:run-1")).toBe(true);
  });

  it("does not match non-cron sessions", () => {
    expect(isCronSessionKey("agent:main:main")).toBe(false);
    expect(isCronSessionKey("agent:main:subagent:worker")).toBe(false);
    expect(isCronSessionKey("cron:job-1")).toBe(false);
    expect(isCronSessionKey(undefined)).toBe(false);
  });
});

describe("isWebSessionKey", () => {
  it("matches web session keys with agent prefix", () => {
    expect(isWebSessionKey("agent:main:web:session-123")).toBe(true);
    expect(isWebSessionKey("agent:main:web:abc-def")).toBe(true);
  });

  it("matches bare web: prefix", () => {
    expect(isWebSessionKey("web:session-123")).toBe(true);
  });

  it("does not match non-web sessions", () => {
    expect(isWebSessionKey("agent:main:main")).toBe(false);
    expect(isWebSessionKey("agent:main:subagent:worker")).toBe(false);
    expect(isWebSessionKey("agent:main:cron:job-1")).toBe(false);
    expect(isWebSessionKey(undefined)).toBe(false);
    expect(isWebSessionKey("")).toBe(false);
  });
});
