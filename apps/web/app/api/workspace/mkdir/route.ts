import { mkdirSync, existsSync } from "node:fs";
import { resolve, normalize } from "node:path";
import { safeResolveNewPath } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/workspace/mkdir
 * Body: { path: string; absolute?: boolean }
 *
 * Creates a new directory. By default paths are resolved relative to the
 * workspace root.  When `absolute` is true the path is treated as a
 * filesystem-absolute path (used by the directory picker for workspace
 * creation outside the current workspace).
 */
export async function POST(req: Request) {
  let body: { path?: string; absolute?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { path: rawPath, absolute: useAbsolute } = body;
  if (!rawPath || typeof rawPath !== "string") {
    return Response.json(
      { error: "Missing 'path' field" },
      { status: 400 },
    );
  }

  let absPath: string | null;

  if (useAbsolute) {
    const normalized = normalize(rawPath);
    if (normalized.includes("/../") || normalized.includes("/..")) {
      return Response.json(
        { error: "Path traversal rejected" },
        { status: 400 },
      );
    }
    absPath = resolve(normalized);
  } else {
    absPath = safeResolveNewPath(rawPath);
  }

  if (!absPath) {
    return Response.json(
      { error: "Invalid path or path traversal rejected" },
      { status: 400 },
    );
  }

  if (existsSync(absPath)) {
    return Response.json(
      { error: "Directory already exists" },
      { status: 409 },
    );
  }

  try {
    mkdirSync(absPath, { recursive: true });
    return Response.json({ ok: true, path: absPath });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "mkdir failed" },
      { status: 500 },
    );
  }
}
