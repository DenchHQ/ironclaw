// Client-side types mirroring src/cron/types.ts and src/cron/run-log.ts
// Stripped of server-only imports for use in the web UI.

export type CronSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: "cron"; expr: string; tz?: string };

export type CronSessionTarget = "main" | "isolated";
export type CronWakeMode = "next-heartbeat" | "now";

export type CronDeliveryMode = "none" | "announce";

export type CronDelivery = {
  mode: CronDeliveryMode;
  channel?: string;
  to?: string;
  bestEffort?: boolean;
};

export type CronPayload =
  | { kind: "systemEvent"; text: string }
  | {
      kind: "agentTurn";
      message: string;
      model?: string;
      thinking?: string;
      timeoutSeconds?: number;
      deliver?: boolean;
      channel?: string;
      to?: string;
    };

export type CronJobState = {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: "ok" | "error" | "skipped";
  lastError?: string;
  lastDurationMs?: number;
  consecutiveErrors?: number;
  scheduleErrorCount?: number;
};

export type CronJob = {
  id: string;
  agentId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: CronSchedule;
  sessionTarget: CronSessionTarget;
  wakeMode: CronWakeMode;
  payload: CronPayload;
  delivery?: CronDelivery;
  state: CronJobState;
};

export type CronStoreFile = {
  version: 1;
  jobs: CronJob[];
};

export type CronRunLogEntry = {
  ts: number;
  jobId: string;
  action: "finished";
  status?: "ok" | "error" | "skipped";
  error?: string;
  summary?: string;
  sessionId?: string;
  sessionKey?: string;
  runAtMs?: number;
  durationMs?: number;
  nextRunAtMs?: number;
};

export type HeartbeatInfo = {
  intervalMs: number;
  nextDueEstimateMs: number | null;
};

export type CronStatusInfo = {
  enabled: boolean;
  nextWakeAtMs: number | null;
};

export type CronJobsResponse = {
  jobs: CronJob[];
  heartbeat: HeartbeatInfo;
  cronStatus: CronStatusInfo;
};

export type CronRunsResponse = {
  entries: CronRunLogEntry[];
};

export type SessionMessagePart =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool-call"; toolName: string; toolCallId: string; args?: unknown; output?: string };

export type SessionMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  parts: SessionMessagePart[];
  timestamp: string;
};

export type CronRunSessionResponse = {
  sessionId: string;
  messages: SessionMessage[];
};
