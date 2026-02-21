import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
  readdirSync: vi.fn(() => []),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  copyFileSync: vi.fn(),
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

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

describe("POST /api/workspace/init", () => {
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
      copyFileSync: vi.fn(),
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

  async function callInit(body: Record<string, unknown>) {
    const { POST } = await import("./route.js");
    const req = new Request("http://localhost/api/workspace/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return POST(req);
  }

  it("creates default workspace directory", async () => {
    const mockMkdir = vi.mocked(mkdirSync);
    const response = await callInit({});
    expect(response.status).toBe(200);
    expect(mockMkdir).toHaveBeenCalledWith(
      join(STATE_DIR, "workspace"),
      { recursive: true },
    );
    const json = await response.json();
    expect(json.profile).toBe("default");
    expect(json.workspaceDir).toBe(join(STATE_DIR, "workspace"));
  });

  it("creates profile-specific workspace directory", async () => {
    const mockMkdir = vi.mocked(mkdirSync);
    const response = await callInit({ profile: "work" });
    expect(response.status).toBe(200);
    expect(mockMkdir).toHaveBeenCalledWith(
      join(STATE_DIR, "workspace-work"),
      { recursive: true },
    );
    const json = await response.json();
    expect(json.profile).toBe("work");
  });

  it("rejects invalid profile names", async () => {
    const response = await callInit({ profile: "invalid profile!" });
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("Invalid profile name");
  });

  it("allows alphanumeric, hyphens, and underscores in profile names", async () => {
    const response = await callInit({ profile: "my-work_1" });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.profile).toBe("my-work_1");
  });

  it("accepts 'default' as profile name", async () => {
    const response = await callInit({ profile: "default" });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.workspaceDir).toBe(join(STATE_DIR, "workspace"));
  });

  it("seeds bootstrap files when seedBootstrap is not false", async () => {
    const mockWrite = vi.mocked(writeFileSync);
    await callInit({});
    const writtenPaths = mockWrite.mock.calls.map((c) => c[0] as string);
    const bootstrapFiles = writtenPaths.filter(
      (p) =>
        p.endsWith("AGENTS.md") ||
        p.endsWith("SOUL.md") ||
        p.endsWith("TOOLS.md") ||
        p.endsWith("IDENTITY.md") ||
        p.endsWith("USER.md") ||
        p.endsWith("HEARTBEAT.md") ||
        p.endsWith("BOOTSTRAP.md"),
    );
    expect(bootstrapFiles.length).toBeGreaterThan(0);
  });

  it("returns seeded files list", async () => {
    const response = await callInit({});
    const json = await response.json();
    expect(Array.isArray(json.seededFiles)).toBe(true);
  });

  it("skips bootstrap seeding when seedBootstrap is false", async () => {
    const mockWrite = vi.mocked(writeFileSync);
    const callsBefore = mockWrite.mock.calls.length;
    await callInit({ seedBootstrap: false });
    const bootstrapWrites = mockWrite.mock.calls
      .slice(callsBefore)
      .filter((c) => {
        const p = c[0] as string;
        return p.endsWith(".md") && !p.endsWith("workspace-state.json");
      });
    expect(bootstrapWrites).toHaveLength(0);
  });

  it("does not overwrite existing bootstrap files (idempotent)", async () => {
    const mockExist = vi.mocked(existsSync);
    const wsDir = join(STATE_DIR, "workspace");
    mockExist.mockImplementation((p) => {
      const s = String(p);
      return s === join(wsDir, "AGENTS.md") || s === join(wsDir, "SOUL.md");
    });

    const response = await callInit({});
    const json = await response.json();
    expect(json.seededFiles).not.toContain("AGENTS.md");
    expect(json.seededFiles).not.toContain("SOUL.md");
  });

  it("handles custom workspace path", async () => {
    const mockMkdir = vi.mocked(mkdirSync);
    const response = await callInit({
      profile: "custom",
      path: "/my/custom/workspace",
    });
    expect(response.status).toBe(200);
    expect(mockMkdir).toHaveBeenCalledWith("/my/custom/workspace", {
      recursive: true,
    });
    const json = await response.json();
    expect(json.workspaceDir).toBe("/my/custom/workspace");
  });

  it("resolves tilde in custom path", async () => {
    const mockMkdir = vi.mocked(mkdirSync);
    await callInit({ profile: "tilde", path: "~/my-workspace" });
    expect(mockMkdir).toHaveBeenCalledWith(
      join("/home/testuser", "my-workspace"),
      { recursive: true },
    );
  });

  it("auto-switches to new profile after creation", async () => {
    const response = await callInit({ profile: "newprofile" });
    const json = await response.json();
    expect(json.activeProfile).toBe("newprofile");
  });

  it("handles mkdir failure with 500", async () => {
    const mockMkdir = vi.mocked(mkdirSync);
    mockMkdir.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });
    const response = await callInit({ profile: "fail" });
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error).toContain("Failed to create workspace directory");
  });
});
