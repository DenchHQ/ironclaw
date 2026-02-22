/**
 * GET /api/chat/stream?sessionId=xxx
 *
 * Reconnect to an active (or recently-completed) agent run.
 * Replays all buffered SSE events from the start of the run, then
 * streams live events until the run finishes.
 *
 * Returns 404 if no run exists for the given session.
 */
import {
	getActiveRun,
	subscribeToRun,
	type SseEvent as ParentSseEvent,
} from "@/lib/active-runs";
import {
	subscribeToSubagent,
	hasActiveSubagent,
	isSubagentRunning,
	ensureRegisteredFromDisk,
	ensureSubagentStreamable,
	type SseEvent as SubagentSseEvent,
} from "@/lib/subagent-runs";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveOpenClawStateDir } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 600;

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

export async function GET(req: Request) {
	const url = new URL(req.url);
	const sessionId = url.searchParams.get("sessionId");
	const sessionKey = url.searchParams.get("sessionKey");
	const isSubagentSession = typeof sessionKey === "string" && sessionKey.includes(":subagent:");

	if (!sessionId && !sessionKey) {
		return new Response("sessionId or subagent sessionKey required", { status: 400 });
	}

	if (isSubagentSession && sessionKey) {
		if (!hasActiveSubagent(sessionKey)) {
			const parentWebSessionId = deriveSubagentParentSessionId(sessionKey);
			const registered = ensureRegisteredFromDisk(sessionKey, parentWebSessionId);
			if (!registered && !hasActiveSubagent(sessionKey)) {
				return Response.json({ active: false }, { status: 404 });
			}
		}
		ensureSubagentStreamable(sessionKey);
		const isActive = isSubagentRunning(sessionKey);
		const encoder = new TextEncoder();
		let closed = false;
		let unsubscribe: (() => void) | null = null;

		const stream = new ReadableStream({
			start(controller) {
				unsubscribe = subscribeToSubagent(
					sessionKey,
					(event: SubagentSseEvent | null) => {
						if (closed) {return;}
						if (event === null) {
							closed = true;
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
					controller.close();
				}
			},
			cancel() {
				closed = true;
				unsubscribe?.();
			},
		});

		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache, no-transform",
				Connection: "keep-alive",
				"X-Run-Active": isActive ? "true" : "false",
			},
		});
	}
	const run = getActiveRun(sessionId as string);
	if (!run) {
		return Response.json({ active: false }, { status: 404 });
	}

	const encoder = new TextEncoder();
	let closed = false;
	let unsubscribe: (() => void) | null = null;
	let keepalive: ReturnType<typeof setInterval> | null = null;

	const stream = new ReadableStream({
		start(controller) {
			// Keep idle SSE connections alive while waiting for subagent announcements.
			keepalive = setInterval(() => {
				if (closed) {return;}
				try {
					controller.enqueue(encoder.encode(": keepalive\n\n"));
				} catch {
					/* ignore enqueue errors on closed stream */
				}
			}, 15_000);

			// subscribeToRun with replay=true replays the full event buffer
			// synchronously, then subscribes for live events.
			unsubscribe = subscribeToRun(
				sessionId as string,
				(event: ParentSseEvent | null) => {
					if (closed) {return;}
					if (event === null) {
						// Run completed — close the SSE stream.
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
						controller.enqueue(
							encoder.encode(`data: ${json}\n\n`),
						);
					} catch {
						/* ignore enqueue errors on closed stream */
					}
				},
				{ replay: true },
			);

			if (!unsubscribe) {
				// Run was cleaned up between getActiveRun and subscribe.
				closed = true;
				if (keepalive) {
					clearInterval(keepalive);
					keepalive = null;
				}
				controller.close();
			}
		},
		cancel() {
			// Client disconnected — unsubscribe only (don't kill the run).
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
