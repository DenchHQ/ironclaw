import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveWebChatDir } from "@/lib/workspace";

export const dynamic = "force-dynamic";

type IndexEntry = { id: string; [k: string]: unknown };

function readIndex(): IndexEntry[] {
  const dir = resolveWebChatDir();
  const indexFile = join(dir, "index.json");
  if (!existsSync(indexFile)) { return []; }
  try {
    return JSON.parse(readFileSync(indexFile, "utf-8"));
  } catch {
    return [];
  }
}

function writeIndex(sessions: IndexEntry[]) {
  const dir = resolveWebChatDir();
  if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); }
  writeFileSync(join(dir, "index.json"), JSON.stringify(sessions, null, 2));
}

export type ChatLine = {
  id: string;
  role: "user" | "assistant";
  /** Plain text summary (always present, used for sidebar / backward compat). */
  content: string;
  /** Full UIMessage parts array — reasoning, tool calls, outputs, text.
   *  Present for sessions saved after the rich-persistence update;
   *  absent for older sessions (fall back to `content` as a text part). */
  parts?: Array<Record<string, unknown>>;
  timestamp: string;
};

/** GET /api/web-sessions/[id] — read all messages for a web chat session */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const filePath = join(resolveWebChatDir(), `${id}.jsonl`);

  if (!existsSync(filePath)) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  const content = readFileSync(filePath, "utf-8");
  const messages: ChatLine[] = content
    .trim()
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line) as ChatLine;
      } catch {
        return null;
      }
    })
    .filter((m): m is ChatLine => m !== null);

  return Response.json({ id, messages });
}

/** PATCH /api/web-sessions/[id] — update session metadata (e.g. rename). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { title?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const sessions = readIndex();
  const session = sessions.find((s) => s.id === id);
  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  if (typeof body.title === "string") {
    session.title = body.title;
  }
  writeIndex(sessions);
  return Response.json({ ok: true, session });
}

/** DELETE /api/web-sessions/[id] — remove a web chat session and its messages. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const dir = resolveWebChatDir();
  const filePath = join(dir, `${id}.jsonl`);

  const sessions = readIndex();
  const filtered = sessions.filter((s) => s.id !== id);
  if (filtered.length === sessions.length) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  writeIndex(filtered);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
  return Response.json({ ok: true });
}
