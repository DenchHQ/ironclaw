import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync, exec } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve, normalize, relative } from "node:path";
import { homedir } from "node:os";
import YAML from "yaml";
import { normalizeFilterGroup, type SavedView } from "./object-filters";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// UI profile override — allows switching profiles at runtime without env vars.
// The active profile is held in-memory for immediate effect and persisted to
// ~/.openclaw/.ironclaw-ui-state.json so it survives server restarts.
// ---------------------------------------------------------------------------

const UI_STATE_FILENAME = ".ironclaw-ui-state.json";

/** In-memory override; takes precedence over the persisted file. */
let _uiActiveProfile: string | null | undefined;

type UIState = {
  activeProfile?: string | null;
  /** Maps profile names to absolute workspace paths for workspaces outside ~/.openclaw/. */
  workspaceRegistry?: Record<string, string>;
};

function uiStatePath(): string {
  const home = process.env.OPENCLAW_HOME?.trim() || homedir();
  return join(home, ".openclaw", UI_STATE_FILENAME);
}

function readUIState(): UIState {
  try {
    const raw = readFileSync(uiStatePath(), "utf-8");
    return JSON.parse(raw) as UIState;
  } catch {
    return {};
  }
}

export function writeUIState(state: UIState): void {
  const p = uiStatePath();
  const dir = join(p, "..");
  if (!existsSync(dir)) {mkdirSync(dir, { recursive: true });}
  writeFileSync(p, JSON.stringify(state, null, 2) + "\n");
}

/** Get the effective profile: env var > in-memory override > persisted file. */
export function getEffectiveProfile(): string | null {
  const envProfile = process.env.OPENCLAW_PROFILE?.trim();
  if (envProfile) {return envProfile;}
  if (_uiActiveProfile !== undefined) {return _uiActiveProfile;}
  const persisted = readUIState().activeProfile;
  return persisted?.trim() || null;
}

/** Set the UI-level profile override (in-memory + persisted). */
export function setUIActiveProfile(profile: string | null): void {
  const normalized = profile?.trim() || null;
  _uiActiveProfile = normalized;
  const existing = readUIState();
  writeUIState({ ...existing, activeProfile: normalized });
}

/** Reset the in-memory override (re-reads from file on next call). */
export function clearUIActiveProfileCache(): void {
  _uiActiveProfile = undefined;
}

// ---------------------------------------------------------------------------
// Workspace registry — remembers workspaces created outside ~/.openclaw/.
// ---------------------------------------------------------------------------

/** Read the full workspace registry (profile → absolute path). */
export function getWorkspaceRegistry(): Record<string, string> {
  return readUIState().workspaceRegistry ?? {};
}

/** Look up a single profile's registered workspace path. */
export function getRegisteredWorkspacePath(profile: string | null): string | null {
  if (!profile) {return null;}
  return getWorkspaceRegistry()[profile] ?? null;
}

/** Persist a profile → workspace-path mapping in the registry. */
export function registerWorkspacePath(profile: string, absolutePath: string): void {
  const state = readUIState();
  const registry = state.workspaceRegistry ?? {};
  registry[profile] = absolutePath;
  writeUIState({ ...state, workspaceRegistry: registry });
}

// ---------------------------------------------------------------------------
// Profile discovery — scans the filesystem for all profiles/workspaces.
// ---------------------------------------------------------------------------

export type DiscoveredProfile = {
  name: string;
  stateDir: string;
  workspaceDir: string | null;
  isActive: boolean;
  hasConfig: boolean;
};

/**
 * Discover all profiles by scanning ~/.openclaw for workspace-* directories
 * and checking for profile-specific state dirs.
 */
