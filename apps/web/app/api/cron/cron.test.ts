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

describe("Cron API routes", () => {
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

  // ─── GET /api/cron/jobs ─────────────────────────────────────────

  describe("GET /api/cron/jobs", () => {
    it("returns empty jobs when no config file", async () => {
      const { GET } = await import("./jobs/route.js");
      const res = await GET();
      const json = await res.json();
      expect(json.jobs).toEqual([]);
    });

    it("returns jobs from config file", async () => {
      const { existsSync: mockExists, readFileSync: mockReadFile } = await import("node:fs");
      vi.mocked(mockExists).mockReturnValue(true);
      const cronStore = {
        version: 1,
        jobs: [
          { id: "j1", name: "Daily sync", schedule: "0 8 * * *", enabled: true, command: "sync" },
        ],
      };
      vi.mocked(mockReadFile).mockReturnValue(JSON.stringify(cronStore) as never);

      const { GET } = await import("./jobs/route.js");
      const res = await GET();
      const json = await res.json();
      expect(json.jobs).toHaveLength(1);
      expect(json.jobs[0].name).toBe("Daily sync");
    });

    it("handles corrupt jobs file gracefully", async () => {
      const { existsSync: mockExists, readFileSync: mockReadFile } = await import("node:fs");
      vi.mocked(mockExists).mockReturnValue(true);
      vi.mocked(mockReadFile).mockReturnValue("not json" as never);

      const { GET } = await import("./jobs/route.js");
      const res = await GET();
      const json = await res.json();
      expect(json.jobs).toEqual([]);
    });
  });

  // ─── GET /api/cron/jobs/[jobId]/runs ────────────────────────────

  describe("GET /api/cron/jobs/[jobId]/runs", () => {
    it("returns empty entries when no runs file", async () => {
      const { GET } = await import("./jobs/[jobId]/runs/route.js");
      const res = await GET(
        new Request("http://localhost/api/cron/jobs/j1/runs"),
        { params: Promise.resolve({ jobId: "j1" }) },
      );
      const json = await res.json();
      expect(json.entries).toEqual([]);
    });

    it("returns run entries from jsonl file", async () => {
      const { existsSync: mockExists, readFileSync: mockReadFile } = await import("node:fs");
      vi.mocked(mockExists).mockReturnValue(true);
      const lines = [
        JSON.stringify({ ts: 1000, jobId: "j1", action: "finished", status: "completed", summary: "Done" }),
        JSON.stringify({ ts: 2000, jobId: "j1", action: "finished", status: "completed", summary: "In progress" }),
      ].join("\n");
      vi.mocked(mockReadFile).mockReturnValue(lines as never);

      const { GET } = await import("./jobs/[jobId]/runs/route.js");
      const res = await GET(
        new Request("http://localhost/api/cron/jobs/j1/runs"),
        { params: Promise.resolve({ jobId: "j1" }) },
      );
      const json = await res.json();
      expect(json.entries.length).toBeGreaterThan(0);
    });

    it("respects limit query param", async () => {
      const { existsSync: mockExists, readFileSync: mockReadFile } = await import("node:fs");
      vi.mocked(mockExists).mockReturnValue(true);
      const lines = Array.from({ length: 50 }, (_, i) =>
        JSON.stringify({ ts: i, status: "completed" }),
      ).join("\n");
      vi.mocked(mockReadFile).mockReturnValue(lines as never);

      const { GET } = await import("./jobs/[jobId]/runs/route.js");
      const res = await GET(
        new Request("http://localhost/api/cron/jobs/j1/runs?limit=5"),
        { params: Promise.resolve({ jobId: "j1" }) },
      );
      const json = await res.json();
      expect(json.entries.length).toBeLessThanOrEqual(5);
    });
  });

  // ─── GET /api/cron/runs/[sessionId] ─────────────────────────────

  describe("GET /api/cron/runs/[sessionId]", () => {
    it("returns 404 when session not found", async () => {
      const { GET } = await import("./runs/[sessionId]/route.js");
      const res = await GET(
        new Request("http://localhost"),
        { params: Promise.resolve({ sessionId: "nonexistent" }) },
      );
      expect(res.status).toBe(404);
    });
  });

  // ─── GET /api/cron/runs/search-transcript ───────────────────────

  describe("GET /api/cron/runs/search-transcript", () => {
    it("returns 400 when missing required params", async () => {
      const { GET } = await import("./runs/search-transcript/route.js");
      const req = new Request("http://localhost/api/cron/runs/search-transcript");
      const res = await GET(req);
      expect(res.status).toBe(400);
    });

    it("returns 404 when no transcript found", async () => {
      const { GET } = await import("./runs/search-transcript/route.js");
      const req = new Request("http://localhost/api/cron/runs/search-transcript?jobId=j1&runAtMs=1000");
      const res = await GET(req);
      expect(res.status).toBe(404);
    });
  });
});
