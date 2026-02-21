import { duckdbPath, parseRelationValue, resolveDuckdbBin, findDuckDBForObject, duckdbQueryOnFile, discoverDuckDBPaths, getObjectViews } from "@/lib/workspace";
import { deserializeFilters, buildWhereClause, buildOrderByClause, type FieldMeta } from "@/lib/object-filters";
import { execSync } from "node:child_process";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ObjectRow = {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  default_view?: string;
  display_field?: string;
  immutable?: boolean;
  created_at?: string;
  updated_at?: string;
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

type StatusRow = {
  id: string;
  name: string;
  color?: string;
  sort_order?: number;
  is_default?: boolean;
};

type EavRow = {
  entry_id: string;
  created_at: string;
  updated_at: string;
  field_name: string;
  value: string | null;
};

// --- Schema migration (idempotent, runs once per process) ---

const migratedDbs = new Set<string>();

/** Ensure the display_field column exists on a specific DB file. */
function ensureDisplayFieldColumn(dbFile: string) {
  if (migratedDbs.has(dbFile)) {return;}
  const bin = resolveDuckdbBin();
  if (!bin) {return;}
  try {
    execSync(
      `'${bin}' '${dbFile}' 'ALTER TABLE objects ADD COLUMN IF NOT EXISTS display_field VARCHAR'`,
      { encoding: "utf-8", timeout: 5_000, shell: "/bin/sh" },
    );
  } catch {
    // migration might fail on DBs that don't have the objects table — skip
  }
  migratedDbs.add(dbFile);
}

// --- Helpers ---

/** Scoped query helper: queries a specific DB file. */
function q<T = Record<string, unknown>>(dbFile: string, sql: string): T[] {
  return duckdbQueryOnFile<T>(dbFile, sql);
}

/**
 * Pivot raw EAV rows into one object per entry with field names as keys.
 */
function pivotEavRows(rows: EavRow[]): Record<string, unknown>[] {
  const grouped = new Map<string, Record<string, unknown>>();

  for (const row of rows) {
    let entry = grouped.get(row.entry_id);
    if (!entry) {
      entry = {
        entry_id: row.entry_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
      grouped.set(row.entry_id, entry);
    }
    if (row.field_name) {
      entry[row.field_name] = row.value;
    }
  }

  return Array.from(grouped.values());
}

function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") {return value;}
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** SQL-escape a string (double single-quotes). */
function sqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Determine the display field for an object.
 * Priority: explicit display_field > heuristic (name/title) > first text field > first field.
 */
function resolveDisplayField(
  obj: ObjectRow,
  objFields: FieldRow[],
): string {
  if (obj.display_field) {return obj.display_field;}

  // Heuristic: look for name/title fields
  const nameField = objFields.find(
    (f) =>
      /\bname\b/i.test(f.name) || /\btitle\b/i.test(f.name),
  );
  if (nameField) {return nameField.name;}

  // Fallback: first text field
  const textField = objFields.find((f) => f.type === "text");
  if (textField) {return textField.name;}

  // Ultimate fallback: first field
  return objFields[0]?.name ?? "id";
}

/**
 * Resolve relation field values to human-readable display labels.
 * All queries target the same DB file where the object lives.
 */
function resolveRelationLabels(
  dbFile: string,
  fields: FieldRow[],
  entries: Record<string, unknown>[],
): {
  labels: Record<string, Record<string, string>>;
  relatedObjectNames: Record<string, string>;
} {
  const labels: Record<string, Record<string, string>> = {};
  const relatedObjectNames: Record<string, string> = {};

  const relationFields = fields.filter(
    (f) => f.type === "relation" && f.related_object_id,
  );

  for (const rf of relationFields) {
    const relatedObjs = q<ObjectRow>(dbFile,
      `SELECT * FROM objects WHERE id = '${sqlEscape(rf.related_object_id!)}' LIMIT 1`,
    );
    if (relatedObjs.length === 0) {continue;}
    const relObj = relatedObjs[0];
    relatedObjectNames[rf.name] = relObj.name;

    const relFields = q<FieldRow>(dbFile,
      `SELECT * FROM fields WHERE object_id = '${sqlEscape(relObj.id)}' ORDER BY sort_order`,
    );
    const displayFieldName = resolveDisplayField(relObj, relFields);

    const entryIds = new Set<string>();
    for (const entry of entries) {
      const val = entry[rf.name];
      if (val == null || val === "") {
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
      for (const id of parseRelationValue(valStr)) {
        entryIds.add(id);
      }
    }

    if (entryIds.size === 0) {
      labels[rf.name] = {};
      continue;
    }

    const idList = Array.from(entryIds)
      .map((id) => `'${sqlEscape(id)}'`)
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
    for (const id of entryIds) {
      if (!labelMap[id]) {labelMap[id] = id;}
    }

    labels[rf.name] = labelMap;
  }

  return { labels, relatedObjectNames };
}

type ReverseRelation = {
  fieldName: string;
  sourceObjectName: string;
  sourceObjectId: string;
  displayField: string;
  entries: Record<string, Array<{ id: string; label: string }>>;
};

/**
 * Find reverse relations: other objects with relation fields pointing TO this object.
 * Searches across ALL discovered databases to catch cross-DB relations.
 */
function findReverseRelations(objectId: string): ReverseRelation[] {
  const dbPaths = discoverDuckDBPaths();
  const result: ReverseRelation[] = [];

  for (const db of dbPaths) {
    const reverseFields = q<
      FieldRow & { source_object_id: string; source_object_name: string }
    >(db,
      `SELECT f.*, f.object_id as source_object_id, o.name as source_object_name
       FROM fields f
       JOIN objects o ON o.id = f.object_id
       WHERE f.type = 'relation'
       AND f.related_object_id = '${sqlEscape(objectId)}'`,
    );

    for (const rrf of reverseFields) {
      const sourceObjs = q<ObjectRow>(db,
        `SELECT * FROM objects WHERE id = '${sqlEscape(rrf.source_object_id)}' LIMIT 1`,
      );
      if (sourceObjs.length === 0) {continue;}

      const sourceFields = q<FieldRow>(db,
        `SELECT * FROM fields WHERE object_id = '${sqlEscape(rrf.source_object_id)}' ORDER BY sort_order`,
      );
      const displayFieldName = resolveDisplayField(sourceObjs[0], sourceFields);

      const refRows = q<{ source_entry_id: string; target_value: string }>(db,
        `SELECT ef.entry_id as source_entry_id, ef.value as target_value
         FROM entry_fields ef
         WHERE ef.field_id = '${sqlEscape(rrf.id)}'
         AND ef.value IS NOT NULL
         AND ef.value != ''`,
      );

      if (refRows.length === 0) {continue;}

      const sourceEntryIds = [...new Set(refRows.map((r) => r.source_entry_id))];
      const idList = sourceEntryIds.map((id) => `'${sqlEscape(id)}'`).join(",");
      const displayRows = q<{ entry_id: string; value: string }>(db,
        `SELECT ef.entry_id, ef.value
         FROM entry_fields ef
         JOIN fields f ON f.id = ef.field_id
         WHERE ef.entry_id IN (${idList})
         AND f.name = '${sqlEscape(displayFieldName)}'
         AND f.object_id = '${sqlEscape(rrf.source_object_id)}'`,
      );

      const displayMap: Record<string, string> = {};
      for (const row of displayRows) {
        displayMap[row.entry_id] = row.value || row.entry_id;
      }

      const entriesMap: Record<string, Array<{ id: string; label: string }>> = {};
      for (const row of refRows) {
        const targetIds = parseRelationValue(row.target_value);
        for (const targetId of targetIds) {
          if (!entriesMap[targetId]) {entriesMap[targetId] = [];}
          entriesMap[targetId].push({
            id: row.source_entry_id,
            label: displayMap[row.source_entry_id] || row.source_entry_id,
          });
        }
      }

      result.push({
        fieldName: rrf.name,
        sourceObjectName: rrf.source_object_name,
        sourceObjectId: rrf.source_object_id,
        displayField: displayFieldName,
        entries: entriesMap,
      });
    }
  }

  return result;
}

// --- Route handler ---

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;

  if (!resolveDuckdbBin()) {
    return Response.json(
      { error: "DuckDB CLI is not installed", code: "DUCKDB_NOT_INSTALLED" },
      { status: 503 },
    );
  }

  // Sanitize name to prevent injection (only allow alphanumeric + underscore + hyphen)
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name)) {
    return Response.json(
      { error: "Invalid object name" },
      { status: 400 },
    );
  }

  // Find which DuckDB file contains this object (searches all discovered DBs)
  const dbFile = findDuckDBForObject(name);
  if (!dbFile) {
    // Fall back to primary DB check for a friendlier error message
    if (!duckdbPath()) {
      return Response.json(
        { error: "DuckDB database not found" },
        { status: 404 },
      );
    }
    return Response.json(
      { error: `Object '${name}' not found` },
      { status: 404 },
    );
  }

  // Ensure display_field column exists on this specific DB
  ensureDisplayFieldColumn(dbFile);

  // All queries below target the specific DB that owns this object
  const objects = q<ObjectRow>(dbFile,
    `SELECT * FROM objects WHERE name = '${name}' LIMIT 1`,
  );

  if (objects.length === 0) {
    return Response.json(
      { error: `Object '${name}' not found` },
      { status: 404 },
    );
  }

  const obj = objects[0];

  const fields = q<FieldRow>(dbFile,
    `SELECT * FROM fields WHERE object_id = '${obj.id}' ORDER BY sort_order`,
  );

  const statuses = q<StatusRow>(dbFile,
    `SELECT * FROM statuses WHERE object_id = '${obj.id}' ORDER BY sort_order`,
  );

  // --- Parse filter/sort/pagination query params ---
  const url = new URL(_req.url);
  const filtersParam = url.searchParams.get("filters");
  const sortParam = url.searchParams.get("sort");
  const searchParam = url.searchParams.get("search");
  const pageParam = url.searchParams.get("page");
  const pageSizeParam = url.searchParams.get("pageSize");

  const filterGroup = filtersParam ? deserializeFilters(filtersParam) : undefined;
  const fieldsMeta: FieldMeta[] = fields.map((f) => ({ name: f.name, type: f.type }));

  // Build WHERE clause from filters
  let whereClause = "";
  if (filterGroup) {
    const where = buildWhereClause(filterGroup, fieldsMeta);
    if (where) {whereClause = ` WHERE ${where}`;}
  }

  // Build ORDER BY clause
  let orderByClause = " ORDER BY created_at DESC";
  if (sortParam) {
    try {
      const sortRules = JSON.parse(sortParam);
      const orderBy = buildOrderByClause(sortRules);
      if (orderBy) {orderByClause = ` ORDER BY ${orderBy}`;}
    } catch {
      // keep default sort
    }
  }

  // Pagination
  const page = Math.max(1, Number(pageParam) || 1);
  const pageSize = Math.min(5000, Math.max(1, Number(pageSizeParam) || 100));
  const offset = (page - 1) * pageSize;
  const limitClause = ` LIMIT ${pageSize} OFFSET ${offset}`;

  // Full-text search across text fields
  if (searchParam && searchParam.trim()) {
    const textFields = fields.filter((f) => ["text", "richtext", "email"].includes(f.type));
    if (textFields.length > 0) {
      const searchConditions = textFields
        .map((f) => `LOWER(CAST("${f.name.replace(/"/g, '""')}" AS VARCHAR)) LIKE '%${sqlEscape(searchParam.toLowerCase())}%'`)
        .join(" OR ");
      whereClause = whereClause
        ? `${whereClause} AND (${searchConditions})`
        : ` WHERE (${searchConditions})`;
    }
  }

  // Try the PIVOT view first, then fall back to raw EAV query + client-side pivot
  let entries: Record<string, unknown>[] = [];
  let totalCount = 0;

  try {
    // Get total count with same WHERE clause but no LIMIT/OFFSET
    const countResult = q<{ cnt: number }>(dbFile,
      `SELECT COUNT(*) as cnt FROM v_${name}${whereClause}`,
    );
    totalCount = countResult[0]?.cnt ?? 0;

    const pivotEntries = q(dbFile,
      `SELECT * FROM v_${name}${whereClause}${orderByClause}${limitClause}`,
    );
    entries = pivotEntries;
  } catch {
    // Pivot view might not exist or filter SQL may not apply; fall back
    const rawRows = q<EavRow>(dbFile,
      `SELECT e.id as entry_id, e.created_at, e.updated_at,
              f.name as field_name, ef.value
       FROM entries e
       JOIN entry_fields ef ON ef.entry_id = e.id
       JOIN fields f ON f.id = ef.field_id
       WHERE e.object_id = '${obj.id}'
       ORDER BY e.created_at DESC
       LIMIT 5000`,
    );
    entries = pivotEavRows(rawRows);
  }

  const parsedFields = fields.map((f) => ({
    ...f,
    enum_values: f.enum_values ? tryParseJson(f.enum_values) : undefined,
    enum_colors: f.enum_colors ? tryParseJson(f.enum_colors) : undefined,
  }));

  const { labels: relationLabels, relatedObjectNames } =
    resolveRelationLabels(dbFile, fields, entries);

  const enrichedFields = parsedFields.map((f) => ({
    ...f,
    related_object_name:
      f.type === "relation" ? relatedObjectNames[f.name] : undefined,
  }));

  const reverseRelations = findReverseRelations(obj.id);

  const effectiveDisplayField = resolveDisplayField(obj, fields);

  // Include saved views from .object.yaml
  const { views: savedViews, activeView } = getObjectViews(name);

  return Response.json({
    object: obj,
    fields: enrichedFields,
    statuses,
    entries,
    relationLabels,
    reverseRelations,
    effectiveDisplayField,
    savedViews,
    activeView,
    totalCount,
    page,
    pageSize,
  });
}
