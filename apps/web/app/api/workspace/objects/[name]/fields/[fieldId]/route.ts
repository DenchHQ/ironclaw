import { duckdbExecOnFile, duckdbQueryOnFile, findDuckDBForObject } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sqlEscape(s: string): string {
	return s.replace(/'/g, "''");
}

/**
 * PATCH /api/workspace/objects/[name]/fields/[fieldId]
 * Rename a field.
 * Body: { name: string }
 */
export async function PATCH(
	req: Request,
	{
		params,
	}: { params: Promise<{ name: string; fieldId: string }> },
) {
	const { name, fieldId } = await params;

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
	const newName: string = body.name;

	if (
		!newName ||
		typeof newName !== "string" ||
		newName.trim().length === 0
	) {
		return Response.json(
			{ error: "Name is required" },
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

	// Validate field exists and belongs to this object
	const fieldExists = duckdbQueryOnFile<{ cnt: number }>(dbFile,
		`SELECT COUNT(*) as cnt FROM fields WHERE id = '${sqlEscape(fieldId)}' AND object_id = '${sqlEscape(objectId)}'`,
	);
	if (!fieldExists[0] || fieldExists[0].cnt === 0) {
		return Response.json(
			{ error: "Field not found" },
			{ status: 404 },
		);
	}

	// Check for duplicate name
	const duplicateCheck = duckdbQueryOnFile<{ cnt: number }>(dbFile,
		`SELECT COUNT(*) as cnt FROM fields WHERE object_id = '${sqlEscape(objectId)}' AND name = '${sqlEscape(newName.trim())}' AND id != '${sqlEscape(fieldId)}'`,
	);
	if (duplicateCheck[0]?.cnt > 0) {
		return Response.json(
			{ error: "A field with that name already exists" },
			{ status: 409 },
		);
	}

	const ok = duckdbExecOnFile(dbFile,
		`UPDATE fields SET name = '${sqlEscape(newName.trim())}' WHERE id = '${sqlEscape(fieldId)}'`,
	);

	if (!ok) {
		return Response.json(
			{ error: "Failed to rename field" },
			{ status: 500 },
		);
	}

	return Response.json({ ok: true });
}
