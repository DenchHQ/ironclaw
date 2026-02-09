import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const dynamic = "force-dynamic";

const WEB_CHAT_DIR = join(homedir(), ".openclaw", "web-chat");

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
  const filePath = join(WEB_CHAT_DIR, `${id}.jsonl`);

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
