"use client";

import { useEffect, useState, useCallback } from "react";
import type {
  CronJob,
  HeartbeatInfo,
  CronStatusInfo,
  CronJobsResponse,
} from "../../types/cron";

/* ─── Helpers ─── */

function formatSchedule(schedule: CronJob["schedule"]): string {
  switch (schedule.kind) {
    case "cron":
      return `cron: ${schedule.expr}${schedule.tz ? ` (${schedule.tz})` : ""}`;
    case "every": {
      const ms = schedule.everyMs;
      if (ms >= 86_400_000) {return `every ${Math.round(ms / 86_400_000)}d`;}
      if (ms >= 3_600_000) {return `every ${Math.round(ms / 3_600_000)}h`;}
      if (ms >= 60_000) {return `every ${Math.round(ms / 60_000)}m`;}
      return `every ${Math.round(ms / 1000)}s`;
    }
    case "at":
      return `at ${schedule.at}`;
    default:
      return "unknown";
  }
}

function formatCountdown(ms: number): string {
  if (ms <= 0) {return "now";}
  const totalSec = Math.ceil(ms / 1000);
  if (totalSec < 60) {return `${totalSec}s`;}
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) {return sec > 0 ? `${min}m ${sec}s` : `${min}m`;}
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
}

function formatTimeAgo(ms: number): string {
  const ago = Date.now() - ms;
  if (ago < 60_000) {return "just now";}
  if (ago < 3_600_000) {return `${Math.floor(ago / 60_000)}m ago`;}
  if (ago < 86_400_000) {return `${Math.floor(ago / 3_600_000)}h ago`;}
  return `${Math.floor(ago / 86_400_000)}d ago`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) {return `${ms}ms`;}
  if (ms < 60_000) {return `${(ms / 1000).toFixed(1)}s`;}
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function jobStatusLabel(job: CronJob): string {
  if (!job.enabled) {return "disabled";}
  if (job.state.runningAtMs) {return "running";}
  return job.state.lastStatus ?? "idle";
}

function jobStatusColor(status: string): string {
  switch (status) {
    case "ok": return "var(--color-success, #22c55e)";
    case "running": return "var(--color-accent)";
    case "error": return "var(--color-error, #ef4444)";
    case "disabled": return "var(--color-text-muted)";
    case "skipped": return "var(--color-warning, #f59e0b)";
    default: return "var(--color-text-muted)";
  }
}

/* ─── Countdown hook ─── */

function useCountdown(targetMs: number | null | undefined): string | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!targetMs) {return;}
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetMs]);
  if (!targetMs) {return null;}
  return formatCountdown(targetMs - now);
}

/* ─── Main component ─── */

