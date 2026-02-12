import { duckdbQuery, duckdbPath, parseRelationValue } from "@/lib/workspace";

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
  if (typeof value !== "string") {return value;}
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function resolveDisplayField(obj: ObjectRow, fields: FieldRow[]): string {
  if (obj.display_field) {return obj.display_field;}
  const nameField = fields.find(
    (f) => /\bname\b/i.test(f.name) || /\btitle\b/i.test(f.name),
  );
  if (nameField) {return nameField.name;}
  const textField = fields.find((f) => f.type === "text");
  if (textField) {return textField.name;}
  return fields[0]?.name ?? "id";
}

// --- Route handler ---

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string; id: string }> },
) {
  const { name, id } = await params;

  if (!duckdbPath()) {
    return Response.json({ error: "DuckDB not found" }, { status: 404 });
  }

  // Validate inputs
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return Response.json({ error: "Invalid object name" }, { status: 400 });
  }
  if (!id || id.length > 64) {
    return Response.json({ error: "Invalid entry ID" }, { status: 400 });
  }

  // Fetch object
  const objects = duckdbQuery<ObjectRow>(
    `SELECT * FROM objects WHERE name = '${sqlEscape(name)}' LIMIT 1`,
  );
  if (objects.length === 0) {
    return Response.json({ error: `Object '${name}' not found` }, { status: 404 });
  }
  const obj = objects[0];

  // Fetch fields
  const fields = duckdbQuery<FieldRow>(
    `SELECT * FROM fields WHERE object_id = '${sqlEscape(obj.id)}' ORDER BY sort_order`,
  );

  // Fetch entry field values
  const entryRows = duckdbQuery<{
    entry_id: string;
    created_at: string;
    updated_at: string;
    field_name: string;
    value: string | null;
  }>(
    `SELECT e.id as entry_id, e.created_at, e.updated_at,
            f.name as field_name, ef.value
     FROM entries e
     JOIN entry_fields ef ON ef.entry_id = e.id
     JOIN fields f ON f.id = ef.field_id
     WHERE e.id = '${sqlEscape(id)}'
     AND e.object_id = '${sqlEscape(obj.id)}'`,
  );

  if (entryRows.length === 0) {
    // Check if entry exists at all
    const exists = duckdbQuery<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM entries WHERE id = '${sqlEscape(id)}' AND object_id = '${sqlEscape(obj.id)}'`,
    );
    if (!exists[0] || exists[0].cnt === 0) {
      return Response.json({ error: "Entry not found" }, { status: 404 });
    }
  }

  // Pivot into a single record
  const entry: Record<string, unknown> = { entry_id: id };
  for (const row of entryRows) {
    entry.created_at ??= row.created_at;
    entry.updated_at ??= row.updated_at;
    if (row.field_name) {entry[row.field_name] = row.value;}
  }

  // Parse enum JSON strings in fields
  const parsedFields = fields.map((f) => ({
    ...f,
    enum_values: f.enum_values ? tryParseJson(f.enum_values) : undefined,
    enum_colors: f.enum_colors ? tryParseJson(f.enum_colors) : undefined,
  }));

  // Resolve relation labels for this entry
  const relationLabels: Record<string, Record<string, string>> = {};
  const relatedObjectNames: Record<string, string> = {};

  const relationFields = fields.filter(
    (f) => f.type === "relation" && f.related_object_id,
  );

  for (const rf of relationFields) {
    const relatedObjs = duckdbQuery<ObjectRow>(
      `SELECT * FROM objects WHERE id = '${sqlEscape(rf.related_object_id!)}' LIMIT 1`,
    );
    if (relatedObjs.length === 0) {continue;}
    const relObj = relatedObjs[0];
    relatedObjectNames[rf.name] = relObj.name;

    const val = entry[rf.name];
    if (val == null || val === "") {
      relationLabels[rf.name] = {};
      continue;
    }

    const ids = parseRelationValue(String(val));
    if (ids.length === 0) {
      relationLabels[rf.name] = {};
      continue;
    }

    const relFields = duckdbQuery<FieldRow>(
      `SELECT * FROM fields WHERE object_id = '${sqlEscape(relObj.id)}' ORDER BY sort_order`,
    );
    const displayFieldName = resolveDisplayField(relObj, relFields);

    const idList = ids.map((i) => `'${sqlEscape(i)}'`).join(",");
    const displayRows = duckdbQuery<{ entry_id: string; value: string }>(
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
      if (!labelMap[i]) {labelMap[i] = i;}
    }
    relationLabels[rf.name] = labelMap;
  }

  // Enrich fields with related object names
  const enrichedFields = parsedFields.map((f) => ({
    ...f,
    related_object_name:
      f.type === "relation" ? relatedObjectNames[f.name] : undefined,
  }));

  // Find reverse relations: other objects linking TO this entry
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

// --- Reverse relations for a single entry ---

type ReverseRelation = {
  fieldName: string;
  sourceObjectName: string;
  sourceObjectId: string;
  displayField: string;
  links: Array<{ id: string; label: string }>;
};

/**
 * Find entries in other objects that link TO this specific entry via relation fields.
 */
function findReverseRelationsForEntry(
  objectId: string,
  entryId: string,
): ReverseRelation[] {
  // Find all relation fields in other objects that point to this object
  const reverseFields = duckdbQuery<
    { id: string; name: string; object_id: string; source_object_name: string }
  >(
    `SELECT f.id, f.name, f.object_id, o.name as source_object_name
     FROM fields f
     JOIN objects o ON o.id = f.object_id
     WHERE f.type = 'relation'
     AND f.related_object_id = '${sqlEscape(objectId)}'`,
  );

  if (reverseFields.length === 0) {return [];}

  const result: ReverseRelation[] = [];

  for (const rrf of reverseFields) {
    // Find source entries that reference this specific entry ID
    const refRows = duckdbQuery<{ source_entry_id: string; target_value: string }>(
      `SELECT ef.entry_id as source_entry_id, ef.value as target_value
       FROM entry_fields ef
       WHERE ef.field_id = '${sqlEscape(rrf.id)}'
       AND ef.value IS NOT NULL
       AND ef.value != ''`,
    );

    // Filter to only rows that actually reference our entryId
    const matchingSourceIds: string[] = [];
    for (const row of refRows) {
      const targetIds = parseRelationValue(row.target_value);
      if (targetIds.includes(entryId)) {
        matchingSourceIds.push(row.source_entry_id);
      }
    }

    if (matchingSourceIds.length === 0) {continue;}

    // Get source object's fields to resolve display labels
    const sourceObj = duckdbQuery<ObjectRow>(
      `SELECT * FROM objects WHERE id = '${sqlEscape(rrf.object_id)}' LIMIT 1`,
    );
    if (sourceObj.length === 0) {continue;}

    const sourceFields = duckdbQuery<FieldRow>(
      `SELECT * FROM fields WHERE object_id = '${sqlEscape(rrf.object_id)}' ORDER BY sort_order`,
    );
    const displayFieldName = resolveDisplayField(sourceObj[0], sourceFields);

    // Get display labels for matching source entries
    const idList = matchingSourceIds.map((i) => `'${sqlEscape(i)}'`).join(",");
    const displayRows = duckdbQuery<{ entry_id: string; value: string }>(
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

  return result;
}
