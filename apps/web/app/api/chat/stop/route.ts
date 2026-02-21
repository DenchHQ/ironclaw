/**
 * POST /api/chat/stop
 *
 * Abort an active agent run. Called by the Stop button.
 * The child process is sent SIGTERM and the run transitions to "error" state.
 */
import { abortRun } from "@/lib/active-runs";
import {
	abortSubagent,
	hasActiveSubagent,
	isSubagentRunning,
	ensureRegisteredFromDisk,
} from "@/lib/subagent-runs";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveOpenClawStateDir } from "@/lib/workspace";

export const runtime = "nodejs";

function deriveSubagentParentSessionId(sessionKey: string): string {
	const registryPath = join(resolveOpenClawStateDir(), "subagents", "runs.json");
	if (!existsSync(registryPath)) {return "";}
	try {
		const raw = JSON.parse(readFileSync(registryPath, "utf-8")) as {
			runs?: Record<string, Record<string, unknown>>;
		};
		for (const entry of Object.values(raw.runs ?? {})) {
			if (entry.childSessionKey !== sessionKey) {continue;}
			const requester = typeof entry.requesterSessionKey === "string" ? entry.requesterSessionKey : "";
			const match = requester.match(/^agent:[^:]+:web:(.+)$/);
			return match?.[1] ?? "";
		}
	} catch {
		// ignore
	}
	return "";
}

export async function POST(req: Request) {
	const body: { sessionId?: string; sessionKey?: string } = await req
		.json()
		.catch(() => ({}));

	const isSubagentSession = typeof body.sessionKey === "string" && body.sessionKey.includes(":subagent:");
	if (isSubagentSession && body.sessionKey) {
		if (!hasActiveSubagent(body.sessionKey)) {
			const parentWebSessionId = deriveSubagentParentSessionId(body.sessionKey);
			ensureRegisteredFromDisk(body.sessionKey, parentWebSessionId);
		}
		const aborted = isSubagentRunning(body.sessionKey) ? abortSubagent(body.sessionKey) : false;
		return Response.json({ aborted });
	}

	if (!body.sessionId) {
		return new Response("sessionId or subagent sessionKey required", { status: 400 });
	}

	const aborted = abortRun(body.sessionId);
	return Response.json({ aborted });
}
