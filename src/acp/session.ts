import { randomUUID } from "node:crypto";

import type { AcpSession } from "./types.js";

const sessions = new Map<string, AcpSession>();
const runIdToSessionId = new Map<string, string>();

export function createSession(params: {
  sessionKey: string;
  cwd: string;
  sessionId?: string;
}): AcpSession {
  const sessionId = params.sessionId ?? randomUUID();
  const session: AcpSession = {
    sessionId,
    sessionKey: params.sessionKey,
    cwd: params.cwd,
    createdAt: Date.now(),
    abortController: null,
    activeRunId: null,
  };
  sessions.set(sessionId, session);
  return session;
}

export function getSession(sessionId: string): AcpSession | undefined {
  return sessions.get(sessionId);
}

export function getSessionByRunId(runId: string): AcpSession | undefined {
  const sessionId = runIdToSessionId.get(runId);
  return sessionId ? sessions.get(sessionId) : undefined;
}

export function setActiveRun(
  sessionId: string,
  runId: string,
  abortController: AbortController,
): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.activeRunId = runId;
  session.abortController = abortController;
  runIdToSessionId.set(runId, sessionId);
}

export function clearActiveRun(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  if (session.activeRunId) runIdToSessionId.delete(session.activeRunId);
  session.activeRunId = null;
  session.abortController = null;
}

export function cancelActiveRun(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session?.abortController) return false;
  session.abortController.abort();
  if (session.activeRunId) runIdToSessionId.delete(session.activeRunId);
  session.abortController = null;
  session.activeRunId = null;
  return true;
}

export function clearAllSessionsForTest(): void {
  for (const session of sessions.values()) {
    session.abortController?.abort();
  }
  sessions.clear();
  runIdToSessionId.clear();
}
