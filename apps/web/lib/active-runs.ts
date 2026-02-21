/**
 * Server-side singleton that manages agent child processes independently of
 * HTTP connections. Buffers SSE events, fans out to subscribers, and
 * persists assistant messages incrementally to disk.
 *
 * This decouples agent lifecycles from request lifecycles so:
 *  - Streams survive page reloads (process keeps running).
 *  - Messages are written to persistent sessions as they arrive.
 *  - New HTTP connections can re-attach to a running stream.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import {
	readFileSync,
	writeFileSync,
	existsSync,
	mkdirSync,
} from "node:fs";
import { resolveWebChatDir } from "./workspace";
import {
	type AgentEvent,
	spawnAgentProcess,
	spawnAgentSubscribeProcess,
	resolvePackageRoot,
	extractToolResult,
	buildToolOutput,
	parseAgentErrorMessage,
	parseErrorBody,
	parseErrorFromStderr,
} from "./agent-runner";
import {
	hasRunningSubagentsForParent,
} from "./subagent-runs";

// ── Types ──

/** An SSE event object in the AI SDK v6 data stream wire format. */
export type SseEvent = Record<string, unknown> & { type: string };

/** Subscriber callback. Receives SSE events, or `null` when the run completes. */
export type RunSubscriber = (event: SseEvent | null) => void;

type AccumulatedPart =
	| { type: "reasoning"; text: string }
	| {
			type: "tool-invocation";
			toolCallId: string;
			toolName: string;
			args: Record<string, unknown>;
			result?: Record<string, unknown>;
			errorText?: string;
		}
	| { type: "text"; text: string };

type AccumulatedMessage = {
	id: string;
	role: "assistant";
	/** Ordered parts preserving the interleaving of reasoning, tools, and text. */
	parts: AccumulatedPart[];
};

export type ActiveRun = {
	sessionId: string;
	childProcess: ChildProcess;
	eventBuffer: SseEvent[];
	subscribers: Set<RunSubscriber>;
	accumulated: AccumulatedMessage;
	status: "running" | "waiting-for-subagents" | "completed" | "error";
	startedAt: number;
	exitCode: number | null;
	abortController: AbortController;
	/** @internal debounced persistence timer */
	_persistTimer: ReturnType<typeof setTimeout> | null;
	/** @internal last time persistence was flushed */
	_lastPersistedAt: number;
	/** @internal last globalSeq seen from the gateway event stream */
	lastGlobalSeq: number;
	/** @internal subscribe child process for waiting-for-subagents continuation */
	_subscribeProcess?: ChildProcess | null;
};

// ── Constants ──

const PERSIST_INTERVAL_MS = 2_000;
const CLEANUP_GRACE_MS = 30_000;

const SILENT_REPLY_TOKEN = "NO_REPLY";

/**
 * Detect leaked silent-reply fragments in finalized text parts.
 * The agent runner suppresses full "NO_REPLY" tokens, but during streaming
 * the model may emit a partial prefix (e.g. "NO") before the full token is
 * assembled and caught. This catches both the full token and known partial
 * prefixes so they don't leak into persisted/displayed messages.
 */
function isLeakedSilentReplyToken(text: string): boolean {
	const t = text.trim();
	if (!t) {return false;}
	if (new RegExp(`^${SILENT_REPLY_TOKEN}\\W*$`).test(t)) {return true;}
	if (SILENT_REPLY_TOKEN.startsWith(t) && t.length >= 2 && t.length < SILENT_REPLY_TOKEN.length) {return true;}
	return false;
}
// Evaluated per-call so it tracks profile switches at runtime.
function webChatDir(): string { return resolveWebChatDir(); }
function indexFile(): string { return join(webChatDir(), "index.json"); }

// ── Singleton registry ──
// Store on globalThis so the Map survives Next.js HMR reloads in dev mode.
// Without this, hot-reloading any server module resets the Map, orphaning
// running child processes and dropping SSE streams mid-flight.

const GLOBAL_KEY = "__openclaw_activeRuns" as const;

const activeRuns: Map<string, ActiveRun> =
	(globalThis as Record<string, unknown>)[GLOBAL_KEY] as Map<string, ActiveRun> ??
	new Map<string, ActiveRun>();

