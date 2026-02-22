/**
 * Pure utility functions for report filter SQL injection.
 * Extracted from the execute API route for testability.
 */

export type FilterValue =
  | { type: "dateRange"; from?: string; to?: string }
  | { type: "select"; value?: string }
  | { type: "multiSelect"; values?: string[] }
  | { type: "number"; min?: number; max?: number };

export type FilterEntry = {
  id: string;
  column: string;
  value: FilterValue;
};

/** Escape single quotes in SQL string values. */
export function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Build WHERE clause fragments from active filters.
 * Returns an array of SQL condition strings (safe -- values are escaped).
 */
export function buildFilterClauses(filters?: FilterEntry[]): string[] {
  if (!filters || filters.length === 0) {return [];}

  const clauses: string[] = [];

  for (const f of filters) {
    const col = `"${f.column.replace(/"/g, '""')}"`;
    const v = f.value;

    if (v.type === "dateRange") {
      if (v.from) {
        clauses.push(`${col} >= '${escapeSqlString(v.from)}'`);
      }
      if (v.to) {
        clauses.push(`${col} <= '${escapeSqlString(v.to)}'`);
      }
    } else if (v.type === "select" && v.value) {
      clauses.push(`${col} = '${escapeSqlString(v.value)}'`);
    } else if (v.type === "multiSelect" && v.values && v.values.length > 0) {
      const vals = v.values.map((x) => `'${escapeSqlString(x)}'`).join(", ");
      clauses.push(`${col} IN (${vals})`);
    } else if (v.type === "number") {
      if (v.min !== undefined) {
        clauses.push(`CAST(${col} AS NUMERIC) >= ${Number(v.min)}`);
      }
      if (v.max !== undefined) {
        clauses.push(`CAST(${col} AS NUMERIC) <= ${Number(v.max)}`);
      }
    }
  }

  return clauses;
}

/**
 * Inject filter WHERE clauses into a SQL query.
 * Strategy: wrap the original query as a CTE and filter on top.
 */
export function injectFilters(sql: string, filterClauses: string[]): string {
  if (filterClauses.length === 0) {return sql;}

  const whereClause = filterClauses.join(" AND ");
  // Wrap original SQL as CTE to avoid parsing complexities
  return `WITH __report_data AS (${sql.replace(/;$/, "")}) SELECT * FROM __report_data WHERE ${whereClause}`;
}

/**
 * Check if SQL is read-only (no mutation statements).
 * Returns an error message if unsafe, or null if safe.
 */
export function checkSqlSafety(sql: string): string | null {
  const upper = sql.toUpperCase().trim();
  const forbidden = ["DROP", "DELETE", "INSERT", "UPDATE", "ALTER", "CREATE", "TRUNCATE"];
  for (const keyword of forbidden) {
    if (upper.startsWith(keyword)) {
      return "Only SELECT queries are allowed in reports";
    }
  }
  return null;
}
