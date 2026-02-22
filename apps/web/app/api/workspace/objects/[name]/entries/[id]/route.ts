import {
	duckdbQueryOnFile,
	duckdbExecOnFile,
	findDuckDBForObject,
	discoverDuckDBPaths,
	parseRelationValue,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// --- Types ---

type ObjectRow = {
	id: string;
	name: string;
	description?: string;
	icon?: string;
	default_view?: string;
	display_field?: string;
};

type FieldRow = {
	id: string;
	name: string;
	type: string;
	description?: string;
	required?: boolean;
	enum_values?: string;
	enum_colors?: string;
	enum_multiple?: boolean;
	related_object_id?: string;
	relationship_type?: string;
	sort_order?: number;
};

// --- Helpers ---

function sqlEscape(s: string): string {
	return s.replace(/'/g, "''");
}

function tryParseJson(value: unknown): unknown {
	if (typeof value !== "string") {
		return value;
	}
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

function resolveDisplayField(
	obj: ObjectRow,
	fields: FieldRow[],
): string {
	if (obj.display_field) {
		return obj.display_field;
	}
	const nameField = fields.find(
		(f) =>
			/\bname\b/i.test(f.name) || /\btitle\b/i.test(f.name),
	);
	if (nameField) {
		return nameField.name;
	}
	const textField = fields.find((f) => f.type === "text");
	if (textField) {
		return textField.name;
	}
	return fields[0]?.name ?? "id";
}

/** Scoped query shorthand. */
function q<T = Record<string, unknown>>(db: string, sql: string): T[] {
	return duckdbQueryOnFile<T>(db, sql);
}

// --- Route handlers ---

/**
 * GET /api/workspace/objects/[name]/entries/[id]
 * Returns a single entry with all field values, relation labels, and reverse relations.
 */
export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ name: string; id: string }> },
) {
	const { name, id } = await params;

	if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
		return Response.json(
			{ error: "Invalid object name" },
			{ status: 400 },
		);
	}
	if (!id || id.length > 64) {
		return Response.json(
			{ error: "Invalid entry ID" },
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

	// Fetch object
	const objects = q<ObjectRow>(dbFile,
		`SELECT * FROM objects WHERE name = '${sqlEscape(name)}' LIMIT 1`,
	);
	if (objects.length === 0) {
		return Response.json(
			{ error: `Object '${name}' not found` },
			{ status: 404 },
		);
	}
	const obj = objects[0];

	// Fetch fields
	const fields = q<FieldRow>(dbFile,
		`SELECT * FROM fields WHERE object_id = '${sqlEscape(obj.id)}' ORDER BY sort_order`,
	);

	// Fetch entry field values
	const entryRows = q<{
		entry_id: string;
		created_at: string;
		updated_at: string;
		field_name: string;
		value: string | null;
	}>(dbFile,
		`SELECT e.id as entry_id, e.created_at, e.updated_at,
            f.name as field_name, ef.value
     FROM entries e
     JOIN entry_fields ef ON ef.entry_id = e.id
     JOIN fields f ON f.id = ef.field_id
     WHERE e.id = '${sqlEscape(id)}'
     AND e.object_id = '${sqlEscape(obj.id)}'`,
	);

	if (entryRows.length === 0) {
		const exists = q<{ cnt: number }>(dbFile,
			`SELECT COUNT(*) as cnt FROM entries WHERE id = '${sqlEscape(id)}' AND object_id = '${sqlEscape(obj.id)}'`,
		);
		if (!exists[0] || exists[0].cnt === 0) {
			return Response.json(
				{ error: "Entry not found" },
				{ status: 404 },
			);
		}
	}

	// Pivot into a single record
	const entry: Record<string, unknown> = { entry_id: id };
	for (const row of entryRows) {
		entry.created_at ??= row.created_at;
		entry.updated_at ??= row.updated_at;
		if (row.field_name) {
			entry[row.field_name] = row.value;
		}
	}

	// Parse enum JSON strings in fields
	const parsedFields = fields.map((f) => ({
		...f,
		enum_values: f.enum_values
			? tryParseJson(f.enum_values)
			: undefined,
		enum_colors: f.enum_colors
			? tryParseJson(f.enum_colors)
			: undefined,
	}));

	// Resolve relation labels for this entry
	const relationLabels: Record<string, Record<string, string>> = {};
	const relatedObjectNames: Record<string, string> = {};

	const relationFields = fields.filter(
		(f) => f.type === "relation" && f.related_object_id,
	);

	for (const rf of relationFields) {
		const relatedObjs = q<ObjectRow>(dbFile,
			`SELECT * FROM objects WHERE id = '${sqlEscape(rf.related_object_id!)}' LIMIT 1`,
		);
		if (relatedObjs.length === 0) {
			continue;
		}
		const relObj = relatedObjs[0];
		relatedObjectNames[rf.name] = relObj.name;

		const val = entry[rf.name];
		if (val == null || val === "") {
			relationLabels[rf.name] = {};
			continue;
		}

		const valStr =
			typeof val === "object" && val !== null
				? JSON.stringify(val)
				: typeof val === "string"
					? val
					: typeof val === "number" || typeof val === "boolean"
						? String(val)
						: "";
		const ids = parseRelationValue(valStr);
		if (ids.length === 0) {
			relationLabels[rf.name] = {};
			continue;
		}

		const relFields = q<FieldRow>(dbFile,
			`SELECT * FROM fields WHERE object_id = '${sqlEscape(relObj.id)}' ORDER BY sort_order`,
		);
		const displayFieldName = resolveDisplayField(relObj, relFields);

		const idList = ids
			.map((i) => `'${sqlEscape(i)}'`)
			.join(",");
		const displayRows = q<{ entry_id: string; value: string }>(dbFile,
			`SELECT e.id as entry_id, ef.value
       FROM entries e
       JOIN entry_fields ef ON ef.entry_id = e.id
       JOIN fields f ON f.id = ef.field_id
       WHERE e.id IN (${idList})
       AND f.object_id = '${sqlEscape(relObj.id)}'
       AND f.name = '${sqlEscape(displayFieldName)}'`,
		);

		const labelMap: Record<string, string> = {};
		for (const row of displayRows) {
			labelMap[row.entry_id] = row.value || row.entry_id;
		}
		for (const i of ids) {
			if (!labelMap[i]) {
				labelMap[i] = i;
			}
		}
		relationLabels[rf.name] = labelMap;
	}

	// Enrich fields with related object names
	const enrichedFields = parsedFields.map((f) => ({
		...f,
		related_object_name:
			f.type === "relation"
				? relatedObjectNames[f.name]
				: undefined,
	}));

	// Find reverse relations for this entry (search across all DBs)
	const reverseRelations = findReverseRelationsForEntry(obj.id, id);

	const effectiveDisplayField = resolveDisplayField(obj, fields);

	return Response.json({
		object: obj,
		fields: enrichedFields,
		entry,
		relationLabels,
		reverseRelations,
		effectiveDisplayField,
	});
}

/**
 * PATCH /api/workspace/objects/[name]/entries/[id]
 * Update field values for an entry.
 * Body: { fields: { [fieldName]: newValue } }
 */
export async function PATCH(
	req: Request,
	{ params }: { params: Promise<{ name: string; id: string }> },
) {
	const { name, id } = await params;

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

	// Find object
	const objects = q<{ id: string }>(dbFile,
		`SELECT id FROM objects WHERE name = '${sqlEscape(name)}' LIMIT 1`,
	);
	if (objects.length === 0) {
		return Response.json(
			{ error: `Object '${name}' not found` },
			{ status: 404 },
		);
	}
	const objectId = objects[0].id;

	// Verify entry exists
	const exists = q<{ cnt: number }>(dbFile,
		`SELECT COUNT(*) as cnt FROM entries WHERE id = '${sqlEscape(id)}' AND object_id = '${sqlEscape(objectId)}'`,
	);
	if (!exists[0] || exists[0].cnt === 0) {
		return Response.json(
			{ error: "Entry not found" },
			{ status: 404 },
		);
	}

	const body = await req.json();
	const fieldUpdates: Record<string, string> = body.fields ?? {};

	// Get field IDs by name
	const dbFields = q<{ id: string; name: string }>(dbFile,
		`SELECT id, name FROM fields WHERE object_id = '${sqlEscape(objectId)}'`,
	);
	const fieldMap = new Map(dbFields.map((f) => [f.name, f.id]));

	let updatedCount = 0;
	for (const [fieldName, value] of Object.entries(fieldUpdates)) {
		const fieldId = fieldMap.get(fieldName);
		if (!fieldId) {continue;}

		const escapedValue =
			value == null ? "NULL" : `'${sqlEscape(String(value))}'`;

		// Try update first, then insert if no rows affected
		const existingRows = q<{ cnt: number }>(dbFile,
			`SELECT COUNT(*) as cnt FROM entry_fields WHERE entry_id = '${sqlEscape(id)}' AND field_id = '${sqlEscape(fieldId)}'`,
		);

		if (existingRows[0]?.cnt > 0) {
			duckdbExecOnFile(dbFile,
				`UPDATE entry_fields SET value = ${escapedValue} WHERE entry_id = '${sqlEscape(id)}' AND field_id = '${sqlEscape(fieldId)}'`,
			);
		} else {
			duckdbExecOnFile(dbFile,
				`INSERT INTO entry_fields (entry_id, field_id, value) VALUES ('${sqlEscape(id)}', '${sqlEscape(fieldId)}', ${escapedValue})`,
			);
		}
		updatedCount++;
	}

	// Touch updated_at on the entry
	const now = new Date().toISOString();
	duckdbExecOnFile(dbFile,
		`UPDATE entries SET updated_at = '${now}' WHERE id = '${sqlEscape(id)}'`,
	);

	return Response.json({ ok: true, updatedCount });
}

/**
 * DELETE /api/workspace/objects/[name]/entries/[id]
 * Delete a single entry and its field values.
 */
export async function DELETE(
	_req: Request,
	{ params }: { params: Promise<{ name: string; id: string }> },
) {
	const { name, id } = await params;

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

	// Find object
	const objects = q<{ id: string }>(dbFile,
		`SELECT id FROM objects WHERE name = '${sqlEscape(name)}' LIMIT 1`,
	);
	if (objects.length === 0) {
		return Response.json(
			{ error: `Object '${name}' not found` },
			{ status: 404 },
		);
	}
	const objectId = objects[0].id;

	// Delete field values first, then entry
	duckdbExecOnFile(dbFile,
		`DELETE FROM entry_fields WHERE entry_id = '${sqlEscape(id)}'`,
	);
	duckdbExecOnFile(dbFile,
		`DELETE FROM entries WHERE id = '${sqlEscape(id)}' AND object_id = '${sqlEscape(objectId)}'`,
	);

	return Response.json({ ok: true });
}

// --- Reverse relations for a single entry ---

type ReverseRelation = {
	fieldName: string;
	sourceObjectName: string;
	sourceObjectId: string;
	displayField: string;
	links: Array<{ id: string; label: string }>;
};

/**
 * Find reverse relations for a single entry, searching across ALL discovered databases.
 */
function findReverseRelationsForEntry(
	objectId: string,
	entryId: string,
): ReverseRelation[] {
	const dbPaths = discoverDuckDBPaths();
	const result: ReverseRelation[] = [];

	for (const db of dbPaths) {
		const reverseFields = q<{
			id: string;
			name: string;
			object_id: string;
			source_object_name: string;
		}>(db,
			`SELECT f.id, f.name, f.object_id, o.name as source_object_name
       FROM fields f
       JOIN objects o ON o.id = f.object_id
       WHERE f.type = 'relation'
       AND f.related_object_id = '${sqlEscape(objectId)}'`,
		);

		for (const rrf of reverseFields) {
			const refRows = q<{
				source_entry_id: string;
				target_value: string;
			}>(db,
				`SELECT ef.entry_id as source_entry_id, ef.value as target_value
         FROM entry_fields ef
         WHERE ef.field_id = '${sqlEscape(rrf.id)}'
         AND ef.value IS NOT NULL
         AND ef.value != ''`,
			);

			const matchingSourceIds: string[] = [];
			for (const row of refRows) {
				const targetIds = parseRelationValue(row.target_value);
				if (targetIds.includes(entryId)) {
					matchingSourceIds.push(row.source_entry_id);
				}
			}

			if (matchingSourceIds.length === 0) {
				continue;
			}

			const sourceObj = q<ObjectRow>(db,
				`SELECT * FROM objects WHERE id = '${sqlEscape(rrf.object_id)}' LIMIT 1`,
			);
			if (sourceObj.length === 0) {
				continue;
			}

			const sourceFields = q<FieldRow>(db,
				`SELECT * FROM fields WHERE object_id = '${sqlEscape(rrf.object_id)}' ORDER BY sort_order`,
			);
			const displayFieldName = resolveDisplayField(sourceObj[0], sourceFields);

			const idList = matchingSourceIds
				.map((i) => `'${sqlEscape(i)}'`)
				.join(",");
			const displayRows = q<{ entry_id: string; value: string }>(db,
				`SELECT ef.entry_id, ef.value
         FROM entry_fields ef
         JOIN fields f ON f.id = ef.field_id
         WHERE ef.entry_id IN (${idList})
         AND f.name = '${sqlEscape(displayFieldName)}'
         AND f.object_id = '${sqlEscape(rrf.object_id)}'`,
			);

			const displayMap: Record<string, string> = {};
			for (const row of displayRows) {
				displayMap[row.entry_id] = row.value || row.entry_id;
			}

			const links = matchingSourceIds.map((sid) => ({
				id: sid,
				label: displayMap[sid] || sid,
			}));

			result.push({
				fieldName: rrf.name,
				sourceObjectName: rrf.source_object_name,
				sourceObjectId: rrf.object_id,
				displayField: displayFieldName,
				links,
			});
		}
	}

	return result;
}
