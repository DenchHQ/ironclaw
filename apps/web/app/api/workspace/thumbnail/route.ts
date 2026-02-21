import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { safeResolvePath } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const THUMB_DIR = join(tmpdir(), "ironclaw-thumbs");
mkdirSync(THUMB_DIR, { recursive: true });

/**
 * Resolve a file path — supports absolute paths and workspace-relative paths.
 */
function resolveFile(path: string): string | null {
  if (path.startsWith("/")) {
    const abs = resolve(path);
    if (existsSync(abs)) {return abs;}
  }
  return safeResolvePath(path) ?? null;
}

/**
 * GET /api/workspace/thumbnail?path=...&size=200
 * Uses macOS Quick Look (qlmanage) to generate a thumbnail image.
 * Returns the thumbnail as image/png.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  const size = url.searchParams.get("size") ?? "200";

  if (!path) {
    return new Response("Missing path", { status: 400 });
  }

  const absolute = resolveFile(path);
  if (!absolute) {
    return new Response("Not found", { status: 404 });
  }

  // The thumbnail output filename is <original-basename>.png
  const thumbName = `${basename(absolute)}.png`;
  const thumbPath = join(THUMB_DIR, thumbName);

  try {
    // Generate thumbnail using macOS Quick Look
    execSync(
      `qlmanage -t -s ${parseInt(size, 10)} -o "${THUMB_DIR}" "${absolute}" 2>/dev/null`,
      { timeout: 5000 },
    );

    if (!existsSync(thumbPath)) {
      return new Response("Thumbnail generation failed", { status: 500 });
    }

    const buffer = readFileSync(thumbPath);
    return new Response(buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("Thumbnail generation failed", { status: 500 });
  }
}
