import { duckdbExecOnFile, duckdbQueryOnFile, findDuckDBForObject } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sqlEscape(s: string): string {
	return s.replace(/'/g, "''");
}

/**
 * POST /api/workspace/objects/[name]/entries/bulk-delete
 * Delete multiple entries at once.
 * Body: { entryIds: string[] }
 */
export async function POST(
	req: Request,
	{ params }: { params: Promise<{ name: string }> },
) {
	const { name } = await params;

	if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
		return Response.json(
			{ error: "Invalid object name" },
			{ status: 400 },
		);
	}

	const dbFile = findDuckDBForObject(name);
	if (!dbFile) {
		return Response.json(
			{ error: "DuckDB not found" },
			{ status: 404 },
		);
	}

	const body = await req.json();
	const entryIds: string[] = body.entryIds;

	if (!Array.isArray(entryIds) || entryIds.length === 0) {
		return Response.json(
			{ error: "entryIds must be a non-empty array" },
			{ status: 400 },
		);
	}

	// Validate object exists
	const objects = duckdbQueryOnFile<{ id: string }>(dbFile,
		`SELECT id FROM objects WHERE name = '${sqlEscape(name)}' LIMIT 1`,
	);
	if (objects.length === 0) {
		return Response.json(
			{ error: `Object '${name}' not found` },
			{ status: 404 },
		);
	}
	const objectId = objects[0].id;

	const idList = entryIds
		.map((id) => `'${sqlEscape(id)}'`)
		.join(",");

	// Delete field values first, then entries
	duckdbExecOnFile(dbFile,
		`DELETE FROM entry_fields WHERE entry_id IN (${idList})`,
	);
	duckdbExecOnFile(dbFile,
		`DELETE FROM entries WHERE id IN (${idList}) AND object_id = '${sqlEscape(objectId)}'`,
	);

	return Response.json({
		ok: true,
		deletedCount: entryIds.length,
	});
}
