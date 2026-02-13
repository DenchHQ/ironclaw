import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export type AgentEvent = {
	event: string;
	runId?: string;
	stream?: string;
	data?: Record<string, unknown>;
	seq?: number;
	ts?: number;
	sessionKey?: string;
	status?: string;
	result?: {
		payloads?: Array<{ text?: string; mediaUrl?: string | null }>;
		meta?: Record<string, unknown>;
	};
};

/** Extracted text + details from a tool result event. */
export type ToolResult = {
	text?: string;
	details?: Record<string, unknown>;
};

export type AgentCallback = {
	onTextDelta: (delta: string) => void;
	onThinkingDelta: (delta: string) => void;
	onToolStart: (
		toolCallId: string,
		toolName: string,
		args?: Record<string, unknown>,
	) => void;
	onToolEnd: (
		toolCallId: string,
		toolName: string,
		isError: boolean,
		result?: ToolResult,
	) => void;
	/** Called when the agent run is picked up and starts executing. */
	onLifecycleStart?: () => void;
	onLifecycleEnd: () => void;
	/** Called when session auto-compaction begins. */
	onCompactionStart?: () => void;
	/** Called when session auto-compaction finishes. */
	onCompactionEnd?: (willRetry: boolean) => void;
	/** Called when a running tool emits a progress update. */
	onToolUpdate?: (
		toolCallId: string,
		toolName: string,
	) => void;
	onError: (error: Error) => void;
	onClose: (code: number | null) => void;
	/** Called when the agent encounters an API or runtime error (402, rate limit, etc.) */
	onAgentError?: (message: string) => void;
};

/**
 * Extract text content from the agent's tool result object.
 * The result has `content: Array<{ type: "text", text: string } | ...>` and
 * optional `details` (exit codes, file paths, etc.).
 *
 * Falls back gracefully when the result doesn't follow the standard wrapper:
 * - If no `content` array, tries to use the raw object as details directly.
 * - If the raw value is a string, treats it as text.
 */
export function extractToolResult(
	raw: unknown,
): ToolResult | undefined {
	if (!raw) {return undefined;}
	// String result — treat the whole thing as text
	if (typeof raw === "string") {return { text: raw, details: undefined };}
	if (typeof raw !== "object") {return undefined;}
	const r = raw as Record<string, unknown>;

	// Extract text from content blocks
	const content = Array.isArray(r.content) ? r.content : [];
	const textParts: string[] = [];
	for (const block of content) {
		if (
			block &&
			typeof block === "object" &&
			(block as Record<string, unknown>).type === "text" &&
			typeof (block as Record<string, unknown>).text === "string"
		) {
			textParts.push((block as Record<string, unknown>).text as string);
		}
	}

	const text = textParts.length > 0 ? textParts.join("\n") : undefined;
	const details =
		r.details && typeof r.details === "object"
			? (r.details as Record<string, unknown>)
			: undefined;

	// Fallback: if neither content nor details were found, the raw object
	// might BE the tool payload itself (e.g. { query, results, url, ... }).
	// Use it as details so buildToolOutput can extract web tool fields.
	if (!text && !details && !Array.isArray(r.content)) {
		return { text: undefined, details: r };
	}

	return { text, details };
}

export type RunAgentOptions = {
	/** When set, the agent runs in an isolated session (e.g. file-scoped subagent). */
	sessionId?: string;
};

/**
 * Resolve the ironclaw/openclaw package root directory.
 *
 * In a dev workspace the cwd is `<repo>/apps/web` and `scripts/run-node.mjs`
 * exists two levels up.  In a production standalone build the cwd is
 * `<pkg>/apps/web/.next/standalone/apps/web/` — walking two levels up lands
 * inside the `.next` tree, not at the package root.
 *
 * Strategy:
 *  1. Honour `OPENCLAW_ROOT` env var (set by the gateway when spawning the
 *     standalone server — guaranteed correct).
 *  2. Walk upward from cwd looking for `openclaw.mjs` (production) or
 *     `scripts/run-node.mjs` (dev).
 *  3. Fallback: original 2-levels-up heuristic.
 */
