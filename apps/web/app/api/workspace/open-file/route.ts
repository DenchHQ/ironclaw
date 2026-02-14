import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, normalize } from "node:path";
import { homedir } from "node:os";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/workspace/open-file
 * Opens a file or directory using the system's default application.
 * On macOS this uses `open`, on Linux `xdg-open`.
 */
export async function POST(req: Request) {
	let body: { path?: string; reveal?: boolean };
	try {
		body = await req.json();
	} catch {
		return Response.json(
			{ error: "Invalid JSON body" },
			{ status: 400 },
		);
	}

	const rawPath = body.path;
	if (!rawPath || typeof rawPath !== "string") {
		return Response.json(
			{ error: "Missing 'path' in request body" },
			{ status: 400 },
		);
	}

	// Expand ~ to home directory
	const expanded = rawPath.startsWith("~/")
		? rawPath.replace(/^~/, homedir())
		: rawPath;

	const resolved = resolve(normalize(expanded));

	if (!existsSync(resolved)) {
		return Response.json(
			{ error: "File not found", path: resolved },
			{ status: 404 },
		);
	}

	const platform = process.platform;
	const reveal = body.reveal === true;

	let cmd: string;
	if (platform === "darwin") {
		// macOS: use `open` — `-R` reveals in Finder instead of opening
		cmd = reveal
			? `open -R ${JSON.stringify(resolved)}`
			: `open ${JSON.stringify(resolved)}`;
	} else if (platform === "linux") {
		// Linux: xdg-open (no reveal equivalent)
		cmd = `xdg-open ${JSON.stringify(resolved)}`;
	} else {
		return Response.json(
			{ error: `Unsupported platform: ${platform}` },
			{ status: 400 },
		);
	}

	return new Promise<Response>((res) => {
		exec(cmd, (error) => {
			if (error) {
				res(
					Response.json(
						{ error: `Failed to open file: ${error.message}` },
						{ status: 500 },
					),
				);
			} else {
				res(Response.json({ ok: true, path: resolved }));
			}
		});
	});
}
