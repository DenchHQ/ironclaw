import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Dirent } from "node:fs";

// Mock node:fs — all fs operations are controlled by tests
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
  readdirSync: vi.fn(() => []),
}));

// Mock node:child_process
vi.mock("node:child_process", () => ({
  execSync: vi.fn(() => ""),
  exec: vi.fn((_cmd: string, _opts: unknown, cb: (err: Error | null, result: { stdout: string }) => void) => {
    cb(null, { stdout: "" });
  }),
}));

// Mock node:os
vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/home/testuser"),
}));

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const _mockExistsSync = vi.mocked(existsSync);
const _mockReadFileSync = vi.mocked(readFileSync);
const _mockReaddirSync = vi.mocked(readdirSync);
const _mockExecSync = vi.mocked(execSync);

/** Helper to create mock Dirent entries. */
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

describe("workspace utilities", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    // Re-wire mocks after resetModules
    vi.mock("node:fs", () => ({
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(() => ""),
      readdirSync: vi.fn(() => []),
    }));
    vi.mock("node:child_process", () => ({
      execSync: vi.fn(() => ""),
      exec: vi.fn((_cmd: string, _opts: unknown, cb: (err: Error | null, result: { stdout: string }) => void) => {
        cb(null, { stdout: "" });
      }),
    }));
    vi.mock("node:os", () => ({
      homedir: vi.fn(() => "/home/testuser"),
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /** Fresh import after mocks are wired. */
  async function importWorkspace() {
    const { existsSync: es, readFileSync: rfs, readdirSync: rds } = await import("node:fs");
    const { execSync: exs } = await import("node:child_process");
    const mod = await import("./workspace.js");
    return {
      ...mod,
      mockExists: vi.mocked(es),
      mockReadFile: vi.mocked(rfs),
      mockReaddir: vi.mocked(rds),
      mockExec: vi.mocked(exs),
    };
  }

  // ─── resolveWorkspaceRoot ────────────────────────────────────────

  describe("resolveWorkspaceRoot", () => {
    it("returns OPENCLAW_WORKSPACE env var when set and exists", async () => {
      process.env.OPENCLAW_WORKSPACE = "/custom/workspace";
      const { resolveWorkspaceRoot, mockExists } = await importWorkspace();
      mockExists.mockImplementation((p) => String(p) === "/custom/workspace");
      expect(resolveWorkspaceRoot()).toBe("/custom/workspace");
    });

    it("returns default ~/.openclaw/workspace when env not set", async () => {
      delete process.env.OPENCLAW_WORKSPACE;
      const { resolveWorkspaceRoot, mockExists } = await importWorkspace();
      const defaultPath = join("/home/testuser", ".openclaw", "workspace");
      mockExists.mockImplementation((p) => String(p) === defaultPath);
      expect(resolveWorkspaceRoot()).toBe(defaultPath);
    });

    it("returns null when no candidate directory exists", async () => {
      delete process.env.OPENCLAW_WORKSPACE;
      const { resolveWorkspaceRoot, mockExists } = await importWorkspace();
      mockExists.mockReturnValue(false);
      expect(resolveWorkspaceRoot()).toBeNull();
    });

    it("prefers OPENCLAW_WORKSPACE over default when both exist", async () => {
      process.env.OPENCLAW_WORKSPACE = "/custom/workspace";
      const { resolveWorkspaceRoot, mockExists } = await importWorkspace();
      mockExists.mockReturnValue(true);
      expect(resolveWorkspaceRoot()).toBe("/custom/workspace");
    });

    it("falls back to default when env var path does not exist", async () => {
      process.env.OPENCLAW_WORKSPACE = "/nonexistent";
      const { resolveWorkspaceRoot, mockExists } = await importWorkspace();
      const defaultPath = join("/home/testuser", ".openclaw", "workspace");
      mockExists.mockImplementation((p) => String(p) === defaultPath);
      expect(resolveWorkspaceRoot()).toBe(defaultPath);
    });
  });

  // ─── resolveAgentWorkspacePrefix ─────────────────────────────────

  describe("resolveAgentWorkspacePrefix", () => {
    it("returns null when no workspace root", async () => {
      delete process.env.OPENCLAW_WORKSPACE;
      const { resolveAgentWorkspacePrefix, mockExists } = await importWorkspace();
      mockExists.mockReturnValue(false);
      expect(resolveAgentWorkspacePrefix()).toBeNull();
    });

    it("returns absolute path when workspace is outside repo", async () => {
      process.env.OPENCLAW_WORKSPACE = "/external/workspace";
      const { resolveAgentWorkspacePrefix, mockExists } = await importWorkspace();
      mockExists.mockImplementation((p) => String(p) === "/external/workspace");
      vi.spyOn(process, "cwd").mockReturnValue("/repo/apps/web");
      expect(resolveAgentWorkspacePrefix()).toBe("/external/workspace");
    });

    it("returns relative path when workspace is inside repo", async () => {
      process.env.OPENCLAW_WORKSPACE = "/repo/workspace";
      const { resolveAgentWorkspacePrefix, mockExists } = await importWorkspace();
      mockExists.mockImplementation((p) => String(p) === "/repo/workspace");
      vi.spyOn(process, "cwd").mockReturnValue("/repo/apps/web");
      expect(resolveAgentWorkspacePrefix()).toBe("workspace");
    });

    it("handles non apps/web cwd", async () => {
      process.env.OPENCLAW_WORKSPACE = "/repo/workspace";
      const { resolveAgentWorkspacePrefix, mockExists } = await importWorkspace();
      mockExists.mockImplementation((p) => String(p) === "/repo/workspace");
      vi.spyOn(process, "cwd").mockReturnValue("/repo");
      expect(resolveAgentWorkspacePrefix()).toBe("workspace");
    });
  });

  // ─── discoverDuckDBPaths ──────────────────────────────────────────

  describe("discoverDuckDBPaths", () => {
    it("returns empty array when root is null", async () => {
      delete process.env.OPENCLAW_WORKSPACE;
      const { discoverDuckDBPaths, mockExists } = await importWorkspace();
      mockExists.mockReturnValue(false);
      expect(discoverDuckDBPaths()).toEqual([]);
    });

    it("returns empty when root has no duckdb files", async () => {
      const { discoverDuckDBPaths, mockExists, mockReaddir } = await importWorkspace();
      mockExists.mockReturnValue(false);
      mockReaddir.mockReturnValue([]);
      expect(discoverDuckDBPaths("/ws")).toEqual([]);
    });

    it("discovers root-level workspace.duckdb", async () => {
      const { discoverDuckDBPaths, mockExists, mockReaddir } = await importWorkspace();
      mockExists.mockImplementation((p) => String(p) === join("/ws", "workspace.duckdb"));
      mockReaddir.mockReturnValue([]);
      expect(discoverDuckDBPaths("/ws")).toEqual([join("/ws", "workspace.duckdb")]);
    });

    it("discovers nested workspace.duckdb files sorted by depth", async () => {
      const { discoverDuckDBPaths, mockExists, mockReaddir } = await importWorkspace();
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return s === join("/ws", "workspace.duckdb") ||
               s === join("/ws", "sub", "workspace.duckdb");
      });
      mockReaddir.mockImplementation((dir) => {
        if (String(dir) === "/ws") {
          return [makeDirent("sub", true)] as unknown as Dirent[];
        }
        return [] as unknown as Dirent[];
      });
      const result = discoverDuckDBPaths("/ws");
      expect(result).toEqual([
        join("/ws", "workspace.duckdb"),
        join("/ws", "sub", "workspace.duckdb"),
      ]);
    });

    it("skips hidden directories", async () => {
      const { discoverDuckDBPaths, mockExists, mockReaddir } = await importWorkspace();
      mockExists.mockImplementation((p) =>
        String(p) === join("/ws", ".hidden", "workspace.duckdb"),
      );
      mockReaddir.mockImplementation((dir) => {
        if (String(dir) === "/ws") {
          return [makeDirent(".hidden", true)] as unknown as Dirent[];
        }
        return [] as unknown as Dirent[];
      });
      expect(discoverDuckDBPaths("/ws")).toEqual([]);
    });

    it("skips tmp, exports, and node_modules directories", async () => {
      const { discoverDuckDBPaths, mockExists, mockReaddir } = await importWorkspace();
      mockExists.mockReturnValue(false);
      mockReaddir.mockImplementation((dir) => {
        if (String(dir) === "/ws") {
          return [
            makeDirent("tmp", true),
            makeDirent("exports", true),
            makeDirent("node_modules", true),
          ] as unknown as Dirent[];
        }
        return [] as unknown as Dirent[];
      });
      expect(discoverDuckDBPaths("/ws")).toEqual([]);
    });

    it("handles unreadable directories gracefully", async () => {
      const { discoverDuckDBPaths, mockExists, mockReaddir } = await importWorkspace();
      mockExists.mockReturnValue(false);
      mockReaddir.mockImplementation(() => {
        throw new Error("EACCES");
      });
      expect(discoverDuckDBPaths("/ws")).toEqual([]);
    });

    it("skips non-directory entries", async () => {
      const { discoverDuckDBPaths, mockExists, mockReaddir } = await importWorkspace();
      mockExists.mockReturnValue(false);
      mockReaddir.mockImplementation((dir) => {
        if (String(dir) === "/ws") {
          return [makeDirent("somefile.txt", false)] as unknown as Dirent[];
        }
        return [] as unknown as Dirent[];
      });
      expect(discoverDuckDBPaths("/ws")).toEqual([]);
    });
  });

  // ─── duckdbPath ──────────────────────────────────────────────────

  describe("duckdbPath", () => {
    it("returns root-level workspace.duckdb when it exists", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { duckdbPath, mockExists, mockReaddir } = await importWorkspace();
      const rootDb = join("/ws", "workspace.duckdb");
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return s === "/ws" || s === rootDb;
      });
      mockReaddir.mockReturnValue([]);
      expect(duckdbPath()).toBe(rootDb);
    });

    it("falls back to discovered nested db when root has none", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { duckdbPath, mockExists, mockReaddir } = await importWorkspace();
      const nestedDb = join("/ws", "sub", "workspace.duckdb");
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return s === "/ws" || s === nestedDb;
      });
      mockReaddir.mockImplementation((dir) => {
        if (String(dir) === "/ws") {
          return [makeDirent("sub", true)] as unknown as Dirent[];
        }
        return [] as unknown as Dirent[];
      });
      expect(duckdbPath()).toBe(nestedDb);
    });

    it("returns null when no workspace root", async () => {
      delete process.env.OPENCLAW_WORKSPACE;
      const { duckdbPath, mockExists } = await importWorkspace();
      mockExists.mockReturnValue(false);
      expect(duckdbPath()).toBeNull();
    });

    it("returns null when workspace exists but no duckdb files", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { duckdbPath, mockExists, mockReaddir } = await importWorkspace();
      mockExists.mockImplementation((p) => String(p) === "/ws");
      mockReaddir.mockReturnValue([]);
      expect(duckdbPath()).toBeNull();
    });
  });

  // ─── duckdbRelativeScope ─────────────────────────────────────────

  describe("duckdbRelativeScope", () => {
    it("returns empty string for root-level db", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { duckdbRelativeScope, mockExists } = await importWorkspace();
      mockExists.mockImplementation((p) => String(p) === "/ws");
      expect(duckdbRelativeScope("/ws/workspace.duckdb")).toBe("");
    });

    it("returns relative path for nested db", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { duckdbRelativeScope, mockExists } = await importWorkspace();
      mockExists.mockImplementation((p) => String(p) === "/ws");
      expect(duckdbRelativeScope("/ws/sub/deep/workspace.duckdb")).toBe(join("sub", "deep"));
    });

    it("returns empty string when no workspace root", async () => {
      delete process.env.OPENCLAW_WORKSPACE;
      const { duckdbRelativeScope, mockExists } = await importWorkspace();
      mockExists.mockReturnValue(false);
      expect(duckdbRelativeScope("/any/workspace.duckdb")).toBe("");
    });
  });

  // ─── resolveDuckdbBin ────────────────────────────────────────────

  describe("resolveDuckdbBin", () => {
    it("finds user-local duckdb install", async () => {
      const { resolveDuckdbBin, mockExists } = await importWorkspace();
      const expected = join("/home/testuser", ".duckdb", "cli", "latest", "duckdb");
      mockExists.mockImplementation((p) => String(p) === expected);
      expect(resolveDuckdbBin()).toBe(expected);
    });

    it("finds homebrew install", async () => {
      const { resolveDuckdbBin, mockExists } = await importWorkspace();
      mockExists.mockImplementation((p) => String(p) === "/opt/homebrew/bin/duckdb");
      expect(resolveDuckdbBin()).toBe("/opt/homebrew/bin/duckdb");
    });

    it("falls back to which duckdb", async () => {
      const { resolveDuckdbBin, mockExists, mockExec } = await importWorkspace();
      mockExists.mockReturnValue(false);
      mockExec.mockReturnValue("/usr/local/bin/duckdb\n" as never);
      expect(resolveDuckdbBin()).toBe("duckdb");
    });

    it("returns null when nothing found", async () => {
      const { resolveDuckdbBin, mockExists, mockExec } = await importWorkspace();
      mockExists.mockReturnValue(false);
      mockExec.mockImplementation(() => { throw new Error("not found"); });
      expect(resolveDuckdbBin()).toBeNull();
    });

    it("checks user-local before homebrew", async () => {
      const { resolveDuckdbBin, mockExists } = await importWorkspace();
      const userLocal = join("/home/testuser", ".duckdb", "cli", "latest", "duckdb");
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return s === userLocal || s === "/opt/homebrew/bin/duckdb";
      });
      expect(resolveDuckdbBin()).toBe(userLocal);
    });
  });

  // ─── duckdbQuery ─────────────────────────────────────────────────

  describe("duckdbQuery", () => {
    it("returns parsed JSON rows on success", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { duckdbQuery, mockExists, mockExec } = await importWorkspace();
      const rootDb = join("/ws", "workspace.duckdb");
      const bin = "/opt/homebrew/bin/duckdb";
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return s === "/ws" || s === rootDb || s === bin;
      });
      mockExec.mockReturnValue('[{"id":"1","name":"test"}]' as never);
      const result = duckdbQuery("SELECT * FROM objects");
      expect(result).toEqual([{ id: "1", name: "test" }]);
    });

    it("returns empty array for empty result", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { duckdbQuery, mockExists, mockExec } = await importWorkspace();
      mockExists.mockReturnValue(true);
      mockExec.mockReturnValue("[]" as never);
      expect(duckdbQuery("SELECT * FROM empty")).toEqual([]);
    });

    it("returns empty array when no db", async () => {
      delete process.env.OPENCLAW_WORKSPACE;
      const { duckdbQuery, mockExists } = await importWorkspace();
      mockExists.mockReturnValue(false);
      expect(duckdbQuery("SELECT 1")).toEqual([]);
    });

    it("returns empty array on execSync error", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { duckdbQuery, mockExists, mockExec } = await importWorkspace();
      mockExists.mockReturnValue(true);
      mockExec.mockImplementation(() => { throw new Error("query failed"); });
      expect(duckdbQuery("BAD SQL")).toEqual([]);
    });
  });

  // ─── duckdbQueryAsync ────────────────────────────────────────────

  describe("duckdbQueryAsync", () => {
    it("returns parsed JSON rows on success", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { duckdbQueryAsync, mockExists } = await importWorkspace();
      const { exec: mockExecFn } = await import("node:child_process");
      const rootDb = join("/ws", "workspace.duckdb");
      const bin = "/opt/homebrew/bin/duckdb";
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return s === "/ws" || s === rootDb || s === bin;
      });
      vi.mocked(mockExecFn).mockImplementation((_cmd: unknown, _opts: unknown, cb: unknown) => {
        (cb as (err: null, r: { stdout: string }) => void)(null, { stdout: '[{"id":"1"}]' });
        return {} as never;
      });
      const result = await duckdbQueryAsync("SELECT * FROM t");
      expect(result).toEqual([{ id: "1" }]);
    });

    it("returns empty array when no db path", async () => {
      delete process.env.OPENCLAW_WORKSPACE;
      const { duckdbQueryAsync, mockExists } = await importWorkspace();
      mockExists.mockReturnValue(false);
      const result = await duckdbQueryAsync("SELECT 1");
      expect(result).toEqual([]);
    });

    it("returns empty array for empty stdout", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { duckdbQueryAsync, mockExists } = await importWorkspace();
      const { exec: mockExecFn } = await import("node:child_process");
      mockExists.mockReturnValue(true);
      vi.mocked(mockExecFn).mockImplementation((_cmd: unknown, _opts: unknown, cb: unknown) => {
        (cb as (err: null, r: { stdout: string }) => void)(null, { stdout: "" });
        return {} as never;
      });
      const result = await duckdbQueryAsync("SELECT 1");
      expect(result).toEqual([]);
    });

    it("returns empty array on exec error", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { duckdbQueryAsync, mockExists } = await importWorkspace();
      const { exec: mockExecFn } = await import("node:child_process");
      mockExists.mockReturnValue(true);
      vi.mocked(mockExecFn).mockImplementation((_cmd: unknown, _opts: unknown, cb: unknown) => {
        (cb as (err: Error) => void)(new Error("fail"));
        return {} as never;
      });
      const result = await duckdbQueryAsync("BAD SQL");
      expect(result).toEqual([]);
    });
  });

  // ─── duckdbQueryAll ──────────────────────────────────────────────

  describe("duckdbQueryAll", () => {
    it("merges results from multiple databases", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { duckdbQueryAll, mockExists, mockExec, mockReaddir } = await importWorkspace();
      const rootDb = join("/ws", "workspace.duckdb");
      const subDb = join("/ws", "sub", "workspace.duckdb");
      const bin = "/opt/homebrew/bin/duckdb";
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return s === "/ws" || s === rootDb || s === subDb || s === bin;
      });
      mockReaddir.mockImplementation((dir) => {
        if (String(dir) === "/ws") {
          return [makeDirent("sub", true)] as unknown as Dirent[];
        }
        return [] as unknown as Dirent[];
      });
      let callCount = 0;
      mockExec.mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {return '[{"name":"rootObj"}]' as never;}
        return '[{"name":"subObj"}]' as never;
      });
      const result = duckdbQueryAll<{ name: string }>("SELECT * FROM objects");
      expect(result).toEqual([{ name: "rootObj" }, { name: "subObj" }]);
    });

    it("deduplicates by key (shallower wins)", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { duckdbQueryAll, mockExists, mockExec, mockReaddir } = await importWorkspace();
      const rootDb = join("/ws", "workspace.duckdb");
      const subDb = join("/ws", "sub", "workspace.duckdb");
      const bin = "/opt/homebrew/bin/duckdb";
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return s === "/ws" || s === rootDb || s === subDb || s === bin;
      });
      mockReaddir.mockImplementation((dir) => {
        if (String(dir) === "/ws") {return [makeDirent("sub", true)] as unknown as Dirent[];}
        return [] as unknown as Dirent[];
      });
      let callCount = 0;
      mockExec.mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {return '[{"name":"obj","val":"root"}]' as never;}
        return '[{"name":"obj","val":"sub"}]' as never;
      });
      const result = duckdbQueryAll<{ name: string; val: string }>("SQL", "name");
      expect(result).toEqual([{ name: "obj", val: "root" }]);
    });

    it("returns empty when no dbs discovered", async () => {
      delete process.env.OPENCLAW_WORKSPACE;
      const { duckdbQueryAll, mockExists } = await importWorkspace();
      mockExists.mockReturnValue(false);
      expect(duckdbQueryAll("SELECT 1")).toEqual([]);
    });

    it("skips failing databases", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { duckdbQueryAll, mockExists, mockExec, mockReaddir } = await importWorkspace();
      const rootDb = join("/ws", "workspace.duckdb");
      const subDb = join("/ws", "sub", "workspace.duckdb");
      const bin = "/opt/homebrew/bin/duckdb";
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return s === "/ws" || s === rootDb || s === subDb || s === bin;
      });
      mockReaddir.mockImplementation((dir) => {
        if (String(dir) === "/ws") {return [makeDirent("sub", true)] as unknown as Dirent[];}
        return [] as unknown as Dirent[];
      });
      let callCount = 0;
      mockExec.mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {throw new Error("corrupt db");}
        return '[{"name":"subObj"}]' as never;
      });
      const result = duckdbQueryAll<{ name: string }>("SELECT *");
      expect(result).toEqual([{ name: "subObj" }]);
    });
  });

  // ─── findDuckDBForObject ─────────────────────────────────────────

  describe("findDuckDBForObject", () => {
    it("finds object in first database", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { findDuckDBForObject, mockExists, mockExec, mockReaddir } = await importWorkspace();
      const rootDb = join("/ws", "workspace.duckdb");
      const bin = "/opt/homebrew/bin/duckdb";
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return s === "/ws" || s === rootDb || s === bin;
      });
      mockReaddir.mockReturnValue([]);
      mockExec.mockReturnValue('[{"id":"123"}]' as never);
      expect(findDuckDBForObject("leads")).toBe(rootDb);
    });

    it("returns null when object not found in any db", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { findDuckDBForObject, mockExists, mockExec, mockReaddir } = await importWorkspace();
      const rootDb = join("/ws", "workspace.duckdb");
      const bin = "/opt/homebrew/bin/duckdb";
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return s === "/ws" || s === rootDb || s === bin;
      });
      mockReaddir.mockReturnValue([]);
      mockExec.mockReturnValue("[]" as never);
      expect(findDuckDBForObject("nonexistent")).toBeNull();
    });

    it("returns null when no dbs exist", async () => {
      delete process.env.OPENCLAW_WORKSPACE;
      const { findDuckDBForObject, mockExists } = await importWorkspace();
      mockExists.mockReturnValue(false);
      expect(findDuckDBForObject("any")).toBeNull();
    });

    it("handles object names with single quotes", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { findDuckDBForObject, mockExists, mockExec, mockReaddir } = await importWorkspace();
      const rootDb = join("/ws", "workspace.duckdb");
      const bin = "/opt/homebrew/bin/duckdb";
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return s === "/ws" || s === rootDb || s === bin;
      });
      mockReaddir.mockReturnValue([]);
      mockExec.mockReturnValue('[{"id":"1"}]' as never);
      expect(findDuckDBForObject("O'Brien's")).toBe(rootDb);
    });
  });

  // ─── duckdbExec / duckdbExecOnFile ───────────────────────────────

  describe("duckdbExec", () => {
    it("returns true on successful exec", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { duckdbExec, mockExists, mockExec } = await importWorkspace();
      const rootDb = join("/ws", "workspace.duckdb");
      const bin = "/opt/homebrew/bin/duckdb";
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return s === "/ws" || s === rootDb || s === bin;
      });
      mockExec.mockReturnValue("" as never);
      expect(duckdbExec("INSERT INTO t VALUES (1)")).toBe(true);
    });

    it("returns false when no database path", async () => {
      delete process.env.OPENCLAW_WORKSPACE;
      const { duckdbExec, mockExists } = await importWorkspace();
      mockExists.mockReturnValue(false);
      expect(duckdbExec("INSERT INTO t VALUES (1)")).toBe(false);
    });
  });

  describe("duckdbExecOnFile", () => {
    it("returns true on success", async () => {
      const { duckdbExecOnFile, mockExists, mockExec } = await importWorkspace();
      mockExists.mockImplementation((p) => String(p) === "/opt/homebrew/bin/duckdb");
      mockExec.mockReturnValue("" as never);
      expect(duckdbExecOnFile("/db/file.duckdb", "CREATE TABLE t(id INT)")).toBe(true);
    });

    it("returns false when no bin", async () => {
      const { duckdbExecOnFile, mockExists, mockExec } = await importWorkspace();
      mockExists.mockReturnValue(false);
      mockExec.mockImplementation(() => { throw new Error("not found"); });
      expect(duckdbExecOnFile("/db/file.duckdb", "SQL")).toBe(false);
    });

    it("returns false on exec error", async () => {
      const { duckdbExecOnFile, mockExists, mockExec } = await importWorkspace();
      mockExists.mockImplementation((p) => String(p) === "/opt/homebrew/bin/duckdb");
      mockExec.mockImplementation(() => { throw new Error("exec failed"); });
      expect(duckdbExecOnFile("/db/file.duckdb", "BAD SQL")).toBe(false);
    });
  });

  // ─── parseRelationValue ──────────────────────────────────────────

  describe("parseRelationValue", () => {
    it("returns empty array for null", async () => {
      const { parseRelationValue } = await importWorkspace();
      expect(parseRelationValue(null)).toEqual([]);
    });

    it("returns empty array for undefined", async () => {
      const { parseRelationValue } = await importWorkspace();
      expect(parseRelationValue(undefined)).toEqual([]);
    });

    it("returns empty array for empty string", async () => {
      const { parseRelationValue } = await importWorkspace();
      expect(parseRelationValue("")).toEqual([]);
    });

    it("returns empty array for whitespace-only string", async () => {
      const { parseRelationValue } = await importWorkspace();
      expect(parseRelationValue("   ")).toEqual([]);
    });

    it("returns single ID for simple string", async () => {
      const { parseRelationValue } = await importWorkspace();
      expect(parseRelationValue("abc-123")).toEqual(["abc-123"]);
    });

    it("parses JSON array of IDs", async () => {
      const { parseRelationValue } = await importWorkspace();
      expect(parseRelationValue('["id1","id2","id3"]')).toEqual(["id1", "id2", "id3"]);
    });

    it("converts numeric array elements to strings", async () => {
      const { parseRelationValue } = await importWorkspace();
      expect(parseRelationValue("[1,2,3]")).toEqual(["1", "2", "3"]);
    });

    it("filters empty values from array", async () => {
      const { parseRelationValue } = await importWorkspace();
      expect(parseRelationValue('["a","","b"]')).toEqual(["a", "b"]);
    });

    it("treats invalid JSON starting with [ as single value", async () => {
      const { parseRelationValue } = await importWorkspace();
      expect(parseRelationValue("[not-json")).toEqual(["[not-json"]);
    });

    it("handles empty JSON array", async () => {
      const { parseRelationValue } = await importWorkspace();
      expect(parseRelationValue("[]")).toEqual([]);
    });
  });

  // ─── isDatabaseFile ──────────────────────────────────────────────

  describe("isDatabaseFile", () => {
    it("returns true for .duckdb", async () => {
      const { isDatabaseFile } = await importWorkspace();
      expect(isDatabaseFile("workspace.duckdb")).toBe(true);
    });

    it("returns true for .sqlite", async () => {
      const { isDatabaseFile } = await importWorkspace();
      expect(isDatabaseFile("data.sqlite")).toBe(true);
    });

    it("returns true for .sqlite3", async () => {
      const { isDatabaseFile } = await importWorkspace();
      expect(isDatabaseFile("main.sqlite3")).toBe(true);
    });

    it("returns true for .db", async () => {
      const { isDatabaseFile } = await importWorkspace();
      expect(isDatabaseFile("app.db")).toBe(true);
    });

    it("returns true for .postgres", async () => {
      const { isDatabaseFile } = await importWorkspace();
      expect(isDatabaseFile("conn.postgres")).toBe(true);
    });

    it("returns false for .txt", async () => {
      const { isDatabaseFile } = await importWorkspace();
      expect(isDatabaseFile("notes.txt")).toBe(false);
    });

    it("returns false for .json", async () => {
      const { isDatabaseFile } = await importWorkspace();
      expect(isDatabaseFile("data.json")).toBe(false);
    });

    it("returns false for no extension", async () => {
      const { isDatabaseFile } = await importWorkspace();
      expect(isDatabaseFile("Makefile")).toBe(false);
    });
  });

  // ─── DB_EXTENSIONS ───────────────────────────────────────────────

  describe("DB_EXTENSIONS", () => {
    it("contains all expected extensions", async () => {
      const { DB_EXTENSIONS } = await importWorkspace();
      expect(DB_EXTENSIONS.has("duckdb")).toBe(true);
      expect(DB_EXTENSIONS.has("sqlite")).toBe(true);
      expect(DB_EXTENSIONS.has("sqlite3")).toBe(true);
      expect(DB_EXTENSIONS.has("db")).toBe(true);
      expect(DB_EXTENSIONS.has("postgres")).toBe(true);
    });

    it("does not contain non-database extensions", async () => {
      const { DB_EXTENSIONS } = await importWorkspace();
      expect(DB_EXTENSIONS.has("json")).toBe(false);
      expect(DB_EXTENSIONS.has("txt")).toBe(false);
      expect(DB_EXTENSIONS.has("csv")).toBe(false);
    });
  });

  // ─── duckdbQueryOnFile ───────────────────────────────────────────

  describe("duckdbQueryOnFile", () => {
    it("executes query against specific db file", async () => {
      const { duckdbQueryOnFile, mockExists, mockExec } = await importWorkspace();
      mockExists.mockImplementation((p) => String(p) === "/opt/homebrew/bin/duckdb");
      mockExec.mockReturnValue('[{"col":"val"}]' as never);
      expect(duckdbQueryOnFile("/any/db.duckdb", "SELECT *")).toEqual([{ col: "val" }]);
    });

    it("returns empty array when no bin found", async () => {
      const { duckdbQueryOnFile, mockExists, mockExec } = await importWorkspace();
      mockExists.mockReturnValue(false);
      mockExec.mockImplementation(() => { throw new Error("not found"); });
      expect(duckdbQueryOnFile("/any/db.duckdb", "SELECT *")).toEqual([]);
    });

    it("returns empty for empty result", async () => {
      const { duckdbQueryOnFile, mockExists, mockExec } = await importWorkspace();
      mockExists.mockImplementation((p) => String(p) === "/opt/homebrew/bin/duckdb");
      mockExec.mockReturnValue("" as never);
      expect(duckdbQueryOnFile("/any/db.duckdb", "SELECT *")).toEqual([]);
    });
  });

  // ─── safeResolvePath ─────────────────────────────────────────────

  describe("safeResolvePath", () => {
    it("resolves valid path within workspace", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { safeResolvePath, mockExists } = await importWorkspace();
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return s === "/ws" || s === "/ws/knowledge/doc.md";
      });
      expect(safeResolvePath("knowledge/doc.md")).toBe("/ws/knowledge/doc.md");
    });

    it("returns null for traversal with ..", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { safeResolvePath, mockExists } = await importWorkspace();
      mockExists.mockReturnValue(true);
      expect(safeResolvePath("../etc/passwd")).toBeNull();
    });

    it("returns null for traversal with /../", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { safeResolvePath, mockExists } = await importWorkspace();
      mockExists.mockReturnValue(true);
      expect(safeResolvePath("foo/../../../etc/passwd")).toBeNull();
    });

    it("returns null when file does not exist", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { safeResolvePath, mockExists } = await importWorkspace();
      mockExists.mockImplementation((p) => String(p) === "/ws");
      expect(safeResolvePath("nonexistent.txt")).toBeNull();
    });

    it("returns null when no workspace root", async () => {
      delete process.env.OPENCLAW_WORKSPACE;
      const { safeResolvePath, mockExists } = await importWorkspace();
      mockExists.mockReturnValue(false);
      expect(safeResolvePath("any/file.txt")).toBeNull();
    });
  });

  // ─── safeResolveNewPath ──────────────────────────────────────────

  describe("safeResolveNewPath", () => {
    it("resolves valid new path (does not require existence)", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { safeResolveNewPath, mockExists } = await importWorkspace();
      mockExists.mockImplementation((p) => String(p) === "/ws");
      expect(safeResolveNewPath("new-folder/file.txt")).toBe("/ws/new-folder/file.txt");
    });

    it("returns null for traversal attempts", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { safeResolveNewPath, mockExists } = await importWorkspace();
      mockExists.mockReturnValue(true);
      expect(safeResolveNewPath("../../outside")).toBeNull();
    });

    it("returns null when no workspace root", async () => {
      delete process.env.OPENCLAW_WORKSPACE;
      const { safeResolveNewPath, mockExists } = await importWorkspace();
      mockExists.mockReturnValue(false);
      expect(safeResolveNewPath("any")).toBeNull();
    });

    it("handles deeply nested new paths", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { safeResolveNewPath, mockExists } = await importWorkspace();
      mockExists.mockImplementation((p) => String(p) === "/ws");
      expect(safeResolveNewPath("a/b/c/d/e.txt")).toBe("/ws/a/b/c/d/e.txt");
    });
  });

  // ─── isSystemFile ────────────────────────────────────────────────

  describe("isSystemFile", () => {
    it("returns true for .object.yaml at any depth", async () => {
      const { isSystemFile } = await importWorkspace();
      expect(isSystemFile(".object.yaml")).toBe(true);
      expect(isSystemFile("sub/.object.yaml")).toBe(true);
      expect(isSystemFile("a/b/c/.object.yaml")).toBe(true);
    });

    it("returns true for .wal files at any depth", async () => {
      const { isSystemFile } = await importWorkspace();
      expect(isSystemFile("workspace.duckdb.wal")).toBe(true);
      expect(isSystemFile("sub/data.wal")).toBe(true);
    });

    it("returns true for .tmp files at any depth", async () => {
      const { isSystemFile } = await importWorkspace();
      expect(isSystemFile("upload.tmp")).toBe(true);
      expect(isSystemFile("sub/temp.tmp")).toBe(true);
    });

    it("returns true for workspace.duckdb at root only", async () => {
      const { isSystemFile } = await importWorkspace();
      expect(isSystemFile("workspace.duckdb")).toBe(true);
    });

    it("returns false for workspace.duckdb in subdirectory", async () => {
      const { isSystemFile } = await importWorkspace();
      expect(isSystemFile("sub/workspace.duckdb")).toBe(false);
    });

    it("returns true for workspace_context.yaml at root", async () => {
      const { isSystemFile } = await importWorkspace();
      expect(isSystemFile("workspace_context.yaml")).toBe(true);
    });

    it("returns false for workspace_context.yaml in subdirectory", async () => {
      const { isSystemFile } = await importWorkspace();
      expect(isSystemFile("sub/workspace_context.yaml")).toBe(false);
    });

    it("returns false for regular files", async () => {
      const { isSystemFile } = await importWorkspace();
      expect(isSystemFile("readme.md")).toBe(false);
      expect(isSystemFile("knowledge/notes.md")).toBe(false);
      expect(isSystemFile("data.json")).toBe(false);
    });
  });

  // ─── parseSimpleYaml ─────────────────────────────────────────────

  describe("parseSimpleYaml", () => {
    it("parses basic key-value pairs", async () => {
      const { parseSimpleYaml } = await importWorkspace();
      const result = parseSimpleYaml("name: My Workspace\nversion: 1");
      expect(result).toEqual({ name: "My Workspace", version: 1 });
    });

    it("parses boolean values", async () => {
      const { parseSimpleYaml } = await importWorkspace();
      const result = parseSimpleYaml("enabled: true\ndisabled: false");
      expect(result).toEqual({ enabled: true, disabled: false });
    });

    it("parses null value", async () => {
      const { parseSimpleYaml } = await importWorkspace();
      const result = parseSimpleYaml("empty: null");
      expect(result).toEqual({ empty: null });
    });

    it("parses numeric values", async () => {
      const { parseSimpleYaml } = await importWorkspace();
      const result = parseSimpleYaml("count: 42\nratio: 3.14\nneg: -5");
      expect(result).toEqual({ count: 42, ratio: 3.14, neg: -5 });
    });

    it("strips double quotes from values", async () => {
      const { parseSimpleYaml } = await importWorkspace();
      const result = parseSimpleYaml('title: "My Title"');
      expect(result).toEqual({ title: "My Title" });
    });

    it("strips single quotes from values", async () => {
      const { parseSimpleYaml } = await importWorkspace();
      const result = parseSimpleYaml("title: 'My Title'");
      expect(result).toEqual({ title: "My Title" });
    });

    it("skips comment lines", async () => {
      const { parseSimpleYaml } = await importWorkspace();
      const result = parseSimpleYaml("# This is a comment\nname: test");
      expect(result).toEqual({ name: "test" });
    });

    it("skips empty lines", async () => {
      const { parseSimpleYaml } = await importWorkspace();
      const result = parseSimpleYaml("a: 1\n\n\nb: 2");
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it("handles keys with hyphens and underscores", async () => {
      const { parseSimpleYaml } = await importWorkspace();
      const result = parseSimpleYaml("my-key: val\nmy_key2: val2");
      expect(result).toEqual({ "my-key": "val", "my_key2": "val2" });
    });

    it("returns empty object for empty input", async () => {
      const { parseSimpleYaml } = await importWorkspace();
      expect(parseSimpleYaml("")).toEqual({});
    });
  });

  // ─── readWorkspaceFile ───────────────────────────────────────────

  describe("readWorkspaceFile", () => {
    it("reads markdown file and detects type", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { readWorkspaceFile, mockExists, mockReadFile } = await importWorkspace();
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return s === "/ws" || s === "/ws/doc.md";
      });
      mockReadFile.mockReturnValue("# Hello" as never);
      const result = readWorkspaceFile("doc.md");
      expect(result).toEqual({ content: "# Hello", type: "markdown" });
    });

    it("reads yaml file and detects type", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { readWorkspaceFile, mockExists, mockReadFile } = await importWorkspace();
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return s === "/ws" || s === "/ws/config.yaml";
      });
      mockReadFile.mockReturnValue("key: value" as never);
      const result = readWorkspaceFile("config.yaml");
      expect(result).toEqual({ content: "key: value", type: "yaml" });
    });

    it("reads yml file as yaml type", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { readWorkspaceFile, mockExists, mockReadFile } = await importWorkspace();
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return s === "/ws" || s === "/ws/config.yml";
      });
      mockReadFile.mockReturnValue("key: value" as never);
      const result = readWorkspaceFile("config.yml");
      expect(result).toEqual({ content: "key: value", type: "yaml" });
    });

    it("reads text file with generic type", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { readWorkspaceFile, mockExists, mockReadFile } = await importWorkspace();
      mockExists.mockImplementation((p) => {
        const s = String(p);
        return s === "/ws" || s === "/ws/notes.txt";
      });
      mockReadFile.mockReturnValue("plain text" as never);
      const result = readWorkspaceFile("notes.txt");
      expect(result).toEqual({ content: "plain text", type: "text" });
    });

    it("returns null when file not found", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { readWorkspaceFile, mockExists } = await importWorkspace();
      mockExists.mockImplementation((p) => String(p) === "/ws");
      expect(readWorkspaceFile("nonexistent.md")).toBeNull();
    });

    it("returns null when readFileSync throws", async () => {
      process.env.OPENCLAW_WORKSPACE = "/ws";
      const { readWorkspaceFile, mockExists, mockReadFile } = await importWorkspace();
      mockExists.mockReturnValue(true);
      mockReadFile.mockImplementation(() => { throw new Error("EACCES"); });
      expect(readWorkspaceFile("forbidden.md")).toBeNull();
    });
  });
});
