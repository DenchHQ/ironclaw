import { duckdbQuery } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { sql?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { sql } = body;
  if (!sql || typeof sql !== "string") {
    return Response.json(
      { error: "Missing 'sql' field in request body" },
      { status: 400 },
    );
  }

  // Basic SQL safety: reject obviously dangerous statements
  const upper = sql.toUpperCase().trim();
  if (
    upper.startsWith("DROP") ||
    upper.startsWith("DELETE") ||
    upper.startsWith("INSERT") ||
    upper.startsWith("UPDATE") ||
    upper.startsWith("ALTER") ||
    upper.startsWith("CREATE")
  ) {
    return Response.json(
      { error: "Only SELECT queries are allowed" },
      { status: 403 },
    );
  }

  const rows = duckdbQuery(sql);
  return Response.json({ rows });
}
