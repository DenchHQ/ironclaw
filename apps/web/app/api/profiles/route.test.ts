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

describe("profiles API", () => {
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

  // ─── GET /api/profiles ────────────────────────────────────────────

  describe("GET /api/profiles", () => {
    async function callGet() {
      const { GET } = await import("./route.js");
      return GET();
    }

    it("returns profiles list with default profile", async () => {
      const response = await callGet();
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.profiles).toBeDefined();
      expect(json.profiles.length).toBeGreaterThanOrEqual(1);
      expect(json.profiles[0].name).toBe("default");
    });

    it("returns activeProfile", async () => {
      const response = await callGet();
      const json = await response.json();
      expect(json.activeProfile).toBe("default");
    });

    it("returns stateDir", async () => {
      const response = await callGet();
      const json = await response.json();
      expect(json.stateDir).toBe(STATE_DIR);
    });

    it("discovers workspace-<name> directories", async () => {
      const { existsSync: es, readdirSync: rds } = await import("node:fs");
      vi.mocked(es).mockImplementation((p) => {
        const s = String(p);
        return (
          s === STATE_DIR ||
          s === join(STATE_DIR, "workspace-dev")
        );
      });
      vi.mocked(rds).mockReturnValue([
        makeDirent("workspace-dev", true),
      ] as unknown as Dirent[]);

      const response = await callGet();
      const json = await response.json();
      const names = json.profiles.map((p: { name: string }) => p.name);
      expect(names).toContain("dev");
    });
  });

  // ─── POST /api/profiles/switch ────────────────────────────────────

  describe("POST /api/profiles/switch", () => {
    async function callSwitch(body: Record<string, unknown>) {
      const { POST } = await import("./switch/route.js");
      const req = new Request("http://localhost/api/profiles/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return POST(req);
    }

    it("switches to named profile", async () => {
      const { writeFileSync: wfs } = await import("node:fs");
      const { existsSync: es } = await import("node:fs");
      vi.mocked(es).mockReturnValue(true);

      const response = await callSwitch({ profile: "work" });
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.activeProfile).toBe("work");

      const writeCalls = vi.mocked(wfs).mock.calls;
      const stateWrite = writeCalls.find((c) =>
        (c[0] as string).includes(".ironclaw-ui-state.json"),
      );
      expect(stateWrite).toBeDefined();
    });

    it("'default' clears the override", async () => {
      const { existsSync: es } = await import("node:fs");
      vi.mocked(es).mockReturnValue(true);

      const response = await callSwitch({ profile: "default" });
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.activeProfile).toBe("default");
    });

    it("rejects missing profile name", async () => {
      const response = await callSwitch({});
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain("Missing profile name");
    });

    it("rejects invalid profile name characters", async () => {
      const response = await callSwitch({ profile: "bad name!" });
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain("Invalid profile name");
    });

    it("returns workspace root after switching", async () => {
      const { existsSync: es } = await import("node:fs");
      const wsDir = join(STATE_DIR, "workspace-dev");
      vi.mocked(es).mockImplementation((p) => {
        const s = String(p);
        return s === wsDir || s.includes(".openclaw");
      });

      const response = await callSwitch({ profile: "dev" });
      const json = await response.json();
      expect(json.workspaceRoot).toBeDefined();
    });

    it("returns stateDir in response", async () => {
      const { existsSync: es } = await import("node:fs");
      vi.mocked(es).mockReturnValue(true);

      const response = await callSwitch({ profile: "test" });
      const json = await response.json();
      expect(json.stateDir).toBe(STATE_DIR);
    });
  });
});
