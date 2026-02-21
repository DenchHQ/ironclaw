import { readdirSync, statSync, type Dirent } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { resolveWorkspaceRoot } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BrowseNode = {
	name: string;
	path: string; // absolute path
	type: "folder" | "file" | "document" | "database";
	children?: BrowseNode[];
	symlink?: boolean;
};

/** Directories to skip when browsing the filesystem. */
const SKIP_DIRS = new Set(["node_modules", ".git", ".Trash", "__pycache__", ".cache"]);

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
			// Broken symlink
		}
	}
	return null;
}

/** Build a depth-limited tree from an absolute directory. */
function buildBrowseTree(
	absDir: string,
	maxDepth: number,
	currentDepth = 0,
	showHidden = false,
): BrowseNode[] {
	if (currentDepth >= maxDepth) {return [];}

	let entries: Dirent[];
	try {
		entries = readdirSync(absDir, { withFileTypes: true });
	} catch {
		return [];
	}

	const filtered = entries
		.filter((e) => showHidden || !e.name.startsWith("."))
		.filter((e) => {
			const absPath = join(absDir, e.name);
			const t = resolveEntryType(e, absPath);
			return !(t === "directory" && SKIP_DIRS.has(e.name));
		});

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

	const nodes: BrowseNode[] = [];

	for (const entry of sorted) {
		const absPath = join(absDir, entry.name);
		const isSymlink = entry.isSymbolicLink();
		const effectiveType = resolveEntryType(entry, absPath);

		if (effectiveType === "directory") {
			const children = buildBrowseTree(absPath, maxDepth, currentDepth + 1, showHidden);
			nodes.push({
				name: entry.name,
				path: absPath,
				type: "folder",
				children: children.length > 0 ? children : undefined,
				...(isSymlink && { symlink: true }),
			});
		} else if (effectiveType === "file") {
			const ext = entry.name.split(".").pop()?.toLowerCase();
			const isDocument = ext === "md" || ext === "mdx";
			const isDatabase = ext === "duckdb" || ext === "sqlite" || ext === "sqlite3" || ext === "db";

			nodes.push({
				name: entry.name,
				path: absPath,
				type: isDatabase ? "database" : isDocument ? "document" : "file",
				...(isSymlink && { symlink: true }),
			});
		}
	}

	return nodes;
}

export async function GET(req: Request) {
	const url = new URL(req.url);
	let dir = url.searchParams.get("dir");
	const showHidden = url.searchParams.get("showHidden") === "1";

	if (!dir) {
		dir = resolveWorkspaceRoot();
	}

	if (!dir) {
		return Response.json(
			{ entries: [], currentDir: "/", parentDir: null },
		);
	}

	const resolved = resolve(dir);

	const entries = buildBrowseTree(resolved, 3, 0, showHidden);
	const parentDir = resolved === "/" ? null : dirname(resolved);

	return Response.json({
		entries,
		currentDir: resolved,
		parentDir,
	});
}
