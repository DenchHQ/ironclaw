import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { safeResolvePath, resolveWorkspaceRoot } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIME_MAP: Record<string, string> = {
	// Images
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	ico: "image/x-icon",
	bmp: "image/bmp",
	tiff: "image/tiff",
	tif: "image/tiff",
	avif: "image/avif",
	heic: "image/heic",
	heif: "image/heif",
	// Video
	mp4: "video/mp4",
	webm: "video/webm",
	mov: "video/quicktime",
	avi: "video/x-msvideo",
	mkv: "video/x-matroska",
	// Audio
	mp3: "audio/mpeg",
	wav: "audio/wav",
	ogg: "audio/ogg",
	m4a: "audio/mp4",
	// Documents
	pdf: "application/pdf",
};

/**
 * Resolve a file path, trying multiple strategies:
 * 1. Absolute path — the agent may read files from anywhere on the local machine
 *    (Photos library, Downloads, etc.), so we serve any readable absolute path.
 * 2. Workspace-relative via safeResolvePath
 * 3. Bare filename — search common workspace subdirectories
 *
 * Security note: this is a local-only dev server; it never runs in production.
 */
function resolveFile(path: string): string | null {
	// 1. Absolute path — serve directly if it exists on disk
	if (path.startsWith("/")) {
		const abs = resolve(path);
		if (existsSync(abs)) {return abs;}
		// Fall through to workspace-relative in case the leading / is accidental
	}

	// 2. Standard workspace-relative resolution
	const resolved = safeResolvePath(path);
	if (resolved) {return resolved;}

	// 3. Try common subdirectories in case the path is a bare filename
	const root = resolveWorkspaceRoot();
	if (!root) {return null;}
	const rootAbs = resolve(root);
	const basename = path.split("/").pop() ?? path;
	if (basename === path) {
		const subdirs = [
			"assets",
			"knowledge",
			"manufacturing",
			"uploads",
			"files",
			"images",
			"media",
			"reports",
			"exports",
		];
		for (const sub of subdirs) {
			const candidate = resolve(root, sub, basename);
			if (
				candidate.startsWith(rootAbs) &&
				existsSync(candidate)
			) {
				return candidate;
			}
		}
	}

	return null;
}

/**
 * GET /api/workspace/raw-file?path=...
 * Serves a workspace file with the correct Content-Type for inline display.
 * Used by the chain-of-thought component to render images, videos, and PDFs.
 */
export async function GET(req: Request) {
	const url = new URL(req.url);
	const path = url.searchParams.get("path");

	if (!path) {
		return new Response("Missing path", { status: 400 });
	}

	const absolute = resolveFile(path);
	if (!absolute) {
		return new Response("Not found", { status: 404 });
	}

	const ext = path.split(".").pop()?.toLowerCase() ?? "";
	const contentType = MIME_MAP[ext] ?? "application/octet-stream";

	try {
		const buffer = readFileSync(absolute);
		return new Response(buffer, {
			headers: {
				"Content-Type": contentType,
				"Cache-Control": "public, max-age=3600",
			},
		});
	} catch {
		return new Response("Read error", { status: 500 });
	}
}
