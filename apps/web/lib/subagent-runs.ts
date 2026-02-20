/**
 * Server-side manager for subagent runs spawned by the web chat agent.
 *
 * Mirrors the ActiveRunManager pattern: buffers SSE events, supports
 * subscriber fan-out, and tracks subagent metadata per parent web session.
 *
 * Events are fed from the gateway WebSocket connection (gateway-events.ts).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import {
	extractToolResult,
	buildToolOutput,
	parseAgentErrorMessage,
	parseErrorBody,
} from "./agent-runner";
import { subscribeToSessionKey, type GatewayEvent } from "./gateway-events";
import { resolveOpenClawStateDir, resolveWebChatDir } from "./workspace";

// ── Types ──

export type SseEvent = Record<string, unknown> & { type: string };
export type SubagentSubscriber = (event: SseEvent | null) => void;

export type SubagentInfo = {
	sessionKey: string;
	runId: string;
	parentWebSessionId: string;
	task: string;
	label?: string;
	status: "running" | "completed" | "error";
	startedAt: number;
	endedAt?: number;
};

type SubagentRun = SubagentInfo & {
	eventBuffer: SseEvent[];
	subscribers: Set<SubagentSubscriber>;
	/** Internal state for event-to-SSE transformation */
	_state: TransformState;
	_unsubGateway: (() => void) | null;
	_cleanupTimer: ReturnType<typeof setTimeout> | null;
};

type TransformState = {
	idCounter: number;
	currentTextId: string;
	currentReasoningId: string;
	textStarted: boolean;
	reasoningStarted: boolean;
	everSentText: boolean;
	statusReasoningActive: boolean;
};

// ── Constants ──

const CLEANUP_GRACE_MS = 24 * 60 * 60_000; // 24 hours — events are persisted to disk
const GLOBAL_KEY = "__openclaw_subagentRuns" as const;

// ── Singleton registry ──

type SubagentRegistry = {
	runs: Map<string, SubagentRun>;
	/** Reverse index: parent web session ID → subagent session keys */
	parentIndex: Map<string, Set<string>>;
	/** Pre-registration buffer: events that arrive before the subagent is registered */
	preRegBuffer: Map<string, GatewayEvent[]>;
};

function getRegistry(): SubagentRegistry {
	const existing = (globalThis as Record<string, unknown>)[GLOBAL_KEY] as
		| SubagentRegistry
		| undefined;
	if (existing) {return existing;}

	const registry: SubagentRegistry = {
		runs: new Map(),
		parentIndex: new Map(),
		preRegBuffer: new Map(),
	};
	(globalThis as Record<string, unknown>)[GLOBAL_KEY] = registry;
	return registry;
}

// ── Event persistence ──

/** Profile-scoped directory for subagent event JSONL files. */
function subagentEventsDir(): string {
	return join(resolveWebChatDir(), "subagent-events");
}

/** Pre-profile-scoping legacy path — used as a read fallback for migration. */
function legacySubagentEventsDir(): string {
	return join(resolveOpenClawStateDir(), "web-chat", "subagent-events");
}

/** Filesystem-safe filename derived from a session key. */
function safeFilename(sessionKey: string): string {
	return sessionKey.replaceAll(":", "_") + ".jsonl";
}

function persistEvent(sessionKey: string, event: SseEvent): void {
	try {
		const dir = subagentEventsDir();
		mkdirSync(dir, { recursive: true });
		appendFileSync(join(dir, safeFilename(sessionKey)), JSON.stringify(event) + "\n");
	} catch { /* best-effort */ }
}

function loadPersistedEvents(sessionKey: string): SseEvent[] {
	const fname = safeFilename(sessionKey);

	// Try profile-scoped dir first, fall back to legacy shared dir.
	let filePath = join(subagentEventsDir(), fname);
	if (!existsSync(filePath)) {
		const legacyPath = join(legacySubagentEventsDir(), fname);
		if (existsSync(legacyPath)) {
			filePath = legacyPath;
		} else {
			return [];
		}
	}

	try {
		const lines = readFileSync(filePath, "utf-8").split("\n");
		const events: SseEvent[] = [];
		for (const line of lines) {
			if (!line.trim()) {continue;}
			try { events.push(JSON.parse(line) as SseEvent); } catch { /* skip */ }
		}
		return events;
	} catch { return []; }
}

// ── Profile-scoped subagent index ──

