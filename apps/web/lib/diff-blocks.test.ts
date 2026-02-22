import { describe, it, expect } from "vitest";
import { splitDiffBlocks, hasDiffBlocks } from "./diff-blocks";

// ─── hasDiffBlocks ─────────────────────────────────────────────────

describe("hasDiffBlocks", () => {
  it("returns true when diff block is present", () => {
    expect(hasDiffBlocks("```diff\n-old\n+new\n```")).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(hasDiffBlocks("Hello world")).toBe(false);
  });

  it("returns false for regular code block", () => {
    expect(hasDiffBlocks("```js\nconst x = 1;\n```")).toBe(false);
  });

  it("returns true for partial match (streaming content)", () => {
    expect(hasDiffBlocks("Some text then ```diff")).toBe(true);
  });

  it("returns true for multiple diff blocks", () => {
    expect(hasDiffBlocks("```diff\n-a\n```\ntext\n```diff\n+b\n```")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(hasDiffBlocks("")).toBe(false);
  });

  it("returns false for 'diff' without backtick fence", () => {
    expect(hasDiffBlocks("This is a diff of two files")).toBe(false);
  });
});

// ─── splitDiffBlocks ───────────────────────────────────────────────

describe("splitDiffBlocks", () => {
  it("returns text segment for plain text with no blocks", () => {
    const result = splitDiffBlocks("Hello world");
    expect(result).toEqual([{ type: "text", text: "Hello world" }]);
  });

  it("returns empty array for whitespace-only text", () => {
    expect(splitDiffBlocks("   ")).toEqual([]);
  });

  it("parses a single diff block", () => {
    const text = "```diff\n-old line\n+new line\n```";
    const result = splitDiffBlocks(text);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("diff-artifact");
    if (result[0].type === "diff-artifact") {
      expect(result[0].diff).toBe("-old line\n+new line");
    }
  });

  it("splits text before and after a diff block", () => {
    const text = "Before text\n\n```diff\n-old\n+new\n```\n\nAfter text";
    const result = splitDiffBlocks(text);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: "text", text: "Before text\n\n" });
    expect(result[1].type).toBe("diff-artifact");
    expect(result[2]).toEqual({ type: "text", text: "\n\nAfter text" });
  });

  it("handles multiple diff blocks", () => {
    const text = "First:\n```diff\n-a\n+b\n```\nSecond:\n```diff\n-c\n+d\n```\nDone.";
    const result = splitDiffBlocks(text);
    expect(result).toHaveLength(5);
    expect(result[0].type).toBe("text");
    expect(result[1].type).toBe("diff-artifact");
    expect(result[2].type).toBe("text");
    expect(result[3].type).toBe("diff-artifact");
    expect(result[4].type).toBe("text");
  });

  it("handles diff block at the very beginning", () => {
    const text = "```diff\n-x\n+y\n```\nSome text after.";
    const result = splitDiffBlocks(text);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("diff-artifact");
    expect(result[1].type).toBe("text");
  });

  it("handles diff block at the very end", () => {
    const text = "Some text before\n```diff\n-x\n+y\n```";
    const result = splitDiffBlocks(text);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("text");
    expect(result[1].type).toBe("diff-artifact");
  });

  it("handles empty diff block (becomes text)", () => {
    const text = "```diff\n```";
    const result = splitDiffBlocks(text);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
    expect(result[0]).toEqual({ type: "text", text: "```diff\n```" });
  });

  it("handles complex unified diff format", () => {
    const diff = [
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,3 +1,3 @@",
      " line 1",
      "-old line 2",
      "+new line 2",
      " line 3",
    ].join("\n");
    const text = `\`\`\`diff\n${diff}\n\`\`\``;
    const result = splitDiffBlocks(text);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("diff-artifact");
    if (result[0].type === "diff-artifact") {
      expect(result[0].diff).toContain("--- a/file.ts");
      expect(result[0].diff).toContain("+++ b/file.ts");
    }
  });

  it("handles diff with special characters", () => {
    const text = '```diff\n-const x = "hello";\n+const x = "world";\n```';
    const result = splitDiffBlocks(text);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("diff-artifact");
  });

  it("does not match regular code blocks", () => {
    const text = "```js\nconst x = 1;\n```";
    const result = splitDiffBlocks(text);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
  });

  it("handles only diff block with no surrounding text", () => {
    const text = "```diff\n+added\n```";
    const result = splitDiffBlocks(text);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("diff-artifact");
    if (result[0].type === "diff-artifact") {
      expect(result[0].diff).toBe("+added");
    }
  });

  it("handles diff with whitespace-only before (trimmed away)", () => {
    const text = "   \n```diff\n+added\n```";
    const result = splitDiffBlocks(text);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("diff-artifact");
  });

  it("handles diff with whitespace after language tag", () => {
    const text = "```diff   \n-removed\n+added\n```";
    const result = splitDiffBlocks(text);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("diff-artifact");
  });

  it("handles consecutive diff blocks with no text between", () => {
    const text = "```diff\n-a\n```\n```diff\n+b\n```";
    const result = splitDiffBlocks(text);
    // The \n between blocks isn't trimmed, so we get 2 diff artifacts
    const diffArtifacts = result.filter((s) => s.type === "diff-artifact");
    expect(diffArtifacts.length).toBe(2);
  });

  it("handles diff block with deletion-only content", () => {
    const text = "```diff\n-line1\n-line2\n-line3\n```";
    const result = splitDiffBlocks(text);
    expect(result).toHaveLength(1);
    if (result[0].type === "diff-artifact") {
      expect(result[0].diff).toContain("-line1");
      expect(result[0].diff).toContain("-line3");
    }
  });

  it("handles diff block with addition-only content", () => {
    const text = "```diff\n+new1\n+new2\n```";
    const result = splitDiffBlocks(text);
    expect(result).toHaveLength(1);
    if (result[0].type === "diff-artifact") {
      expect(result[0].diff).toContain("+new1");
    }
  });

  it("preserves context lines in diff", () => {
    const text = "```diff\n context\n-removed\n+added\n context2\n```";
    const result = splitDiffBlocks(text);
    expect(result).toHaveLength(1);
    if (result[0].type === "diff-artifact") {
      expect(result[0].diff).toContain(" context");
      expect(result[0].diff).toContain(" context2");
    }
  });
});