(globalThis as Record<string, unknown>)[GLOBAL_KEY] = activeRuns;

// ── Public API ──

/** Retrieve an active or recently-completed run (within the grace period). */
export function getActiveRun(sessionId: string): ActiveRun | undefined {
	return activeRuns.get(sessionId);
}

/** Check whether a *running* (not just completed) run exists for a session. */
export function hasActiveRun(sessionId: string): boolean {
	const run = activeRuns.get(sessionId);
	return run !== undefined && (run.status === "running" || run.status === "waiting-for-subagents");
}

/** Return the session IDs of all currently running agent runs. */
export function getRunningSessionIds(): string[] {
	const ids: string[] = [];
	for (const [sessionId, run] of activeRuns) {
		if (run.status === "running" || run.status === "waiting-for-subagents") {
			ids.push(sessionId);
		}
	}
	return ids;
}

/**
 * Subscribe to an active run's SSE events.
 *
 * When `replay` is true (default), all buffered events are replayed first
 * (synchronously), then live events follow. If the run already finished,
 * the subscriber is called with `null` after the replay.
 *
 * Returns an unsubscribe function, or `null` if no run exists.
 */
export function subscribeToRun(
	sessionId: string,
	callback: RunSubscriber,
	options?: { replay?: boolean },
): (() => void) | null {
	const run = activeRuns.get(sessionId);
	if (!run) {return null;}

	const replay = options?.replay ?? true;

	// Replay buffered events synchronously (safe — no event-loop yield).
	if (replay) {
		for (const event of run.eventBuffer) {
			callback(event);
		}
	}

	// If the run already finished, signal completion immediately.
	if (run.status !== "running" && run.status !== "waiting-for-subagents") {
		callback(null);
		return () => {};
	}

	run.subscribers.add(callback);
	return () => {
		run.subscribers.delete(callback);
	};
}

/** Abort a running agent. Returns true if a run was actually aborted. */
export function abortRun(sessionId: string): boolean {
	const run = activeRuns.get(sessionId);
	if (!run || (run.status !== "running" && run.status !== "waiting-for-subagents")) {return false;}

	// Immediately mark the run as non-running so hasActiveRun() returns
	// false and the next user message isn't rejected with 409.
	const wasWaiting = run.status === "waiting-for-subagents";
	run.status = "error";

	// Clean up waiting subscribe process if present.
	stopSubscribeProcess(run);

	run.abortController.abort();
	if (!wasWaiting) {
		run.childProcess.kill("SIGTERM");
	}

	// Send chat.abort directly to the gateway so the agent run stops
	// even if the CLI child's best-effort onAbort doesn't complete in time.
	sendGatewayAbort(sessionId);

	// Flush persistence to save the partial response (without _streaming).
	flushPersistence(run);

	// Signal subscribers that the stream ended.
	for (const sub of run.subscribers) {
		try { sub(null); } catch { /* ignore */ }
	}
	run.subscribers.clear();

	// Schedule grace-period cleanup (guard: only if we're still the active run).
	setTimeout(() => {
		if (activeRuns.get(sessionId) === run) {
			cleanupRun(sessionId);
		}
	}, CLEANUP_GRACE_MS);

	// Fallback: if the child doesn't exit within 5 seconds after
	// SIGTERM (e.g. the CLI's best-effort chat.abort RPC hangs),
	// send SIGKILL to force-terminate.
	if (!wasWaiting) {
		const killTimer = setTimeout(() => {
			try {
				run.childProcess.kill("SIGKILL");
			} catch { /* already dead */ }
		}, 5_000);
		run.childProcess.once("close", () => clearTimeout(killTimer));
	}

	return true;
}

/**
 * Send a `chat.abort` RPC directly to the gateway daemon via a short-lived
 * CLI process.  This is a belt-and-suspenders complement to the SIGTERM sent
 * to the child: even if the child's best-effort `onAbort` callback doesn't
 * reach the gateway in time, this separate process will.
 */
