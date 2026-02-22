import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock node:fs
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => "[]"),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

// Mock node:os
vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/home/testuser"),
}));

// Mock node:crypto
vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "test-uuid-1234"),
}));

describe("Web Sessions API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mock("node:fs", () => ({
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(() => "[]"),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
      appendFileSync: vi.fn(),
    }));
    vi.mock("node:os", () => ({
      homedir: vi.fn(() => "/home/testuser"),
    }));
    vi.mock("node:crypto", () => ({
      randomUUID: vi.fn(() => "test-uuid-1234"),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── GET /api/web-sessions ──────────────────────────────────────

  describe("GET /api/web-sessions", () => {
    it("returns empty sessions when no index exists", async () => {
      const { GET } = await import("./route.js");
      const req = new Request("http://localhost/api/web-sessions");
      const res = await GET(req);
      const json = await res.json();
      expect(json.sessions).toEqual([]);
    });

    it("returns global sessions when no filePath param", async () => {
      const { readFileSync: mockReadFile, existsSync: mockExists } = await import("node:fs");
      vi.mocked(mockExists).mockReturnValue(true);
      const sessions = [
        { id: "s1", title: "Chat 1", createdAt: 1, updatedAt: 1, messageCount: 0 },
        { id: "s2", title: "File Chat", createdAt: 2, updatedAt: 2, messageCount: 1, filePath: "doc.md" },
      ];
      vi.mocked(mockReadFile).mockReturnValue(JSON.stringify(sessions) as never);

      const { GET } = await import("./route.js");
      const req = new Request("http://localhost/api/web-sessions");
      const res = await GET(req);
      const json = await res.json();
      expect(json.sessions).toHaveLength(1);
      expect(json.sessions[0].id).toBe("s1");
    });

    it("filters sessions by filePath param", async () => {
      const { readFileSync: mockReadFile, existsSync: mockExists } = await import("node:fs");
      vi.mocked(mockExists).mockReturnValue(true);
      const sessions = [
        { id: "s1", title: "Global", createdAt: 1, updatedAt: 1, messageCount: 0 },
        { id: "s2", title: "Doc Chat", createdAt: 2, updatedAt: 2, messageCount: 1, filePath: "doc.md" },
      ];
      vi.mocked(mockReadFile).mockReturnValue(JSON.stringify(sessions) as never);

      const { GET } = await import("./route.js");
      const req = new Request("http://localhost/api/web-sessions?filePath=doc.md");
      const res = await GET(req);
      const json = await res.json();
      expect(json.sessions).toHaveLength(1);
      expect(json.sessions[0].filePath).toBe("doc.md");
    });

    it("returns empty when no matching filePath sessions", async () => {
      const { readFileSync: mockReadFile, existsSync: mockExists } = await import("node:fs");
      vi.mocked(mockExists).mockReturnValue(true);
      vi.mocked(mockReadFile).mockReturnValue("[]" as never);

      const { GET } = await import("./route.js");
      const req = new Request("http://localhost/api/web-sessions?filePath=nonexistent.md");
      const res = await GET(req);
      const json = await res.json();
      expect(json.sessions).toEqual([]);
    });
  });

  // ─── POST /api/web-sessions ────────────────────────────────────

  describe("POST /api/web-sessions", () => {
    it("creates a new session with default title", async () => {
      const { writeFileSync: mockWrite } = await import("node:fs");

      const { POST } = await import("./route.js");
      const req = new Request("http://localhost/api/web-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await POST(req);
      const json = await res.json();
      expect(json.session.id).toBe("test-uuid-1234");
      expect(json.session.title).toBe("New Chat");
      expect(json.session.messageCount).toBe(0);
      expect(mockWrite).toHaveBeenCalled();
    });

    it("creates session with custom title", async () => {
      const { POST } = await import("./route.js");
      const req = new Request("http://localhost/api/web-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "My Chat" }),
      });
      const res = await POST(req);
      const json = await res.json();
      expect(json.session.title).toBe("My Chat");
    });

    it("creates file-scoped session with filePath", async () => {
      const { POST } = await import("./route.js");
      const req = new Request("http://localhost/api/web-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "File Chat", filePath: "readme.md" }),
      });
      const res = await POST(req);
      const json = await res.json();
      expect(json.session.filePath).toBe("readme.md");
    });

    it("handles invalid JSON body gracefully", async () => {
      const { POST } = await import("./route.js");
      const req = new Request("http://localhost/api/web-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      const res = await POST(req);
      const json = await res.json();
      // Falls back to default title
      expect(json.session.title).toBe("New Chat");
    });

    it("creates jsonl file for new session", async () => {
      const { writeFileSync: mockWrite } = await import("node:fs");

      const { POST } = await import("./route.js");
      const req = new Request("http://localhost/api/web-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      await POST(req);
      // Should write at least the index.json and the empty .jsonl
      expect(mockWrite).toHaveBeenCalled();
      // Verify that one of the calls is to the jsonl file
      const calls = mockWrite.mock.calls.map((c) => String(c[0]));
      expect(calls.some((c) => c.endsWith(".jsonl"))).toBe(true);
    });
  });

  // ─── GET /api/web-sessions/[id] ────────────────────────────────

  describe("GET /api/web-sessions/[id]", () => {
    it("returns session messages", async () => {
      const { existsSync: mockExists, readFileSync: mockReadFile } = await import("node:fs");
      vi.mocked(mockExists).mockReturnValue(true);
      const lines = [
        JSON.stringify({ id: "m1", role: "user", content: "hello" }),
        JSON.stringify({ id: "m2", role: "assistant", content: "hi" }),
      ].join("\n");
      vi.mocked(mockReadFile).mockReturnValue(lines as never);

      const { GET } = await import("./[id]/route.js");
      const res = await GET(
        new Request("http://localhost/api/web-sessions/s1"),
        { params: Promise.resolve({ id: "s1" }) },
      );
      const json = await res.json();
      expect(json.id).toBe("s1");
      expect(json.messages).toHaveLength(2);
    });

    it("returns 404 when session file does not exist", async () => {
      const { existsSync: mockExists } = await import("node:fs");
      vi.mocked(mockExists).mockReturnValue(false);

      const { GET } = await import("./[id]/route.js");
      const res = await GET(
        new Request("http://localhost/api/web-sessions/nonexistent"),
        { params: Promise.resolve({ id: "nonexistent" }) },
      );
      expect(res.status).toBe(404);
    });

    it("handles empty session file", async () => {
      const { existsSync: mockExists, readFileSync: mockReadFile } = await import("node:fs");
      vi.mocked(mockExists).mockReturnValue(true);
      vi.mocked(mockReadFile).mockReturnValue("" as never);

      const { GET } = await import("./[id]/route.js");
      const res = await GET(
        new Request("http://localhost/api/web-sessions/s1"),
        { params: Promise.resolve({ id: "s1" }) },
      );
      const json = await res.json();
      expect(json.messages).toEqual([]);
    });
  });

  // ─── POST /api/web-sessions/[id]/messages ──────────────────────

  describe("POST /api/web-sessions/[id]/messages", () => {
    it("appends messages to session file", async () => {
      const { existsSync: mockExists, readFileSync: mockReadFile, writeFileSync: _mockWrite } = await import("node:fs");
      vi.mocked(mockExists).mockReturnValue(true);
      vi.mocked(mockReadFile).mockImplementation((p) => {
        const s = String(p);
        if (s.endsWith("index.json")) {
          return JSON.stringify([{ id: "s1", title: "Chat", createdAt: 1, updatedAt: 1, messageCount: 0 }]) as never;
        }
        return "" as never;
      });

      const { POST } = await import("./[id]/messages/route.js");
      const req = new Request("http://localhost/api/web-sessions/s1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ id: "m1", role: "user", content: "hello" }],
        }),
      });
      const res = await POST(req, { params: Promise.resolve({ id: "s1" }) });
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    it("auto-creates session file if missing", async () => {
      const { existsSync: mockExists, readFileSync: mockReadFile, writeFileSync: _mockWrite } = await import("node:fs");
      vi.mocked(mockExists).mockImplementation((p) => {
        const s = String(p);
        if (s.endsWith(".jsonl")) {return false;}
        return true;
      });
      vi.mocked(mockReadFile).mockImplementation((p) => {
        const s = String(p);
        if (s.endsWith("index.json")) {return "[]" as never;}
        return "" as never;
      });

      const { POST } = await import("./[id]/messages/route.js");
      const req = new Request("http://localhost/api/web-sessions/new-s/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ id: "m1", role: "user", content: "first message" }],
        }),
      });
      const res = await POST(req, { params: Promise.resolve({ id: "new-s" }) });
      expect(res.status).toBe(200);
    });

    it("updates session title when provided", async () => {
      const { existsSync: mockExists, readFileSync: mockReadFile, writeFileSync: mockWrite } = await import("node:fs");
      vi.mocked(mockExists).mockReturnValue(true);
      vi.mocked(mockReadFile).mockImplementation((p) => {
        const s = String(p);
        if (s.endsWith("index.json")) {
          return JSON.stringify([{ id: "s1", title: "Old Title", createdAt: 1, updatedAt: 1, messageCount: 0 }]) as never;
        }
        return "" as never;
      });

      const { POST } = await import("./[id]/messages/route.js");
      const req = new Request("http://localhost/api/web-sessions/s1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ id: "m1", role: "user", content: "hello" }],
          title: "New Title",
        }),
      });
      const res = await POST(req, { params: Promise.resolve({ id: "s1" }) });
      expect(res.status).toBe(200);
      // Verify index was written with new title
      expect(mockWrite).toHaveBeenCalled();
    });
  });
});
