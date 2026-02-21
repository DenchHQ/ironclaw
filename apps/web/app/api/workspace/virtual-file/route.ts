import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve, normalize } from "node:path";
import { resolveOpenClawStateDir, resolveWorkspaceRoot } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Resolve a virtual path (~skills/... or ~memories/...) to an absolute filesystem path.
 * Returns null if the path is invalid or tries to escape.
 */
function resolveVirtualPath(virtualPath: string): string | null {
  const stateDir = resolveOpenClawStateDir();
  const workspaceDir = resolveWorkspaceRoot() ?? join(stateDir, "workspace");

  if (virtualPath.startsWith("~skills/")) {
    // ~skills/<skillName>/SKILL.md
    const rest = virtualPath.slice("~skills/".length);
    // Validate: must be <name>/SKILL.md
    const parts = rest.split("/");
    if (parts.length !== 2 || parts[1] !== "SKILL.md" || !parts[0]) {
      return null;
    }
    const skillName = parts[0];
    // Prevent path traversal
    if (skillName.includes("..") || skillName.includes("/")) {
      return null;
    }

    // Check workspace skills first, then managed skills
    const candidates = [
      join(workspaceDir, "skills", skillName, "SKILL.md"),
      join(stateDir, "skills", skillName, "SKILL.md"),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    // Default to workspace skills dir for new files
    return candidates[0];
  }

  if (virtualPath.startsWith("~memories/")) {
    const rest = virtualPath.slice("~memories/".length);
    // Prevent path traversal
    if (rest.includes("..") || rest.includes("/")) {
      return null;
    }

    if (rest === "MEMORY.md") {
      // Check both casing
      for (const filename of ["MEMORY.md", "memory.md"]) {
        const candidate = join(workspaceDir, filename);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
      // Default to MEMORY.md for new files
      return join(workspaceDir, "MEMORY.md");
    }

    // Daily log: must be a .md file in the memory/ subdirectory
    if (!rest.endsWith(".md")) {
      return null;
    }
    return join(workspaceDir, "memory", rest);
  }

  if (virtualPath.startsWith("~workspace/")) {
    const rest = virtualPath.slice("~workspace/".length);
    // Only allow direct filenames (no subdirectories, no traversal)
    if (!rest || rest.includes("..") || rest.includes("/")) {
      return null;
    }
    return join(workspaceDir, rest);
  }

  return null;
}

/**
 * Double-check that the resolved path stays within expected directories.
 */
function isSafePath(absPath: string): boolean {
  const stateDir = resolveOpenClawStateDir();
  const workspaceDir = resolveWorkspaceRoot() ?? join(stateDir, "workspace");
  const normalized = normalize(resolve(absPath));
  const allowed = [
    normalize(join(stateDir, "skills")),
    normalize(join(workspaceDir, "skills")),
    normalize(workspaceDir),
  ];
  return allowed.some((dir) => normalized.startsWith(dir));
}

/** Extensions recognized as code files for syntax-highlighted viewing. */
const VIRTUAL_CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs",
  "java", "kt", "swift", "c", "cpp", "h", "hpp", "cs", "css", "scss",
  "less", "html", "htm", "xml", "json", "jsonc", "toml", "sh", "bash",
  "zsh", "fish", "ps1", "sql", "graphql", "gql", "diff", "patch",
  "ini", "env", "tf", "proto", "zig", "lua", "php",
]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");

  if (!path) {
    return Response.json({ error: "Missing 'path' query parameter" }, { status: 400 });
  }

  const absPath = resolveVirtualPath(path);
  if (!absPath || !isSafePath(absPath)) {
    return Response.json({ error: "Invalid virtual path" }, { status: 400 });
  }

  if (!existsSync(absPath)) {
    return Response.json({ error: "File not found" }, { status: 404 });
  }

  try {
    const content = readFileSync(absPath, "utf-8");
    const ext = absPath.split(".").pop()?.toLowerCase();
    let type: "markdown" | "yaml" | "code" | "text" = "text";
    if (ext === "md" || ext === "mdx") {type = "markdown";}
    else if (ext === "yaml" || ext === "yml") {type = "yaml";}
    else if (VIRTUAL_CODE_EXTENSIONS.has(ext ?? "")) {type = "code";}
    return Response.json({ content, type });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Read failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let body: { path?: string; content?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { path: virtualPath, content } = body;
  if (!virtualPath || typeof virtualPath !== "string" || typeof content !== "string") {
    return Response.json(
      { error: "Missing 'path' and 'content' fields" },
      { status: 400 },
    );
  }

  const absPath = resolveVirtualPath(virtualPath);
  if (!absPath || !isSafePath(absPath)) {
    return Response.json({ error: "Invalid virtual path" }, { status: 400 });
  }

  try {
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content, "utf-8");
    return Response.json({ ok: true, path: virtualPath });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Write failed" },
      { status: 500 },
    );
  }
}
