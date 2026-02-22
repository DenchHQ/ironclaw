/**
 * Utility functions for report identification and helpers.
 * Extracted for testability.
 */

/** Check if a filename is a report file (.report.json). */
export function isReportFile(filename: string): boolean {
  return filename.endsWith(".report.json");
}

/** Extensions recognized as code files for syntax-highlighted viewing. */
const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "rb", "go", "rs", "java", "kt", "swift",
  "c", "cpp", "h", "hpp", "cs",
  "css", "scss", "less",
  "html", "htm", "xml", "svg",
  "json", "jsonc",
  "yaml", "yml", "toml",
  "sh", "bash", "zsh", "fish", "ps1",
  "sql", "graphql", "gql",
  "dockerfile", "makefile", "cmake",
  "r", "lua", "php",
  "vue", "svelte",
  "diff", "patch",
  "ini", "env",
  "tf", "proto", "zig",
  "elixir", "ex", "erl", "hs", "scala", "clj", "dart",
]);

/** Check if a filename has a recognized code extension. */
export function isCodeFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return CODE_EXTENSIONS.has(ext);
}

/**
 * Classify a file's type for the tree display.
 * Returns "report", "database", "document", "code", or "file".
 */
export function classifyFileType(
  name: string,
  isDatabaseFile: (n: string) => boolean,
): "report" | "database" | "document" | "code" | "file" {
  if (isReportFile(name)) {return "report";}
  if (isDatabaseFile(name)) {return "database";}
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "md" || ext === "mdx") {return "document";}
  if (isCodeFile(name)) {return "code";}
  return "file";
}

/**
 * Generate a slug from a report title for use as a filename.
 */
export function reportTitleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Determine the CSS grid column span class for a panel size.
 */
export function panelColSpan(size?: string): string {
  switch (size) {
    case "full":
      return "col-span-6";
    case "third":
      return "col-span-2";
    case "half":
    default:
      return "col-span-3";
  }
}

/** Safe string conversion for display (handles objects via JSON.stringify). */
function toDisplayStr(val: unknown): string {
  if (val == null) {return "";}
  if (typeof val === "object") {return JSON.stringify(val);}
  if (typeof val === "string") {return val;}
  if (typeof val === "number" || typeof val === "boolean") {return String(val);}
  // symbol, bigint, function — val is narrowed (object already handled above)
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(val);
}

/**
 * Format a numeric value for chart display.
 */
export function formatChartValue(val: unknown): string {
  if (val === null || val === undefined) {return "";}
  if (typeof val === "object") {return JSON.stringify(val);}
  if (typeof val === "number") {
    if (Math.abs(val) >= 1_000_000) {return `${(val / 1_000_000).toFixed(1)}M`;}
    if (Math.abs(val) >= 1_000) {return `${(val / 1_000).toFixed(1)}K`;}
    return Number.isInteger(val) ? String(val) : val.toFixed(2);
  }
  return toDisplayStr(val);
}

/**
 * Format a label for chart display (truncates long strings, shortens dates).
 */
export function formatChartLabel(val: unknown): string {
  if (val === null || val === undefined) {return "";}
  const str = toDisplayStr(val);
  if (str.length > 16 && !isNaN(Date.parse(str))) {
    return str.slice(0, 10);
  }
  if (str.length > 20) {return str.slice(0, 18) + "...";}
  return str;
}

/**
 * Validate a report config structure. Returns error message or null if valid.
 */
export function validateReportConfig(config: unknown): string | null {
  if (!config || typeof config !== "object") {return "Config must be an object";}
  const c = config as Record<string, unknown>;
  if (typeof c.title !== "string" || !c.title) {return "Missing title";}
  if (!Array.isArray(c.panels)) {return "panels must be an array";}
  for (let i = 0; i < c.panels.length; i++) {
    const p = c.panels[i] as Record<string, unknown>;
    if (!p.id || typeof p.id !== "string") {return `Panel ${i}: missing id`;}
    if (!p.title || typeof p.title !== "string") {return `Panel ${i}: missing title`;}
    if (!p.type || typeof p.type !== "string") {return `Panel ${i}: missing type`;}
    if (!p.sql || typeof p.sql !== "string") {return `Panel ${i}: missing sql`;}
    if (!p.mapping || typeof p.mapping !== "object") {return `Panel ${i}: missing mapping`;}
  }
  return null;
}
