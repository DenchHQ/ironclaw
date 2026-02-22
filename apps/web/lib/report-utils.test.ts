import { describe, it, expect } from "vitest";
import {
  isReportFile,
  isCodeFile,
  classifyFileType,
  reportTitleToSlug,
  panelColSpan,
  formatChartValue,
  formatChartLabel,
  validateReportConfig,
} from "./report-utils";

// ─── isReportFile ───

describe("isReportFile", () => {
  it("returns true for .report.json files", () => {
    expect(isReportFile("deals-pipeline.report.json")).toBe(true);
  });

  it("returns true for deeply nested report files", () => {
    expect(isReportFile("analytics.report.json")).toBe(true);
  });

  it("returns false for regular JSON", () => {
    expect(isReportFile("config.json")).toBe(false);
  });

  it("returns false for similarly named non-report files", () => {
    expect(isReportFile("report.json")).toBe(false);
  });

  it("returns false for markdown", () => {
    expect(isReportFile("report.md")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isReportFile("")).toBe(false);
  });
});

// ─── isCodeFile ───

describe("isCodeFile", () => {
  it("returns true for .ts files", () => {
    expect(isCodeFile("index.ts")).toBe(true);
  });

  it("returns true for .tsx files", () => {
    expect(isCodeFile("component.tsx")).toBe(true);
  });

  it("returns true for .py files", () => {
    expect(isCodeFile("script.py")).toBe(true);
  });

  it("returns true for .go files", () => {
    expect(isCodeFile("main.go")).toBe(true);
  });

  it("returns true for .rs files", () => {
    expect(isCodeFile("lib.rs")).toBe(true);
  });

  it("returns true for .sql files", () => {
    expect(isCodeFile("query.sql")).toBe(true);
  });

  it("returns true for .yaml files", () => {
    expect(isCodeFile("config.yaml")).toBe(true);
  });

  it("returns true for .json files", () => {
    expect(isCodeFile("data.json")).toBe(true);
  });

  it("returns true for .sh files", () => {
    expect(isCodeFile("deploy.sh")).toBe(true);
  });

  it("returns false for .md files", () => {
    expect(isCodeFile("readme.md")).toBe(false);
  });

  it("returns false for .txt files", () => {
    expect(isCodeFile("notes.txt")).toBe(false);
  });

  it("returns false for .png files", () => {
    expect(isCodeFile("image.png")).toBe(false);
  });

  it("returns true for Makefile (makefile is a code extension)", () => {
    expect(isCodeFile("Makefile")).toBe(true);
  });

  it("returns false for files with non-code extension", () => {
    expect(isCodeFile("archive.zip")).toBe(false);
  });
});

// ─── classifyFileType ───

describe("classifyFileType", () => {
  const mockIsDb = (n: string) => /\.(duckdb|sqlite|sqlite3|db)$/.test(n);

  it("classifies .report.json as report", () => {
    expect(classifyFileType("test.report.json", mockIsDb)).toBe("report");
  });

  it("classifies .duckdb as database", () => {
    expect(classifyFileType("workspace.duckdb", mockIsDb)).toBe("database");
  });

  it("classifies .sqlite as database", () => {
    expect(classifyFileType("data.sqlite", mockIsDb)).toBe("database");
  });

  it("classifies .md as document", () => {
    expect(classifyFileType("readme.md", mockIsDb)).toBe("document");
  });

  it("classifies .mdx as document", () => {
    expect(classifyFileType("page.mdx", mockIsDb)).toBe("document");
  });

  it("classifies .yaml as code", () => {
    expect(classifyFileType("config.yaml", mockIsDb)).toBe("code");
  });

  it("classifies .ts as code", () => {
    expect(classifyFileType("index.ts", mockIsDb)).toBe("code");
  });

  it("classifies .txt as file", () => {
    expect(classifyFileType("notes.txt", mockIsDb)).toBe("file");
  });

  it("report takes priority over other extensions", () => {
    // .report.json should be "report", not "file"
    expect(classifyFileType("x.report.json", mockIsDb)).toBe("report");
  });
});

// ─── reportTitleToSlug ───

