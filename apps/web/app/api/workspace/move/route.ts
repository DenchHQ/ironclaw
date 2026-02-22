import { renameSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { safeResolvePath, isSystemFile } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/workspace/move
 * Body: { sourcePath: string, destinationDir: string }
 *
 * Moves a file or folder into a different directory.
 * System files are protected from moving.
 */
export async function POST(req: Request) {
  let body: { sourcePath?: string; destinationDir?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sourcePath, destinationDir } = body;
  if (!sourcePath || typeof sourcePath !== "string" || !destinationDir || typeof destinationDir !== "string") {
    return Response.json(
      { error: "Missing 'sourcePath' and 'destinationDir' fields" },
      { status: 400 },
    );
  }

  if (isSystemFile(sourcePath)) {
    return Response.json(
      { error: "Cannot move system file" },
      { status: 403 },
    );
  }

  const srcAbs = safeResolvePath(sourcePath);
  if (!srcAbs) {
    return Response.json(
      { error: "Source not found or path traversal rejected" },
      { status: 404 },
    );
  }

  const destDirAbs = safeResolvePath(destinationDir);
  if (!destDirAbs) {
    return Response.json(
      { error: "Destination not found or path traversal rejected" },
      { status: 404 },
    );
  }

  // Destination must be a directory
  if (!statSync(destDirAbs).isDirectory()) {
    return Response.json(
      { error: "Destination is not a directory" },
      { status: 400 },
    );
  }

  // Prevent moving a folder into itself or its children
  const srcAbsNorm = srcAbs + "/";
  if (destDirAbs.startsWith(srcAbsNorm) || destDirAbs === srcAbs) {
    return Response.json(
      { error: "Cannot move a folder into itself" },
      { status: 400 },
    );
  }

  const itemName = basename(srcAbs);
  const destAbs = join(destDirAbs, itemName);

  if (existsSync(destAbs)) {
    return Response.json(
      { error: `'${itemName}' already exists in destination` },
      { status: 409 },
    );
  }

  // Build new relative path
  const newRelPath = destinationDir === "." ? itemName : `${destinationDir}/${itemName}`;

  try {
    renameSync(srcAbs, destAbs);
    return Response.json({ ok: true, oldPath: sourcePath, newPath: newRelPath });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Move failed" },
      { status: 500 },
    );
  }
}
