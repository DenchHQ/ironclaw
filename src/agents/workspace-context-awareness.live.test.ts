/**
 * Live E2E tests for workspace context awareness.
 *
 * Requires:
 *   - A running gateway (openclaw gateway run)
 *   - LIVE=1 or OPENCLAW_LIVE_TEST=1 env var
 *
 * These tests verify that the agent actually knows about workspace context
 * by creating temporary workspaces and inspecting bootstrap file loading.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isTruthyEnvValue } from "../infra/env.js";
import { makeTempWorkspace, writeWorkspaceFile } from "../test-helpers/workspace.js";
import { resolveBootstrapContextForRun } from "./bootstrap-files.js";
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
  ensureAgentWorkspace,
  loadWorkspaceBootstrapFiles,
  resolveDefaultAgentWorkspaceDir,
} from "./workspace.js";

const LIVE =
  isTruthyEnvValue(process.env.OPENCLAW_LIVE_TEST) ||
  isTruthyEnvValue(process.env.CLAWDBOT_LIVE_TEST) ||
  isTruthyEnvValue(process.env.LIVE);

const describeLive = LIVE ? describe : describe.skip;

describeLive(
  "workspace context awareness (live)",
  () => {
    it("agent workspace resolves profile-specific directory", () => {
      const workDir = resolveDefaultAgentWorkspaceDir({
        OPENCLAW_PROFILE: "live-test",
        HOME: "/home/liveuser",
      } as NodeJS.ProcessEnv);
      expect(workDir).toContain("workspace-live-test");
      expect(workDir).not.toContain("workspace-default");
    });

    it("bootstrap files from workspace A are distinct from workspace B", async () => {
      const wsA = await makeTempWorkspace("live-ws-a-");
      const wsB = await makeTempWorkspace("live-ws-b-");

      await writeWorkspaceFile({
        dir: wsA,
        name: DEFAULT_AGENTS_FILENAME,
        content: "# Agent Profile Alpha\nYou are the Alpha agent.",
      });
      await writeWorkspaceFile({
        dir: wsB,
        name: DEFAULT_AGENTS_FILENAME,
        content: "# Agent Profile Beta\nYou are the Beta agent.",
      });

      const ctxA = await resolveBootstrapContextForRun({ workspaceDir: wsA });
      const ctxB = await resolveBootstrapContextForRun({ workspaceDir: wsB });

      const textA = ctxA.contextFiles.map((f) => f.content).join(" ");
      const textB = ctxB.contextFiles.map((f) => f.content).join(" ");

      expect(textA).toContain("Alpha");
      expect(textA).not.toContain("Beta");
      expect(textB).toContain("Beta");
      expect(textB).not.toContain("Alpha");
    }, 15_000);

    it("workspace seeding creates all expected bootstrap files", async () => {
      const tempDir = await makeTempWorkspace("live-seed-");
      await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

      const expectedFiles = [
        DEFAULT_AGENTS_FILENAME,
        DEFAULT_SOUL_FILENAME,
        DEFAULT_TOOLS_FILENAME,
        DEFAULT_IDENTITY_FILENAME,
        DEFAULT_USER_FILENAME,
      ];

      for (const file of expectedFiles) {
        const filePath = path.join(tempDir, file);
        const stat = await fs.stat(filePath).catch(() => null);
        expect(stat, `${file} should exist after seeding`).not.toBeNull();
      }
    }, 15_000);

    it("workspace bootstrap files include workspace path metadata", async () => {
      const tempDir = await makeTempWorkspace("live-meta-");
      await writeWorkspaceFile({
        dir: tempDir,
        name: DEFAULT_AGENTS_FILENAME,
        content: "# Test Agent",
      });

      const files = await loadWorkspaceBootstrapFiles(tempDir);
      const agents = files.find((f) => f.name === DEFAULT_AGENTS_FILENAME);

      expect(agents).toBeDefined();
      expect(agents!.path).toContain(tempDir);
      expect(agents!.missing).toBe(false);
    });

    it("context files from different workspaces contain correct file paths", async () => {
      const wsA = await makeTempWorkspace("live-path-a-");
      const wsB = await makeTempWorkspace("live-path-b-");

      await writeWorkspaceFile({
        dir: wsA,
        name: DEFAULT_AGENTS_FILENAME,
        content: "# Agent A",
      });
      await writeWorkspaceFile({
        dir: wsB,
        name: DEFAULT_AGENTS_FILENAME,
        content: "# Agent B",
      });

      const filesA = await loadWorkspaceBootstrapFiles(wsA);
      const filesB = await loadWorkspaceBootstrapFiles(wsB);

      const agentA = filesA.find((f) => f.name === DEFAULT_AGENTS_FILENAME);
      const agentB = filesB.find((f) => f.name === DEFAULT_AGENTS_FILENAME);

      expect(agentA!.path).toContain(wsA);
      expect(agentB!.path).toContain(wsB);
      expect(agentA!.path).not.toContain(wsB);
    });
  },
  30_000,
);
