import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/workspace/path-info?path=...
 * Resolves and inspects a filesystem path for in-app preview routing.
 */
export async function GET(req: Request) {
	const url = new URL(req.url);
	const rawPath = url.searchParams.get("path");

	if (!rawPath) {
		return Response.json(
			{ error: "Missing 'path' query parameter" },
			{ status: 400 },
		);
	}

	let candidatePath = rawPath;

	// Convert file:// URLs into local paths first.
	if (candidatePath.startsWith("file://")) {
		try {
			candidatePath = fileURLToPath(candidatePath);
		} catch {
			return Response.json(
				{ error: "Invalid file URL" },
				{ status: 400 },
			);
		}
	}

	// Expand "~/..." to the current user's home directory.
	const expandedPath = candidatePath.startsWith("~/")
		? candidatePath.replace(/^~/, homedir())
		: candidatePath;
	const resolvedPath = resolve(normalize(expandedPath));

	if (!existsSync(resolvedPath)) {
		return Response.json(
			{ error: "Path not found", path: resolvedPath },
			{ status: 404 },
		);
	}

	try {
		const stat = statSync(resolvedPath);
		const type = stat.isDirectory()
			? "directory"
			: stat.isFile()
				? "file"
				: "other";

		return Response.json({
			path: resolvedPath,
			name: basename(resolvedPath) || resolvedPath,
			type,
		});
	} catch {
		return Response.json(
			{ error: "Cannot stat path", path: resolvedPath },
			{ status: 500 },
		);
	}
}
