import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";

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
	onLifecycleEnd: () => void;
	onError: (error: Error) => void;
	onClose: (code: number | null) => void;
};

/**
 * Extract text content from the agent's tool result object.
 * The result has `content: Array<{ type: "text", text: string } | ...>` and
 * optional `details` (exit codes, file paths, etc.).
 */
function extractToolResult(
	raw: unknown,
): ToolResult | undefined {
	if (!raw || typeof raw !== "object") return undefined;
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

	return { text, details };
}

/**
 * Spawn the openclaw agent and stream its output.
 * Pass an AbortSignal to kill the child process when the caller cancels.
 */
export async function runAgent(
	message: string,
	signal: AbortSignal | undefined,
	callback: AgentCallback,
): Promise<void> {
	// Get repo root - construct path dynamically at runtime
	const cwd = process.cwd();
	const root = cwd.endsWith(join("apps", "web"))
		? join(cwd, "..", "..")
		: cwd;

	// Construct script path at runtime to avoid static analysis
	const pathParts = ["scripts", "run-node.mjs"];
	const scriptPath = join(root, ...pathParts);

	return new Promise<void>((resolve) => {
		const child = spawn(
			"node",
			[
				scriptPath,
				"agent",
				"--agent",
				"main",
				"--message",
				message,
				"--stream-json",
				// Run embedded (--local) so we get ALL events (tool, thinking,
				// lifecycle) unfiltered. The gateway path drops tool events
				// unless verbose is explicitly "on".
				"--local",
			],
			{
				cwd: root,
				env: { ...process.env },
				stdio: ["ignore", "pipe", "pipe"],
			},
		);

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

		const rl = createInterface({ input: child.stdout });

		rl.on("line", (line: string) => {
			if (!line.trim()) return;

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
				} else if (phase === "result") {
					const isError = event.data?.isError === true;
					const result = extractToolResult(event.data?.result);
					callback.onToolEnd(toolCallId, toolName, isError, result);
				}
			}

			// Handle lifecycle end
			if (
				event.event === "agent" &&
				event.stream === "lifecycle" &&
				event.data?.phase === "end"
			) {
				callback.onLifecycleEnd();
			}
		});

		child.on("close", (code) => {
			callback.onClose(code);
			resolve();
		});

		child.on("error", (err) => {
			callback.onError(err);
			resolve();
		});

		// Log stderr for debugging
		child.stderr?.on("data", (chunk: Buffer) => {
			console.error("[openclaw stderr]", chunk.toString());
		});
	});
}