function sendGatewayAbort(sessionId: string): void {
	try {
		const root = resolvePackageRoot();
		const devScript = join(root, "scripts", "run-node.mjs");
		const prodScript = join(root, "openclaw.mjs");
		const scriptPath = existsSync(devScript) ? devScript : prodScript;

		const sessionKey = `agent:main:web:${sessionId}`;
		const child = spawn(
			"node",
			[
				scriptPath,
				"gateway",
				"call",
				"chat.abort",
				"--params",
				JSON.stringify({ sessionKey }),
				"--json",
				"--timeout",
				"4000",
			],
			{
				cwd: root,
				env: { ...process.env },
				stdio: "ignore",
				detached: true,
			},
		);
		// Let the abort process run independently — don't block on it.
		child.unref();
	} catch {
		// Best-effort; don't let abort failures break the stop flow.
	}
}

/**
 * Start a new agent run for the given session.
 * Throws if a run is already active for this session.
 */
export function startRun(params: {
	sessionId: string;
	message: string;
	agentSessionId?: string;
}): ActiveRun {
	const { sessionId, message, agentSessionId } = params;

	const existing = activeRuns.get(sessionId);
	if (existing?.status === "running") {
		throw new Error("Active run already exists for this session");
	}
	// Clean up a finished run that's still in the grace period.
	if (existing) {cleanupRun(sessionId);}

	const abortController = new AbortController();
	const child = spawnAgentProcess(message, agentSessionId);

	const run: ActiveRun = {
		sessionId,
		childProcess: child,
		eventBuffer: [],
		subscribers: new Set(),
		accumulated: {
			id: `assistant-${sessionId}-${Date.now()}`,
			role: "assistant",
			parts: [],
		},
		status: "running",
		startedAt: Date.now(),
		exitCode: null,
		abortController,
		_persistTimer: null,
		_lastPersistedAt: 0,
		lastGlobalSeq: 0,
	};

	activeRuns.set(sessionId, run);

	// Wire abort signal → child process kill.
	const onAbort = () => child.kill("SIGTERM");
	if (abortController.signal.aborted) {
		child.kill("SIGTERM");
	} else {
		abortController.signal.addEventListener("abort", onAbort, {
			once: true,
		});
		child.on("close", () =>
			abortController.signal.removeEventListener("abort", onAbort),
		);
	}

	wireChildProcess(run);
	return run;
}

// ── Persistence helpers (called from route to persist user messages) ──

/** Save a user message to the session JSONL (called once at run start). */
export function persistUserMessage(
	sessionId: string,
	msg: { id: string; content: string; parts?: unknown[] },
): void {
	ensureDir();
	const filePath = join(webChatDir(), `${sessionId}.jsonl`);
	if (!existsSync(filePath)) {writeFileSync(filePath, "");}

	const line = JSON.stringify({
		id: msg.id,
		role: "user",
		content: msg.content,
		...(msg.parts ? { parts: msg.parts } : {}),
		timestamp: new Date().toISOString(),
	});

	// Avoid duplicates (e.g. retry).
	const existing = readFileSync(filePath, "utf-8");
	const lines = existing.split("\n").filter((l) => l.trim());
	const alreadySaved = lines.some((l) => {
		try {
			return JSON.parse(l).id === msg.id;
		} catch {
			return false;
		}
	});

	if (!alreadySaved) {
		writeFileSync(filePath, [...lines, line].join("\n") + "\n");
		updateIndex(sessionId, { incrementCount: 1 });
	}
}

// ── Internals ──

