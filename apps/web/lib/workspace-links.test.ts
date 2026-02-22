import { describe, it, expect } from "vitest";
import {
  buildEntryLink,
  buildFileLink,
  parseWorkspaceLink,
  isWorkspaceLink,
  isInternalLink,
  isEntryLink,
} from "./workspace-links";

// ─── buildEntryLink ────────────────────────────────────────────────

describe("buildEntryLink", () => {
  it("builds a basic entry link", () => {
    expect(buildEntryLink("leads", "abc123")).toBe("/workspace?entry=leads:abc123");
  });

  it("encodes special characters in object name", () => {
    const result = buildEntryLink("my objects", "id1");
    expect(result).toContain("my%20objects");
    expect(result).toContain("id1");
  });

  it("encodes special characters in entry ID", () => {
    const result = buildEntryLink("leads", "id/with/slashes");
    expect(result).toContain("id%2Fwith%2Fslashes");
  });

  it("handles empty object name", () => {
    const result = buildEntryLink("", "id1");
    expect(result).toBe("/workspace?entry=:id1");
  });

  it("handles unicode characters", () => {
    const result = buildEntryLink("対象", "エントリ");
    expect(result).toContain("/workspace?entry=");
    // Should decode back correctly
    const url = new URL(result, "http://localhost");
    expect(url.searchParams.get("entry")).toBe("対象:エントリ");
  });
});

// ─── buildFileLink ────────────────────────────────────────────────

describe("buildFileLink", () => {
  it("builds a basic file link", () => {
    expect(buildFileLink("knowledge/doc.md")).toBe("/workspace?path=knowledge%2Fdoc.md");
  });

  it("builds link for nested path", () => {
    const result = buildFileLink("a/b/c/d.txt");
    const url = new URL(result, "http://localhost");
    expect(url.searchParams.get("path")).toBe("a/b/c/d.txt");
  });

  it("handles spaces in path", () => {
    const result = buildFileLink("my docs/file name.md");
    const url = new URL(result, "http://localhost");
    expect(url.searchParams.get("path")).toBe("my docs/file name.md");
  });

  it("handles special characters", () => {
    const result = buildFileLink("notes & ideas/doc (1).md");
    const url = new URL(result, "http://localhost");
    expect(url.searchParams.get("path")).toBe("notes & ideas/doc (1).md");
  });

  it("handles empty path", () => {
    expect(buildFileLink("")).toBe("/workspace?path=");
  });
});

// ─── parseWorkspaceLink ───────────────────────────────────────────