export function resolvePackageRoot(): string {
	// 1. Env var (fastest, most reliable in standalone mode).
	if (process.env.OPENCLAW_ROOT && existsSync(process.env.OPENCLAW_ROOT)) {
		return process.env.OPENCLAW_ROOT;
	}

	// 2. Walk up from cwd.
	let dir = process.cwd();
	for (let i = 0; i < 20; i++) {
		if (
			existsSync(join(dir, "openclaw.mjs")) ||
			existsSync(join(dir, "scripts", "run-node.mjs"))
		) {
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) {break;}
		dir = parent;
	}

	// 3. Fallback: legacy heuristic.
	const cwd = process.cwd();
	return cwd.endsWith(join("apps", "web"))
		? join(cwd, "..", "..")
		: cwd;
}

/**
 * Spawn an agent child process and return the ChildProcess handle.
 * Shared between `runAgent` (legacy callback API) and the ActiveRunManager.
 *
 * In a dev workspace uses `scripts/run-node.mjs` (auto-rebuilds TypeScript).
 * In production / global-install uses `openclaw.mjs` directly (pre-built).
 */
export function spawnAgentProcess(
	message: string,
	agentSessionId?: string,
): ReturnType<typeof spawn> {
	const root = resolvePackageRoot();

	// Dev: scripts/run-node.mjs (auto-rebuild). Prod: openclaw.mjs (pre-built).
	const devScript = join(root, "scripts", "run-node.mjs");
	const prodScript = join(root, "openclaw.mjs");
	const scriptPath = existsSync(devScript) ? devScript : prodScript;

	const args = [
		scriptPath,
		"agent",
		"--agent",
		"main",
		"--message",
		message,
		"--stream-json",
	];

	if (agentSessionId) {
		const sessionKey = `agent:main:subagent:${agentSessionId}`;
		args.push("--session-key", sessionKey, "--lane", "subagent");
	}

	return spawn("node", args, {
		cwd: root,
		env: { ...process.env },
		stdio: ["ignore", "pipe", "pipe"],
	});
}

/**
 * Build a flat output object from the agent's tool result so the frontend
 * can render tool output text, exit codes, etc.
 */
export function buildToolOutput(
	result?: ToolResult,
): Record<string, unknown> {
	if (!result) {return {};}
	const out: Record<string, unknown> = {};
	if (result.text) {out.text = result.text;}
	if (result.details) {
		for (const key of [
			"exitCode",
			"status",
			"durationMs",
			"cwd",
			"error",
			"reason",
			// Web tool fields — pass through so the UI can show favicons / domains
			"url",
			"finalUrl",
			"targetUrl",
			"query",
			"results",
			"citations",
		]) {
			if (result.details[key] !== undefined)
				{out[key] = result.details[key];}
		}
	}
	// If we have details but no text, synthesize a text field from the JSON so
	// domain-extraction regex in the frontend can find URLs from search results.
	if (!out.text && result.details) {
		try {
			const json = JSON.stringify(result.details);
			if (json.length <= 12000) {
				out.text = json;
			}
		} catch {
			/* ignore */
		}
	}
	return out;
}

/**
 * Spawn the openclaw agent and stream its output.
 * Pass an AbortSignal to kill the child process when the caller cancels.
 *
 * When `options.sessionId` is set the child process gets `--session-id <id>`,
 * which creates an isolated agent session that won't interfere with the main
 * agent or other sidebar chats.
 */
