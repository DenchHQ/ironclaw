import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Dirent } from "node:fs";

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

function makeDirent(name: string, isDir: boolean): Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    path: "",
    parentPath: "",
  } as Dirent;
}

describe("workspace profiles", () => {
  const originalEnv = { ...process.env };
  const STATE_DIR = join("/home/testuser", ".openclaw");
  const UI_STATE_PATH = join(STATE_DIR, ".ironclaw-ui-state.json");

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
    const {
      existsSync: es,
      readFileSync: rfs,
      readdirSync: rds,
      writeFileSync: wfs,
    } = await import("node:fs");
    const mod = await import("./workspace.js");
    return {
      ...mod,
      mockExists: vi.mocked(es),
      mockReadFile: vi.mocked(rfs),
      mockReaddir: vi.mocked(rds),
      mockWriteFile: vi.mocked(wfs),
    };
  }

  // ─── getEffectiveProfile ──────────────────────────────────────────

  describe("getEffectiveProfile", () => {
    it("returns env var when OPENCLAW_PROFILE is set", async () => {
      process.env.OPENCLAW_PROFILE = "work";
      const { getEffectiveProfile } = await importWorkspace();
      expect(getEffectiveProfile()).toBe("work");
    });

    it("returns null when nothing is set", async () => {
      const { getEffectiveProfile, mockReadFile } = await importWorkspace();
      mockReadFile.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      expect(getEffectiveProfile()).toBeNull();
    });

    it("returns persisted profile from state file", async () => {
      const { getEffectiveProfile, mockReadFile } = await importWorkspace();
      mockReadFile.mockReturnValue(
        JSON.stringify({ activeProfile: "personal" }) as never,
      );
      expect(getEffectiveProfile()).toBe("personal");
    });

    it("env var takes precedence over persisted file", async () => {
      process.env.OPENCLAW_PROFILE = "env-profile";
      const { getEffectiveProfile, mockReadFile } = await importWorkspace();
      mockReadFile.mockReturnValue(
        JSON.stringify({ activeProfile: "file-profile" }) as never,
      );
      expect(getEffectiveProfile()).toBe("env-profile");
    });

    it("in-memory override takes precedence over persisted file", async () => {
      const { getEffectiveProfile, setUIActiveProfile, mockReadFile } =
        await importWorkspace();
      mockReadFile.mockReturnValue(
        JSON.stringify({ activeProfile: "file-profile" }) as never,
      );
      setUIActiveProfile("memory-profile");
      expect(getEffectiveProfile()).toBe("memory-profile");
    });

    it("env var takes precedence over in-memory override", async () => {
      process.env.OPENCLAW_PROFILE = "env-wins";
      const { getEffectiveProfile, setUIActiveProfile } =
        await importWorkspace();
      setUIActiveProfile("memory-profile");
      expect(getEffectiveProfile()).toBe("env-wins");
    });

    it("trims whitespace from env var", async () => {
      process.env.OPENCLAW_PROFILE = "  padded  ";
      const { getEffectiveProfile } = await importWorkspace();
      expect(getEffectiveProfile()).toBe("padded");
    });

    it("trims whitespace from persisted profile", async () => {
      const { getEffectiveProfile, mockReadFile } = await importWorkspace();
      mockReadFile.mockReturnValue(
        JSON.stringify({ activeProfile: "  trimme  " }) as never,
      );
      expect(getEffectiveProfile()).toBe("trimme");
    });
  });

  // ─── setUIActiveProfile ──────────────────────────────────────────

  describe("setUIActiveProfile", () => {
    it("persists profile to state file", async () => {
      const { setUIActiveProfile, mockReadFile, mockWriteFile, mockExists } =
        await importWorkspace();
      mockReadFile.mockReturnValue(JSON.stringify({}) as never);
      mockExists.mockReturnValue(true);
      setUIActiveProfile("work");
      expect(mockWriteFile).toHaveBeenCalledWith(
        UI_STATE_PATH,
        expect.stringContaining('"activeProfile": "work"'),
      );
    });

    it("null clears the override", async () => {
      const { setUIActiveProfile, mockReadFile, mockWriteFile, mockExists } =
        await importWorkspace();
      mockReadFile.mockReturnValue(JSON.stringify({}) as never);
      mockExists.mockReturnValue(true);
      setUIActiveProfile(null);
      expect(mockWriteFile).toHaveBeenCalledWith(
        UI_STATE_PATH,
        expect.stringContaining('"activeProfile": null'),
      );
    });

    it("preserves existing state keys", async () => {
      const { setUIActiveProfile, mockReadFile, mockWriteFile, mockExists } =
        await importWorkspace();
      mockReadFile.mockReturnValue(
        JSON.stringify({
          workspaceRegistry: { other: "/path" },
        }) as never,
      );
      mockExists.mockReturnValue(true);
      setUIActiveProfile("new");
      const stateWrites = mockWriteFile.mock.calls.filter((c) =>
        (c[0] as string).includes(".ironclaw-ui-state.json"),
      );
      expect(stateWrites.length).toBeGreaterThan(0);
      const parsed = JSON.parse(stateWrites[stateWrites.length - 1][1] as string);
      expect(parsed.workspaceRegistry).toEqual({ other: "/path" });
      expect(parsed.activeProfile).toBe("new");
    });
  });

  // ─── clearUIActiveProfileCache ────────────────────────────────────

  describe("clearUIActiveProfileCache", () => {
    it("re-reads from file after clearing", async () => {
      const {
        getEffectiveProfile,
        setUIActiveProfile,
        clearUIActiveProfileCache,
        mockReadFile,
      } = await importWorkspace();

      mockReadFile.mockReturnValue(
        JSON.stringify({ activeProfile: "from-file" }) as never,
      );
      setUIActiveProfile("in-memory");
      expect(getEffectiveProfile()).toBe("in-memory");

      clearUIActiveProfileCache();
      expect(getEffectiveProfile()).toBe("from-file");
    });
  });

  // ─── discoverProfiles ─────────────────────────────────────────────

  describe("discoverProfiles", () => {
    it("always includes default profile", async () => {
      const { discoverProfiles, mockExists } = await importWorkspace();
      mockExists.mockReturnValue(false);
      const profiles = discoverProfiles();
      expect(profiles).toHaveLength(1);
      expect(profiles[0].name).toBe("default");
    });

    it("default profile is active when no profile set", async () => {
      const { discoverProfiles, clearUIActiveProfileCache, mockExists, mockReadFile } =
        await importWorkspace();
      mockReadFile.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      mockExists.mockReturnValue(false);
      clearUIActiveProfileCache();
      const profiles = discoverProfiles();
      expect(profiles[0].isActive).toBe(true);
    });

    it("discovers workspace-<name> directories", async () => {
      const { discoverProfiles, mockExists, mockReaddir } =
        await importWorkspace();
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return (
          s === STATE_DIR ||
          s === join(STATE_DIR, "workspace-work") ||
          s === join(STATE_DIR, "workspace-personal")
        );
      });
      mockReaddir.mockReturnValue([
        makeDirent("workspace-work", true),
        makeDirent("workspace-personal", true),
        makeDirent("sessions", true),
        makeDirent("config.json", false),
      ] as unknown as Dirent[]);

      const profiles = discoverProfiles();
      const names = profiles.map((p) => p.name);
      expect(names).toContain("default");
      expect(names).toContain("work");
      expect(names).toContain("personal");
      expect(names).not.toContain("sessions");
    });

    it("marks active profile correctly", async () => {
      const { discoverProfiles, setUIActiveProfile, mockExists, mockReaddir } =
        await importWorkspace();
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return s === STATE_DIR || s === join(STATE_DIR, "workspace-work");
      });
      mockReaddir.mockReturnValue([
        makeDirent("workspace-work", true),
      ] as unknown as Dirent[]);

      setUIActiveProfile("work");
      const profiles = discoverProfiles();
      const defaultProfile = profiles.find((p) => p.name === "default");
      const workProfile = profiles.find((p) => p.name === "work");
      expect(defaultProfile?.isActive).toBe(false);
      expect(workProfile?.isActive).toBe(true);
    });

    it("merges registry entries for custom-path workspaces", async () => {
      const { discoverProfiles, mockExists, mockReadFile } =
        await importWorkspace();
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return s === "/custom/workspace" || s === STATE_DIR;
      });
      mockReadFile.mockReturnValue(
        JSON.stringify({
          workspaceRegistry: { custom: "/custom/workspace" },
        }) as never,
      );

      const profiles = discoverProfiles();
      const custom = profiles.find((p) => p.name === "custom");
      expect(custom).toBeDefined();
      expect(custom!.workspaceDir).toBe("/custom/workspace");
    });

    it("does not duplicate profiles seen via directory and registry", async () => {
      const { discoverProfiles, mockExists, mockReaddir, mockReadFile } =
        await importWorkspace();
      const wsDir = join(STATE_DIR, "workspace-shared");
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return s === STATE_DIR || s === wsDir;
      });
      mockReaddir.mockReturnValue([
        makeDirent("workspace-shared", true),
      ] as unknown as Dirent[]);
      mockReadFile.mockReturnValue(
        JSON.stringify({
          workspaceRegistry: { shared: wsDir },
        }) as never,
      );

      const profiles = discoverProfiles();
      const sharedProfiles = profiles.filter((p) => p.name === "shared");
      expect(sharedProfiles).toHaveLength(1);
    });

    it("handles unreadable state directory gracefully", async () => {
      const { discoverProfiles, mockExists, mockReaddir } =
        await importWorkspace();
      mockExists.mockReturnValue(true);
      mockReaddir.mockImplementation(() => {
        throw new Error("EACCES");
      });
      const profiles = discoverProfiles();
      expect(profiles.length).toBeGreaterThanOrEqual(1);
      expect(profiles[0].name).toBe("default");
    });
  });

  // ─── resolveWebChatDir ────────────────────────────────────────────

  describe("resolveWebChatDir", () => {
    it("returns web-chat for default profile", async () => {
      const { resolveWebChatDir, mockReadFile } = await importWorkspace();
      mockReadFile.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      expect(resolveWebChatDir()).toBe(join(STATE_DIR, "web-chat"));
    });

    it("returns web-chat-<name> for named profile", async () => {
      const { resolveWebChatDir, setUIActiveProfile, mockReadFile } =
        await importWorkspace();
      mockReadFile.mockReturnValue(JSON.stringify({}) as never);
      setUIActiveProfile("work");
      expect(resolveWebChatDir()).toBe(join(STATE_DIR, "web-chat-work"));
    });

    it("returns web-chat when profile is 'default'", async () => {
      const { resolveWebChatDir, setUIActiveProfile, mockReadFile } =
        await importWorkspace();
      mockReadFile.mockReturnValue(JSON.stringify({}) as never);
      setUIActiveProfile("default");
      expect(resolveWebChatDir()).toBe(join(STATE_DIR, "web-chat"));
    });

    it("respects OPENCLAW_STATE_DIR override", async () => {
      process.env.OPENCLAW_STATE_DIR = "/custom/state";
      const { resolveWebChatDir, mockReadFile } = await importWorkspace();
      mockReadFile.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      expect(resolveWebChatDir()).toBe(join("/custom/state", "web-chat"));
    });
  });

  // ─── resolveWorkspaceRoot (profile-aware) ─────────────────────────

  describe("resolveWorkspaceRoot (profile-aware)", () => {
    it("returns workspace-<name> for named profile", async () => {
      const { resolveWorkspaceRoot, setUIActiveProfile, mockExists, mockReadFile } =
        await importWorkspace();
      mockReadFile.mockReturnValue(JSON.stringify({}) as never);
      setUIActiveProfile("work");
      const workDir = join(STATE_DIR, "workspace-work");
      mockExists.mockImplementation((p) => String(p) === workDir);
      expect(resolveWorkspaceRoot()).toBe(workDir);
    });

    it("prefers registry path over directory convention", async () => {
      const {
        resolveWorkspaceRoot,
        setUIActiveProfile,
        mockExists,
        mockReadFile,
      } = await importWorkspace();
      mockReadFile.mockReturnValue(
        JSON.stringify({
          workspaceRegistry: { work: "/custom/work" },
        }) as never,
      );
      setUIActiveProfile("work");
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return (
          s === "/custom/work" || s === join(STATE_DIR, "workspace-work")
        );
      });
      expect(resolveWorkspaceRoot()).toBe("/custom/work");
    });

    it("OPENCLAW_WORKSPACE env takes top priority", async () => {
      process.env.OPENCLAW_WORKSPACE = "/env/workspace";
      const { resolveWorkspaceRoot, setUIActiveProfile, mockExists, mockReadFile } =
        await importWorkspace();
      mockReadFile.mockReturnValue(JSON.stringify({}) as never);
      setUIActiveProfile("work");
      mockExists.mockImplementation((p) => String(p) === "/env/workspace");
      expect(resolveWorkspaceRoot()).toBe("/env/workspace");
    });

    it("falls back to default workspace when named profile dir missing", async () => {
      const { resolveWorkspaceRoot, setUIActiveProfile, mockExists, mockReadFile } =
        await importWorkspace();
      mockReadFile.mockReturnValue(JSON.stringify({}) as never);
      setUIActiveProfile("missing");
      const defaultDir = join(STATE_DIR, "workspace");
      mockExists.mockImplementation((p) => String(p) === defaultDir);
      expect(resolveWorkspaceRoot()).toBe(defaultDir);
    });
  });

  // ─── registerWorkspacePath / getRegisteredWorkspacePath ────────────

  describe("workspace registry", () => {
    it("registerWorkspacePath persists to state file", async () => {
      const { registerWorkspacePath, mockReadFile, mockWriteFile, mockExists } =
        await importWorkspace();
      mockReadFile.mockReturnValue(JSON.stringify({}) as never);
      mockExists.mockReturnValue(true);
      registerWorkspacePath("myprofile", "/my/workspace");
      const stateWrites = mockWriteFile.mock.calls.filter((c) =>
        (c[0] as string).includes(".ironclaw-ui-state.json"),
      );
      expect(stateWrites.length).toBeGreaterThan(0);
      const parsed = JSON.parse(stateWrites[stateWrites.length - 1][1] as string);
      expect(parsed.workspaceRegistry.myprofile).toBe("/my/workspace");
    });

    it("getRegisteredWorkspacePath returns null for unknown profile", async () => {
      const { getRegisteredWorkspacePath, mockReadFile } =
        await importWorkspace();
      mockReadFile.mockReturnValue(JSON.stringify({}) as never);
      expect(getRegisteredWorkspacePath("unknown")).toBeNull();
    });

    it("getRegisteredWorkspacePath returns null for null profile", async () => {
      const { getRegisteredWorkspacePath } = await importWorkspace();
      expect(getRegisteredWorkspacePath(null)).toBeNull();
    });

    it("getRegisteredWorkspacePath returns path for registered profile", async () => {
      const { getRegisteredWorkspacePath, mockReadFile } =
        await importWorkspace();
      mockReadFile.mockReturnValue(
        JSON.stringify({
          workspaceRegistry: { test: "/test/workspace" },
        }) as never,
      );
      expect(getRegisteredWorkspacePath("test")).toBe("/test/workspace");
    });

    it("registerWorkspacePath preserves existing registry entries", async () => {
      const { registerWorkspacePath, mockReadFile, mockWriteFile, mockExists } =
        await importWorkspace();
      mockReadFile.mockReturnValue(
        JSON.stringify({
          workspaceRegistry: { existing: "/existing" },
        }) as never,
      );
      mockExists.mockReturnValue(true);
      registerWorkspacePath("new", "/new/path");
      const stateWrites = mockWriteFile.mock.calls.filter((c) =>
        (c[0] as string).includes(".ironclaw-ui-state.json"),
      );
      expect(stateWrites.length).toBeGreaterThan(0);
      const parsed = JSON.parse(stateWrites[stateWrites.length - 1][1] as string);
      expect(parsed.workspaceRegistry.existing).toBe("/existing");
      expect(parsed.workspaceRegistry.new).toBe("/new/path");
    });
  });
});
