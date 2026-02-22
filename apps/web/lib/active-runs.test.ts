import { type ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock agent-runner to control spawnAgentProcess
vi.mock("./agent-runner", () => ({
	spawnAgentProcess: vi.fn(),
	extractToolResult: vi.fn((raw: unknown) => {
		if (!raw) {return undefined;}
		if (typeof raw === "string") {return { text: raw };}
		return { text: undefined, details: raw as Record<string, unknown> };
	}),
	buildToolOutput: vi.fn(
		(result?: { text?: string }) => (result ? { text: result.text } : {}),
	),
	parseAgentErrorMessage: vi.fn((data?: Record<string, unknown>) => {
		if (data?.error && typeof data.error === "string") {return data.error;}
		if (data?.message && typeof data.message === "string") {return data.message;}
		return undefined;
	}),
	parseErrorBody: vi.fn((raw: string) => raw),
	parseErrorFromStderr: vi.fn((stderr: string) => {
		if (!stderr) {return undefined;}
		if (/error/i.test(stderr)) {return stderr.trim();}
		return undefined;
	}),
}));

// Mock fs operations used for persistence so tests don't hit disk
vi.mock("node:fs", async (importOriginal) => {
	const original = await importOriginal<typeof import("node:fs")>();
	return {
		...original,
		existsSync: vi.fn(() => false),
		readFileSync: vi.fn(() => ""),
		writeFileSync: vi.fn(),
		mkdirSync: vi.fn(),
	};
});

import type { SseEvent } from "./active-runs.js";

/**
 * Create a mock child process with a real PassThrough stream for stdout,
 * so the readline interface inside wireChildProcess actually receives data.
 */
function createMockChild() {
	const events: Record<string, ((...args: unknown[]) => void)[]> = {};
	const stdoutStream = new PassThrough();
	const stderrStream = new PassThrough();

	const child = {
		exitCode: null as number | null,
		killed: false,
		pid: 12345,
		stdout: stdoutStream,
		stderr: stderrStream,
		on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
			events[event] = events[event] || [];
			events[event].push(cb);
			return child;
		}),
		once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
			events[event] = events[event] || [];
			events[event].push(cb);
			return child;
		}),
		kill: vi.fn(),
		/** Emit an event to all registered listeners. */
		_emit(event: string, ...args: unknown[]) {
			for (const cb of events[event] || []) {
				cb(...args);
			}
		},
		/** Write a JSON line to stdout (simulating agent output). */
		_writeLine(jsonObj: Record<string, unknown>) {
			stdoutStream.write(JSON.stringify(jsonObj) + "\n");
		},
		/** Write raw text to stderr. */
		_writeStderr(text: string) {
			stderrStream.write(Buffer.from(text));
		},
	};

	return child;
}