export async function runAgent(
	message: string,
	signal: AbortSignal | undefined,
	callback: AgentCallback,
	options?: RunAgentOptions,
): Promise<void> {
	return new Promise<void>((resolve) => {
		const child = spawnAgentProcess(message, options?.sessionId);

		// Kill the child process if the caller aborts (e.g. user hit stop).
		if (signal) {
			const onAbort = () => child.kill("SIGTERM");
			if (signal.aborted) {
				child.kill("SIGTERM");
			} else {
				signal.addEventListener("abort", onAbort, { once: true });
				child.on("close", () =>
					signal.removeEventListener("abort", onAbort),
				);
			}
		}

		// Collect stderr so we can surface errors to the UI
		const stderrChunks: string[] = [];
		let agentErrorReported = false;

		const rl = createInterface({ input: child.stdout! });

		// Prevent unhandled 'error' events when the child process fails
		// to start (e.g. ENOENT). The child's own 'error' handler below
		// surfaces the real error to the caller.
		rl.on("error", () => { /* handled by child error/close */ });

		rl.on("line", (line: string) => {
			if (!line.trim()) {return;}

			let event: AgentEvent;
			try {
				event = JSON.parse(line) as AgentEvent;
			} catch {
				console.log("[agent-runner] Non-JSON line:", line);
				return; // skip non-JSON lines
			}

			// Handle assistant text deltas
			if (event.event === "agent" && event.stream === "assistant") {
				const delta =
					typeof event.data?.delta === "string"
						? event.data.delta
						: undefined;
				if (delta) {
					callback.onTextDelta(delta);
				}
				// Forward media URLs (images, files generated by the agent)
				const mediaUrls = event.data?.mediaUrls;
				if (Array.isArray(mediaUrls)) {
					for (const url of mediaUrls) {
						if (typeof url === "string" && url.trim()) {
							callback.onTextDelta(`\n![media](${url.trim()})\n`);
						}
					}
				}
			}

			// Handle thinking/reasoning deltas
			if (event.event === "agent" && event.stream === "thinking") {
				const delta =
					typeof event.data?.delta === "string"
						? event.data.delta
						: undefined;
				if (delta) {
					callback.onThinkingDelta(delta);
				}
			}

			// Handle tool execution events
			if (event.event === "agent" && event.stream === "tool") {
				const phase =
					typeof event.data?.phase === "string"
						? event.data.phase
						: undefined;
				const toolCallId =
					typeof event.data?.toolCallId === "string"
						? event.data.toolCallId
						: "";
				const toolName =
					typeof event.data?.name === "string"
						? event.data.name
						: "";

				if (phase === "start") {
					const args =
						event.data?.args &&
						typeof event.data.args === "object"
							? (event.data.args as Record<string, unknown>)
							: undefined;
					callback.onToolStart(toolCallId, toolName, args);
				} else if (phase === "update") {
					callback.onToolUpdate?.(toolCallId, toolName);
				} else if (phase === "result") {
					const isError = event.data?.isError === true;
					const result = extractToolResult(event.data?.result);
					callback.onToolEnd(toolCallId, toolName, isError, result);
				}
			}

			// Handle lifecycle start
			if (
				event.event === "agent" &&
				event.stream === "lifecycle" &&
				event.data?.phase === "start"
			) {
				callback.onLifecycleStart?.();
			}

			// Handle lifecycle end
			if (
				event.event === "agent" &&
				event.stream === "lifecycle" &&
				event.data?.phase === "end"
			) {
				callback.onLifecycleEnd();
			}

			// Handle session compaction events
			if (event.event === "agent" && event.stream === "compaction") {
				const phase =
					typeof event.data?.phase === "string"
						? event.data.phase
						: undefined;
				if (phase === "start") {
					callback.onCompactionStart?.();
				} else if (phase === "end") {
					const willRetry = event.data?.willRetry === true;
					callback.onCompactionEnd?.(willRetry);
				}
			}

			// ── Surface agent-level errors (API 402, rate limits, etc.) ──

			// Lifecycle error phase
			if (
				event.event === "agent" &&
				event.stream === "lifecycle" &&
				event.data?.phase === "error"
			) {
				const msg = parseAgentErrorMessage(event.data);
				if (msg && !agentErrorReported) {
					agentErrorReported = true;
					callback.onAgentError?.(msg);
				}
			}

			// Top-level error events
			if (event.event === "error") {
				const msg = parseAgentErrorMessage(event.data ?? event);
				if (msg && !agentErrorReported) {
					agentErrorReported = true;
					callback.onAgentError?.(msg);
				}
			}

			// Messages with stopReason "error" (some agents inline errors this way)
			if (
				event.event === "agent" &&
				event.stream === "assistant" &&
				typeof event.data?.stopReason === "string" &&
				event.data.stopReason === "error" &&
				typeof event.data?.errorMessage === "string"
			) {
				if (!agentErrorReported) {
					agentErrorReported = true;
					callback.onAgentError?.(
						parseErrorBody(event.data.errorMessage),
					);
				}
			}
		});

		child.on("close", (code) => {
			// If no error was reported yet, check stderr for useful info
			if (!agentErrorReported && stderrChunks.length > 0) {
				const stderr = stderrChunks.join("").trim();
				const msg = parseErrorFromStderr(stderr);
				if (msg) {
					agentErrorReported = true;
					callback.onAgentError?.(msg);
				}
			}
			callback.onClose(code);
			resolve();
		});

		child.on("error", (err) => {
			callback.onError(err);
			resolve();
		});

		// Capture stderr for debugging + error surfacing
		child.stderr?.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			stderrChunks.push(text);
			console.error("[ironclaw stderr]", text);
		});
	});
}