export function discoverProfiles(): DiscoveredProfile[] {
  const home = process.env.OPENCLAW_HOME?.trim() || homedir();
  const baseStateDir = join(home, ".openclaw");
  const activeProfile = getEffectiveProfile();
  const profiles: DiscoveredProfile[] = [];
  const seen = new Set<string>();

  // Default profile
  const defaultWs = join(baseStateDir, "workspace");
  profiles.push({
    name: "default",
    stateDir: baseStateDir,
    workspaceDir: existsSync(defaultWs) ? defaultWs : null,
    isActive: !activeProfile || activeProfile.toLowerCase() === "default",
    hasConfig: existsSync(join(baseStateDir, "openclaw.json")),
  });
  seen.add("default");

  // Scan for workspace-<profile> directories inside the state dir
  if (existsSync(baseStateDir)) {
    try {
      const entries = readdirSync(baseStateDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {continue;}
        const match = entry.name.match(/^workspace-(.+)$/);
        if (!match) {continue;}
        const profileName = match[1];
        if (seen.has(profileName)) {continue;}
        seen.add(profileName);

        const wsDir = join(baseStateDir, entry.name);
        profiles.push({
          name: profileName,
          stateDir: baseStateDir,
          workspaceDir: existsSync(wsDir) ? wsDir : null,
          isActive: activeProfile === profileName,
          hasConfig: existsSync(join(baseStateDir, "openclaw.json")),
        });
      }
    } catch {
      // dir unreadable
    }
  }

  // Merge workspaces registered via custom paths (outside ~/.openclaw/)
  const registry = getWorkspaceRegistry();
  for (const [profileName, wsPath] of Object.entries(registry)) {
    if (seen.has(profileName)) {
      const existing = profiles.find((p) => p.name === profileName);
      if (existing && !existing.workspaceDir && existsSync(wsPath)) {
        existing.workspaceDir = wsPath;
      }
      continue;
    }
    seen.add(profileName);
    profiles.push({
      name: profileName,
      stateDir: baseStateDir,
      workspaceDir: existsSync(wsPath) ? wsPath : null,
      isActive: activeProfile === profileName,
      hasConfig: existsSync(join(baseStateDir, "openclaw.json")),
    });
  }

  return profiles;
}

// ---------------------------------------------------------------------------
// State directory & workspace resolution (profile-aware)
// ---------------------------------------------------------------------------

/**
 * Resolve the OpenClaw state directory (base dir for config, sessions, agents, etc.).
 * Mirrors src/config/paths.ts:resolveStateDir() logic for the web app.
 *
 * Precedence:
 * 1. OPENCLAW_STATE_DIR env var
 * 2. OPENCLAW_HOME env var → <home>/.openclaw
 * 3. ~/.openclaw (default)
 */
export function resolveOpenClawStateDir(): string {
  const stateOverride = process.env.OPENCLAW_STATE_DIR?.trim();
  if (stateOverride) {
    return stateOverride.startsWith("~")
      ? join(homedir(), stateOverride.slice(1))
      : stateOverride;
  }
  const home = process.env.OPENCLAW_HOME?.trim() || homedir();
  return join(home, ".openclaw");
}

/**
 * Resolve the web-chat sessions directory, scoped to the active profile.
 * Default profile: <stateDir>/web-chat
 * Named profile:   <stateDir>/web-chat-<profile>
 */
export function resolveWebChatDir(): string {
  const stateDir = resolveOpenClawStateDir();
  const profile = getEffectiveProfile();
  if (profile && profile.toLowerCase() !== "default") {
    return join(stateDir, `web-chat-${profile}`);
  }
  return join(stateDir, "web-chat");
}

/**
 * Resolve the workspace directory, checking in order:
 * 1. OPENCLAW_WORKSPACE env var
 * 2. Effective profile → <stateDir>/workspace-<profile>
 * 3. <stateDir>/workspace
 */
export function resolveWorkspaceRoot(): string | null {
  const stateDir = resolveOpenClawStateDir();
  const profile = getEffectiveProfile();
  const registryPath = getRegisteredWorkspacePath(profile);
  const candidates = [
    process.env.OPENCLAW_WORKSPACE,
    registryPath,
    profile && profile.toLowerCase() !== "default"
      ? join(stateDir, `workspace-${profile}`)
      : null,
    join(stateDir, "workspace"),
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    if (existsSync(dir)) {return dir;}
  }
  return null;
}

/** @deprecated Use `resolveWorkspaceRoot` instead. */
export const resolveDenchRoot = resolveWorkspaceRoot;

/**
 * Return the workspace path prefix for the agent.
 * Returns the absolute workspace path (e.g. ~/.openclaw/workspace),
 * or a relative path from the repo root if the workspace is inside it.
 */