describe("parseWorkspaceLink", () => {
  it("parses file link from path param", () => {
    const result = parseWorkspaceLink("/workspace?path=knowledge/doc.md");
    expect(result).toEqual({ kind: "file", path: "knowledge/doc.md" });
  });

  it("parses entry link from entry param", () => {
    const result = parseWorkspaceLink("/workspace?entry=leads:abc123");
    expect(result).toEqual({ kind: "entry", objectName: "leads", entryId: "abc123" });
  });

  it("parses entry link from full URL", () => {
    const result = parseWorkspaceLink("http://localhost:3100/workspace?entry=deals:xyz");
    expect(result).toEqual({ kind: "entry", objectName: "deals", entryId: "xyz" });
  });

  it("parses file link from full URL", () => {
    const result = parseWorkspaceLink("http://localhost:3100/workspace?path=readme.md");
    expect(result).toEqual({ kind: "file", path: "readme.md" });
  });

  it("parses legacy @entry/ format", () => {
    const result = parseWorkspaceLink("@entry/leads/abc123");
    expect(result).toEqual({ kind: "entry", objectName: "leads", entryId: "abc123" });
  });

  it("returns null for invalid URL", () => {
    expect(parseWorkspaceLink("not a url ://bad")).toBeNull();
  });

  it("returns null when no params present", () => {
    expect(parseWorkspaceLink("/workspace")).toBeNull();
  });

  it("returns null for hash-only link", () => {
    expect(parseWorkspaceLink("/workspace#section")).toBeNull();
  });

  it("returns null for entry param without colon", () => {
    expect(parseWorkspaceLink("/workspace?entry=nocolon")).toBeNull();
  });

  it("handles deeply nested file path", () => {
    const result = parseWorkspaceLink("/workspace?path=a/b/c/d/e/f.txt");
    expect(result).toEqual({ kind: "file", path: "a/b/c/d/e/f.txt" });
  });

  it("handles encoded characters in path", () => {
    const result = parseWorkspaceLink("/workspace?path=my%20docs%2Ffile.md");
    expect(result).toEqual({ kind: "file", path: "my docs/file.md" });
  });

  it("returns null for non-workspace URL", () => {
    expect(parseWorkspaceLink("https://google.com")).toBeNull();
  });

  it("entry param takes priority over path param", () => {
    const result = parseWorkspaceLink("/workspace?entry=obj:id&path=file.md");
    expect(result).toEqual({ kind: "entry", objectName: "obj", entryId: "id" });
  });

  it("handles entry with colon in ID", () => {
    const result = parseWorkspaceLink("/workspace?entry=obj:id:with:colons");
    expect(result).toEqual({ kind: "entry", objectName: "obj", entryId: "id:with:colons" });
  });

  it("returns null for legacy @entry with no slash after object name", () => {
    expect(parseWorkspaceLink("@entry/objectonly")).toBeNull();
  });
});

// ─── isWorkspaceLink ──────────────────────────────────────────────

describe("isWorkspaceLink", () => {
  it("returns true for /workspace?path=...", () => {
    expect(isWorkspaceLink("/workspace?path=doc.md")).toBe(true);
  });

  it("returns true for /workspace#...", () => {
    expect(isWorkspaceLink("/workspace#section")).toBe(true);
  });

  it("returns true for /workspace alone", () => {
    expect(isWorkspaceLink("/workspace")).toBe(true);
  });

  it("returns true for @entry/ format", () => {
    expect(isWorkspaceLink("@entry/leads/abc")).toBe(true);
  });

  it("returns false for external URL", () => {
    expect(isWorkspaceLink("https://example.com")).toBe(false);
  });

  it("returns false for random path", () => {
    expect(isWorkspaceLink("/other-page")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isWorkspaceLink("")).toBe(false);
  });
});

// ─── isInternalLink ───────────────────────────────────────────────

describe("isInternalLink", () => {
  it("returns false for http:// URLs", () => {
    expect(isInternalLink("http://example.com")).toBe(false);
  });

  it("returns false for https:// URLs", () => {
    expect(isInternalLink("https://example.com")).toBe(false);
  });

  it("returns false for mailto: links", () => {
    expect(isInternalLink("mailto:user@example.com")).toBe(false);
  });

  it("returns true for relative paths", () => {
    expect(isInternalLink("/workspace?path=doc.md")).toBe(true);
  });

  it("returns true for @entry/ links", () => {
    expect(isInternalLink("@entry/leads/123")).toBe(true);
  });

  it("returns true for plain text", () => {
    expect(isInternalLink("some-page")).toBe(true);
  });
});

// ─── isEntryLink ──────────────────────────────────────────────────

describe("isEntryLink", () => {
  it("returns true for new format entry link", () => {
    expect(isEntryLink("/workspace?entry=leads:abc")).toBe(true);
  });

  it("returns true for legacy @entry/ format", () => {
    expect(isEntryLink("@entry/leads/abc")).toBe(true);
  });

  it("returns false for file workspace link", () => {
    expect(isEntryLink("/workspace?path=doc.md")).toBe(false);
  });

  it("returns false for external URL", () => {
    expect(isEntryLink("https://example.com")).toBe(false);
  });

  it("returns false for plain /workspace", () => {
    expect(isEntryLink("/workspace")).toBe(false);
  });
});