describe("reportTitleToSlug", () => {
  it("converts simple title to slug", () => {
    expect(reportTitleToSlug("Deals Pipeline")).toBe("deals-pipeline");
  });

  it("removes special characters", () => {
    expect(reportTitleToSlug("Q1 2025 Revenue (Draft)")).toBe("q1-2025-revenue-draft");
  });

  it("trims leading/trailing hyphens", () => {
    expect(reportTitleToSlug("  Hello World!  ")).toBe("hello-world");
  });

  it("truncates to 40 characters", () => {
    const long = "A".repeat(100);
    expect(reportTitleToSlug(long).length).toBeLessThanOrEqual(40);
  });

  it("handles empty string", () => {
    expect(reportTitleToSlug("")).toBe("");
  });

  it("handles unicode/emoji gracefully", () => {
    const result = reportTitleToSlug("Sales Overview 📊");
    expect(result).toBe("sales-overview");
    expect(result).not.toContain("📊");
  });

  it("collapses multiple dashes", () => {
    expect(reportTitleToSlug("a --- b")).toBe("a-b");
  });
});

// ─── panelColSpan ───

describe("panelColSpan", () => {
  it("returns col-span-6 for full", () => {
    expect(panelColSpan("full")).toBe("col-span-6");
  });

  it("returns col-span-3 for half", () => {
    expect(panelColSpan("half")).toBe("col-span-3");
  });

  it("returns col-span-2 for third", () => {
    expect(panelColSpan("third")).toBe("col-span-2");
  });

  it("returns col-span-3 for undefined (default)", () => {
    expect(panelColSpan(undefined)).toBe("col-span-3");
  });

  it("returns col-span-3 for unknown size", () => {
    expect(panelColSpan("quarter")).toBe("col-span-3");
  });
});

// ─── formatChartValue ───