export function resolveAgentWorkspacePrefix(): string | null {
  const root = resolveWorkspaceRoot();
  if (!root) {return null;}

  // If the workspace is an absolute path outside the repo, return it as-is
  if (root.startsWith("/")) {
    const cwd = process.cwd();
    const repoRoot = cwd.endsWith(join("apps", "web"))
      ? resolve(cwd, "..", "..")
      : cwd;
    const rel = relative(repoRoot, root);
    // If the relative path starts with "..", it's outside the repo — use absolute
    if (rel.startsWith("..")) {return root;}
    return rel || root;
  }

  return root;
}

// ---------------------------------------------------------------------------
// Hierarchical DuckDB discovery
//
// Supports multiple workspace.duckdb files in a tree structure.  Each
// subdirectory may contain its own workspace.duckdb that is authoritative
// for the objects in that subtree.  Shallower (closer to workspace root)
// databases take priority when objects share the same name.
// ---------------------------------------------------------------------------

/**
 * Recursively discover all workspace.duckdb files under `root`.
 * Returns absolute paths sorted by depth (shallowest first) so that
 * root-level databases have priority over deeper ones.
 */
export function discoverDuckDBPaths(root?: string): string[] {
  const wsRoot = root ?? resolveWorkspaceRoot();
  if (!wsRoot) {return [];}

  const results: Array<{ path: string; depth: number }> = [];

  function walk(dir: string, depth: number) {
    const dbFile = join(dir, "workspace.duckdb");
    if (existsSync(dbFile)) {
      results.push({ path: dbFile, depth });
    }
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {continue;}
        if (entry.name.startsWith(".")) {continue;}
        // Skip common non-workspace directories
        if (entry.name === "tmp" || entry.name === "exports" || entry.name === "node_modules") {continue;}
        walk(join(dir, entry.name), depth + 1);
      }
    } catch {
      // unreadable directory
    }
  }

  walk(wsRoot, 0);
  results.sort((a, b) => a.depth - b.depth);
  return results.map((r) => r.path);
}

/**
 * Path to the primary DuckDB database file.
 * Checks the workspace root first, then falls back to any workspace.duckdb
 * discovered in subdirectories (backward compat with dench/ layout).
 */
export function duckdbPath(): string | null {
  const root = resolveWorkspaceRoot();
  if (!root) {return null;}

  // Try root-level first (standard layout)
  const rootDb = join(root, "workspace.duckdb");
  if (existsSync(rootDb)) {return rootDb;}

  // Fallback: discover the shallowest workspace.duckdb in subdirectories
  const all = discoverDuckDBPaths(root);
  return all.length > 0 ? all[0] : null;
}

/**
 * Compute the workspace-relative directory that a DuckDB file is authoritative for.
 * e.g. for `~/.openclaw/workspace/dench/workspace.duckdb` returns `"dench"`.
 * For the root DB returns `""` (empty string).
 */
export function duckdbRelativeScope(dbPath: string): string {
  const root = resolveWorkspaceRoot();
  if (!root) {return "";}
  const dir = resolve(dbPath, "..");
  const rel = relative(root, dir);
  return rel === "." ? "" : rel;
}

/**
 * Resolve the duckdb CLI binary path.
 * Checks common locations since the Next.js server may have a minimal PATH.
 */
export function resolveDuckdbBin(): string | null {
  const home = homedir();
  const candidates = [
    // User-local installs
    join(home, ".duckdb", "cli", "latest", "duckdb"),
    join(home, ".local", "bin", "duckdb"),
    // Homebrew
    "/opt/homebrew/bin/duckdb",
    "/usr/local/bin/duckdb",
    // System
    "/usr/bin/duckdb",
  ];

  for (const bin of candidates) {
    if (existsSync(bin)) {return bin;}
  }

  // Fallback: try bare `duckdb` and hope it's in PATH
  try {
    execSync("which duckdb", { encoding: "utf-8", timeout: 2000 });
    return "duckdb";
  } catch {
    return null;
  }
}

/**
 * Execute a DuckDB query and return parsed JSON rows.
 * Uses the duckdb CLI with -json output format.
 *
 * @deprecated Prefer `duckdbQueryAsync` in server route handlers to avoid
 * blocking the Node.js event loop (which freezes the standalone server).
 */
