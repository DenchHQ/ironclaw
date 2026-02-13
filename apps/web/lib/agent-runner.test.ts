import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs", () => ({ existsSync: vi.fn() }));

const spawnMock = vi.mocked(spawn);

/** Minimal mock ChildProcess for testing. */
function mockChildProcess() {
	const events: Record<string, ((...args: unknown[]) => void)[]> = {};
	const child = {
		exitCode: null as number | null,
		killed: false,
		pid: 12345,
		stdout: {
			on: vi.fn(),
			// Act as a minimal readable for createInterface
			[Symbol.asyncIterator]: vi.fn(),
		},
		stderr: { on: vi.fn() },
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
		_emit(event: string, ...args: unknown[]) {
			for (const cb of events[event] || []) {
				cb(...args);
			}
		},
	};
	spawnMock.mockReturnValue(child as unknown as ChildProcess);
	return child;
}

describe("agent-runner", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
		process.env = { ...originalEnv };
		// Re-wire mocks after resetModules
		vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
		vi.mock("node:fs", () => ({ existsSync: vi.fn() }));
	});

	afterEach(() => {
		process.env = originalEnv;
		vi.restoreAllMocks();
	});

	// ── resolvePackageRoot ──────────────────────────────────────────────

	describe("resolvePackageRoot", () => {
		it("uses OPENCLAW_ROOT env var when set and valid", async () => {
			process.env.OPENCLAW_ROOT = "/opt/ironclaw";
			const { existsSync: mockExists } = await import("node:fs");
			vi.mocked(mockExists).mockImplementation(
				(p) => String(p) === "/opt/ironclaw",
			);

			const { resolvePackageRoot } = await import("./agent-runner.js");
			expect(resolvePackageRoot()).toBe("/opt/ironclaw");
		});

		it("ignores OPENCLAW_ROOT when the path does not exist", async () => {
			process.env.OPENCLAW_ROOT = "/nonexistent/path";

			const { existsSync: mockExists } = await import("node:fs");
			// OPENCLAW_ROOT doesn't exist, but we'll find openclaw.mjs by walking up
			vi.mocked(mockExists).mockImplementation((p) => {
				return String(p) === join("/pkg", "openclaw.mjs");
			});

			vi.spyOn(process, "cwd").mockReturnValue("/pkg/apps/web");

			const { resolvePackageRoot } = await import("./agent-runner.js");
			expect(resolvePackageRoot()).toBe("/pkg");
		});

		it("finds package root via openclaw.mjs in production (standalone cwd)", async () => {
			delete process.env.OPENCLAW_ROOT;

			const { existsSync: mockExists } = await import("node:fs");
			vi.mocked(mockExists).mockImplementation((p) => {
				// Only openclaw.mjs exists at the real package root
				return String(p) === join("/pkg", "openclaw.mjs");
			});

			// Standalone mode: cwd is deep inside .next/standalone
			vi.spyOn(process, "cwd").mockReturnValue(
				"/pkg/apps/web/.next/standalone/apps/web",
			);

			const { resolvePackageRoot } = await import("./agent-runner.js");
			expect(resolvePackageRoot()).toBe("/pkg");
		});

		it("finds package root via scripts/run-node.mjs in dev workspace", async () => {
			delete process.env.OPENCLAW_ROOT;

			const { existsSync: mockExists } = await import("node:fs");
			vi.mocked(mockExists).mockImplementation((p) => {
				return String(p) === join("/repo", "scripts", "run-node.mjs");
			});

			vi.spyOn(process, "cwd").mockReturnValue("/repo/apps/web");

			const { resolvePackageRoot } = await import("./agent-runner.js");
			expect(resolvePackageRoot()).toBe("/repo");
		});

		it("falls back to legacy 2-levels-up heuristic", async () => {
			delete process.env.OPENCLAW_ROOT;

			const { existsSync: mockExists } = await import("node:fs");
			vi.mocked(mockExists).mockReturnValue(false); // nothing found

			vi.spyOn(process, "cwd").mockReturnValue("/unknown/apps/web");

			const { resolvePackageRoot } = await import("./agent-runner.js");
			expect(resolvePackageRoot()).toBe(
				join("/unknown/apps/web", "..", ".."),
			);
		});
	});

	// ── spawnAgentProcess ──────────────────────────────────────────────

	describe("spawnAgentProcess", () => {
		it("uses scripts/run-node.mjs in dev when both scripts exist", async () => {
			delete process.env.OPENCLAW_ROOT;

			const { existsSync: mockExists } = await import("node:fs");
			const { spawn: mockSpawn } = await import("node:child_process");

			vi.mocked(mockExists).mockImplementation((p) => {
				const s = String(p);
				// Package root found via scripts/run-node.mjs
				if (s === join("/repo", "scripts", "run-node.mjs")) {return true;}
				// openclaw.mjs also exists in dev
				if (s === join("/repo", "openclaw.mjs")) {return true;}
				return false;
			});

			vi.spyOn(process, "cwd").mockReturnValue("/repo/apps/web");

			const child = mockChildProcess();
			vi.mocked(mockSpawn).mockReturnValue(
				child as unknown as ChildProcess,
			);

			const { spawnAgentProcess } = await import("./agent-runner.js");
			spawnAgentProcess("hello");

			expect(vi.mocked(mockSpawn)).toHaveBeenCalledWith(
				"node",
				expect.arrayContaining([
					join("/repo", "scripts", "run-node.mjs"),
					"agent",
					"--agent",
					"main",
					"--message",
					"hello",
					"--stream-json",
				]),
				expect.objectContaining({
					cwd: "/repo",
				}),
			);
		});

		it("falls back to openclaw.mjs in production (standalone)", async () => {
			process.env.OPENCLAW_ROOT = "/pkg";

			const { existsSync: mockExists } = await import("node:fs");
			const { spawn: mockSpawn } = await import("node:child_process");

			vi.mocked(mockExists).mockImplementation((p) => {
				const s = String(p);
				if (s === "/pkg") {return true;} // OPENCLAW_ROOT valid
				if (s === join("/pkg", "openclaw.mjs")) {return true;} // prod script
				// scripts/run-node.mjs does NOT exist (production install)
				return false;
			});

			const child = mockChildProcess();
			vi.mocked(mockSpawn).mockReturnValue(
				child as unknown as ChildProcess,
			);

			const { spawnAgentProcess } = await import("./agent-runner.js");
			spawnAgentProcess("test message");

			expect(vi.mocked(mockSpawn)).toHaveBeenCalledWith(
				"node",
				expect.arrayContaining([
					join("/pkg", "openclaw.mjs"),
					"agent",
					"--agent",
					"main",
					"--message",
					"test message",
					"--stream-json",
				]),
				expect.objectContaining({
					cwd: "/pkg",
				}),
			);
		});

		it("includes session-key and lane args when agentSessionId is set", async () => {
			process.env.OPENCLAW_ROOT = "/pkg";

			const { existsSync: mockExists } = await import("node:fs");
			const { spawn: mockSpawn } = await import("node:child_process");

			vi.mocked(mockExists).mockImplementation((p) => {
				const s = String(p);
				return s === "/pkg" || s === join("/pkg", "openclaw.mjs");
			});

			const child = mockChildProcess();
			vi.mocked(mockSpawn).mockReturnValue(
				child as unknown as ChildProcess,
			);

			const { spawnAgentProcess } = await import("./agent-runner.js");
			spawnAgentProcess("msg", "session-123");

			expect(vi.mocked(mockSpawn)).toHaveBeenCalledWith(
				"node",
				expect.arrayContaining([
					"--session-key",
					"agent:main:subagent:session-123",
					"--lane",
					"subagent",
				]),
				expect.anything(),
			);
		});
	});

	// ── parseAgentErrorMessage ──────────────────────────────────────────

	describe("parseAgentErrorMessage", () => {
		it("extracts message from error field", async () => {
			const { parseAgentErrorMessage } = await import(
				"./agent-runner.js"
			);
			expect(
				parseAgentErrorMessage({ error: "something went wrong" }),
			).toBe("something went wrong");
		});

		it("extracts message from JSON error body", async () => {
			const { parseAgentErrorMessage } = await import(
				"./agent-runner.js"
			);
			const result = parseAgentErrorMessage({
				errorMessage:
					'402 {"error":{"message":"Insufficient funds"}}',
			});
			expect(result).toBe("Insufficient funds");
		});

		it("returns undefined for empty data", async () => {
			const { parseAgentErrorMessage } = await import(
				"./agent-runner.js"
			);
			expect(parseAgentErrorMessage(undefined)).toBeUndefined();
			expect(parseAgentErrorMessage({})).toBeUndefined();
		});
	});

	// ── parseErrorFromStderr ───────────────────────────────────────────

	describe("parseErrorFromStderr", () => {
		it("extracts JSON error message from stderr", async () => {
			const { parseErrorFromStderr } = await import(
				"./agent-runner.js"
			);
			const stderr = `Some log line\n{"error":{"message":"Rate limit exceeded"}}\n`;
			expect(parseErrorFromStderr(stderr)).toBe("Rate limit exceeded");
		});

		it("extracts error line containing 'error' keyword", async () => {
			const { parseErrorFromStderr } = await import(
				"./agent-runner.js"
			);
			const stderr = "Module not found error: cannot resolve 'next'";
			expect(parseErrorFromStderr(stderr)).toBeTruthy();
		});

		it("returns undefined for empty stderr", async () => {
			const { parseErrorFromStderr } = await import(
				"./agent-runner.js"
			);
			expect(parseErrorFromStderr("")).toBeUndefined();
		});
	});
});
