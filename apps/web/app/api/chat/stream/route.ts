/**
 * GET /api/chat/stream?sessionId=xxx  (parent sessions)
 * GET /api/chat/stream?sessionKey=xxx (subagent sessions)
 *
 * Reconnect to an active (or recently-completed) agent run.
 * Replays all buffered SSE events from the start of the run, then
 * streams live events until the run finishes.
 *
 * Both parent and subagent sessions use the same ActiveRun system.
 */
import {
	getActiveRun,
	startSubscribeRun,
	subscribeToRun,
	type SseEvent,
} from "@/lib/active-runs";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveOpenClawStateDir } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 600;

function deriveSubagentInfo(sessionKey: string): { parentSessionId: string; task: string } | null {
	const registryPath = join(resolveOpenClawStateDir(), "subagents", "runs.json");
	if (!existsSync(registryPath)) {return null;}
	try {
		const raw = JSON.parse(readFileSync(registryPath, "utf-8")) as {
			runs?: Record<string, Record<string, unknown>>;
		};
		for (const entry of Object.values(raw.runs ?? {})) {
			if (entry.childSessionKey !== sessionKey) {continue;}
			const requester = typeof entry.requesterSessionKey === "string" ? entry.requesterSessionKey : "";
			const match = requester.match(/^agent:[^:]+:web:(.+)$/);
			const parentSessionId = match?.[1] ?? "";
			const task = typeof entry.task === "string" ? entry.task : "";
			return { parentSessionId, task };
		}
	} catch {
		// ignore
	}
	return null;
}

export async function GET(req: Request) {
	const url = new URL(req.url);
	const sessionId = url.searchParams.get("sessionId");
	const sessionKey = url.searchParams.get("sessionKey");
	const isSubagentSession = typeof sessionKey === "string" && sessionKey.includes(":subagent:");

	if (!sessionId && !sessionKey) {
		return new Response("sessionId or subagent sessionKey required", { status: 400 });
	}

	const runKey = isSubagentSession && sessionKey ? sessionKey : (sessionId as string);

	let run = getActiveRun(runKey);

	if (!run && isSubagentSession && sessionKey) {
		const info = deriveSubagentInfo(sessionKey);
		if (info) {
			run = startSubscribeRun({
				sessionKey,
				parentSessionId: info.parentSessionId,
				task: info.task,
			});
		}
	}

	if (!run) {
		return Response.json({ active: false }, { status: 404 });
	}

	const encoder = new TextEncoder();
	let closed = false;
	let unsubscribe: (() => void) | null = null;
	let keepalive: ReturnType<typeof setInterval> | null = null;

	const stream = new ReadableStream({
		start(controller) {
			keepalive = setInterval(() => {
				if (closed) {return;}
				try {
					controller.enqueue(encoder.encode(": keepalive\n\n"));
				} catch {
					/* ignore enqueue errors on closed stream */
				}
			}, 15_000);

			unsubscribe = subscribeToRun(
				runKey,
				(event: SseEvent | null) => {
					if (closed) {return;}
					if (event === null) {
						closed = true;
						if (keepalive) {
							clearInterval(keepalive);
							keepalive = null;
						}
						try {
							controller.close();
						} catch {
							/* already closed */
						}
						return;
					}
					try {
						const json = JSON.stringify(event);
						controller.enqueue(encoder.encode(`data: ${json}\n\n`));
					} catch {
						/* ignore enqueue errors on closed stream */
					}
				},
				{ replay: true },
			);

			if (!unsubscribe) {
				closed = true;
				if (keepalive) {
					clearInterval(keepalive);
					keepalive = null;
				}
				controller.close();
			}
		},
		cancel() {
			closed = true;
			if (keepalive) {
				clearInterval(keepalive);
				keepalive = null;
			}
			unsubscribe?.();
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Run-Active": run.status === "running" || run.status === "waiting-for-subagents" ? "true" : "false",
		},
	});
}
