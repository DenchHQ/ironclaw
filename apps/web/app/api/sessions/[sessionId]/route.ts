import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveOpenClawStateDir } from "@/lib/workspace";

export const dynamic = "force-dynamic";

type JSONLMessage = {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  message?: {
    role: "user" | "assistant";
    content: Array<
      | { type: "text"; text: string }
      | { type: "image"; data: string }
      | { type: "thinking"; thinking: string; thinkingSignature?: string }
    >;
    timestamp?: number;
  };
  customType?: string;
  data?: unknown;
};

function findSessionFile(sessionId: string): string | null {
  const openclawDir = resolveOpenClawStateDir();
  const agentsDir = join(openclawDir, "agents");

  if (!existsSync(agentsDir)) {
    return null;
  }

  try {
    const agentDirs = readdirSync(agentsDir, { withFileTypes: true });
    for (const agentDir of agentDirs) {
      if (!agentDir.isDirectory()) {
        continue;
      }

      const sessionFile = join(
        agentsDir,
        agentDir.name,
        "sessions",
        `${sessionId}.jsonl`
      );

      if (existsSync(sessionFile)) {
        return sessionFile;
      }
    }
  } catch {
    // ignore errors
  }

  return null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
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
    const lines = content
      .trim()
      .split("\n")
      .filter((line) => line.trim());

    const messages: Array<{
      id: string;
      role: "user" | "assistant";
      content: string;
      timestamp: string;
    }> = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as JSONLMessage;

        if (entry.type === "message" && entry.message) {
          // Extract text content from the message
          const textContent = entry.message.content
            .filter((part) => part.type === "text" || part.type === "thinking")
            .map((part) => {
              if (part.type === "text") {
                return part.text;
              }
              if (part.type === "thinking") {
                return `[Thinking: ${part.thinking.slice(0, 100)}...]`;
              }
              return "";
            })
            .join("\n");

          if (textContent) {
            messages.push({
              id: entry.id,
              role: entry.message.role,
              content: textContent,
              timestamp: entry.timestamp,
            });
          }
        }
      } catch {
        // skip malformed lines
      }
    }

    return Response.json({ sessionId, messages });
  } catch (error) {
    console.error("Error reading session:", error);
    return Response.json(
      { error: "Failed to read session" },
      { status: 500 }
    );
  }
}
