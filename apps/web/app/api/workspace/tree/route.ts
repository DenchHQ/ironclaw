import { readdirSync, readFileSync, existsSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { resolveWorkspaceRoot, resolveOpenClawStateDir, getEffectiveProfile, parseSimpleYaml, duckdbQueryAll, isDatabaseFile } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type TreeNode = {
  name: string;
  path: string; // relative to workspace root (or ~skills/ for virtual nodes)
  type: "object" | "document" | "folder" | "file" | "database" | "report";
  icon?: string;
  defaultView?: "table" | "kanban";
  children?: TreeNode[];
  /** Virtual nodes live outside the main workspace (e.g. Skills, Memories). */
  virtual?: boolean;
  /** True when the entry is a symbolic link. */
  symlink?: boolean;
};

type DbObject = {
  name: string;
  icon?: string;
  default_view?: string;
};

/** Read .object.yaml metadata from a directory if it exists. */
function readObjectMeta(
  dirPath: string,
): { icon?: string; defaultView?: string } | null {
  const yamlPath = join(dirPath, ".object.yaml");
  if (!existsSync(yamlPath)) {return null;}

  try {
    const content = readFileSync(yamlPath, "utf-8");
    const parsed = parseSimpleYaml(content);
    return {
      icon: parsed.icon as string | undefined,
      defaultView: parsed.default_view as string | undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Query ALL discovered DuckDB files for objects so we can identify object
 * directories even when .object.yaml files are missing.
 * Shallower databases win on name conflicts (parent priority).
 */
function loadDbObjects(): Map<string, DbObject> {
  const map = new Map<string, DbObject>();
  const rows = duckdbQueryAll<DbObject & { name: string }>(
    "SELECT name, icon, default_view FROM objects",
    "name",
  );
  for (const row of rows) {
    map.set(row.name, row);
  }
  return map;
}

/** Resolve a dirent's effective type, following symlinks to their target. */
function resolveEntryType(entry: Dirent, absPath: string): "directory" | "file" | null {
  if (entry.isDirectory()) {return "directory";}
  if (entry.isFile()) {return "file";}
  if (entry.isSymbolicLink()) {
    try {
      const st = statSync(absPath);
      if (st.isDirectory()) {return "directory";}
      if (st.isFile()) {return "file";}
    } catch {
      // Broken symlink -- skip
    }
  }
  return null;
}

/** Recursively build a tree from a workspace directory. */
function buildTree(
  absDir: string,
  relativeBase: string,
  dbObjects: Map<string, DbObject>,
  showHidden = false,
): TreeNode[] {
  const nodes: TreeNode[] = [];

  let entries: Dirent[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return nodes;
  }

  const filtered = entries.filter((e) => {
    // .object.yaml is always needed for metadata; also shown as a node when showHidden is on
    if (e.name === ".object.yaml") {return true;}
    if (e.name.startsWith(".")) {return showHidden;}
    return true;
  });

  // Sort: directories first, then files, alphabetical within each group
  const sorted = filtered.toSorted((a, b) => {
    const absA = join(absDir, a.name);
    const absB = join(absDir, b.name);
    const typeA = resolveEntryType(a, absA);
    const typeB = resolveEntryType(b, absB);
    const dirA = typeA === "directory";
    const dirB = typeB === "directory";
    if (dirA && !dirB) {return -1;}
    if (!dirA && dirB) {return 1;}
    return a.name.localeCompare(b.name);
  });

  for (const entry of sorted) {
    // .object.yaml is consumed for metadata; only show it as a visible node when revealing hidden files
    if (entry.name === ".object.yaml" && !showHidden) {continue;}

    const absPath = join(absDir, entry.name);
    const relPath = relativeBase
      ? `${relativeBase}/${entry.name}`
      : entry.name;

    const isSymlink = entry.isSymbolicLink();
    const effectiveType = resolveEntryType(entry, absPath);

    if (effectiveType === "directory") {
      const objectMeta = readObjectMeta(absPath);
      const dbObject = dbObjects.get(entry.name);
      const children = buildTree(absPath, relPath, dbObjects, showHidden);

      if (objectMeta || dbObject) {
        nodes.push({
          name: entry.name,
          path: relPath,
          type: "object",
          icon: objectMeta?.icon ?? dbObject?.icon,
          defaultView:
            ((objectMeta?.defaultView ?? dbObject?.default_view) as
              | "table"
              | "kanban") ?? "table",
          children: children.length > 0 ? children : undefined,
          ...(isSymlink && { symlink: true }),
        });
      } else {
        nodes.push({
          name: entry.name,
          path: relPath,
          type: "folder",
          children: children.length > 0 ? children : undefined,
          ...(isSymlink && { symlink: true }),
        });
      }
    } else if (effectiveType === "file") {
      const ext = entry.name.split(".").pop()?.toLowerCase();
      const isReport = entry.name.endsWith(".report.json");
      const isDocument = ext === "md" || ext === "mdx";
      const isDatabase = isDatabaseFile(entry.name);

      nodes.push({
        name: entry.name,
        path: relPath,
        type: isReport ? "report" : isDatabase ? "database" : isDocument ? "document" : "file",
        ...(isSymlink && { symlink: true }),
      });
    }
  }

  return nodes;
}

// --- Virtual folder builders ---

/** Parse YAML frontmatter from a SKILL.md file (lightweight). */
function parseSkillFrontmatter(content: string): { name?: string; emoji?: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) {return {};}
  const yaml = match[1];
  const result: Record<string, string> = {};
  for (const line of yaml.split("\n")) {
    const kv = line.match(/^(\w+)\s*:\s*(.+)/);
    if (kv) {result[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();}
  }
  return { name: result.name, emoji: result.emoji };
}

/** Build a virtual "Skills" folder from <stateDir>/skills/. */
function buildSkillsVirtualFolder(): TreeNode | null {
  const stateDir = resolveOpenClawStateDir();
  const dirs = [
    join(stateDir, "skills"),
  ];

  const children: TreeNode[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    if (!existsSync(dir)) {continue;}
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || seen.has(entry.name)) {continue;}
        const skillMdPath = join(dir, entry.name, "SKILL.md");
        if (!existsSync(skillMdPath)) {continue;}

        seen.add(entry.name);
        let displayName = entry.name;
        try {
          const content = readFileSync(skillMdPath, "utf-8");
          const meta = parseSkillFrontmatter(content);
          if (meta.name) {displayName = meta.name;}
          if (meta.emoji) {displayName = `${meta.emoji} ${displayName}`;}
        } catch {
          // skip
        }

        children.push({
          name: displayName,
          path: `~skills/${entry.name}/SKILL.md`,
          type: "document",
          virtual: true,
        });
      }
    } catch {
      // dir unreadable
    }
  }

  if (children.length === 0) {return null;}
  children.sort((a, b) => a.name.localeCompare(b.name));

  return {
    name: "Skills",
    path: "~skills",
    type: "folder",
    virtual: true,
    children,
  };
}


export async function GET(req: Request) {
  const url = new URL(req.url);
  const showHidden = url.searchParams.get("showHidden") === "1";

  const openclawDir = resolveOpenClawStateDir();
  const profile = getEffectiveProfile();
  const root = resolveWorkspaceRoot();
  if (!root) {
    const tree: TreeNode[] = [];
    const skillsFolder = buildSkillsVirtualFolder();
    if (skillsFolder) {tree.push(skillsFolder);}
    return Response.json({ tree, exists: false, workspaceRoot: null, openclawDir, profile });
  }

  const dbObjects = loadDbObjects();

  const tree = buildTree(root, "", dbObjects, showHidden);

  const skillsFolder = buildSkillsVirtualFolder();
  if (skillsFolder) {tree.push(skillsFolder);}

  return Response.json({ tree, exists: true, workspaceRoot: root, openclawDir, profile });
}