function ensureDir() {
	const dir = webChatDir();
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

function updateIndex(
	sessionId: string,
	opts: { incrementCount?: number; title?: string },
) {
	try {
		const idxPath = indexFile();
		let index: Array<Record<string, unknown>>;
		if (!existsSync(idxPath)) {
			// Auto-create index with a bootstrap entry for this session so
			// orphaned .jsonl files become visible in the sidebar.
			index = [{
				id: sessionId,
				title: opts.title || "New Chat",
				createdAt: Date.now(),
				updatedAt: Date.now(),
				messageCount: opts.incrementCount || 0,
			}];
			writeFileSync(idxPath, JSON.stringify(index, null, 2));
			return;
		}
		index = JSON.parse(
			readFileSync(idxPath, "utf-8"),
		) as Array<Record<string, unknown>>;
		let session = index.find((s) => s.id === sessionId);
		if (!session) {
			// Session file exists but wasn't indexed — add it.
			session = {
				id: sessionId,
				title: opts.title || "New Chat",
				createdAt: Date.now(),
				updatedAt: Date.now(),
				messageCount: 0,
			};
			index.unshift(session);
		}
		session.updatedAt = Date.now();
		if (opts.incrementCount) {
			session.messageCount =
				((session.messageCount as number) || 0) + opts.incrementCount;
		}
		if (opts.title) {session.title = opts.title;}
		writeFileSync(idxPath, JSON.stringify(index, null, 2));
	} catch {
		/* best-effort */
	}
}

// ── SSE event generation from child-process JSON lines ──

function wireChildProcess(run: ActiveRun): void {
	const child = run.childProcess;

	let idCounter = 0;
	const nextId = (prefix: string) =>
		`${prefix}-${Date.now()}-${++idCounter}`;

	let currentTextId = "";
	let currentReasoningId = "";
	let textStarted = false;
	let reasoningStarted = false;
	let everSentText = false;
	let statusReasoningActive = false;
	let agentErrorReported = false;
	const stderrChunks: string[] = [];

	// ── Ordered accumulation tracking (preserves interleaving for persistence) ──
	let accTextIdx = -1;
	let accReasoningIdx = -1;
	const accToolMap = new Map<string, number>();

	const accAppendReasoning = (delta: string) => {
		if (accReasoningIdx < 0) {
			run.accumulated.parts.push({ type: "reasoning", text: delta });
			accReasoningIdx = run.accumulated.parts.length - 1;
		} else {
			(run.accumulated.parts[accReasoningIdx] as { type: "reasoning"; text: string }).text += delta;
		}
	};

	const accAppendText = (delta: string) => {
		if (accTextIdx < 0) {
			run.accumulated.parts.push({ type: "text", text: delta });
			accTextIdx = run.accumulated.parts.length - 1;
		} else {
			(run.accumulated.parts[accTextIdx] as { type: "text"; text: string }).text += delta;
		}
	};

	/** Emit an SSE event: push to buffer + notify all subscribers. */
	const emit = (event: SseEvent) => {
		run.eventBuffer.push(event);
		for (const sub of run.subscribers) {
			try {
				sub(event);
			} catch {
				/* ignore subscriber errors */
			}
		}
		schedulePersist(run);
	};

	const closeReasoning = () => {
		if (reasoningStarted) {
			emit({ type: "reasoning-end", id: currentReasoningId });
			reasoningStarted = false;
			statusReasoningActive = false;
		}
		accReasoningIdx = -1;
	};

	const closeText = () => {
		if (textStarted) {
			if (accTextIdx >= 0) {
				const part = run.accumulated.parts[accTextIdx] as { type: "text"; text: string };
				if (isLeakedSilentReplyToken(part.text)) {
					run.accumulated.parts.splice(accTextIdx, 1);
					for (const [k, v] of accToolMap) {
						if (v > accTextIdx) { accToolMap.set(k, v - 1); }
					}
				}
			}
			emit({ type: "text-end", id: currentTextId });
			textStarted = false;
		}
		accTextIdx = -1;
	};

	const openStatusReasoning = (label: string) => {
		closeReasoning();
		closeText();
		currentReasoningId = nextId("status");
		emit({ type: "reasoning-start", id: currentReasoningId });
		emit({
			type: "reasoning-delta",
			id: currentReasoningId,
			delta: label,
		});
		reasoningStarted = true;
		statusReasoningActive = true;
		accAppendReasoning(label);
	};

	const emitError = (message: string) => {
		closeReasoning();
		closeText();
		const tid = nextId("text");
		emit({ type: "text-start", id: tid });
		emit({ type: "text-delta", id: tid, delta: `[error] ${message}` });
		emit({ type: "text-end", id: tid });
		accAppendText(`[error] ${message}`);
		accTextIdx = -1; // error text is self-contained
		everSentText = true;
	};

	// ── Parse stdout JSON lines ──

	const rl = createInterface({ input: child.stdout! });
	const parentSessionKey = `agent:main:web:${run.sessionId}`;
	// Prevent unhandled 'error' events on the readline interface.
	// When the child process fails to start (e.g. ENOENT — missing script)
	// the stdout pipe is destroyed and readline re-emits the error.  Without
	// this handler Node.js throws "Unhandled 'error' event" which crashes
	// the API route instead of surfacing a clean message to the user.
	rl.on("error", () => {
		// Swallow — the child 'error' / 'close' handlers take care of
		// emitting user-visible diagnostics.
	});

	// ── Reusable parent event processor ──
	// Handles lifecycle, thinking, assistant text, tool, compaction, and error
	// events for the parent agent. Used by both the CLI NDJSON stream and the
	// subscribe-only CLI fallback (waiting-for-subagents state).

	const processParentEvent = (ev: AgentEvent) => {
		// Lifecycle start
		if (
			ev.event === "agent" &&
			ev.stream === "lifecycle" &&
			ev.data?.phase === "start"
		) {
			openStatusReasoning("Preparing response...");
		}

		// Thinking / reasoning
		if (ev.event === "agent" && ev.stream === "thinking") {
			const delta =
				typeof ev.data?.delta === "string"
					? ev.data.delta
					: undefined;
			if (delta) {
				if (statusReasoningActive) {closeReasoning();}
				if (!reasoningStarted) {
					currentReasoningId = nextId("reasoning");
					emit({
						type: "reasoning-start",
						id: currentReasoningId,
					});
					reasoningStarted = true;
				}
				emit({
					type: "reasoning-delta",
					id: currentReasoningId,
					delta,
				});
				accAppendReasoning(delta);
			}
		}

		// Assistant text
		if (ev.event === "agent" && ev.stream === "assistant") {
			const delta =
				typeof ev.data?.delta === "string"
					? ev.data.delta
					: undefined;
			if (delta) {
				closeReasoning();
				if (!textStarted) {
					currentTextId = nextId("text");
					emit({ type: "text-start", id: currentTextId });
					textStarted = true;
				}
				everSentText = true;
				emit({ type: "text-delta", id: currentTextId, delta });
				accAppendText(delta);
			}
			// Media URLs
			const mediaUrls = ev.data?.mediaUrls;
			if (Array.isArray(mediaUrls)) {
				for (const url of mediaUrls) {
					if (typeof url === "string" && url.trim()) {
						closeReasoning();
						if (!textStarted) {
							currentTextId = nextId("text");
							emit({
								type: "text-start",
								id: currentTextId,
							});
							textStarted = true;
						}
						everSentText = true;
						const md = `\n![media](${url.trim()})\n`;
						emit({
							type: "text-delta",
							id: currentTextId,
							delta: md,
						});
						accAppendText(md);
					}
				}
			}
			// Agent error inline (stopReason=error)
			if (
				typeof ev.data?.stopReason === "string" &&
				ev.data.stopReason === "error" &&
				typeof ev.data?.errorMessage === "string" &&
				!agentErrorReported
			) {
				agentErrorReported = true;
				emitError(parseErrorBody(ev.data.errorMessage));
			}
		}

		// Tool events
		if (ev.event === "agent" && ev.stream === "tool") {
			const phase =
				typeof ev.data?.phase === "string"
					? ev.data.phase
					: undefined;
			const toolCallId =
				typeof ev.data?.toolCallId === "string"
					? ev.data.toolCallId
					: "";
			const toolName =
				typeof ev.data?.name === "string" ? ev.data.name : "";

			if (phase === "start") {
				closeReasoning();
				closeText();
				const args =
					ev.data?.args && typeof ev.data.args === "object"
						? (ev.data.args as Record<string, unknown>)
						: {};
				emit({ type: "tool-input-start", toolCallId, toolName });
				emit({
					type: "tool-input-available",
					toolCallId,
					toolName,
					input: args,
				});
				run.accumulated.parts.push({
					type: "tool-invocation",
					toolCallId,
					toolName,
					args,
				});
				accToolMap.set(toolCallId, run.accumulated.parts.length - 1);
			} else if (phase === "result") {
				const isError = ev.data?.isError === true;
				const result = extractToolResult(ev.data?.result);
				if (isError) {
					const errorText =
						result?.text ||
						(result?.details?.error as string | undefined) ||
						"Tool execution failed";
					emit({
						type: "tool-output-error",
						toolCallId,
						errorText,
					});
					const idx = accToolMap.get(toolCallId);
					if (idx !== undefined) {
						const part = run.accumulated.parts[idx];
						if (part.type === "tool-invocation") {
							part.errorText = errorText;
						}
					}
				} else {
					const output = buildToolOutput(result);
					emit({
						type: "tool-output-available",
						toolCallId,
						output,
					});
					const idx = accToolMap.get(toolCallId);
					if (idx !== undefined) {
						const part = run.accumulated.parts[idx];
						if (part.type === "tool-invocation") {
							part.result = output;
						}
					}
				}
			}
		}

		// Compaction
		if (ev.event === "agent" && ev.stream === "compaction") {
			const phase =
				typeof ev.data?.phase === "string"
					? ev.data.phase
					: undefined;
			if (phase === "start") {
				openStatusReasoning("Optimizing session context...");
			} else if (phase === "end") {
				if (statusReasoningActive) {
					if (ev.data?.willRetry === true) {
						const retryDelta = "\nRetrying with compacted context...";
						emit({
							type: "reasoning-delta",
							id: currentReasoningId,
							delta: retryDelta,
						});
						accAppendReasoning(retryDelta);
					} else {
						closeReasoning();
					}
				}
			}
		}

		// Lifecycle end
		if (
			ev.event === "agent" &&
			ev.stream === "lifecycle" &&
			ev.data?.phase === "end"
		) {
			closeReasoning();
			closeText();
		}

		// Lifecycle error
		if (
			ev.event === "agent" &&
			ev.stream === "lifecycle" &&
			ev.data?.phase === "error" &&
			!agentErrorReported
		) {
			const msg = parseAgentErrorMessage(ev.data);
			if (msg) {
				agentErrorReported = true;
				emitError(msg);
			}
		}

		// Top-level error event
		if (ev.event === "error" && !agentErrorReported) {
			const msg = parseAgentErrorMessage(
				ev.data ??
					(ev as unknown as Record<string, unknown>),
			);
			if (msg) {
				agentErrorReported = true;
				emitError(msg);
			}
		}
	};

	const processParentSubscribeEvent = (ev: AgentEvent) => {
		const gSeq = typeof (ev as Record<string, unknown>).globalSeq === "number"
			? (ev as Record<string, unknown>).globalSeq as number
			: undefined;
		if (gSeq !== undefined) {
			if (gSeq <= run.lastGlobalSeq) {return;}
			run.lastGlobalSeq = gSeq;
		}
		processParentEvent(ev);
		if (ev.stream === "lifecycle" && ev.data?.phase === "end") {
			if (hasRunningSubagentsForParent(run.sessionId)) {
				openStatusReasoning("Waiting for subagent results...");
				flushPersistence(run);
			} else {
				finalizeWaitingRun(run);
			}
		}
	};

	rl.on("line", (line: string) => {
		if (!line.trim()) {return;}

		let ev: AgentEvent;
		try {
			ev = JSON.parse(line) as AgentEvent;
		} catch {
			return;
		}

		// Track the global event cursor from the gateway for replay on handoff.
		const gSeq = typeof (ev as Record<string, unknown>).globalSeq === "number"
			? (ev as Record<string, unknown>).globalSeq as number
			: undefined;
		if (gSeq !== undefined && gSeq > run.lastGlobalSeq) {
			run.lastGlobalSeq = gSeq;
		}

		processParentEvent(ev);
	});

	// ── Child process exit ──

	child.on("close", (code) => {
		// If already finalized (e.g. by abortRun), just record the exit code.
		if (run.status !== "running") {
			run.exitCode = code;
			return;
		}

		if (!agentErrorReported && stderrChunks.length > 0) {
			const stderr = stderrChunks.join("").trim();
			const msg = parseErrorFromStderr(stderr);
			if (msg) {
				agentErrorReported = true;
				emitError(msg);
			}
		}

		closeReasoning();

		const exitedClean = code === 0 || code === null;

		if (!everSentText && !exitedClean) {
			const tid = nextId("text");
			emit({ type: "text-start", id: tid });
			const errMsg = `[error] Agent exited with code ${code}. Check server logs for details.`;
			emit({ type: "text-delta", id: tid, delta: errMsg });
			emit({ type: "text-end", id: tid });
			accAppendText(errMsg);
		} else if (!everSentText && exitedClean) {
			const tid = nextId("text");
			emit({ type: "text-start", id: tid });
			const msg = "No response from agent.";
			emit({ type: "text-delta", id: tid, delta: msg });
			emit({ type: "text-end", id: tid });
			accAppendText(msg);
		} else {
			closeText();
		}

		run.exitCode = code;

		const hasRunningSubagents = hasRunningSubagentsForParent(run.sessionId);

		// If the CLI exited cleanly and subagents are still running,
		// keep the SSE stream open and wait for announcement-triggered
		// parent turns via subscribe-only CLI NDJSON.
		if (exitedClean && hasRunningSubagents) {
			run.status = "waiting-for-subagents";

			openStatusReasoning("Waiting for subagent results...");
			flushPersistence(run);
			startParentSubscribeStream(run, parentSessionKey, processParentSubscribeEvent);
			return;
		}

		// Normal completion path.
		run.status = exitedClean ? "completed" : "error";

		// Final persistence flush (removes _streaming flag).
		flushPersistence(run);

		// Signal completion to all subscribers.
		for (const sub of run.subscribers) {
			try {
				sub(null);
			} catch {
				/* ignore */
			}
		}
		run.subscribers.clear();

		// Clean up run state after a grace period so reconnections
		// within that window still get the buffered events.
		// Guard: only clean up if we're still the active run for this session.
		setTimeout(() => {
			if (activeRuns.get(run.sessionId) === run) {
				cleanupRun(run.sessionId);
			}
		}, CLEANUP_GRACE_MS);
	});

	child.on("error", (err) => {
		// If already finalized (e.g. by abortRun), skip.
		if (run.status !== "running") {return;}

		console.error("[active-runs] Child process error:", err);
		emitError(`Failed to start agent: ${err.message}`);
		run.status = "error";
		flushPersistence(run);
		for (const sub of run.subscribers) {
			try {
				sub(null);
			} catch {
				/* ignore */
			}
		}
		run.subscribers.clear();
		setTimeout(() => {
			if (activeRuns.get(run.sessionId) === run) {
				cleanupRun(run.sessionId);
			}
		}, CLEANUP_GRACE_MS);
	});

	child.stderr?.on("data", (chunk: Buffer) => {
		const text = chunk.toString();
		stderrChunks.push(text);
		console.error("[active-runs stderr]", text);
	});
}

function startParentSubscribeStream(
	run: ActiveRun,
	parentSessionKey: string,
	onEvent: (ev: AgentEvent) => void,
): void {
	stopSubscribeProcess(run);
	const child = spawnAgentSubscribeProcess(parentSessionKey, run.lastGlobalSeq);
	run._subscribeProcess = child;
	const rl = createInterface({ input: child.stdout! });

	rl.on("line", (line: string) => {
		if (!line.trim()) {return;}
		let ev: AgentEvent;
		try {
			ev = JSON.parse(line) as AgentEvent;
		} catch {
			return;
		}
		if (ev.sessionKey && ev.sessionKey !== parentSessionKey) {
			return;
		}
		onEvent(ev);
	});

	child.on("close", () => {
		if (run._subscribeProcess === child) {
			run._subscribeProcess = null;
		}
		if (run.status !== "waiting-for-subagents") {return;}
		// If still waiting, restart subscribe stream from the latest cursor.
		setTimeout(() => {
			if (run.status === "waiting-for-subagents" && !run._subscribeProcess) {
				startParentSubscribeStream(run, parentSessionKey, onEvent);
			}
		}, 300);
	});

	child.on("error", (err) => {
		console.error("[active-runs] Parent subscribe child error:", err);
	});

	child.stderr?.on("data", (chunk: Buffer) => {
		console.error("[active-runs subscribe stderr]", chunk.toString());
	});
}

function stopSubscribeProcess(run: ActiveRun): void {
	if (!run._subscribeProcess) {return;}
	try {
		run._subscribeProcess.kill("SIGTERM");
	} catch {
		/* ignore */
	}
	run._subscribeProcess = null;
}

// ── Finalize a waiting-for-subagents run ──

/**
 * Transition a run from "waiting-for-subagents" to "completed".
 * Called when the last subagent finishes and the parent's announcement-
 * triggered turn completes.
 */
function finalizeWaitingRun(run: ActiveRun): void {
	if (run.status !== "waiting-for-subagents") {return;}

	run.status = "completed";

	stopSubscribeProcess(run);

	flushPersistence(run);

	for (const sub of run.subscribers) {
		try { sub(null); } catch { /* ignore */ }
	}
	run.subscribers.clear();

	setTimeout(() => {
		if (activeRuns.get(run.sessionId) === run) {
			cleanupRun(run.sessionId);
		}
	}, CLEANUP_GRACE_MS);
}

// ── Debounced persistence ──

function schedulePersist(run: ActiveRun) {
	if (run._persistTimer) {return;}
	const elapsed = Date.now() - run._lastPersistedAt;
	const delay = Math.max(0, PERSIST_INTERVAL_MS - elapsed);
	run._persistTimer = setTimeout(() => {
		run._persistTimer = null;
		flushPersistence(run);
	}, delay);
}

function flushPersistence(run: ActiveRun) {
	if (run._persistTimer) {
		clearTimeout(run._persistTimer);
		run._persistTimer = null;
	}
	run._lastPersistedAt = Date.now();

	const parts = run.accumulated.parts;
	if (parts.length === 0) {
		return; // Nothing to persist yet.
	}

	// Filter out leaked silent-reply text fragments before persisting.
	const cleanParts = parts.filter((p) =>
		p.type !== "text" || !isLeakedSilentReplyToken((p as { text: string }).text),
	);

	// Build content text from text parts for the backwards-compatible
	// content field (used when parts are not available).
	const text = cleanParts
		.filter((p): p is { type: "text"; text: string } => p.type === "text")
		.map((p) => p.text)
		.join("");

	const isStillStreaming = run.status === "running" || run.status === "waiting-for-subagents";
	const message: Record<string, unknown> = {
		id: run.accumulated.id,
		role: "assistant",
		content: text,
		parts: cleanParts,
		timestamp: new Date().toISOString(),
	};
	if (isStillStreaming) {
		message._streaming = true;
	}

	try {
		upsertMessage(run.sessionId, message);
	} catch (err) {
		console.error("[active-runs] Persistence error:", err);
	}
}

/**
 * Upsert a single message into the session JSONL.
 * If a line with the same `id` already exists it is replaced; otherwise appended.
 */
function upsertMessage(
	sessionId: string,
	message: Record<string, unknown>,
) {
	ensureDir();
	const fp = join(webChatDir(), `${sessionId}.jsonl`);
	if (!existsSync(fp)) {writeFileSync(fp, "");}

	const msgId = message.id as string;
	const content = readFileSync(fp, "utf-8");
	const lines = content.split("\n").filter((l) => l.trim());

	let found = false;
	const updated = lines.map((line) => {
		try {
			const parsed = JSON.parse(line);
			if (parsed.id === msgId) {
				found = true;
				return JSON.stringify(message);
			}
		} catch {
			/* keep as-is */
		}
		return line;
	});

	if (!found) {
		updated.push(JSON.stringify(message));
		updateIndex(sessionId, { incrementCount: 1 });
	} else {
		updateIndex(sessionId, {});
	}

	writeFileSync(fp, updated.join("\n") + "\n");
}

function cleanupRun(sessionId: string) {
	const run = activeRuns.get(sessionId);
	if (!run) {return;}
	if (run._persistTimer) {clearTimeout(run._persistTimer);}
	stopSubscribeProcess(run);
	activeRuns.delete(sessionId);
}