type SubagentIndexEntry = {
	runId: string;
	parentWebSessionId: string;
	task: string;
	label?: string;
	status: "running" | "completed" | "error";
	startedAt: number;
	endedAt?: number;
};

function subagentIndexPath(): string {
	return join(resolveWebChatDir(), "subagent-index.json");
}

function loadSubagentIndex(): Record<string, SubagentIndexEntry> {
	const p = subagentIndexPath();
	if (!existsSync(p)) {return {};}
	try {
		return JSON.parse(readFileSync(p, "utf-8")) as Record<string, SubagentIndexEntry>;
	} catch { return {}; }
}

function upsertSubagentIndex(sessionKey: string, entry: SubagentIndexEntry): void {
	try {
		const dir = resolveWebChatDir();
		mkdirSync(dir, { recursive: true });
		const index = loadSubagentIndex();
		index[sessionKey] = entry;
		writeFileSync(subagentIndexPath(), JSON.stringify(index, null, 2));
	} catch { /* best-effort */ }
}

/** Read the on-disk registry entry and derive the proper status. */
function readDiskStatus(sessionKey: string): "running" | "completed" | "error" {
	// Check profile-scoped index first.
	const profileIndex = loadSubagentIndex();
	const profileEntry = profileIndex[sessionKey];
	if (profileEntry) {
		return profileEntry.status;
	}

	// Fall back to the shared gateway registry.
	const registryPath = join(resolveOpenClawStateDir(), "subagents", "runs.json");
	if (!existsSync(registryPath)) {return "running";}
	try {
		const raw = JSON.parse(readFileSync(registryPath, "utf-8"));
		const runs = raw?.runs;
		if (!runs || typeof runs !== "object") {return "running";}
		for (const entry of Object.values(runs)) {
			if (entry.childSessionKey === sessionKey) {
				if (typeof entry.endedAt !== "number") {return "running";}
				const outcome = entry.outcome as { status?: string } | undefined;
				if (outcome?.status === "error") {return "error";}
				return "completed";
			}
		}
	} catch { /* ignore */ }
	return "running";
}

// ── Public API ──

/**
 * Register a newly spawned subagent. Called when the parent agent's
 * `sessions_spawn` tool result is detected in active-runs.ts.
 *
 * When `fromDisk` is true, the run is being rehydrated after a refresh,
 * so we load persisted events and set the correct status from the registry.
 */
export function registerSubagent(
	parentWebSessionId: string,
	info: { sessionKey: string; runId: string; task: string; label?: string },
	options?: { fromDisk?: boolean },
): void {
	const reg = getRegistry();

	// Avoid duplicate registration
	if (reg.runs.has(info.sessionKey)) {return;}

	const fromDisk = options?.fromDisk ?? false;
	const diskStatus = fromDisk ? readDiskStatus(info.sessionKey) : "running";

	const run: SubagentRun = {
		sessionKey: info.sessionKey,
		runId: info.runId,
		parentWebSessionId,
		task: info.task,
		label: info.label,
		status: diskStatus,
		startedAt: Date.now(),
		eventBuffer: [],
		subscribers: new Set(),
		_state: createTransformState(),
		_unsubGateway: null,
		_cleanupTimer: null,
	};

	// Load persisted events from disk (fills the replay buffer)
	if (fromDisk) {
		run.eventBuffer = loadPersistedEvents(info.sessionKey);
	}

	reg.runs.set(info.sessionKey, run);

	// Update parent index
	let keys = reg.parentIndex.get(parentWebSessionId);
	if (!keys) {
		keys = new Set();
		reg.parentIndex.set(parentWebSessionId, keys);
	}
	keys.add(info.sessionKey);

	// Persist to the profile-scoped subagent index.
	upsertSubagentIndex(info.sessionKey, {
		runId: info.runId,
		parentWebSessionId,
		task: info.task,
		label: info.label,
		status: run.status,
		startedAt: run.startedAt,
		endedAt: run.endedAt,
	});

	// NOTE: We do NOT subscribe to gateway WebSocket here. During live
	// streaming, events arrive via routeRawEvent() from the parent's NDJSON
	// stream. After the parent exits, activateGatewayFallback() subscribes.
	// For on-demand rehydration (page refresh), ensureSubagentStreamable()
	// handles the subscription.

	// Replay any pre-registration buffered events (live sessions only)
	const buf = reg.preRegBuffer.get(info.sessionKey);
	if (buf && buf.length > 0) {
		for (const evt of buf) {
			handleGatewayEvent(run, evt);
		}
		reg.preRegBuffer.delete(info.sessionKey);
	}
}

