import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveOpenClawStateDir } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const AGENTS_DIR = join(resolveOpenClawStateDir(), "agents");

type MessagePart =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool-call"; toolName: string; toolCallId: string; args?: unknown; output?: string };

type ParsedMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  parts: MessagePart[];
  timestamp: string;
};

/**
 * Search for the actual agent transcript for a cron run.
 *
 * For main-target cron runs, the agent response lives in the main session
 * transcript files. This endpoint searches session files for the cron payload
 * text near the run timestamp and returns the matching conversation
 * (user message + assistant response).
 */

/** Try to find a cron-specific session from sessions.json. */
function findCronSessionId(jobId: string): string | null {
  if (!existsSync(AGENTS_DIR)) {return null;}
  try {
    const agentDirs = readdirSync(AGENTS_DIR, { withFileTypes: true });
    for (const agentDir of agentDirs) {
      if (!agentDir.isDirectory()) {continue;}
      const sessionsJsonPath = join(AGENTS_DIR, agentDir.name, "sessions", "sessions.json");
      if (!existsSync(sessionsJsonPath)) {continue;}
      try {
        const store = JSON.parse(readFileSync(sessionsJsonPath, "utf-8"));
        // Look for cron session key matching this job
        for (const [key, entry] of Object.entries(store)) {
          if (key.includes(`:cron:${jobId}`) && !key.includes(":run:")) {
            const sessionId = (entry as { sessionId?: string })?.sessionId;
            if (typeof sessionId === "string" && sessionId.trim()) {
              // Verify the session file actually exists
              const sessionFile = join(AGENTS_DIR, agentDir.name, "sessions", `${sessionId}.jsonl`);
              if (existsSync(sessionFile)) {
                return sessionId;
              }
            }
          }
        }
      } catch {
        // skip malformed sessions.json
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/** Find session files that might contain the cron run's transcript. */
function findCandidateSessionFiles(runAtMs: number): string[] {
  const candidates: Array<{ path: string; mtimeMs: number }> = [];
  if (!existsSync(AGENTS_DIR)) {return [];}

  try {
    const agentDirs = readdirSync(AGENTS_DIR, { withFileTypes: true });
    for (const agentDir of agentDirs) {
      if (!agentDir.isDirectory()) {continue;}
      const sessionsDir = join(AGENTS_DIR, agentDir.name, "sessions");
      if (!existsSync(sessionsDir)) {continue;}
      try {
        const files = readdirSync(sessionsDir);
        for (const file of files) {
          if (!file.endsWith(".jsonl")) {continue;}
          const filePath = join(sessionsDir, file);
          try {
            const stat = statSync(filePath);
            // Only consider files modified within ±2 hours of the run
            const windowMs = 2 * 60 * 60 * 1000;
            if (Math.abs(stat.mtimeMs - runAtMs) < windowMs) {
              candidates.push({ path: filePath, mtimeMs: stat.mtimeMs });
            }
          } catch {
            // skip
          }
        }
      } catch {
        // skip
      }
    }
  } catch {
    // ignore
  }

  // Sort by closest modification time to runAtMs
  candidates.sort((a, b) => Math.abs(a.mtimeMs - runAtMs) - Math.abs(b.mtimeMs - runAtMs));

  // Limit to 10 most likely candidates
  return candidates.slice(0, 10).map((c) => c.path);
}

/** Parse message entries from a JSONL transcript, optionally filtered by time range. */
function parseMessagesInRange(
  content: string,
  opts?: { afterMs?: number; beforeMs?: number },
): ParsedMessage[] {
  const lines = content.trim().split("\n").filter((l) => l.trim());
  const messages: ParsedMessage[] = [];
  const pendingToolCalls = new Map<string, { toolName: string; args?: unknown }>();

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type !== "message" || !entry.message) {continue;}

      // Filter by timestamp if provided
      if (opts?.afterMs || opts?.beforeMs) {
        const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : (entry.ts ?? 0);
        if (opts.afterMs && ts < opts.afterMs) {continue;}
        if (opts.beforeMs && ts > opts.beforeMs) {continue;}
      }

      const msg = entry.message;
      const role = msg.role as "user" | "assistant" | "system";
      const parts: MessagePart[] = [];

      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
            parts.push({ type: "text", text: part.text });
          } else if (part.type === "thinking" && typeof part.thinking === "string" && part.thinking.trim()) {
            parts.push({ type: "thinking", thinking: part.thinking });
          } else if (part.type === "tool_use" || part.type === "tool-call") {
            const toolName = part.name ?? part.toolName ?? "unknown";
            const toolCallId = part.id ?? part.toolCallId ?? `tool-${Date.now()}`;
            pendingToolCalls.set(toolCallId, { toolName, args: part.input ?? part.args });
            parts.push({ type: "tool-call", toolName, toolCallId, args: part.input ?? part.args });
          } else if (part.type === "tool_result" || part.type === "tool-result") {
            const toolCallId = part.tool_use_id ?? part.toolCallId ?? "";
            const pending = pendingToolCalls.get(toolCallId);
            const outputText = typeof part.content === "string"
              ? part.content
              : Array.isArray(part.content)
                ? part.content.filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("\n")
                : typeof part.output === "string"
                  ? part.output
                  : JSON.stringify(part.output ?? part.content ?? "");

            if (pending) {
              const existingMsg = messages[messages.length - 1];
              if (existingMsg) {
                const tc = existingMsg.parts.find(
                  (p) => p.type === "tool-call" && (p as { toolCallId: string }).toolCallId === toolCallId,
                );
                if (tc && tc.type === "tool-call") {
                  (tc as { output?: string }).output = outputText.slice(0, 5000);
                  continue;
                }
              }
              parts.push({ type: "tool-call", toolName: pending.toolName, toolCallId, args: pending.args, output: outputText.slice(0, 5000) });
            } else {
              parts.push({ type: "tool-call", toolName: "tool", toolCallId, output: outputText.slice(0, 5000) });
            }
          }
        }
      } else if (typeof msg.content === "string" && msg.content.trim()) {
        parts.push({ type: "text", text: msg.content });
      }

      if (parts.length > 0) {
        messages.push({
          id: entry.id ?? `msg-${messages.length}`,
          role,
          parts,
          timestamp: entry.timestamp ?? new Date(entry.ts ?? Date.now()).toISOString(),
        });
      }
    } catch {
      // skip malformed lines
    }
  }

  return messages;
}

