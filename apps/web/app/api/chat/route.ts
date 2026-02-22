import type { UIMessage } from "ai";
import { resolveAgentWorkspacePrefix } from "@/lib/workspace";
import {
	startRun,
	startSubscribeRun,
	hasActiveRun,
	getActiveRun,
	subscribeToRun,
	persistUserMessage,
	persistSubscribeUserMessage,
	reactivateSubscribeRun,
	sendSubagentFollowUp,
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

export async function POST(req: Request) {
	const {
		messages,
		sessionId,
		sessionKey,
	}: { messages: UIMessage[]; sessionId?: string; sessionKey?: string } = await req.json();

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

	if (!isSubagentSession && sessionId && hasActiveRun(sessionId)) {
		return new Response("Active run in progress", { status: 409 });
	}
	if (isSubagentSession && sessionKey) {
		const existingRun = getActiveRun(sessionKey);
		if (existingRun?.status === "running") {
			return new Response("Active subagent run in progress", { status: 409 });
		}
	}

	let agentMessage = userText;
	const wsPrefix = resolveAgentWorkspacePrefix();
	if (wsPrefix) {
		agentMessage = userText.replace(
			/\[Context: workspace file '([^']+)'\]/,
			`[Context: workspace file '${wsPrefix}/$1']`,
		);
	}

	const runKey = isSubagentSession && sessionKey ? sessionKey : (sessionId as string);

	if (isSubagentSession && sessionKey && lastUserMessage) {
		let run = getActiveRun(sessionKey);
		if (!run) {
			const info = deriveSubagentInfo(sessionKey);
			if (!info) {
				return new Response("Subagent not found", { status: 404 });
			}
			run = startSubscribeRun({
				sessionKey,
				parentSessionId: info.parentSessionId,
				task: info.task,
			});
		}
		persistSubscribeUserMessage(sessionKey, {
			id: lastUserMessage.id,
			text: userText,
		});
		reactivateSubscribeRun(sessionKey);
		if (!sendSubagentFollowUp(sessionKey, agentMessage)) {
			return new Response("Failed to send subagent message", { status: 500 });
		}
	} else if (sessionId && lastUserMessage) {
		persistUserMessage(sessionId, {
			id: lastUserMessage.id,
			content: userText,
			parts: lastUserMessage.parts as unknown[],
		});
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

	const encoder = new TextEncoder();
	let closed = false;
	let unsubscribe: (() => void) | null = null;

	const stream = new ReadableStream({
		start(controller) {
			if (!runKey) {
				controller.close();
				return;
			}

			unsubscribe = subscribeToRun(
				runKey,
				(event: SseEvent | null) => {
					if (closed) {return;}
					if (event === null) {
						closed = true;
						try { controller.close(); } catch { /* already closed */ }
						return;
					}
					try {
						const json = JSON.stringify(event);
						controller.enqueue(encoder.encode(`data: ${json}\n\n`));
					} catch { /* ignore */ }
				},
				{ replay: false },
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
		},
	});
}
