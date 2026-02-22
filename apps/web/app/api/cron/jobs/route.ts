import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolveOpenClawStateDir } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const CRON_DIR = join(resolveOpenClawStateDir(), "cron");
const JOBS_FILE = join(CRON_DIR, "jobs.json");

type CronStoreFile = {
  version: 1;
  jobs: Array<Record<string, unknown>>;
};

/** Read cron jobs.json, returning empty array if missing or invalid. */
function readJobsFile(): Array<Record<string, unknown>> {
  if (!existsSync(JOBS_FILE)) {return [];}
  try {
    const raw = readFileSync(JOBS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as CronStoreFile;
    if (parsed && Array.isArray(parsed.jobs)) {return parsed.jobs;}
    return [];
  } catch {
    return [];
  }
}

/** Compute next wake time from job states (minimum nextRunAtMs among enabled jobs). */
function computeNextWakeAtMs(jobs: Array<Record<string, unknown>>): number | null {
  let min: number | null = null;
  for (const job of jobs) {
    if (job.enabled !== true) {continue;}
    const state = job.state as Record<string, unknown> | undefined;
    if (!state) {continue;}
    const next = state.nextRunAtMs;
    if (typeof next === "number" && Number.isFinite(next)) {
      if (min === null || next < min) {min = next;}
    }
  }
  return min;
}

/** Read heartbeat config from ~/.openclaw/config.yaml (best-effort). */
function readHeartbeatInfo(): { intervalMs: number; nextDueEstimateMs: number | null } {
  const defaults = { intervalMs: 30 * 60_000, nextDueEstimateMs: null as number | null };

  // Try to read agent session stores to estimate next heartbeat from lastRunMs
  try {
    const agentsDir = join(resolveOpenClawStateDir(), "agents");
    if (!existsSync(agentsDir)) {return defaults;}

    const agentDirs = readdirSync(agentsDir, { withFileTypes: true });
    let latestHeartbeat: number | null = null;

    for (const d of agentDirs) {
      if (!d.isDirectory()) {continue;}
      const storePath = join(agentsDir, d.name, "sessions", "sessions.json");
      if (!existsSync(storePath)) {continue;}
      try {
        const raw = readFileSync(storePath, "utf-8");
        const store = JSON.parse(raw) as Record<string, { updatedAt?: number }>;
        // Look for the main agent session (shortest key, most recently updated)
        for (const [key, entry] of Object.entries(store)) {
          if (key.startsWith("agent:") && !key.includes(":cron:") && entry.updatedAt) {
            if (latestHeartbeat === null || entry.updatedAt > latestHeartbeat) {
              latestHeartbeat = entry.updatedAt;
            }
          }
        }
      } catch {
        // skip
      }
    }

    if (latestHeartbeat) {
      defaults.nextDueEstimateMs = latestHeartbeat + defaults.intervalMs;
    }
  } catch {
    // ignore
  }

  return defaults;
}

/** GET /api/cron/jobs -- list all cron jobs with heartbeat & status info */
export async function GET() {
  const jobs = readJobsFile();
  const heartbeat = readHeartbeatInfo();
  const nextWakeAtMs = computeNextWakeAtMs(jobs);

  return Response.json({
    jobs,
    heartbeat,
    cronStatus: {
      enabled: jobs.length > 0,
      nextWakeAtMs,
    },
  });
}