/**
 * Ensure a rehydrated subagent can receive live events. Called when a client
 * actually connects to the subagent's SSE stream after a page refresh.
 * For still-running subagents, this activates the gateway WebSocket fallback.
 */
export function ensureSubagentStreamable(sessionKey: string): void {
	const run = getRegistry().runs.get(sessionKey);
	if (!run || run.status !== "running" || run._unsubGateway) {return;}
	run._unsubGateway = subscribeToSessionKey(sessionKey, (evt) => {
		handleGatewayEvent(run, evt);
	});
}

/** Get metadata for all subagents belonging to a parent web session. */
export function getSubagentsForSession(parentWebSessionId: string): SubagentInfo[] {
	const reg = getRegistry();
	const keys = reg.parentIndex.get(parentWebSessionId);
	if (!keys) {return [];}

	const result: SubagentInfo[] = [];
	for (const key of keys) {
		const run = reg.runs.get(key);
		if (run) {
			result.push({
				sessionKey: run.sessionKey,
				runId: run.runId,
				parentWebSessionId: run.parentWebSessionId,
				task: run.task,
				label: run.label,
				status: run.status,
				startedAt: run.startedAt,
				endedAt: run.endedAt,
			});
		}
	}
	return result;
}

/**
 * Subscribe to a subagent's SSE events. Replays buffered events first
 * (synchronously), then live events follow.
 */
export function subscribeToSubagent(
	sessionKey: string,
	callback: SubagentSubscriber,
	options?: { replay?: boolean },
): (() => void) | null {
	const reg = getRegistry();
	const run = reg.runs.get(sessionKey);
	if (!run) {return null;}

	const replay = options?.replay ?? true;
	if (replay) {
		for (const event of run.eventBuffer) {
			callback(event);
		}
	}

	if (run.status !== "running") {
		callback(null);
		return () => {};
	}

	run.subscribers.add(callback);
	return () => {
		run.subscribers.delete(callback);
	};
}

/** Check if a subagent run exists (running or completed with buffered data). */
export function hasActiveSubagent(sessionKey: string): boolean {
	return getRegistry().runs.has(sessionKey);
}

/** Check if a subagent is currently running (not yet completed). */
export function isSubagentRunning(sessionKey: string): boolean {
	const run = getRegistry().runs.get(sessionKey);
	return run !== undefined && run.status === "running";
}

/**
 * Activate gateway WebSocket subscriptions for all subagent runs that are
 * still in "running" status and don't already have a gateway subscription.
 *
 * Called when the parent agent's NDJSON stream ends (child process exits).
 * After that point the NDJSON routing is no longer available, so the
 * gateway WS becomes the only event source for orphaned subagents.
 */
export function activateGatewayFallback(): void {
	const reg = getRegistry();
	for (const [key, run] of reg.runs) {
		if (run.status === "running" && !run._unsubGateway) {
			run._unsubGateway = subscribeToSessionKey(key, (evt) => {
				handleGatewayEvent(run, evt);
			});
		}
	}
}

/** Return session keys of all currently running subagents. */
export function getRunningSubagentKeys(): string[] {
	const keys: string[] = [];
	for (const [key, run] of getRegistry().runs) {
		if (run.status === "running") {
			keys.push(key);
		}
	}
	return keys;
}

/**
 * Route a raw NDJSON agent event (from the CLI child process stdout) to the
 * appropriate subagent run.  This is the primary event source -- the parent
 * agent's CLI process already receives all gateway broadcasts, so we piggyback
 * on its NDJSON stream instead of maintaining a separate WebSocket connection.
 *
 * Converts the flat NDJSON event shape to the nested GatewayEvent format that
 * handleGatewayEvent expects.
 */
export function routeRawEvent(
	sessionKey: string,
	ev: { event: string; stream?: string; data?: Record<string, unknown> },
): void {
	const gwEvt: GatewayEvent = {
		event: ev.event,
		payload: { sessionKey, stream: ev.stream, data: ev.data },
	};

	const run = getRegistry().runs.get(sessionKey);
	if (run) {
		handleGatewayEvent(run, gwEvt);
		return;
	}

	// Buffer events that arrive before the subagent is registered
	// (runs.json may not be written yet). These are replayed on registration.
	const reg = getRegistry();
	let buf = reg.preRegBuffer.get(sessionKey);
	if (!buf) {
		buf = [];
		reg.preRegBuffer.set(sessionKey, buf);
	}
	if (buf.length < 10_000) {
		buf.push(gwEvt);
	}
}