// ── Error message extraction helpers ──

/**
 * Extract a user-friendly error message from an agent event's data object.
 * Handles various shapes: `{ error: "..." }`, `{ message: "..." }`,
 * `{ errorMessage: "402 {...}" }`, etc.
 */
export function parseAgentErrorMessage(
	data: Record<string, unknown> | undefined,
): string | undefined {
	if (!data) {return undefined;}

	// Direct error string
	if (typeof data.error === "string") {return parseErrorBody(data.error);}
	// Message field
	if (typeof data.message === "string") {return parseErrorBody(data.message);}
	// errorMessage field (may contain "402 {json}")
	if (typeof data.errorMessage === "string")
		{return parseErrorBody(data.errorMessage);}

	return undefined;
}

/**
 * Parse a raw error string that may contain an HTTP status + JSON body,
 * e.g. `402 {"error":{"message":"Insufficient funds..."}}`.
 * Returns a clean, user-readable message.
 */
export function parseErrorBody(raw: string): string {
	// Try to extract JSON body from "STATUS {json}" pattern
	const jsonIdx = raw.indexOf("{");
	if (jsonIdx >= 0) {
		try {
			const parsed = JSON.parse(raw.slice(jsonIdx));
			const msg =
				parsed?.error?.message ?? parsed?.message ?? parsed?.error;
			if (typeof msg === "string") {return msg;}
		} catch {
			// not valid JSON, fall through
		}
	}
	return raw;
}

/**
 * Extract a meaningful error message from raw stderr output.
 * Strips ANSI codes and looks for common error patterns.
 */
export function parseErrorFromStderr(stderr: string): string | undefined {
	if (!stderr) {return undefined;}

	// Strip ANSI escape codes
	const clean = stderr.replace(
		/\x1B\[[0-9;]*[A-Za-z]/g,
		"",
	);

	// Look for JSON error bodies (e.g. from API responses)
	const jsonMatch = clean.match(/\{"error":\{[^}]*"message":"([^"]+)"[^}]*\}/);
	if (jsonMatch?.[1]) {return jsonMatch[1];}

	// Look for lines containing "error" (case-insensitive)
	const lines = clean.split("\n").filter(Boolean);
	for (const line of lines) {
		const trimmed = line.trim();
		if (/\b(error|failed|fatal)\b/i.test(trimmed)) {
			// Strip common prefixes like "[openclaw]", timestamps, etc.
			const stripped = trimmed
				.replace(/^\[.*?\]\s*/, "")
				.replace(/^Error:\s*/i, "");
			if (stripped.length > 5) {return stripped;}
		}
	}

	// Last resort: return last non-empty line if it's short enough
	const last = lines[lines.length - 1]?.trim();
	if (last && last.length <= 300) {return last;}

	return undefined;
}
