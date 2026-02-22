import { duckdbQuery } from "@/lib/workspace";
import { buildFilterClauses, injectFilters, checkSqlSafety } from "@/lib/report-filters";
import type { FilterEntry } from "@/lib/report-filters";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/workspace/reports/execute
 *
 * Body: { sql: string, filters?: FilterEntry[] }
 *
 * Executes a report panel's SQL query with optional filter injection.
 * Only SELECT-compatible queries are allowed.
 */
export async function POST(req: Request) {
  let body: {
    sql?: string;
    filters?: FilterEntry[];
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sql, filters } = body;
  if (!sql || typeof sql !== "string") {
    return Response.json(
      { error: "Missing 'sql' field in request body" },
      { status: 400 },
    );
  }

  // Basic SQL safety: reject mutation statements
  const safetyError = checkSqlSafety(sql);
  if (safetyError) {
    return Response.json({ error: safetyError }, { status: 403 });
  }

  // Build filter clauses and inject into SQL
  const filterClauses = buildFilterClauses(filters);
  const finalSql = injectFilters(sql, filterClauses);

  try {
    const rows = duckdbQuery(finalSql);
    return Response.json({ rows, sql: finalSql });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Query execution failed" },
      { status: 500 },
    );
  }
}