/**
 * Lazily register a subagent by reading the on-disk registries.
 * Checks the profile-scoped subagent-index.json first, then falls back
 * to the shared gateway registry (~/.openclaw/subagents/runs.json).
 * Returns true if the subagent was found and registered (or already registered).
 */
export function ensureRegisteredFromDisk(
	sessionKey: string,
	parentWebSessionId: string,
): boolean {
	if (getRegistry().runs.has(sessionKey)) {return true;}

	// 1. Check profile-scoped index.
	const profileIndex = loadSubagentIndex();
	const profileEntry = profileIndex[sessionKey];
	if (profileEntry) {
		registerSubagent(profileEntry.parentWebSessionId || parentWebSessionId, {
			sessionKey,
			runId: profileEntry.runId,
			task: profileEntry.task,
			label: profileEntry.label,
		}, { fromDisk: true });
		return true;
	}

	// 2. Fall back to the shared gateway registry.
	const registryPath = join(resolveOpenClawStateDir(), "subagents", "runs.json");
	if (!existsSync(registryPath)) {return false;}

	try {
		const raw = JSON.parse(readFileSync(registryPath, "utf-8"));
		const runs = raw?.runs;
		if (!runs || typeof runs !== "object") {return false;}

		for (const entry of Object.values(runs)) {
			if (entry.childSessionKey === sessionKey) {
				registerSubagent(parentWebSessionId, {
					sessionKey,
					runId: typeof entry.runId === "string" ? entry.runId : "",
					task: typeof entry.task === "string" ? entry.task : "",
					label: typeof entry.label === "string" ? entry.label : undefined,
				}, { fromDisk: true });
				return true;
			}
		}
	} catch { /* ignore */ }

	return false;
}

// ── Event transformation (gateway event → SSE events) ──

function createTransformState(): TransformState {
	return {
		idCounter: 0,
		currentTextId: "",
		currentReasoningId: "",
		textStarted: false,
		reasoningStarted: false,
		everSentText: false,
		statusReasoningActive: false,
	};
}

