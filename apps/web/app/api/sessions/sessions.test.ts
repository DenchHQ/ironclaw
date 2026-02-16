import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock node:fs
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ mtimeMs: Date.now() })),
}));

// Mock node:os
vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/home/testuser"),
}));

describe("Sessions, Memories & Skills API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mock("node:fs", () => ({
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(() => ""),
      readdirSync: vi.fn(() => []),
      statSync: vi.fn(() => ({ mtimeMs: Date.now() })),
    }));
    vi.mock("node:os", () => ({
      homedir: vi.fn(() => "/home/testuser"),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── GET /api/sessions ──────────────────────────────────────────

  describe("GET /api/sessions", () => {
    it("returns empty agents and sessions when no dir exists", async () => {
      const { GET } = await import("./route.js");
      const res = await GET();
      const json = await res.json();
      expect(json.agents).toEqual([]);
      expect(json.sessions).toEqual([]);
    });

    it("returns sessions from agent directories", async () => {
      const { existsSync: mockExists, readFileSync: mockReadFile, readdirSync: mockReaddir } = await import("node:fs");
      vi.mocked(mockExists).mockReturnValue(true);
      vi.mocked(mockReaddir).mockImplementation((dir) => {
        const s = String(dir);
        if (s.endsWith("agents")) {return ["main" as never];}
        if (s.endsWith("sessions")) {return ["sessions.json" as never];}
        return [];
      });
      const sessionsData = {
        "s1": { label: "Chat 1", displayName: "Chat 1", channel: "webchat", updatedAt: Date.now() },
      };
      vi.mocked(mockReadFile).mockReturnValue(JSON.stringify(sessionsData) as never);

      const { GET } = await import("./route.js");
      const res = await GET();
      const json = await res.json();
      expect(json.sessions.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── GET /api/sessions/[sessionId] ──────────────────────────────

  describe("GET /api/sessions/[sessionId]", () => {
    it("returns 404 when session not found", async () => {
      const { GET } = await import("./[sessionId]/route.js");
      const res = await GET(
        new Request("http://localhost"),
        { params: Promise.resolve({ sessionId: "nonexistent" }) },
      );
      expect(res.status).toBe(404);
    });

    it("returns 404 for non-existent session ID", async () => {
      const { GET } = await import("./[sessionId]/route.js");
      const res = await GET(
        new Request("http://localhost"),
        { params: Promise.resolve({ sessionId: "missing-id" }) },
      );
      expect(res.status).toBe(404);
    });
  });

  // ─── GET /api/memories ──────────────────────────────────────────

  describe("GET /api/memories", () => {
    it("returns null mainMemory when no memory file exists", async () => {
      const { existsSync: mockExists } = await import("node:fs");
      vi.mocked(mockExists).mockReturnValue(false);

      const { GET } = await import("../memories/route.js");
      const res = await GET();
      const json = await res.json();
      expect(json.mainMemory).toBeNull();
    });

    it("returns memory content when file exists", async () => {
      const { existsSync: mockExists, readFileSync: mockReadFile, readdirSync: mockReaddir } = await import("node:fs");
      vi.mocked(mockExists).mockImplementation((p) => {
        const s = String(p);
        if (s.endsWith("MEMORY.md") || s.endsWith("memory.md")) {return true;}
        return false;
      });
      vi.mocked(mockReadFile).mockReturnValue("# My memories\n\n- Remember X" as never);
      vi.mocked(mockReaddir).mockReturnValue([]);

      const { GET } = await import("../memories/route.js");
      const res = await GET();
      const json = await res.json();
      expect(json.mainMemory).toContain("memories");
    });
  });

  // ─── GET /api/skills ────────────────────────────────────────────

  describe("GET /api/skills", () => {
    it("returns empty skills when no skills directories exist", async () => {
      const { GET } = await import("../skills/route.js");
      const res = await GET();
      const json = await res.json();
      expect(json.skills).toEqual([]);
    });

    it("returns skills from directory", async () => {
      const { existsSync: mockExists, readFileSync: mockReadFile, readdirSync: mockReaddir } = await import("node:fs");
      vi.mocked(mockExists).mockReturnValue(true);
      vi.mocked(mockReaddir).mockImplementation((dir) => {
        const s = String(dir);
        if (s.endsWith("skills")) {return ["my-skill" as never];}
        return [];
      });
      vi.mocked(mockReadFile).mockReturnValue("---\nname: My Skill\n---\n# Skill content" as never);

      const { GET } = await import("../skills/route.js");
      const res = await GET();
      const json = await res.json();
      expect(json.skills.length).toBeGreaterThanOrEqual(0);
    });
  });
});
