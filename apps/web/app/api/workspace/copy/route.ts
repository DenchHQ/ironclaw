import { cpSync, existsSync, statSync } from "node:fs";
import { dirname, basename, extname } from "node:path";
import { safeResolvePath, safeResolveNewPath } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/workspace/copy
 * Body: { path: string, destinationPath?: string }
 *
 * Duplicates a file or folder. If no destinationPath is provided,
 * creates a copy next to the original with " copy" appended.
 */
export async function POST(req: Request) {
  let body: { path?: string; destinationPath?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { path: relPath, destinationPath } = body;
  if (!relPath || typeof relPath !== "string") {
    return Response.json(
      { error: "Missing 'path' field" },
      { status: 400 },
    );
  }

  const srcAbs = safeResolvePath(relPath);
  if (!srcAbs) {
    return Response.json(
      { error: "Source not found or path traversal rejected" },
      { status: 404 },
    );
  }

  let destRelPath: string;
  if (destinationPath && typeof destinationPath === "string") {
    destRelPath = destinationPath;
  } else {
    // Auto-generate "name copy.ext" or "name copy" for folders
    const name = basename(relPath);
    const dir = dirname(relPath);
    const ext = extname(name);
    const stem = ext ? name.slice(0, -ext.length) : name;
    const copyName = ext ? `${stem} copy${ext}` : `${stem} copy`;
    destRelPath = dir === "." ? copyName : `${dir}/${copyName}`;
  }

  const destAbs = safeResolveNewPath(destRelPath);
  if (!destAbs) {
    return Response.json(
      { error: "Invalid destination path" },
      { status: 400 },
    );
  }

  if (existsSync(destAbs)) {
    return Response.json(
      { error: "Destination already exists" },
      { status: 409 },
    );
  }

  try {
    const isDir = statSync(srcAbs).isDirectory();
    cpSync(srcAbs, destAbs, { recursive: isDir });
    return Response.json({ ok: true, sourcePath: relPath, newPath: destRelPath });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Copy failed" },
      { status: 500 },
    );
  }
}
