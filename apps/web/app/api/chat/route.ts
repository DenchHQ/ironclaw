import type { UIMessage } from "ai";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveAgentWorkspacePrefix } from "@/lib/workspace";
import {
	startRun,
	hasActiveRun,
	subscribeToRun,
	persistUserMessage,
	type SseEvent as ParentSseEvent,
} from "@/lib/active-runs";
import {
	hasActiveSubagent,
	isSubagentRunning,
	ensureRegisteredFromDisk,
	subscribeToSubagent,
	persistUserMessage as persistSubagentUserMessage,
	reactivateSubagent,
	spawnSubagentMessage,
	type SseEvent as SubagentSseEvent,
} from "@/lib/subagent-runs";
import { resolveOpenClawStateDir } from "@/lib/workspace";

// Force Node.js runtime (required for child_process)
export const runtime = "nodejs";

// Allow streaming responses up to 10 minutes
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

function ensureSubagentRegistered(sessionKey: string): boolean {
	if (hasActiveSubagent(sessionKey)) {return true;}
	const parentWebSessionId = deriveSubagentParentSessionId(sessionKey);
	return ensureRegisteredFromDisk(sessionKey, parentWebSessionId);
}

export async function POST(req: Request) {
	const {
		messages,
		sessionId,
		sessionKey,
	}: { messages: UIMessage[]; sessionId?: string; sessionKey?: string } = await req.json();

	// Extract the latest user message text
	const lastUserMessage = messages.filter((m) => m.role === "user").pop();
	const userText =
		lastUserMessage?.parts
			?.filter(
				(p): p is { type: "text"; text: string } =>
					p.type === "text",
			)
			.map((p) => p.text)
			.join("\n") ?? "";

	if (!userText.trim()) {
		return new Response("No message provided", { status: 400 });
	}

	const isSubagentSession = typeof sessionKey === "string" && sessionKey.includes(":subagent:");

	// Reject if a run is already active for this session.
	if (!isSubagentSession && sessionId && hasActiveRun(sessionId)) {
		return new Response("Active run in progress", { status: 409 });
	}
	if (isSubagentSession && isSubagentRunning(sessionKey)) {
		return new Response("Active subagent run in progress", { status: 409 });
	}

	// Resolve workspace file paths to be agent-cwd-relative.
	let agentMessage = userText;
	const wsPrefix = resolveAgentWorkspacePrefix();
	if (wsPrefix) {
		agentMessage = userText.replace(
			/\[Context: workspace file '([^']+)'\]/,
			`[Context: workspace file '${wsPrefix}/$1']`,
		);
	}

	// Persist the user message server-side so it survives a page reload
	// even if the client never gets a chance to save.
	if (isSubagentSession && sessionKey && lastUserMessage) {
		if (!ensureSubagentRegistered(sessionKey)) {
			return new Response("Subagent not found", { status: 404 });
		}
		persistSubagentUserMessage(sessionKey, {
			id: lastUserMessage.id,
			text: userText,
		});
	} else if (sessionId && lastUserMessage) {
		persistUserMessage(sessionId, {
			id: lastUserMessage.id,
			content: userText,
			parts: lastUserMessage.parts as unknown[],
		});
	}

	// Start the agent run (decoupled from this HTTP connection).
	// The child process will keep running even if this response is cancelled.
	if (isSubagentSession && sessionKey) {
		if (!reactivateSubagent(sessionKey)) {
			return new Response("Subagent not found", { status: 404 });
		}
		if (!spawnSubagentMessage(sessionKey, agentMessage)) {
			return new Response("Failed to start subagent run", { status: 500 });
		}
	} else if (sessionId) {
		try {
			startRun({
				sessionId,
				message: agentMessage,
				agentSessionId: sessionId,
			});
		} catch (err) {
			return new Response(
				err instanceof Error ? err.message : String(err),
				{ status: 500 },
			);
		}
	}

	// Stream SSE events to the client using the AI SDK v6 wire format.
	const encoder = new TextEncoder();
	let closed = false;
	let unsubscribe: (() => void) | null = null;

	const stream = new ReadableStream({
		start(controller) {
			if (!sessionId && !sessionKey) {
				// No session — shouldn't happen but close gracefully.
				controller.close();
				return;
			}

			unsubscribe = isSubagentSession && sessionKey
				? subscribeToSubagent(
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
					{ replay: false },
				)
				: subscribeToRun(
				sessionId as string,
				(event: ParentSseEvent | null) => {
					if (closed) {return;}
					if (event === null) {
						// Run completed — close the SSE stream.
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
						controller.enqueue(
							encoder.encode(`data: ${json}\n\n`),
						);
					} catch {
						/* ignore enqueue errors on closed stream */
					}
				},
				// Don't replay — we just created the run, the buffer is empty.
				{ replay: false },
			);

			if (!unsubscribe) {
				// Race: run was cleaned up between startRun and subscribe.
				closed = true;
				controller.close();
			}
		},
		cancel() {
			// Client disconnected — unsubscribe but keep the run alive.
			// The ActiveRunManager continues buffering + persisting in the background.
			closed = true;
			unsubscribe?.();
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
		},
	});
}
