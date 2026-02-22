import { duckdbQueryOnFile, duckdbExecOnFile, findDuckDBForObject } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PATCH /api/workspace/objects/[name]/display-field
 * Set which field is used as the display label for entries of this object.
 * Body: { displayField: string }
 */
export async function PATCH(
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
      { error: "DuckDB database not found" },
      { status: 404 },
    );
  }

  const body = await req.json();
  const { displayField } = body;

  if (typeof displayField !== "string" || !displayField.trim()) {
    return Response.json(
      { error: "displayField must be a non-empty string" },
      { status: 400 },
    );
  }

  // Ensure display_field column exists
  duckdbExecOnFile(dbFile,
    "ALTER TABLE objects ADD COLUMN IF NOT EXISTS display_field VARCHAR",
  );

  // Verify the object exists
  const objects = duckdbQueryOnFile<{ id: string }>(dbFile,
    `SELECT id FROM objects WHERE name = '${name}' LIMIT 1`,
  );
  if (objects.length === 0) {
    return Response.json(
      { error: `Object '${name}' not found` },
      { status: 404 },
    );
  }

  // Verify the field exists on this object
  const escapedField = displayField.replace(/'/g, "''");
  const fieldCheck = duckdbQueryOnFile<{ id: string }>(dbFile,
    `SELECT id FROM fields WHERE object_id = '${objects[0].id}' AND name = '${escapedField}' LIMIT 1`,
  );
  if (fieldCheck.length === 0) {
    return Response.json(
      { error: `Field '${displayField}' not found on object '${name}'` },
      { status: 400 },
    );
  }

  // Update the display_field
  const success = duckdbExecOnFile(dbFile,
    `UPDATE objects SET display_field = '${escapedField}', updated_at = now() WHERE name = '${name}'`,
  );

  if (!success) {
    return Response.json(
      { error: "Failed to update display field" },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, displayField });
}
