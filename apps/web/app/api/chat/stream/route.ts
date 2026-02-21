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
	type SseEvent,
} from "@/lib/active-runs";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function GET(req: Request) {
	const url = new URL(req.url);
	const sessionId = url.searchParams.get("sessionId");

	if (!sessionId) {
		return new Response("sessionId required", { status: 400 });
	}

	const run = getActiveRun(sessionId);
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
				sessionId,
				(event: SseEvent | null) => {
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
