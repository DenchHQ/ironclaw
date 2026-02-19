import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveOpenClawStateDir } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const CRON_DIR = join(resolveOpenClawStateDir(), "cron");

type CronRunLogEntry = {
  ts: number;
  jobId: string;
  action: "finished";
  status?: string;
  error?: string;
  summary?: string;
  sessionId?: string;
  sessionKey?: string;
  runAtMs?: number;
  durationMs?: number;
  nextRunAtMs?: number;
};

/** Read run log entries from a JSONL file, returning most recent first (then reversed). */
function readRunLog(filePath: string, limit: number): CronRunLogEntry[] {
  if (!existsSync(filePath)) {return [];}
  try {
    const raw = readFileSync(filePath, "utf-8");
    if (!raw.trim()) {return [];}
    const lines = raw.split("\n");
    const parsed: CronRunLogEntry[] = [];
    for (let i = lines.length - 1; i >= 0 && parsed.length < limit; i--) {
      const line = lines[i]?.trim();
      if (!line) {continue;}
      try {
        const obj = JSON.parse(line) as Partial<CronRunLogEntry>;
        if (!obj || typeof obj !== "object") {continue;}
        if (obj.action !== "finished") {continue;}
        if (typeof obj.jobId !== "string" || !obj.jobId.trim()) {continue;}
        if (typeof obj.ts !== "number" || !Number.isFinite(obj.ts)) {continue;}
        const entry: CronRunLogEntry = {
          ts: obj.ts,
          jobId: obj.jobId,
          action: "finished",
          status: obj.status,
          error: obj.error,
          summary: obj.summary,
          runAtMs: obj.runAtMs,
          durationMs: obj.durationMs,
          nextRunAtMs: obj.nextRunAtMs,
        };
        if (typeof obj.sessionId === "string" && obj.sessionId.trim()) {
          entry.sessionId = obj.sessionId;
        }
        if (typeof obj.sessionKey === "string" && obj.sessionKey.trim()) {
          entry.sessionKey = obj.sessionKey;
        }
        parsed.push(entry);
      } catch {
        // skip malformed lines
      }
    }
    return parsed.toReversed();
  } catch {
    return [];
  }
}

/** GET /api/cron/jobs/[jobId]/runs -- list run log entries for a cron job */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  if (!jobId) {
    return Response.json({ error: "Job ID required" }, { status: 400 });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.max(1, Math.min(500, Number(limitParam) || 100));

  const logPath = join(CRON_DIR, "runs", `${jobId}.jsonl`);
  const entries = readRunLog(logPath, limit);

  return Response.json({ entries });
}