export function duckdbQuery<T = Record<string, unknown>>(
  sql: string,
): T[] {
  const db = duckdbPath();
  if (!db) {return [];}

  const bin = resolveDuckdbBin();
  if (!bin) {return [];}

  try {
    // Escape single quotes in SQL for shell safety
    const escapedSql = sql.replace(/'/g, "'\\''");
    const result = execSync(`'${bin}' -json '${db}' '${escapedSql}'`, {
      encoding: "utf-8",
      timeout: 10_000,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
      shell: "/bin/sh",
    });

    const trimmed = result.trim();
    if (!trimmed || trimmed === "[]") {return [];}
    return JSON.parse(trimmed) as T[];
  } catch {
    return [];
  }
}

/**
 * Async version of duckdbQuery — does not block the event loop.
 * Always prefer this in Next.js route handlers (especially the standalone build
 * which is single-threaded; a blocking execSync freezes the entire server).
 */
export async function duckdbQueryAsync<T = Record<string, unknown>>(
  sql: string,
): Promise<T[]> {
  const db = duckdbPath();
  if (!db) {return [];}

  const bin = resolveDuckdbBin();
  if (!bin) {return [];}

  try {
    const escapedSql = sql.replace(/'/g, "'\\''");
    const { stdout } = await execAsync(`'${bin}' -json '${db}' '${escapedSql}'`, {
      encoding: "utf-8",
      timeout: 10_000,
      maxBuffer: 10 * 1024 * 1024,
      shell: "/bin/sh",
    });

    const trimmed = stdout.trim();
    if (!trimmed || trimmed === "[]") {return [];}
    return JSON.parse(trimmed) as T[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Multi-DB query helpers — aggregate results from all discovered databases
// ---------------------------------------------------------------------------

/**
 * Query ALL discovered workspace.duckdb files and merge results.
 * Shallower databases are queried first; use `dedupeKey` to drop duplicates
 * from deeper databases (shallower wins).
 */
export function duckdbQueryAll<T = Record<string, unknown>>(
  sql: string,
  dedupeKey?: keyof T,
): T[] {
  const dbPaths = discoverDuckDBPaths();
  if (dbPaths.length === 0) {return [];}

  const bin = resolveDuckdbBin();
  if (!bin) {return [];}

  const seen = new Set<unknown>();
  const merged: T[] = [];

  for (const db of dbPaths) {
    try {
      const escapedSql = sql.replace(/'/g, "'\\''");
      const result = execSync(`'${bin}' -json '${db}' '${escapedSql}'`, {
        encoding: "utf-8",
        timeout: 10_000,
        maxBuffer: 10 * 1024 * 1024,
        shell: "/bin/sh",
      });
      const trimmed = result.trim();
      if (!trimmed || trimmed === "[]") {continue;}
      const rows = JSON.parse(trimmed) as T[];
      for (const row of rows) {
        if (dedupeKey) {
          const key = row[dedupeKey];
          if (seen.has(key)) {continue;}
          seen.add(key);
        }
        merged.push(row);
      }
    } catch {
      // skip failing DBs
    }
  }

  return merged;
}

/**
 * Async version of duckdbQueryAll.
 */
export async function duckdbQueryAllAsync<T = Record<string, unknown>>(
  sql: string,
  dedupeKey?: keyof T,
): Promise<T[]> {
  const dbPaths = discoverDuckDBPaths();
  if (dbPaths.length === 0) {return [];}

  const bin = resolveDuckdbBin();
  if (!bin) {return [];}

  const seen = new Set<unknown>();
  const merged: T[] = [];

  for (const db of dbPaths) {
    try {
      const escapedSql = sql.replace(/'/g, "'\\''");
      const { stdout } = await execAsync(`'${bin}' -json '${db}' '${escapedSql}'`, {
        encoding: "utf-8",
        timeout: 10_000,
        maxBuffer: 10 * 1024 * 1024,
        shell: "/bin/sh",
      });
      const trimmed = stdout.trim();
      if (!trimmed || trimmed === "[]") {continue;}
      const rows = JSON.parse(trimmed) as T[];
      for (const row of rows) {
        if (dedupeKey) {
          const key = row[dedupeKey];
          if (seen.has(key)) {continue;}
          seen.add(key);
        }
        merged.push(row);
      }
    } catch {
      // skip failing DBs
    }
  }

  return merged;
}

/**
 * Find the DuckDB file that contains a specific object by name.
 * Returns the absolute path to the database, or null if not found.
 * Checks shallower databases first (parent takes priority).
 */
export function findDuckDBForObject(objectName: string): string | null {
  const dbPaths = discoverDuckDBPaths();
  if (dbPaths.length === 0) {return null;}

  const bin = resolveDuckdbBin();
  if (!bin) {return null;}

  // Build the SQL then apply the same shell-escape as duckdbQuery:
  // replace every ' with '\'' so the single-quoted shell arg stays valid.
  const sql = `SELECT id FROM objects WHERE name = '${objectName.replace(/'/g, "''")}' LIMIT 1`;
  const escapedSql = sql.replace(/'/g, "'\\''");

  for (const db of dbPaths) {
    try {
      const result = execSync(
        `'${bin}' -json '${db}' '${escapedSql}'`,
        { encoding: "utf-8", timeout: 5_000, maxBuffer: 1024 * 1024, shell: "/bin/sh" },
      );
      const trimmed = result.trim();
      if (trimmed && trimmed !== "[]") {return db;}
    } catch {
      // continue to next DB
    }
  }

  return null;
}

/**
 * Execute a DuckDB statement (no JSON output expected).
 * Used for INSERT/UPDATE/ALTER operations.
 */
export function duckdbExec(sql: string): boolean {
  const db = duckdbPath();
  if (!db) {return false;}
  return duckdbExecOnFile(db, sql);
}

/**
 * Execute a DuckDB statement against a specific database file (no JSON output).
 * Used for INSERT/UPDATE/ALTER operations on a targeted DB.
 */
export function duckdbExecOnFile(dbFilePath: string, sql: string): boolean {
  const bin = resolveDuckdbBin();
  if (!bin) {return false;}

  try {
    const escapedSql = sql.replace(/'/g, "'\\''");
    execSync(`'${bin}' '${dbFilePath}' '${escapedSql}'`, {
      encoding: "utf-8",
      timeout: 10_000,
      shell: "/bin/sh",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse a relation field value which may be a single ID or a JSON array of IDs.
 * Handles both many_to_one (single ID string) and many_to_many (JSON array).
 */
export function parseRelationValue(value: string | null | undefined): string[] {
  if (!value) {return [];}
  const trimmed = value.trim();
  if (!trimmed) {return [];}

  // Try JSON array first (many-to-many)
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {return parsed.map(String).filter(Boolean);}
    } catch {
      // not valid JSON array, treat as single value
    }
  }

  return [trimmed];
}

/** Database file extensions that trigger the database viewer. */
export const DB_EXTENSIONS = new Set([
  "duckdb",
  "sqlite",
  "sqlite3",
  "db",
  "postgres",
]);

/** Check whether a filename has a database extension. */
export function isDatabaseFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext ? DB_EXTENSIONS.has(ext) : false;
}

/**
 * Execute a DuckDB query against an arbitrary database file and return parsed JSON rows.
 * This is used by the database viewer to introspect any .duckdb/.sqlite/.db file.
 *
 * @deprecated Prefer `duckdbQueryOnFileAsync` in route handlers.
 */
export function duckdbQueryOnFile<T = Record<string, unknown>>(
  dbFilePath: string,
  sql: string,
): T[] {
  const bin = resolveDuckdbBin();
  if (!bin) {return [];}

  try {
    const escapedSql = sql.replace(/'/g, "'\\''");
    const result = execSync(`'${bin}' -json '${dbFilePath}' '${escapedSql}'`, {
      encoding: "utf-8",
      timeout: 15_000,
      maxBuffer: 10 * 1024 * 1024,
      shell: "/bin/sh",
    });

    const trimmed = result.trim();
    if (!trimmed || trimmed === "[]") {return [];}
    return JSON.parse(trimmed) as T[];
  } catch {
    return [];
  }
}

/** Async version of duckdbQueryOnFile — does not block the event loop. */
export async function duckdbQueryOnFileAsync<T = Record<string, unknown>>(
  dbFilePath: string,
  sql: string,
): Promise<T[]> {
  const bin = resolveDuckdbBin();
  if (!bin) {return [];}

  try {
    const escapedSql = sql.replace(/'/g, "'\\''");
    const { stdout } = await execAsync(`'${bin}' -json '${dbFilePath}' '${escapedSql}'`, {
      encoding: "utf-8",
      timeout: 15_000,
      maxBuffer: 10 * 1024 * 1024,
      shell: "/bin/sh",
    });

    const trimmed = stdout.trim();
    if (!trimmed || trimmed === "[]") {return [];}
    return JSON.parse(trimmed) as T[];
  } catch {
    return [];
  }
}

/**
 * Validate and resolve a path within the workspace.
 * Prevents path traversal by ensuring the resolved path stays within root.
 * Returns the absolute path or null if invalid/nonexistent.
 */
export function safeResolvePath(
  relativePath: string,
): string | null {
  const root = resolveWorkspaceRoot();
  if (!root) {return null;}

  // Reject obvious traversal attempts
  const normalized = normalize(relativePath);
  if (normalized.startsWith("..") || normalized.includes("/../")) {return null;}

  const absolute = resolve(root, normalized);

  // Ensure the resolved path is still within the workspace root
  if (!absolute.startsWith(resolve(root))) {return null;}
  if (!existsSync(absolute)) {return null;}

  return absolute;
}

/**
 * Lightweight YAML frontmatter / simple-value parser.
 * Handles flat key: value pairs and simple nested structures.
 * Good enough for .object.yaml and workspace_context.yaml top-level fields.
 */
export function parseSimpleYaml(
  content: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split("\n");

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.trim().startsWith("#") || !line.trim()) {continue;}

    // Match top-level key: value
    const match = line.match(/^(\w[\w_-]*)\s*:\s*(.+)/);
    if (match) {
      const key = match[1];
      let value: unknown = match[2].trim();

      // Strip quotes
      if (
        typeof value === "string" &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = (value).slice(1, -1);
      }

      // Parse booleans and numbers
      if (value === "true") {value = true;}
      else if (value === "false") {value = false;}
      else if (value === "null") {value = null;}
      else if (
        typeof value === "string" &&
        /^-?\d+(\.\d+)?$/.test(value)
      ) {
        value = Number(value);
      }

      result[key] = value;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// .object.yaml with nested views support
// ---------------------------------------------------------------------------

/** Parsed representation of a .object.yaml file. */
export type ObjectYamlConfig = {
  icon?: string;
  default_view?: string;
  views?: SavedView[];
  active_view?: string;
  /** Any other top-level keys. */
  [key: string]: unknown;
};

/**
 * Parse a .object.yaml file with full YAML support (handles nested views).
 * Falls back to parseSimpleYaml for files that only have flat keys.
 */
export function parseObjectYaml(content: string): ObjectYamlConfig {
  try {
    const parsed = YAML.parse(content);
    if (!parsed || typeof parsed !== "object") {return {};}
    return parsed as ObjectYamlConfig;
  } catch {
    // Fall back to the simple parser for minimal files
    return parseSimpleYaml(content) as ObjectYamlConfig;
  }
}

/**
 * Read and parse a .object.yaml from disk.
 * Returns null if the file does not exist.
 */
export function readObjectYaml(objectDir: string): ObjectYamlConfig | null {
  const yamlPath = join(objectDir, ".object.yaml");
  if (!existsSync(yamlPath)) {return null;}
  const raw = readFileSync(yamlPath, "utf-8");
  return parseObjectYaml(raw);
}

/**
 * Write a .object.yaml file, merging view config with existing top-level keys.
 */
export function writeObjectYaml(objectDir: string, config: ObjectYamlConfig): void {
  const yamlPath = join(objectDir, ".object.yaml");

  // Read existing to preserve keys we don't manage
  let existing: ObjectYamlConfig = {};
  if (existsSync(yamlPath)) {
    try {
      existing = parseObjectYaml(readFileSync(yamlPath, "utf-8"));
    } catch {
      existing = {};
    }
  }

  const merged = { ...existing, ...config };

  // Remove undefined values
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) {delete merged[key];}
  }

  const yamlStr = YAML.stringify(merged, { indent: 2, lineWidth: 0 });
  writeFileSync(yamlPath, yamlStr, "utf-8");
}

/**
 * Find the filesystem directory for an object by name.
 * Walks the workspace tree looking for a directory containing a .object.yaml
 * or a directory matching the object name inside the workspace.
 */
export function findObjectDir(objectName: string): string | null {
  const root = resolveWorkspaceRoot();
  if (!root) {return null;}

  // Check direct match: workspace/{objectName}/
  const direct = join(root, objectName);
  if (existsSync(direct) && existsSync(join(direct, ".object.yaml"))) {
    return direct;
  }

  // Search one level deep for a matching .object.yaml
  try {
    const entries = readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {continue;}
      const subDir = join(root, entry.name);
      if (entry.name === objectName && existsSync(join(subDir, ".object.yaml"))) {
        return subDir;
      }
    }
  } catch {
    // ignore read errors
  }

  return null;
}

/**
 * Get saved views for an object from its .object.yaml.
 */
export function getObjectViews(objectName: string): {
  views: SavedView[];
  activeView: string | undefined;
} {
  const dir = findObjectDir(objectName);
  if (!dir) {return { views: [], activeView: undefined };}

  const config = readObjectYaml(dir);
  if (!config) {return { views: [], activeView: undefined };}

  return {
    views: (config.views ?? []).map((v) => ({
      ...v,
      filters: v.filters ? normalizeFilterGroup(v.filters) : undefined,
    })),
    activeView: config.active_view,
  };
}

/**
 * Save views for an object to its .object.yaml.
 */
export function saveObjectViews(
  objectName: string,
  views: SavedView[],
  activeView?: string,
): boolean {
  const dir = findObjectDir(objectName);
  if (!dir) {return false;}

  writeObjectYaml(dir, {
    views: views.length > 0 ? views : undefined,
    active_view: activeView,
  });
  return true;
}

// --- System file protection ---

/** Always protected regardless of depth. */
const ALWAYS_SYSTEM_PATTERNS = [
  /^\.object\.yaml$/,
  /\.wal$/,
  /\.tmp$/,
];

/** Only protected at the workspace root (no "/" in the relative path). */
const ROOT_ONLY_SYSTEM_PATTERNS = [
  /^workspace\.duckdb/,
  /^workspace_context\.yaml$/,
];

/** Check if a workspace-relative path refers to a protected system file. */
export function isSystemFile(relativePath: string): boolean {
  const base = relativePath.split("/").pop() ?? "";
  if (ALWAYS_SYSTEM_PATTERNS.some((p) => p.test(base))) {return true;}
  const isRoot = !relativePath.includes("/");
  return isRoot && ROOT_ONLY_SYSTEM_PATTERNS.some((p) => p.test(base));
}

/**
 * Like safeResolvePath but does NOT require the target to exist on disk.
 * Useful for mkdir / create / rename-target validation.
 * Still prevents path traversal.
 */
export function safeResolveNewPath(relativePath: string): string | null {
  const root = resolveWorkspaceRoot();
  if (!root) {return null;}

  const normalized = normalize(relativePath);
  if (normalized.startsWith("..") || normalized.includes("/../")) {return null;}

  const absolute = resolve(root, normalized);
  if (!absolute.startsWith(resolve(root))) {return null;}

  return absolute;
}

/**
 * Read a file from the workspace safely.
 * Returns content and detected type, or null if not found.
 */
export function readWorkspaceFile(
  relativePath: string,
): { content: string; type: "markdown" | "yaml" | "text" } | null {
  const absolute = safeResolvePath(relativePath);
  if (!absolute) {return null;}

  try {
    const content = readFileSync(absolute, "utf-8");
    const ext = relativePath.split(".").pop()?.toLowerCase();

    let type: "markdown" | "yaml" | "text" = "text";
    if (ext === "md" || ext === "mdx") {type = "markdown";}
    else if (ext === "yaml" || ext === "yml") {type = "yaml";}

    return { content, type };
  } catch {
    return null;
  }
}
