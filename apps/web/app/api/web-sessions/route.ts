import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { type WebSessionMeta, ensureDir, readIndex, writeIndex } from "./shared";

export { type WebSessionMeta };

export const dynamic = "force-dynamic";

/** GET /api/web-sessions — list web chat sessions.
 *  ?filePath=... → returns only sessions scoped to that file.
 *  No filePath   → returns only global (non-file) sessions. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const filePath = url.searchParams.get("filePath");

  const all = readIndex();
  const sessions = filePath
    ? all.filter((s) => s.filePath === filePath)
    : all.filter((s) => !s.filePath);

  return Response.json({ sessions });
}

/** POST /api/web-sessions — create a new web chat session */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id = randomUUID();
  const session: WebSessionMeta = {
    id,
    title: body.title || "New Chat",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messageCount: 0,
    ...(body.filePath ? { filePath: body.filePath } : {}),
  };

  const sessions = readIndex();
  sessions.unshift(session);
  writeIndex(sessions);

  const dir = ensureDir();
  writeFileSync(`${dir}/${id}.jsonl`, "");

  return Response.json({ session });
}
