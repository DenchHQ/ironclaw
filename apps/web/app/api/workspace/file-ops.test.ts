import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock node:fs
vi.mock("node:fs", () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  statSync: vi.fn(() => ({ isDirectory: () => false })),
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
  readdirSync: vi.fn(() => []),
  renameSync: vi.fn(),
  cpSync: vi.fn(),
  copyFileSync: vi.fn(),
}));

// Mock workspace utilities
vi.mock("@/lib/workspace", () => ({
  readWorkspaceFile: vi.fn(),
  safeResolvePath: vi.fn(),
  safeResolveNewPath: vi.fn(),
  isSystemFile: vi.fn(() => false),
  resolveWorkspaceRoot: vi.fn(() => "/ws"),
}));

describe("Workspace File Operations API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mock("node:fs", () => ({
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
      rmSync: vi.fn(),
      statSync: vi.fn(() => ({ isDirectory: () => false })),
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(() => ""),
      readdirSync: vi.fn(() => []),
      renameSync: vi.fn(),
      cpSync: vi.fn(),
      copyFileSync: vi.fn(),
    }));
    vi.mock("@/lib/workspace", () => ({
      readWorkspaceFile: vi.fn(),
      safeResolvePath: vi.fn(),
      safeResolveNewPath: vi.fn(),
      isSystemFile: vi.fn(() => false),
      resolveWorkspaceRoot: vi.fn(() => "/ws"),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── GET /api/workspace/file ────────────────────────────────────

  describe("GET /api/workspace/file", () => {
    it("returns 400 when path param is missing", async () => {
      const { GET } = await import("./file/route.js");
      const req = new Request("http://localhost/api/workspace/file");
      const res = await GET(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("path");
    });

    it("returns file content when found", async () => {
      const { readWorkspaceFile } = await import("@/lib/workspace");
      vi.mocked(readWorkspaceFile).mockReturnValue({ content: "# Hello", type: "markdown" });

      const { GET } = await import("./file/route.js");
      const req = new Request("http://localhost/api/workspace/file?path=doc.md");
      const res = await GET(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.content).toBe("# Hello");
      expect(json.type).toBe("markdown");
    });

    it("returns 404 when file not found", async () => {
      const { readWorkspaceFile } = await import("@/lib/workspace");
      vi.mocked(readWorkspaceFile).mockReturnValue(null);

      const { GET } = await import("./file/route.js");
      const req = new Request("http://localhost/api/workspace/file?path=missing.md");
      const res = await GET(req);
      expect(res.status).toBe(404);
    });
  });

  // ─── POST /api/workspace/file ───────────────────────────────────

  describe("POST /api/workspace/file", () => {
    it("writes file content successfully", async () => {
      const { safeResolveNewPath } = await import("@/lib/workspace");
      vi.mocked(safeResolveNewPath).mockReturnValue("/ws/doc.md");
      const { writeFileSync: mockWrite, mkdirSync: mockMkdir } = await import("node:fs");

      const { POST } = await import("./file/route.js");
      const req = new Request("http://localhost/api/workspace/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "doc.md", content: "# Hello" }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(mockMkdir).toHaveBeenCalled();
      expect(mockWrite).toHaveBeenCalled();
    });

    it("returns 400 for missing path", async () => {
      const { POST } = await import("./file/route.js");
      const req = new Request("http://localhost/api/workspace/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "text" }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 for missing content", async () => {
      const { POST } = await import("./file/route.js");
      const req = new Request("http://localhost/api/workspace/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "doc.md" }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 for path traversal", async () => {
      const { safeResolveNewPath } = await import("@/lib/workspace");
      vi.mocked(safeResolveNewPath).mockReturnValue(null);

      const { POST } = await import("./file/route.js");
      const req = new Request("http://localhost/api/workspace/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "../etc/passwd", content: "hack" }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid JSON body", async () => {
      const { POST } = await import("./file/route.js");
      const req = new Request("http://localhost/api/workspace/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 500 on write error", async () => {
      const { safeResolveNewPath } = await import("@/lib/workspace");
      vi.mocked(safeResolveNewPath).mockReturnValue("/ws/doc.md");
      const { writeFileSync: mockWrite } = await import("node:fs");
      vi.mocked(mockWrite).mockImplementation(() => { throw new Error("EACCES"); });

      const { POST } = await import("./file/route.js");
      const req = new Request("http://localhost/api/workspace/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "doc.md", content: "text" }),
      });
      const res = await POST(req);
      expect(res.status).toBe(500);
    });
  });

  // ─── DELETE /api/workspace/file ─────────────────────────────────

  describe("DELETE /api/workspace/file", () => {
    it("deletes file successfully", async () => {
      const { safeResolvePath, isSystemFile } = await import("@/lib/workspace");
      vi.mocked(safeResolvePath).mockReturnValue("/ws/file.txt");
      vi.mocked(isSystemFile).mockReturnValue(false);

      const { DELETE } = await import("./file/route.js");
      const req = new Request("http://localhost/api/workspace/file", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "file.txt" }),
      });
      const res = await DELETE(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    it("returns 403 for system file", async () => {
      const { isSystemFile } = await import("@/lib/workspace");
      vi.mocked(isSystemFile).mockReturnValue(true);

      const { DELETE } = await import("./file/route.js");
      const req = new Request("http://localhost/api/workspace/file", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: ".object.yaml" }),
      });
      const res = await DELETE(req);
      expect(res.status).toBe(403);
    });

    it("returns 404 when file not found", async () => {
      const { safeResolvePath, isSystemFile } = await import("@/lib/workspace");
      vi.mocked(isSystemFile).mockReturnValue(false);
      vi.mocked(safeResolvePath).mockReturnValue(null);

      const { DELETE } = await import("./file/route.js");
      const req = new Request("http://localhost/api/workspace/file", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "nonexistent.txt" }),
      });
      const res = await DELETE(req);
      expect(res.status).toBe(404);
    });

    it("returns 400 for missing path", async () => {
      const { DELETE } = await import("./file/route.js");
      const req = new Request("http://localhost/api/workspace/file", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await DELETE(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid JSON body", async () => {
      const { DELETE } = await import("./file/route.js");
      const req = new Request("http://localhost/api/workspace/file", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      const res = await DELETE(req);
      expect(res.status).toBe(400);
    });
  });

  // ─── POST /api/workspace/mkdir ──────────────────────────────────

  describe("POST /api/workspace/mkdir", () => {
    it("creates directory successfully", async () => {
      const { safeResolveNewPath } = await import("@/lib/workspace");
      vi.mocked(safeResolveNewPath).mockReturnValue("/ws/new-folder");

      const { POST } = await import("./mkdir/route.js");
      const req = new Request("http://localhost/api/workspace/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "new-folder" }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    it("returns 400 for missing path", async () => {
      const { POST } = await import("./mkdir/route.js");
      const req = new Request("http://localhost/api/workspace/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 for traversal attempt", async () => {
      const { safeResolveNewPath } = await import("@/lib/workspace");
      vi.mocked(safeResolveNewPath).mockReturnValue(null);

      const { POST } = await import("./mkdir/route.js");
      const req = new Request("http://localhost/api/workspace/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "../../etc" }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });
});
