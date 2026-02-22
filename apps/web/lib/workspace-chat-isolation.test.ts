import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
  readdirSync: vi.fn(() => []),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn(() => ""),
  exec: vi.fn(
    (
      _cmd: string,
      _opts: unknown,
      cb: (err: Error | null, result: { stdout: string }) => void,
    ) => {
      cb(null, { stdout: "" });
    },
  ),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/home/testuser"),
}));

import { join } from "node:path";

describe("profile-scoped chat session isolation", () => {
  const originalEnv = { ...process.env };
  const STATE_DIR = join("/home/testuser", ".openclaw");

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.OPENCLAW_PROFILE;
    delete process.env.OPENCLAW_HOME;
    delete process.env.OPENCLAW_WORKSPACE;
    delete process.env.OPENCLAW_STATE_DIR;

    vi.mock("node:fs", () => ({
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(() => ""),
      readdirSync: vi.fn(() => []),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
    }));
    vi.mock("node:child_process", () => ({
      execSync: vi.fn(() => ""),
      exec: vi.fn(
        (
          _cmd: string,
          _opts: unknown,
          cb: (err: Error | null, result: { stdout: string }) => void,
        ) => {
          cb(null, { stdout: "" });
        },
      ),
    }));
    vi.mock("node:os", () => ({
      homedir: vi.fn(() => "/home/testuser"),
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function importWorkspace() {
    const { readFileSync: rfs, writeFileSync: wfs, existsSync: es } =
      await import("node:fs");
    const mod = await import("./workspace.js");
    return {
      ...mod,
      mockReadFile: vi.mocked(rfs),
      mockWriteFile: vi.mocked(wfs),
      mockExists: vi.mocked(es),
    };
  }

  it("default profile uses web-chat directory", async () => {
    const { resolveWebChatDir, mockReadFile } = await importWorkspace();
    mockReadFile.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(resolveWebChatDir()).toBe(join(STATE_DIR, "web-chat"));
  });

  it("named profile uses web-chat-<name> directory", async () => {
    const { resolveWebChatDir, setUIActiveProfile, mockReadFile } =
      await importWorkspace();
    mockReadFile.mockReturnValue(JSON.stringify({}) as never);
    setUIActiveProfile("work");
    expect(resolveWebChatDir()).toBe(join(STATE_DIR, "web-chat-work"));
  });

  it("different profiles produce different chat directories", async () => {
    const { resolveWebChatDir, setUIActiveProfile, clearUIActiveProfileCache, mockReadFile } =
      await importWorkspace();
    mockReadFile.mockReturnValue(JSON.stringify({}) as never);

    setUIActiveProfile("alpha");
    const dirAlpha = resolveWebChatDir();

    clearUIActiveProfileCache();
    setUIActiveProfile("beta");
    const dirBeta = resolveWebChatDir();

    expect(dirAlpha).not.toBe(dirBeta);
    expect(dirAlpha).toBe(join(STATE_DIR, "web-chat-alpha"));
    expect(dirBeta).toBe(join(STATE_DIR, "web-chat-beta"));
  });

  it("switching to default after named profile reverts to base dir", async () => {
    const { resolveWebChatDir, setUIActiveProfile, mockReadFile } =
      await importWorkspace();
    mockReadFile.mockReturnValue(JSON.stringify({}) as never);

    setUIActiveProfile("work");
    expect(resolveWebChatDir()).toBe(join(STATE_DIR, "web-chat-work"));

    setUIActiveProfile(null);
    expect(resolveWebChatDir()).toBe(join(STATE_DIR, "web-chat"));
  });

  it("'default' profile name uses base web-chat dir (case-insensitive)", async () => {
    const { resolveWebChatDir, setUIActiveProfile, mockReadFile } =
      await importWorkspace();
    mockReadFile.mockReturnValue(JSON.stringify({}) as never);

    setUIActiveProfile("Default");
    expect(resolveWebChatDir()).toBe(join(STATE_DIR, "web-chat"));

    setUIActiveProfile("DEFAULT");
    expect(resolveWebChatDir()).toBe(join(STATE_DIR, "web-chat"));
  });

  it("OPENCLAW_STATE_DIR override changes base for chat dirs", async () => {
    process.env.OPENCLAW_STATE_DIR = "/custom/state";
    const { resolveWebChatDir, setUIActiveProfile, mockReadFile } =
      await importWorkspace();
    mockReadFile.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(resolveWebChatDir()).toBe(join("/custom/state", "web-chat"));

    setUIActiveProfile("test");
    expect(resolveWebChatDir()).toBe(join("/custom/state", "web-chat-test"));
  });

  it("workspace roots are isolated per profile too", async () => {
    const { resolveWorkspaceRoot, setUIActiveProfile, clearUIActiveProfileCache, mockExists, mockReadFile } =
      await importWorkspace();
    mockReadFile.mockReturnValue(JSON.stringify({}) as never);

    const defaultWs = join(STATE_DIR, "workspace");
    const workWs = join(STATE_DIR, "workspace-work");

    mockExists.mockImplementation((p) => {
      const s = String(p);
      return s === defaultWs || s === workWs;
    });

    clearUIActiveProfileCache();
    setUIActiveProfile(null);
    expect(resolveWorkspaceRoot()).toBe(defaultWs);

    setUIActiveProfile("work");
    expect(resolveWorkspaceRoot()).toBe(workWs);
  });
});
