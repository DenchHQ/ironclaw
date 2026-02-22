import { describe, it, expect } from "vitest";
import { splitReportBlocks, hasReportBlocks } from "./report-blocks";

// ─── hasReportBlocks ───

describe("hasReportBlocks", () => {
  it("returns false for plain text", () => {
    expect(hasReportBlocks("Hello world")).toBe(false);
  });

  it("returns false for regular code blocks", () => {
    expect(hasReportBlocks("```json\n{}\n```")).toBe(false);
  });

  it("returns true when report-json block is present", () => {
    expect(hasReportBlocks('```report-json\n{"version":1,"title":"Test","panels":[]}\n```')).toBe(true);
  });

  it("returns true for partial/streaming content with marker", () => {
    expect(hasReportBlocks("Some text ```report-json")).toBe(true);
  });
});

// ─── splitReportBlocks ───

describe("splitReportBlocks", () => {
  const validReport = JSON.stringify({
    version: 1,
    title: "Test Report",
    panels: [{ id: "p1", title: "Panel 1", type: "bar", sql: "SELECT 1", mapping: { xAxis: "a" } }],
  });

  it("returns text segment for plain text with no blocks", () => {
    const result = splitReportBlocks("Hello world");
    expect(result).toEqual([{ type: "text", text: "Hello world" }]);
  });

  it("returns empty array for whitespace-only text", () => {
    const result = splitReportBlocks("   ");
    expect(result).toEqual([]);
  });

  it("parses a single report block", () => {
    const text = `\`\`\`report-json\n${validReport}\n\`\`\``;
    const result = splitReportBlocks(text);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("report-artifact");
    if (result[0].type === "report-artifact") {
      expect(result[0].config.title).toBe("Test Report");
      expect(result[0].config.panels).toHaveLength(1);
    }
  });

  it("splits text before and after a report block", () => {
    const text = `Before text\n\n\`\`\`report-json\n${validReport}\n\`\`\`\n\nAfter text`;
    const result = splitReportBlocks(text);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: "text", text: "Before text\n\n" });
    expect(result[1].type).toBe("report-artifact");
    expect(result[2]).toEqual({ type: "text", text: "\n\nAfter text" });
  });

  it("handles multiple report blocks", () => {
    const report2 = JSON.stringify({
      version: 1,
      title: "Second Report",
      panels: [{ id: "p2", title: "Panel 2", type: "pie", sql: "SELECT 2", mapping: { nameKey: "a" } }],
    });
    const text = `First:\n\`\`\`report-json\n${validReport}\n\`\`\`\nSecond:\n\`\`\`report-json\n${report2}\n\`\`\`\nDone.`;
    const result = splitReportBlocks(text);
    expect(result).toHaveLength(5);
    expect(result[0].type).toBe("text");
    expect(result[1].type).toBe("report-artifact");
    expect(result[2].type).toBe("text");
    expect(result[3].type).toBe("report-artifact");
    expect(result[4].type).toBe("text");
    if (result[1].type === "report-artifact") {
      expect(result[1].config.title).toBe("Test Report");
    }
    if (result[3].type === "report-artifact") {
      expect(result[3].config.title).toBe("Second Report");
    }
  });

  it("falls back to text for invalid JSON", () => {
    const text = "```report-json\n{not valid json}\n```";
    const result = splitReportBlocks(text);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
    expect(result[0]).toEqual({ type: "text", text: "```report-json\n{not valid json}\n```" });
  });

  it("falls back to text for valid JSON without panels array", () => {
    const text = '```report-json\n{"version":1,"title":"Bad"}\n```';
    const result = splitReportBlocks(text);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
  });

  it("falls back to text for JSON with panels as non-array", () => {
    const text = '```report-json\n{"version":1,"title":"Bad","panels":"not-array"}\n```';
    const result = splitReportBlocks(text);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
  });

  it("handles report block at the very beginning with no preceding text", () => {
    const text = `\`\`\`report-json\n${validReport}\n\`\`\`\nSome analysis.`;
    const result = splitReportBlocks(text);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("report-artifact");
    expect(result[1].type).toBe("text");
  });

  it("handles report block at the very end with no following text", () => {
    const text = `Here is the data:\n\`\`\`report-json\n${validReport}\n\`\`\``;
    const result = splitReportBlocks(text);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("text");
    expect(result[1].type).toBe("report-artifact");
  });

  it("handles report-json with extra whitespace after language tag", () => {
    const text = `\`\`\`report-json   \n${validReport}\n\`\`\``;
    const result = splitReportBlocks(text);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("report-artifact");
  });

  it("handles empty panels array (valid config, zero charts)", () => {
    const emptyPanels = JSON.stringify({ version: 1, title: "Empty", panels: [] });
    const text = `\`\`\`report-json\n${emptyPanels}\n\`\`\``;
    const result = splitReportBlocks(text);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("report-artifact");
    if (result[0].type === "report-artifact") {
      expect(result[0].config.panels).toEqual([]);
    }
  });

  it("preserves report config fields (description, filters)", () => {
    const fullReport = JSON.stringify({
      version: 1,
      title: "Full Report",
      description: "A detailed report",
      panels: [{ id: "p1", title: "P1", type: "bar", sql: "SELECT 1", mapping: {} }],
      filters: [{ id: "f1", type: "dateRange", label: "Date", column: "created_at" }],
    });
    const text = `\`\`\`report-json\n${fullReport}\n\`\`\``;
    const result = splitReportBlocks(text);
    expect(result).toHaveLength(1);
    if (result[0].type === "report-artifact") {
      expect(result[0].config.description).toBe("A detailed report");
      expect(result[0].config.filters).toHaveLength(1);
    }
  });

  it("does not match regular json code blocks", () => {
    const text = '```json\n{"panels":[]}\n```';
    const result = splitReportBlocks(text);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
    expect((result[0] as { type: "text"; text: string }).text).toContain("```json");
  });

  it("does not match inline backticks", () => {
    const text = 'Use `report-json` format for charts.';
    const result = splitReportBlocks(text);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
  });

  it("handles SQL with special characters in report config", () => {
    const reportWithSpecialSql = JSON.stringify({
      version: 1,
      title: "Special SQL",
      panels: [{
        id: "p1",
        title: "P1",
        type: "bar",
        sql: `SELECT "Stage", COUNT(*) as count FROM v_deal WHERE "Name" LIKE '%O''Brien%' GROUP BY "Stage"`,
        mapping: { xAxis: "Stage", yAxis: ["count"] },
      }],
    });
    const text = `\`\`\`report-json\n${reportWithSpecialSql}\n\`\`\``;
    const result = splitReportBlocks(text);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("report-artifact");
  });
});