export function CronDashboard({
  onSelectJob,
}: {
  onSelectJob: (jobId: string) => void;
}) {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [heartbeat, setHeartbeat] = useState<HeartbeatInfo>({ intervalMs: 30 * 60_000, nextDueEstimateMs: null });
  const [cronStatus, setCronStatus] = useState<CronStatusInfo>({ enabled: false, nextWakeAtMs: null });
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/cron/jobs");
      const data: CronJobsResponse = await res.json();
      setJobs(data.jobs ?? []);
      setHeartbeat(data.heartbeat ?? { intervalMs: 30 * 60_000, nextDueEstimateMs: null });
      setCronStatus(data.cronStatus ?? { enabled: false, nextWakeAtMs: null });
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const id = setInterval(() => void fetchData(), 30_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const heartbeatCountdown = useCountdown(heartbeat.nextDueEstimateMs);
  const cronWakeCountdown = useCountdown(cronStatus.nextWakeAtMs);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div
          className="w-6 h-6 border-2 rounded-full animate-spin"
          style={{ borderColor: "var(--color-border)", borderTopColor: "var(--color-accent)" }}
        />
      </div>
    );
  }

  const enabledJobs = jobs.filter((j) => j.enabled);
  const disabledJobs = jobs.filter((j) => !j.enabled);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <h1
        className="font-instrument text-3xl tracking-tight mb-1"
        style={{ color: "var(--color-text)" }}
      >
        Cron
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--color-text-muted)" }}>
        Scheduled jobs and heartbeat status
      </p>

      {/* Status cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {/* Heartbeat card */}
        <StatusCard
          title="Heartbeat"
          icon={<HeartbeatIcon />}
          value={heartbeatCountdown ? `in ${heartbeatCountdown}` : "unknown"}
          subtitle={`Interval: ${formatCountdown(heartbeat.intervalMs)}`}
          description="The heartbeat wakes the agent periodically. Cron jobs with wakeMode=next-heartbeat piggyback on this loop."
        />

        {/* Cron scheduler card */}
        <StatusCard
          title="Cron Scheduler"
          icon={<ClockIcon />}
          value={cronWakeCountdown ? `next in ${cronWakeCountdown}` : jobs.length === 0 ? "no jobs" : "idle"}
          subtitle={`${enabledJobs.length} active / ${jobs.length} total jobs`}
          description="The cron timer fires every ~60s, checking for due jobs. Isolated jobs run independently; main-session jobs wake the heartbeat."
        />

        {/* Running card */}
        <StatusCard
          title="Active Runs"
          icon={<RunningIcon />}
          value={`${jobs.filter((j) => j.state.runningAtMs).length}`}
          subtitle={`${jobs.filter((j) => j.state.lastStatus === "error").length} errors`}
          description="Jobs currently executing. Errors show consecutive failures."
        />
      </div>

      {/* Timeline - upcoming runs in next 24h */}
      <TimelineSection jobs={enabledJobs} />

      {/* Jobs table */}
      <div className="mb-6">
        <h2
          className="text-sm font-medium uppercase tracking-wider mb-3"
          style={{ color: "var(--color-text-muted)" }}
        >
          Jobs
        </h2>

        {jobs.length === 0 ? (
          <div
            className="p-8 text-center rounded-2xl"
            style={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
            }}
          >
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              No cron jobs configured. Use <code className="px-1.5 py-0.5 rounded text-xs" style={{ background: "var(--color-surface-hover)" }}>ironclaw cron add</code> to create one.
            </p>
          </div>
        ) : (
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
            }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--color-border)",
                    color: "var(--color-text-muted)",
                  }}
                >
                  <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider">Schedule</th>
                  <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider">Next Run</th>
                  <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider">Last Run</th>
                  <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider">Target</th>
                </tr>
              </thead>
              <tbody>
                {[...enabledJobs, ...disabledJobs].map((job) => (
                  <JobRow key={job.id} job={job} onClick={() => onSelectJob(job.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Status card ─── */

function StatusCard({
  title,
  icon,
  value,
  subtitle,
  description,
}: {
  title: string;
  icon: React.ReactNode;
  value: string;
  subtitle: string;
  description: string;
}) {
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span style={{ color: "var(--color-accent)" }}>{icon}</span>
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
          {title}
        </span>
      </div>
      <div className="text-lg font-semibold mb-0.5" style={{ color: "var(--color-text)" }}>
        {value}
      </div>
      <div className="text-xs mb-2" style={{ color: "var(--color-text-muted)" }}>
        {subtitle}
      </div>
      <div className="text-[11px] leading-relaxed" style={{ color: "var(--color-text-muted)", opacity: 0.7 }}>
        {description}
      </div>
    </div>
  );
}

/* ─── Timeline ─── */

function TimelineSection({ jobs }: { jobs: CronJob[] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  const horizon = 24 * 60 * 60 * 1000; // 24h
  const upcoming = jobs
    .filter((j) => j.state.nextRunAtMs && j.state.nextRunAtMs > now && j.state.nextRunAtMs < now + horizon)
    .toSorted((a, b) => (a.state.nextRunAtMs ?? 0) - (b.state.nextRunAtMs ?? 0));

  if (upcoming.length === 0) {return null;}

  return (
    <div className="mb-8">
      <h2
        className="text-sm font-medium uppercase tracking-wider mb-3"
        style={{ color: "var(--color-text-muted)" }}
      >
        Upcoming (next 24h)
      </h2>
      <div
        className="rounded-2xl p-4"
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div className="relative">
          {/* Timeline bar */}
          <div
            className="absolute top-0 left-3 bottom-0 w-px"
            style={{ background: "var(--color-border)" }}
          />
          <div className="space-y-3">
            {upcoming.map((job) => {
              const timeUntil = (job.state.nextRunAtMs ?? 0) - now;
              return (
                <div key={job.id} className="flex items-center gap-3 pl-1">
                  <div
                    className="relative z-10 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: "var(--color-accent)", opacity: 0.8 }}
                  >
                    <div className="w-2 h-2 rounded-full" style={{ background: "var(--color-bg)" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                      {job.name}
                    </span>
                    <span className="text-xs ml-2" style={{ color: "var(--color-text-muted)" }}>
                      in {formatCountdown(timeUntil)}
                    </span>
                  </div>
                  <span className="text-[11px] flex-shrink-0" style={{ color: "var(--color-text-muted)" }}>
                    {new Date(job.state.nextRunAtMs!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Job row ─── */

function JobRow({ job, onClick }: { job: CronJob; onClick: () => void }) {
  const status = jobStatusLabel(job);
  const statusColor = jobStatusColor(status);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const nextRunStr = job.state.nextRunAtMs
    ? job.state.nextRunAtMs > now
      ? `in ${formatCountdown(job.state.nextRunAtMs - now)}`
      : "overdue"
    : "-";

  const lastRunStr = job.state.lastRunAtMs
    ? `${formatTimeAgo(job.state.lastRunAtMs)}${job.state.lastDurationMs ? ` (${formatDuration(job.state.lastDurationMs)})` : ""}`
    : "-";

  return (
    <tr
      className="cursor-pointer transition-colors"
      style={{ borderBottom: "1px solid var(--color-border)" }}
      onClick={onClick}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      <td className="px-4 py-3">
        <div className="font-medium" style={{ color: "var(--color-text)" }}>{job.name}</div>
        {job.description && (
          <div className="text-xs truncate max-w-[200px]" style={{ color: "var(--color-text-muted)" }}>
            {job.description}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
        {formatSchedule(job.schedule)}
      </td>
      <td className="px-4 py-3">
        <span
          className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full"
          style={{
            background: `color-mix(in srgb, ${statusColor} 12%, transparent)`,
            color: statusColor,
          }}
        >
          {status === "running" && (
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: statusColor }} />
          )}
          {status}
        </span>
      </td>
      <td className="px-4 py-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
        {nextRunStr}
      </td>
      <td className="px-4 py-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
        {lastRunStr}
      </td>
      <td className="px-4 py-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
        {job.sessionTarget}
      </td>
    </tr>
  );
}

/* ─── Icons ─── */

function HeartbeatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function RunningIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}