describe("formatChartValue", () => {
  it("returns empty string for null", () => {
    expect(formatChartValue(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(formatChartValue(undefined)).toBe("");
  });

  it("formats millions", () => {
    expect(formatChartValue(1_500_000)).toBe("1.5M");
  });

  it("formats thousands", () => {
    expect(formatChartValue(1_500)).toBe("1.5K");
  });

  it("formats negative millions", () => {
    expect(formatChartValue(-2_500_000)).toBe("-2.5M");
  });

  it("formats negative thousands", () => {
    expect(formatChartValue(-2_500)).toBe("-2.5K");
  });

  it("formats integers below 1000 as-is", () => {
    expect(formatChartValue(42)).toBe("42");
  });

  it("formats floats to 2 decimal places", () => {
    expect(formatChartValue(Math.PI)).toBe("3.14");
  });

  it("formats zero as integer", () => {
    expect(formatChartValue(0)).toBe("0");
  });

  it("formats strings as-is", () => {
    expect(formatChartValue("hello")).toBe("hello");
  });

  it("formats boolean as string", () => {
    expect(formatChartValue(true)).toBe("true");
  });

  it("formats exactly 1000", () => {
    expect(formatChartValue(1000)).toBe("1.0K");
  });

  it("formats exactly 1000000", () => {
    expect(formatChartValue(1000000)).toBe("1.0M");
  });

  it("formats 999 as integer", () => {
    expect(formatChartValue(999)).toBe("999");
  });

  it("formats object as JSON string", () => {
    expect(formatChartValue({ key: "val" })).toBe('{"key":"val"}');
  });

  it("formats array as JSON string", () => {
    expect(formatChartValue([1, 2, 3])).toBe("[1,2,3]");
  });

  it("formats negative float", () => {
    expect(formatChartValue(-3.14)).toBe("-3.14");
  });

  it("formats very large number", () => {
    expect(formatChartValue(999_999_999)).toBe("1000.0M");
  });
});

// ─── formatChartLabel ───

describe("formatChartLabel", () => {
  it("returns empty string for null", () => {
    expect(formatChartLabel(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(formatChartLabel(undefined)).toBe("");
  });

  it("returns short strings unchanged", () => {
    expect(formatChartLabel("Active")).toBe("Active");
  });

  it("truncates long strings", () => {
    const long = "A".repeat(25);
    expect(formatChartLabel(long)).toBe("A".repeat(18) + "...");
  });

  it("shortens ISO date strings", () => {
    expect(formatChartLabel("2025-06-15T10:30:00Z")).toBe("2025-06-15");
  });

  it("shortens full datetime strings", () => {
    expect(formatChartLabel("2025-06-15 10:30:00.000")).toBe("2025-06-15");
  });

  it("does not shorten non-date long strings", () => {
    const notDate = "This is definitely not a date string at all";
    expect(formatChartLabel(notDate)).toBe("This is definitely..." );
  });

  it("handles numbers by converting to string", () => {
    expect(formatChartLabel(42)).toBe("42");
  });

  it("handles exactly 20-char string (no truncation)", () => {
    expect(formatChartLabel("12345678901234567890")).toBe("12345678901234567890");
  });

  it("truncates 21-char string", () => {
    expect(formatChartLabel("123456789012345678901")).toBe("123456789012345678...");
  });
});

// ─── validateReportConfig ───

describe("validateReportConfig", () => {
  const validConfig = {
    version: 1,
    title: "Test",
    panels: [
      { id: "p1", title: "P1", type: "bar", sql: "SELECT 1", mapping: { xAxis: "x" } },
    ],
  };

  it("returns null for valid config", () => {
    expect(validateReportConfig(validConfig)).toBeNull();
  });

  it("returns null for valid config with filters", () => {
    expect(validateReportConfig({
      ...validConfig,
      filters: [{ id: "f1", type: "dateRange", label: "Date", column: "created_at" }],
    })).toBeNull();
  });

  it("rejects null config", () => {
    expect(validateReportConfig(null)).not.toBeNull();
  });

  it("rejects non-object config", () => {
    expect(validateReportConfig("string")).not.toBeNull();
  });

  it("rejects missing title", () => {
    expect(validateReportConfig({ panels: [] })).toContain("title");
  });

  it("rejects empty title", () => {
    expect(validateReportConfig({ title: "", panels: [] })).toContain("title");
  });

  it("rejects missing panels", () => {
    expect(validateReportConfig({ title: "Test" })).toContain("panels");
  });

  it("rejects non-array panels", () => {
    expect(validateReportConfig({ title: "Test", panels: "not-array" })).toContain("panels");
  });

  it("accepts empty panels array", () => {
    expect(validateReportConfig({ title: "Test", panels: [] })).toBeNull();
  });

  it("rejects panel without id", () => {
    const config = { title: "Test", panels: [{ title: "P", type: "bar", sql: "SELECT 1", mapping: {} }] };
    expect(validateReportConfig(config)).toContain("Panel 0");
    expect(validateReportConfig(config)).toContain("id");
  });

  it("rejects panel without title", () => {
    const config = { title: "Test", panels: [{ id: "p", type: "bar", sql: "SELECT 1", mapping: {} }] };
    expect(validateReportConfig(config)).toContain("title");
  });

  it("rejects panel without type", () => {
    const config = { title: "Test", panels: [{ id: "p", title: "P", sql: "SELECT 1", mapping: {} }] };
    expect(validateReportConfig(config)).toContain("type");
  });

  it("rejects panel without sql", () => {
    const config = { title: "Test", panels: [{ id: "p", title: "P", type: "bar", mapping: {} }] };
    expect(validateReportConfig(config)).toContain("sql");
  });

  it("rejects panel without mapping", () => {
    const config = { title: "Test", panels: [{ id: "p", title: "P", type: "bar", sql: "SELECT 1" }] };
    expect(validateReportConfig(config)).toContain("mapping");
  });

  it("validates multiple panels", () => {
    const config = {
      title: "Test",
      panels: [
        { id: "p1", title: "P1", type: "bar", sql: "SELECT 1", mapping: {} },
        { id: "p2", title: "P2", type: "pie", sql: "SELECT 2", mapping: {} },
      ],
    };
    expect(validateReportConfig(config)).toBeNull();
  });

  it("reports correct panel index on validation error", () => {
    const config = {
      title: "Test",
      panels: [
        { id: "p1", title: "P1", type: "bar", sql: "SELECT 1", mapping: {} },
        { id: "p2", type: "pie", sql: "SELECT 2", mapping: {} }, // missing title
      ],
    };
    expect(validateReportConfig(config)).toContain("Panel 1");
  });
});