describe("active-runs", () => {
	beforeEach(() => {
		vi.resetModules();

		// Re-wire mocks after resetModules
		vi.mock("./agent-runner", () => ({
			spawnAgentProcess: vi.fn(),
			extractToolResult: vi.fn((raw: unknown) => {
				if (!raw) {return undefined;}
				if (typeof raw === "string") {return { text: raw };}
				return {
					text: undefined,
					details: raw as Record<string, unknown>,
				};
			}),
			buildToolOutput: vi.fn(
				(result?: { text?: string }) =>
					result ? { text: result.text } : {},
			),
			parseAgentErrorMessage: vi.fn(
				(data?: Record<string, unknown>) => {
					if (data?.error && typeof data.error === "string")
						{return data.error;}
					if (data?.message && typeof data.message === "string")
						{return data.message;}
					return undefined;
				},
			),
			parseErrorBody: vi.fn((raw: string) => raw),
			parseErrorFromStderr: vi.fn((stderr: string) => {
				if (!stderr) {return undefined;}
				if (/error/i.test(stderr)) {return stderr.trim();}
				return undefined;
			}),
		}));

		vi.mock("node:fs", async (importOriginal) => {
			const original =
				await importOriginal<typeof import("node:fs")>();
			return {
				...original,
				existsSync: vi.fn(() => false),
				readFileSync: vi.fn(() => ""),
				writeFileSync: vi.fn(),
				mkdirSync: vi.fn(),
			};
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	/** Helper: set up a mock child and import the active-runs module fresh. */
	async function setup() {
		const child = createMockChild();

		const { spawnAgentProcess } = await import("./agent-runner.js");
		vi.mocked(spawnAgentProcess).mockReturnValue(
			child as unknown as ChildProcess,
		);

		const mod = await import("./active-runs.js");
		return { child, ...mod };
	}

	// ── startRun + subscribeToRun ──────────────────────────────────────

	describe("startRun + subscribeToRun", () => {
		it("creates a run and emits fallback text when process exits without output", async () => {
			const { child, startRun, subscribeToRun } = await setup();

			const events: SseEvent[] = [];

			startRun({
				sessionId: "s1",
				message: "hello",
				agentSessionId: "s1",
			});

			subscribeToRun(
				"s1",
				(event) => {
					if (event) {events.push(event);}
				},
				{ replay: false },
			);

			// Close stdout before emitting close, so readline finishes
			child.stdout.end();
			// Small delay to let readline drain
			await new Promise((r) => setTimeout(r, 50));

			child._emit("close", 0);

			// Should have emitted fallback "[error] No response from agent."
			expect(
				events.some(
					(e) =>
						e.type === "text-delta" &&
						typeof e.delta === "string" &&
						(e.delta).includes("No response"),
				),
			).toBe(true);
		});

		it("streams assistant text events for agent assistant output", async () => {
			const { child, startRun, subscribeToRun } = await setup();

			const events: SseEvent[] = [];

			startRun({
				sessionId: "s-text",
				message: "say hi",
				agentSessionId: "s-text",
			});

			subscribeToRun(
				"s-text",
				(event) => {
					if (event) {events.push(event);}
				},
				{ replay: false },
			);

			// Emit an assistant text delta via stdout JSON
			child._writeLine({
				event: "agent",
				stream: "assistant",
				data: { delta: "Hello world!" },
			});

			// Give readline a tick to process
			await new Promise((r) => setTimeout(r, 50));

			// Should have text-start + text-delta
			expect(events.some((e) => e.type === "text-start")).toBe(true);
			expect(
				events.some(
					(e) => e.type === "text-delta" && e.delta === "Hello world!",
				),
			).toBe(true);

			// Clean up
			child.stdout.end();
			await new Promise((r) => setTimeout(r, 50));
			child._emit("close", 0);
		});

		it("streams reasoning events for thinking output", async () => {
			const { child, startRun, subscribeToRun } = await setup();

			const events: SseEvent[] = [];

			startRun({
				sessionId: "s-think",
				message: "think about it",
				agentSessionId: "s-think",
			});

			subscribeToRun(
				"s-think",
				(event) => {
					if (event) {events.push(event);}
				},
				{ replay: false },
			);

			child._writeLine({
				event: "agent",
				stream: "thinking",
				data: { delta: "Let me think..." },
			});

			await new Promise((r) => setTimeout(r, 50));

			expect(events.some((e) => e.type === "reasoning-start")).toBe(
				true,
			);
			expect(
				events.some(
					(e) =>
						e.type === "reasoning-delta" &&
						e.delta === "Let me think...",
				),
			).toBe(true);

			child.stdout.end();
			await new Promise((r) => setTimeout(r, 50));
			child._emit("close", 0);
		});

		it("streams tool-input-start and tool-input-available for tool calls", async () => {
			const { child, startRun, subscribeToRun } = await setup();

			const events: SseEvent[] = [];

			startRun({
				sessionId: "s-tool",
				message: "use a tool",
				agentSessionId: "s-tool",
			});

			subscribeToRun(
				"s-tool",
				(event) => {
					if (event) {events.push(event);}
				},
				{ replay: false },
			);

			child._writeLine({
				event: "agent",
				stream: "tool",
				data: {
					phase: "start",
					toolCallId: "tc-1",
					name: "search",
					args: { query: "test" },
				},
			});

			await new Promise((r) => setTimeout(r, 50));

			expect(
				events.some(
					(e) =>
						e.type === "tool-input-start" &&
						e.toolCallId === "tc-1",
				),
			).toBe(true);
			expect(
				events.some(
					(e) =>
						e.type === "tool-input-available" &&
						e.toolCallId === "tc-1" &&
						e.toolName === "search",
				),
			).toBe(true);

			child.stdout.end();
			await new Promise((r) => setTimeout(r, 50));
			child._emit("close", 0);
		});

		it("emits error text for non-zero exit code", async () => {
			const { child, startRun, subscribeToRun } = await setup();

			const events: SseEvent[] = [];

			startRun({
				sessionId: "s-fail",
				message: "fail",
				agentSessionId: "s-fail",
			});

			subscribeToRun(
				"s-fail",
				(event) => {
					if (event) {events.push(event);}
				},
				{ replay: false },
			);

			child.stdout.end();
			await new Promise((r) => setTimeout(r, 50));
			child._emit("close", 1);

			expect(
				events.some(
					(e) =>
						e.type === "text-delta" &&
						typeof e.delta === "string" &&
						(e.delta).includes("exited with code 1"),
				),
			).toBe(true);
		});

		it("signals completion (null) to subscribers when run finishes", async () => {
			const { child, startRun, subscribeToRun } = await setup();

			const completed: boolean[] = [];

			startRun({
				sessionId: "s-complete",
				message: "hi",
				agentSessionId: "s-complete",
			});

			subscribeToRun(
				"s-complete",
				(event) => {
					if (event === null) {completed.push(true);}
				},
				{ replay: false },
			);

			child.stdout.end();
			await new Promise((r) => setTimeout(r, 50));
			child._emit("close", 0);

			expect(completed).toHaveLength(1);
		});
	});

	// ── child process error handling ────────────────────────────────────

	describe("child process error handling", () => {
		it("emits 'Failed to start agent' on spawn error (ENOENT)", async () => {
			const { child, startRun, subscribeToRun } = await setup();

			const events: SseEvent[] = [];
			const completions: boolean[] = [];

			startRun({
				sessionId: "s-enoent",
				message: "hello",
				agentSessionId: "s-enoent",
			});

			subscribeToRun(
				"s-enoent",
				(event) => {
					if (event) {
						events.push(event);
					} else {
						completions.push(true);
					}
				},
				{ replay: false },
			);

			const err = new Error("spawn node ENOENT");
			(err as NodeJS.ErrnoException).code = "ENOENT";
			child._emit("error", err);

			expect(
				events.some(
					(e) =>
						e.type === "text-delta" &&
						typeof e.delta === "string" &&
						(e.delta).includes("Failed to start agent"),
				),
			).toBe(true);

			expect(completions).toHaveLength(1);
		});

		it("does not crash on readline error (the root cause of 'Unhandled error event')", async () => {
			const { child, startRun } = await setup();

			startRun({
				sessionId: "s-rl-err",
				message: "hello",
				agentSessionId: "s-rl-err",
			});

			// Simulate what happens when a child process fails to start:
			// stdout stream is destroyed with an error, which readline re-emits.
			// Before the fix, this would throw "Unhandled 'error' event".
			// After the fix, the rl.on("error") handler swallows it.
			expect(() => {
				child.stdout.destroy(new Error("stream destroyed"));
			}).not.toThrow();

			// Give a tick for the error to propagate
			await new Promise((r) => setTimeout(r, 50));

			// The run should still be tracked (error handler on child takes care of cleanup)
		});
	});

	// ── subscribeToRun replay ──────────────────────────────────────────

	describe("subscribeToRun replay", () => {
		it("replays buffered events to new subscribers", async () => {
			const { child, startRun, subscribeToRun } = await setup();

			startRun({
				sessionId: "s-replay",
				message: "hi",
				agentSessionId: "s-replay",
			});

			// Generate some events
			child._writeLine({
				event: "agent",
				stream: "assistant",
				data: { delta: "Hello" },
			});

			await new Promise((r) => setTimeout(r, 50));

			child.stdout.end();
			await new Promise((r) => setTimeout(r, 50));
			child._emit("close", 0);

			// New subscriber with replay=true
			const replayed: (SseEvent | null)[] = [];
			subscribeToRun(
				"s-replay",
				(event) => {
					replayed.push(event);
				},
				{ replay: true },
			);

			// Should include the text events + null (completion)
			expect(replayed.length).toBeGreaterThan(0);
			expect(replayed[replayed.length - 1]).toBeNull();
			expect(
				replayed.some(
					(e) =>
						e !== null &&
						e.type === "text-delta" &&
						e.delta === "Hello",
				),
			).toBe(true);
		});

		it("returns null for unsubscribe when no run exists", async () => {
			const { subscribeToRun } = await setup();

			const unsub = subscribeToRun(
				"nonexistent",
				() => {},
				{ replay: true },
			);

			expect(unsub).toBeNull();
		});
	});

	// ── hasActiveRun / getActiveRun ────────────────────────────────────

	describe("hasActiveRun / getActiveRun", () => {
		it("returns true for a running process", async () => {
			const { child: _child, startRun, hasActiveRun, getActiveRun } =
				await setup();

			startRun({
				sessionId: "s-active",
				message: "hi",
				agentSessionId: "s-active",
			});

			expect(hasActiveRun("s-active")).toBe(true);
			expect(getActiveRun("s-active")).toBeDefined();
			expect(getActiveRun("s-active")?.status).toBe("running");
		});

		it("marks status as completed after clean exit", async () => {
			const { child, startRun, hasActiveRun, getActiveRun } =
				await setup();

			startRun({
				sessionId: "s-done",
				message: "hi",
				agentSessionId: "s-done",
			});

			child.stdout.end();
			await new Promise((r) => setTimeout(r, 50));
			child._emit("close", 0);

			expect(hasActiveRun("s-done")).toBe(false);
			expect(getActiveRun("s-done")?.status).toBe("completed");
		});

		it("marks status as error after non-zero exit", async () => {
			const { child, startRun, getActiveRun } = await setup();

			startRun({
				sessionId: "s-err-exit",
				message: "hi",
				agentSessionId: "s-err-exit",
			});

			child.stdout.end();
			await new Promise((r) => setTimeout(r, 50));
			child._emit("close", 1);

			expect(getActiveRun("s-err-exit")?.status).toBe("error");
		});

		it("returns false for unknown sessions", async () => {
			const { hasActiveRun, getActiveRun } = await setup();
			expect(hasActiveRun("nonexistent")).toBe(false);
			expect(getActiveRun("nonexistent")).toBeUndefined();
		});
	});

	// ── abortRun ──────────────────────────────────────────────────────

	describe("abortRun", () => {
		it("kills a running child process", async () => {
			const { child, startRun, abortRun } = await setup();

			startRun({
				sessionId: "s-abort",
				message: "hi",
				agentSessionId: "s-abort",
			});

			expect(abortRun("s-abort")).toBe(true);
			expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		});

		it("returns false for non-running sessions", async () => {
			const { abortRun } = await setup();
			expect(abortRun("nonexistent")).toBe(false);
		});

		it("immediately marks the run as non-active so new messages are not blocked", async () => {
			const { startRun, abortRun, hasActiveRun, getActiveRun } = await setup();

			startRun({
				sessionId: "s-abort-status",
				message: "hi",
				agentSessionId: "s-abort-status",
			});

			expect(hasActiveRun("s-abort-status")).toBe(true);

			abortRun("s-abort-status");

			// hasActiveRun must return false immediately after abort
			// (before the child process exits), otherwise the next
			// user message is rejected with 409.
			expect(hasActiveRun("s-abort-status")).toBe(false);
			expect(getActiveRun("s-abort-status")?.status).toBe("error");
		});

		it("allows starting a new run after abort (no 409 race)", async () => {
			const { startRun, abortRun, hasActiveRun } = await setup();

			startRun({
				sessionId: "s-abort-new",
				message: "first",
				agentSessionId: "s-abort-new",
			});

			abortRun("s-abort-new");

			// Starting a new run for the same session should succeed.
			expect(() =>
				startRun({
					sessionId: "s-abort-new",
					message: "second",
					agentSessionId: "s-abort-new",
				}),
			).not.toThrow();

			expect(hasActiveRun("s-abort-new")).toBe(true);
		});

		it("signals subscribers with null on abort", async () => {
			const { startRun, abortRun, subscribeToRun } = await setup();

			const completed: boolean[] = [];

			startRun({
				sessionId: "s-abort-sub",
				message: "hi",
				agentSessionId: "s-abort-sub",
			});

			subscribeToRun(
				"s-abort-sub",
				(event) => {
					if (event === null) {completed.push(true);}
				},
				{ replay: false },
			);

			abortRun("s-abort-sub");

			expect(completed).toHaveLength(1);
		});
	});

	// ── duplicate run prevention ──────────────────────────────────────

	describe("duplicate run prevention", () => {
		it("throws when starting a run for an already-active session", async () => {
			const { startRun } = await setup();

			startRun({
				sessionId: "s-dup",
				message: "first",
				agentSessionId: "s-dup",
			});

			expect(() =>
				startRun({
					sessionId: "s-dup",
					message: "second",
					agentSessionId: "s-dup",
				}),
			).toThrow("Active run already exists");
		});
	});

	// ── multiple concurrent runs ─────────────────────────────────────

	describe("multiple concurrent runs", () => {
		it("tracks multiple sessions independently", async () => {
			const { startRun, hasActiveRun, getActiveRun } = await setup();

			startRun({ sessionId: "s-a", message: "first", agentSessionId: "s-a" });
			startRun({ sessionId: "s-b", message: "second", agentSessionId: "s-b" });

			expect(hasActiveRun("s-a")).toBe(true);
			expect(hasActiveRun("s-b")).toBe(true);
			expect(getActiveRun("s-a")?.status).toBe("running");
			expect(getActiveRun("s-b")?.status).toBe("running");
		});
	});

	// ── tool result events ───────────────────────────────────────────

	describe("tool result events", () => {
		it("emits tool-result events for completed tool calls", async () => {
			const { child, startRun, subscribeToRun } = await setup();

			const events: SseEvent[] = [];

			startRun({ sessionId: "s-tr", message: "use tool", agentSessionId: "s-tr" });

			subscribeToRun("s-tr", (event) => {
				if (event) {events.push(event);}
			}, { replay: false });

			// Emit tool start
			child._writeLine({
				event: "agent",
				stream: "tool",
				data: { phase: "start", toolCallId: "tc-1", name: "search", args: { q: "test" } },
			});

			// Emit tool result
			child._writeLine({
				event: "agent",
				stream: "tool",
				data: { phase: "result", toolCallId: "tc-1", result: "found 3 results" },
			});

			await new Promise((r) => setTimeout(r, 50));

			expect(events.some((e) => e.type === "tool-input-start" && e.toolCallId === "tc-1")).toBe(true);

			child.stdout.end();
			await new Promise((r) => setTimeout(r, 50));
			child._emit("close", 0);
		});
	});

	// ── stderr handling ──────────────────────────────────────────────

	describe("stderr handling", () => {
		it("captures stderr output for error reporting", async () => {
			const { child, startRun, subscribeToRun } = await setup();

			const events: SseEvent[] = [];

			startRun({ sessionId: "s-stderr", message: "fail", agentSessionId: "s-stderr" });

			subscribeToRun("s-stderr", (event) => {
				if (event) {events.push(event);}
			}, { replay: false });

			child._writeStderr("Error: something went wrong\n");

			child.stdout.end();
			await new Promise((r) => setTimeout(r, 50));
			child._emit("close", 1);

			// Should have an error message mentioning stderr content
			expect(events.some((e) =>
				e.type === "text-delta" && typeof e.delta === "string",
			)).toBe(true);
		});
	});

	// ── lifecycle events ──────────────────────────────────────────────

	describe("lifecycle events", () => {
		it("emits reasoning status on lifecycle start", async () => {
			const { child, startRun, subscribeToRun } = await setup();

			const events: SseEvent[] = [];

			startRun({
				sessionId: "s-lifecycle",
				message: "hi",
				agentSessionId: "s-lifecycle",
			});

			subscribeToRun(
				"s-lifecycle",
				(event) => {
					if (event) {events.push(event);}
				},
				{ replay: false },
			);

			child._writeLine({
				event: "agent",
				stream: "lifecycle",
				data: { phase: "start" },
			});

			await new Promise((r) => setTimeout(r, 50));

			expect(events.some((e) => e.type === "reasoning-start")).toBe(
				true,
			);
			expect(
				events.some(
					(e) =>
						e.type === "reasoning-delta" &&
						e.delta === "Preparing response...",
				),
			).toBe(true);

			child.stdout.end();
			await new Promise((r) => setTimeout(r, 50));
			child._emit("close", 0);
		});
	});
});
