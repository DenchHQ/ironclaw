import { subscribeToSubagent, hasActiveSubagent, isSubagentRunning, ensureRegisteredFromDisk } from "@/lib/subagent-runs";
import type { SseEvent } from "@/lib/subagent-runs";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveOpenClawStateDir } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 600;

/**
 * Ensure the subagent is registered in the in-memory SubagentRunManager.
 * Tries the shared ensureRegisteredFromDisk helper first, which reads the
 * on-disk registry (~/.openclaw/subagents/runs.json).
 */
function ensureRegistered(sessionKey: string): boolean {
	if (hasActiveSubagent(sessionKey)) {return true;}

	// Look up the parent web session ID from the on-disk registry
	const registryPath = join(resolveOpenClawStateDir(), "subagents", "runs.json");
	if (!existsSync(registryPath)) {return false;}

	try {
		const raw = JSON.parse(readFileSync(registryPath, "utf-8"));
		const runs = raw?.runs;
		if (!runs || typeof runs !== "object") {return false;}

		for (const entry of Object.values(runs)) {
			if (entry.childSessionKey === sessionKey) {
				const rsk = typeof entry.requesterSessionKey === "string" ? entry.requesterSessionKey : "";
				const webIdMatch = rsk.match(/^agent:[^:]+:web:(.+)$/);
				const parentWebSessionId = webIdMatch?.[1] ?? "";
				return ensureRegisteredFromDisk(sessionKey, parentWebSessionId);
			}
		}
	} catch { /* ignore */ }

	return false;
}

export async function GET(req: Request) {
	const url = new URL(req.url);
	const sessionKey = url.searchParams.get("sessionKey");

	if (!sessionKey) {
		return new Response("sessionKey required", { status: 400 });
	}

	// Lazily register the subagent so events get buffered
	const registered = ensureRegistered(sessionKey);
	if (!registered && !hasActiveSubagent(sessionKey)) {
		return new Response("Subagent not found", { status: 404 });
	}

	const isActive = isSubagentRunning(sessionKey);
	const encoder = new TextEncoder();
	let closed = false;
	let unsubscribe: (() => void) | null = null;

	const stream = new ReadableStream({
		start(controller) {
			unsubscribe = subscribeToSubagent(
				sessionKey,
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
