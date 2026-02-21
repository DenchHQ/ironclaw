import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { resolveWebChatDir } from "@/lib/workspace";
import { readIndex, writeIndex } from "../shared";

export const dynamic = "force-dynamic";

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

/** DELETE /api/web-sessions/[id] — delete a web chat session */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const sessions = readIndex();
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx === -1) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  sessions.splice(idx, 1);
  writeIndex(sessions);

  const filePath = join(resolveWebChatDir(), `${id}.jsonl`);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }

  return Response.json({ ok: true });
}

/** PATCH /api/web-sessions/[id] — update session metadata (e.g. rename) */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const sessions = readIndex();
  const session = sessions.find((s) => s.id === id);
  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  if (typeof body.title === "string") {
    session.title = body.title;
  }
  session.updatedAt = Date.now();
  writeIndex(sessions);

  return Response.json({ session });
}