/** Extract text content from message parts. */
function getMessageText(msg: ParsedMessage): string {
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

/**
 * Search session files for the cron run's conversation.
 * Matches by finding a user message containing the summary text near runAtMs,
 * then returns that message + all following messages until the next user message.
 */
function searchForRunTranscript(
  sessionFiles: string[],
  summary: string,
  runAtMs: number,
): { messages: ParsedMessage[]; sessionFile: string } | null {
  // Use a distinctive portion of the summary for matching (first 80 chars)
  const searchText = summary.slice(0, 80);
  // Search window: from 5s before run to 10 minutes after (heartbeat delay)
  const afterMs = runAtMs - 5_000;
  const beforeMs = runAtMs + 10 * 60_000;

  for (const filePath of sessionFiles) {
    try {
      const content = readFileSync(filePath, "utf-8");
      if (!content.includes(searchText.slice(0, 40))) {
        // Quick pre-check: skip files that don't contain the text at all
        continue;
      }

      const allMessages = parseMessagesInRange(content);

      // Find user messages containing the summary text within the time window
      for (let i = 0; i < allMessages.length; i++) {
        const msg = allMessages[i];
        if (msg.role !== "user") {continue;}

        const msgTs = new Date(msg.timestamp).getTime();
        if (msgTs < afterMs || msgTs > beforeMs) {continue;}

        const text = getMessageText(msg);
        if (!text.includes(searchText.slice(0, 40))) {continue;}

        // Found the user message! Collect it + all following messages
        // until the next user message (the full agent turn).
        const conversation: ParsedMessage[] = [msg];
        for (let j = i + 1; j < allMessages.length; j++) {
          const next = allMessages[j];
          if (next.role === "user") {break;}
          conversation.push(next);
        }

        return { messages: conversation, sessionFile: filePath };
      }
    } catch {
      // skip unreadable files
    }
  }

  return null;
}

/**
 * GET /api/cron/runs/search-transcript?jobId=X&runAtMs=Y&summary=Z
 *
 * Search for the actual agent transcript for a cron run that doesn't have
 * a direct sessionId. Tries:
 * 1. Sessions.json lookup for a cron-specific session
 * 2. Time-based search of session files near the run timestamp
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  const runAtMsStr = url.searchParams.get("runAtMs");
  const summary = url.searchParams.get("summary");

  if (!jobId || !runAtMsStr) {
    return Response.json({ error: "jobId and runAtMs are required" }, { status: 400 });
  }

  const runAtMs = Number(runAtMsStr);
  if (!Number.isFinite(runAtMs)) {
    return Response.json({ error: "Invalid runAtMs" }, { status: 400 });
  }

  // Strategy 1: Look for a cron-specific session in sessions.json
  const cronSessionId = findCronSessionId(jobId);
  if (cronSessionId) {
    try {
      const agentDirs = readdirSync(AGENTS_DIR, { withFileTypes: true });
      for (const agentDir of agentDirs) {
        if (!agentDir.isDirectory()) {continue;}
        const sessionFile = join(AGENTS_DIR, agentDir.name, "sessions", `${cronSessionId}.jsonl`);
        if (!existsSync(sessionFile)) {continue;}

        const content = readFileSync(sessionFile, "utf-8");
        const messages = parseMessagesInRange(content);
        if (messages.length > 0) {
          return Response.json({
            sessionId: cronSessionId,
            messages,
            source: "cron-session",
          });
        }
      }
    } catch {
      // fall through to search
    }
  }

  // Strategy 2: Search session files near the run timestamp
  if (summary) {
    const candidates = findCandidateSessionFiles(runAtMs);
    const result = searchForRunTranscript(candidates, summary, runAtMs);
    if (result) {
      return Response.json({
        messages: result.messages,
        source: "main-session-search",
      });
    }
  }

  return Response.json({ error: "Transcript not found" }, { status: 404 });
}
