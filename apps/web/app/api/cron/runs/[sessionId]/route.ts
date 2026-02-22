import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveOpenClawStateDir } from "@/lib/workspace";

export const dynamic = "force-dynamic";

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

/** Search agent session directories for a session file by ID. */
function findSessionFile(sessionId: string): string | null {
  const agentsDir = join(resolveOpenClawStateDir(), "agents");
  if (!existsSync(agentsDir)) {return null;}

  try {
    const agentDirs = readdirSync(agentsDir, { withFileTypes: true });
    for (const agentDir of agentDirs) {
      if (!agentDir.isDirectory()) {continue;}
      const sessionFile = join(agentsDir, agentDir.name, "sessions", `${sessionId}.jsonl`);
      if (existsSync(sessionFile)) {return sessionFile;}
    }
  } catch {
    // ignore
  }
  return null;
}

/** Parse a JSONL session transcript into structured messages with thinking and tool calls. */
function parseSessionTranscript(content: string): ParsedMessage[] {
  const lines = content.trim().split("\n").filter((l) => l.trim());
  const messages: ParsedMessage[] = [];

  // Track tool calls for linking invocations with results
  const pendingToolCalls = new Map<string, { toolName: string; args?: unknown }>();

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);

      if (entry.type === "message" && entry.message) {
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
              parts.push({
                type: "tool-call",
                toolName,
                toolCallId,
                args: part.input ?? part.args,
              });
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
                // Merge output into existing tool-call part
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
                parts.push({
                  type: "tool-call",
                  toolName: pending.toolName,
                  toolCallId,
                  args: pending.args,
                  output: outputText.slice(0, 5000),
                });
              } else {
                parts.push({
                  type: "tool-call",
                  toolName: "tool",
                  toolCallId,
                  output: outputText.slice(0, 5000),
                });
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
      }
    } catch {
      // skip malformed lines
    }
  }

  return messages;
}

/** GET /api/cron/runs/[sessionId] -- get full session transcript for a cron run */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  if (!sessionId) {
    return Response.json({ error: "Session ID required" }, { status: 400 });
  }

  const sessionFile = findSessionFile(sessionId);
  if (!sessionFile) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    const content = readFileSync(sessionFile, "utf-8");
    const messages = parseSessionTranscript(content);
    return Response.json({ sessionId, messages });
  } catch (error) {
    console.error("Error reading cron session:", error);
    return Response.json({ error: "Failed to read session" }, { status: 500 });
  }
}