function handleGatewayEvent(run: SubagentRun, evt: GatewayEvent): void {
	if (evt.event !== "agent" || !evt.payload) {return;}

	const payload = evt.payload;
	const stream = typeof payload.stream === "string" ? payload.stream : undefined;
	const data =
		payload.data && typeof payload.data === "object"
			? (payload.data as Record<string, unknown>)
			: undefined;

	if (!stream || !data) {return;}

	const st = run._state;
	const nextId = (prefix: string) => `${prefix}-${Date.now()}-${++st.idCounter}`;

	const emit = (event: SseEvent) => {
		run.eventBuffer.push(event);
		persistEvent(run.sessionKey, event);
		for (const sub of run.subscribers) {
			try { sub(event); } catch { /* ignore */ }
		}
	};

	const closeReasoning = () => {
		if (st.reasoningStarted) {
			emit({ type: "reasoning-end", id: st.currentReasoningId });
			st.reasoningStarted = false;
			st.statusReasoningActive = false;
		}
	};

	const closeText = () => {
		if (st.textStarted) {
			emit({ type: "text-end", id: st.currentTextId });
			st.textStarted = false;
		}
	};

	const openStatusReasoning = (label: string) => {
		closeReasoning();
		closeText();
		st.currentReasoningId = nextId("status");
		emit({ type: "reasoning-start", id: st.currentReasoningId });
		emit({ type: "reasoning-delta", id: st.currentReasoningId, delta: label });
		st.reasoningStarted = true;
		st.statusReasoningActive = true;
	};

	const emitError = (message: string) => {
		closeReasoning();
		closeText();
		const tid = nextId("text");
		emit({ type: "text-start", id: tid });
		emit({ type: "text-delta", id: tid, delta: `[error] ${message}` });
		emit({ type: "text-end", id: tid });
		st.everSentText = true;
	};

	// Lifecycle start
	if (stream === "lifecycle" && data.phase === "start") {
		openStatusReasoning("Preparing response...");
	}

	// Thinking / reasoning
	if (stream === "thinking") {
		const delta = typeof data.delta === "string" ? data.delta : undefined;
		if (delta) {
			if (st.statusReasoningActive) {closeReasoning();}
			if (!st.reasoningStarted) {
				st.currentReasoningId = nextId("reasoning");
				emit({ type: "reasoning-start", id: st.currentReasoningId });
				st.reasoningStarted = true;
			}
			emit({ type: "reasoning-delta", id: st.currentReasoningId, delta });
		}
	}

	// Assistant text
	if (stream === "assistant") {
		const delta = typeof data.delta === "string" ? data.delta : undefined;
		if (delta) {
			closeReasoning();
			if (!st.textStarted) {
				st.currentTextId = nextId("text");
				emit({ type: "text-start", id: st.currentTextId });
				st.textStarted = true;
			}
			st.everSentText = true;
			emit({ type: "text-delta", id: st.currentTextId, delta });
		}
		// Inline error
		if (
			typeof data.stopReason === "string" &&
			data.stopReason === "error" &&
			typeof data.errorMessage === "string"
		) {
			emitError(parseErrorBody(data.errorMessage));
		}
	}

	// Tool events
	if (stream === "tool") {
		const phase = typeof data.phase === "string" ? data.phase : undefined;
		const toolCallId = typeof data.toolCallId === "string" ? data.toolCallId : "";
		const toolName = typeof data.name === "string" ? data.name : "";

		if (phase === "start") {
			closeReasoning();
			closeText();
			const args =
				data.args && typeof data.args === "object"
					? (data.args as Record<string, unknown>)
					: {};
			emit({ type: "tool-input-start", toolCallId, toolName });
			emit({ type: "tool-input-available", toolCallId, toolName, input: args });
		} else if (phase === "result") {
			const isError = data.isError === true;
			const result = extractToolResult(data.result);
			if (isError) {
				const errorText =
					result?.text ||
					(result?.details?.error as string | undefined) ||
					"Tool execution failed";
				emit({ type: "tool-output-error", toolCallId, errorText });
			} else {
				const output = buildToolOutput(result);
				emit({ type: "tool-output-available", toolCallId, output });
			}
		}
	}

	// Compaction
	if (stream === "compaction") {
		const phase = typeof data.phase === "string" ? data.phase : undefined;
		if (phase === "start") {
			openStatusReasoning("Optimizing session context...");
		} else if (phase === "end") {
			if (st.statusReasoningActive) {
				if (data.willRetry === true) {
					emit({
						type: "reasoning-delta",
						id: st.currentReasoningId,
						delta: "\nRetrying with compacted context...",
					});
				} else {
					closeReasoning();
				}
			}
		}
	}

	// Lifecycle end → mark run completed
	if (stream === "lifecycle" && data.phase === "end") {
		closeReasoning();
		closeText();
		finalizeRun(run, "completed");
	}

	// Lifecycle error
	if (stream === "lifecycle" && data.phase === "error") {
		const msg = parseAgentErrorMessage(data);
		if (msg) {emitError(msg);}
		finalizeRun(run, "error");
	}
}

function finalizeRun(run: SubagentRun, status: "completed" | "error"): void {
	if (run.status !== "running") {return;}

	run.status = status;
	run.endedAt = Date.now();

	// Update the profile-scoped subagent index with final status.
	upsertSubagentIndex(run.sessionKey, {
		runId: run.runId,
		parentWebSessionId: run.parentWebSessionId,
		task: run.task,
		label: run.label,
		status: run.status,
		startedAt: run.startedAt,
		endedAt: run.endedAt,
	});

	// Signal completion to all subscribers
	for (const sub of run.subscribers) {
		try { sub(null); } catch { /* ignore */ }
	}
	run.subscribers.clear();

	// Unsubscribe from gateway events
	run._unsubGateway?.();
	run._unsubGateway = null;

	// Schedule cleanup after grace period
	run._cleanupTimer = setTimeout(() => {
		cleanupRun(run.sessionKey);
	}, CLEANUP_GRACE_MS);
}

function cleanupRun(sessionKey: string): void {
	const reg = getRegistry();
	const run = reg.runs.get(sessionKey);
	if (!run) {return;}

	if (run._cleanupTimer) {
		clearTimeout(run._cleanupTimer);
		run._cleanupTimer = null;
	}
	run._unsubGateway?.();
	reg.runs.delete(sessionKey);

	// Clean up parent index
	const keys = reg.parentIndex.get(run.parentWebSessionId);
	if (keys) {
		keys.delete(sessionKey);
		if (keys.size === 0) {
			reg.parentIndex.delete(run.parentWebSessionId);
		}
	}
}
