import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { resolveWebChatDir } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export type WebSessionMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  /** When set, this session is scoped to a specific workspace file. */
  filePath?: string;
};

function ensureDir() {
  const dir = resolveWebChatDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function readIndex(): WebSessionMeta[] {
  const dir = ensureDir();
  const indexFile = join(dir, "index.json");
  if (!existsSync(indexFile)) {return [];}
  try {
    return JSON.parse(readFileSync(indexFile, "utf-8"));
  } catch {
    return [];
  }
}

function writeIndex(sessions: WebSessionMeta[]) {
  const dir = ensureDir();
  writeFileSync(join(dir, "index.json"), JSON.stringify(sessions, null, 2));
}

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

  // Create empty .jsonl file
  const dir = ensureDir();
  writeFileSync(join(dir, `${id}.jsonl`), "");

  return Response.json({ session });
}
