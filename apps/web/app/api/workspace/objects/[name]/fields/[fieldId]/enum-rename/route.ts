import { duckdbExecOnFile, duckdbQueryOnFile, findDuckDBForObject } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sqlEscape(s: string): string {
	return s.replace(/'/g, "''");
}

/**
 * PATCH /api/workspace/objects/[name]/fields/[fieldId]/enum-rename
 * Rename an enum value across the field definition and all entries.
 * Body: { oldValue: string, newValue: string }
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
	const oldValue: string = body.oldValue;
	const newValue: string = body.newValue;

	if (!oldValue || !newValue || typeof oldValue !== "string" || typeof newValue !== "string") {
		return Response.json(
			{ error: "oldValue and newValue are required" },
			{ status: 400 },
		);
	}
	if (oldValue.trim() === newValue.trim()) {
		return Response.json({ ok: true, changed: 0 });
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

	// Validate field exists and is an enum
	const fields = duckdbQueryOnFile<{ id: string; enum_values: string | null; enum_colors: string | null }>(dbFile,
		`SELECT id, enum_values, enum_colors FROM fields WHERE id = '${sqlEscape(fieldId)}' AND object_id = '${sqlEscape(objectId)}'`,
	);
	if (fields.length === 0) {
		return Response.json(
			{ error: "Field not found" },
			{ status: 404 },
		);
	}

	const field = fields[0];
	let enumValues: string[];
	try {
		enumValues = field.enum_values ? JSON.parse(field.enum_values) : [];
	} catch {
		return Response.json(
			{ error: "Invalid enum_values in field" },
			{ status: 500 },
		);
	}

	const idx = enumValues.indexOf(oldValue.trim());
	if (idx === -1) {
		return Response.json(
			{ error: `Enum value '${oldValue}' not found` },
			{ status: 404 },
		);
	}

	// Check for duplicate
	if (enumValues.includes(newValue.trim())) {
		return Response.json(
			{ error: `Enum value '${newValue}' already exists` },
			{ status: 409 },
		);
	}

	// Update enum_values array
	enumValues[idx] = newValue.trim();
	const newEnumJson = JSON.stringify(enumValues);

	duckdbExecOnFile(dbFile,
		`UPDATE fields SET enum_values = '${sqlEscape(newEnumJson)}' WHERE id = '${sqlEscape(fieldId)}'`,
	);

	// Update all entry_fields with the old value to the new value
	const updatedEntries = duckdbExecOnFile(dbFile,
		`UPDATE entry_fields SET value = '${sqlEscape(newValue.trim())}' WHERE field_id = '${sqlEscape(fieldId)}' AND value = '${sqlEscape(oldValue.trim())}'`,
	);

	return Response.json({ ok: true, updated: updatedEntries });
}
