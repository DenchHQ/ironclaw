import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
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

/**
 * Read the session index, auto-discovering any orphaned .jsonl files
 * that aren't in the index (e.g. from profile switches or missing index).
 */
function readIndex(): WebSessionMeta[] {
  const dir = ensureDir();
  const indexFile = join(dir, "index.json");
  let index: WebSessionMeta[] = [];
  if (existsSync(indexFile)) {
    try {
      index = JSON.parse(readFileSync(indexFile, "utf-8"));
    } catch {
      index = [];
    }
  }

  // Scan for orphaned .jsonl files not in the index
  try {
    const indexed = new Set(index.map((s) => s.id));
    const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    let dirty = false;
    for (const file of files) {
      const id = file.replace(/\.jsonl$/, "");
      if (indexed.has(id)) {continue;}

      // Build a minimal index entry from the file
      const fp = join(dir, file);
      const stat = statSync(fp);
      let title = "New Chat";
      let messageCount = 0;
      try {
        const content = readFileSync(fp, "utf-8");
        const lines = content.split("\n").filter((l) => l.trim());
        messageCount = lines.length;
        // Try to extract a title from the first user message
        for (const line of lines) {
          const parsed = JSON.parse(line);
          if (parsed.role === "user" && parsed.content) {
            const text = String(parsed.content);
            title = text.length > 60 ? text.slice(0, 60) + "..." : text;
            break;
          }
        }
      } catch { /* best-effort */ }

      index.push({
        id,
        title,
        createdAt: stat.birthtimeMs || stat.mtimeMs,
        updatedAt: stat.mtimeMs,
        messageCount,
      });
      dirty = true;
    }

    if (dirty) {
      index.sort((a, b) => b.updatedAt - a.updatedAt);
      writeFileSync(indexFile, JSON.stringify(index, null, 2));
    }
  } catch { /* best-effort */ }

  return index;
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
