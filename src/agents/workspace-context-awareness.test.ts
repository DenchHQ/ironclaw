import { describe, expect, it } from "vitest";
import { makeTempWorkspace, writeWorkspaceFile } from "../test-helpers/workspace.js";
import { resolveBootstrapFilesForRun, resolveBootstrapContextForRun } from "./bootstrap-files.js";
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
  loadWorkspaceBootstrapFiles,
  filterBootstrapFilesForSession,
  resolveDefaultAgentWorkspaceDir,
} from "./workspace.js";

describe("workspace context awareness", () => {
  // ─── resolveDefaultAgentWorkspaceDir profile awareness ────────────

  describe("resolveDefaultAgentWorkspaceDir respects OPENCLAW_PROFILE", () => {
    it("returns workspace-<profile> for named profile", () => {
      const dir = resolveDefaultAgentWorkspaceDir({
        OPENCLAW_PROFILE: "work",
        HOME: "/home/user",
      } as NodeJS.ProcessEnv);
      expect(dir).toContain("workspace-work");
    });

    it("returns default workspace when profile is 'default'", () => {
      const dir = resolveDefaultAgentWorkspaceDir({
        OPENCLAW_PROFILE: "default",
        HOME: "/home/user",
      } as NodeJS.ProcessEnv);
      expect(dir).toMatch(/workspace$/);
      expect(dir).not.toContain("workspace-default");
    });

    it("returns default workspace when no profile set", () => {
      const dir = resolveDefaultAgentWorkspaceDir({
        HOME: "/home/user",
      } as NodeJS.ProcessEnv);
      expect(dir).toMatch(/workspace$/);
    });

    it("trims whitespace from profile name", () => {
      const dir = resolveDefaultAgentWorkspaceDir({
        OPENCLAW_PROFILE: "  padded  ",
        HOME: "/home/user",
      } as NodeJS.ProcessEnv);
      expect(dir).toContain("workspace-padded");
    });
  });

  // ─── loadWorkspaceBootstrapFiles ──────────────────────────────────

  describe("loadWorkspaceBootstrapFiles loads from correct workspace", () => {
    it("loads all standard bootstrap files from a workspace directory", async () => {
      const tempDir = await makeTempWorkspace("ctx-awareness-");
      await writeWorkspaceFile({
        dir: tempDir,
        name: DEFAULT_AGENTS_FILENAME,
        content: "# Custom Agent",
      });
      await writeWorkspaceFile({
        dir: tempDir,
        name: DEFAULT_SOUL_FILENAME,
        content: "# Custom Soul",
      });
      await writeWorkspaceFile({
        dir: tempDir,
        name: DEFAULT_TOOLS_FILENAME,
        content: "# Custom Tools",
      });

      const files = await loadWorkspaceBootstrapFiles(tempDir);
      const agents = files.find((f) => f.name === DEFAULT_AGENTS_FILENAME);
      const soul = files.find((f) => f.name === DEFAULT_SOUL_FILENAME);
      const tools = files.find((f) => f.name === DEFAULT_TOOLS_FILENAME);

      expect(agents).toBeDefined();
      expect(agents!.missing).toBe(false);
      expect(agents!.content).toBe("# Custom Agent");

      expect(soul).toBeDefined();
      expect(soul!.content).toBe("# Custom Soul");

      expect(tools).toBeDefined();
      expect(tools!.content).toBe("# Custom Tools");
    });

    it("marks missing files correctly", async () => {
      const tempDir = await makeTempWorkspace("ctx-missing-");
      const files = await loadWorkspaceBootstrapFiles(tempDir);

      for (const f of files) {
        expect(f.missing).toBe(true);
      }
    });

    it("loads from the specific workspace dir, not a different one", async () => {
      const wsA = await makeTempWorkspace("ctx-ws-a-");
      const wsB = await makeTempWorkspace("ctx-ws-b-");

      await writeWorkspaceFile({ dir: wsA, name: DEFAULT_AGENTS_FILENAME, content: "Workspace A" });
      await writeWorkspaceFile({ dir: wsB, name: DEFAULT_AGENTS_FILENAME, content: "Workspace B" });

      const filesA = await loadWorkspaceBootstrapFiles(wsA);
      const filesB = await loadWorkspaceBootstrapFiles(wsB);

      const agentsA = filesA.find((f) => f.name === DEFAULT_AGENTS_FILENAME);
      const agentsB = filesB.find((f) => f.name === DEFAULT_AGENTS_FILENAME);

      expect(agentsA!.content).toBe("Workspace A");
      expect(agentsB!.content).toBe("Workspace B");
    });
  });

  // ─── filterBootstrapFilesForSession ───────────────────────────────

  describe("filterBootstrapFilesForSession", () => {
    it("returns all files for a regular session key", async () => {
      const tempDir = await makeTempWorkspace("ctx-filter-");
      await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_AGENTS_FILENAME, content: "agents" });
      await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_SOUL_FILENAME, content: "soul" });
      await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_TOOLS_FILENAME, content: "tools" });
      await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_USER_FILENAME, content: "user" });

      const files = await loadWorkspaceBootstrapFiles(tempDir);
      const filtered = filterBootstrapFilesForSession(files, "regular-session-key");
      expect(filtered.length).toBe(files.length);
    });

    it("returns only AGENTS.md and TOOLS.md for subagent sessions", async () => {
      const tempDir = await makeTempWorkspace("ctx-subagent-");
      await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_AGENTS_FILENAME, content: "agents" });
      await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_SOUL_FILENAME, content: "soul" });
      await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_TOOLS_FILENAME, content: "tools" });
      await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_USER_FILENAME, content: "user" });

      const files = await loadWorkspaceBootstrapFiles(tempDir);
      const filtered = filterBootstrapFilesForSession(files, "subagent:parent:child");
      const names = filtered.map((f) => f.name);
      expect(names).toContain(DEFAULT_AGENTS_FILENAME);
      expect(names).toContain(DEFAULT_TOOLS_FILENAME);
      expect(names).not.toContain(DEFAULT_SOUL_FILENAME);
      expect(names).not.toContain(DEFAULT_USER_FILENAME);
    });

    it("returns all files when no session key provided", async () => {
      const tempDir = await makeTempWorkspace("ctx-no-key-");
      await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_AGENTS_FILENAME, content: "a" });
      const files = await loadWorkspaceBootstrapFiles(tempDir);
      const filtered = filterBootstrapFilesForSession(files);
      expect(filtered.length).toBe(files.length);
    });
  });

  // ─── resolveBootstrapContextForRun ────────────────────────────────

  describe("resolveBootstrapContextForRun", () => {
    it("produces context files from workspace bootstrap files", async () => {
      const tempDir = await makeTempWorkspace("ctx-resolve-");
      await writeWorkspaceFile({
        dir: tempDir,
        name: DEFAULT_AGENTS_FILENAME,
        content: "# My Agent",
      });
      await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_SOUL_FILENAME, content: "# My Soul" });

      const result = await resolveBootstrapContextForRun({
        workspaceDir: tempDir,
      });

      expect(result.bootstrapFiles.length).toBeGreaterThan(0);
      expect(result.contextFiles.length).toBeGreaterThan(0);

      const agentsCtx = result.contextFiles.find((f) => f.path.includes(DEFAULT_AGENTS_FILENAME));
      expect(agentsCtx).toBeDefined();
    });

    it("context files reflect workspace-specific content", async () => {
      const wsA = await makeTempWorkspace("ctx-a-");
      const wsB = await makeTempWorkspace("ctx-b-");

      await writeWorkspaceFile({
        dir: wsA,
        name: DEFAULT_AGENTS_FILENAME,
        content: "Profile A instructions",
      });
      await writeWorkspaceFile({
        dir: wsB,
        name: DEFAULT_AGENTS_FILENAME,
        content: "Profile B instructions",
      });

      const resultA = await resolveBootstrapContextForRun({ workspaceDir: wsA });
      const resultB = await resolveBootstrapContextForRun({ workspaceDir: wsB });

      const contentA = resultA.contextFiles.map((f) => f.content).join(" ");
      const contentB = resultB.contextFiles.map((f) => f.content).join(" ");

      expect(contentA).toContain("Profile A instructions");
      expect(contentB).toContain("Profile B instructions");
      expect(contentA).not.toContain("Profile B instructions");
    });

    it("handles empty workspace gracefully", async () => {
      const emptyDir = await makeTempWorkspace("ctx-empty-");
      const result = await resolveBootstrapContextForRun({
        workspaceDir: emptyDir,
      });
      expect(result.bootstrapFiles).toBeDefined();
      expect(result.contextFiles).toBeDefined();
    });
  });

  // ─── resolveBootstrapFilesForRun ──────────────────────────────────

  describe("resolveBootstrapFilesForRun", () => {
    it("filters files for subagent session keys", async () => {
      const tempDir = await makeTempWorkspace("ctx-run-sub-");
      await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_AGENTS_FILENAME, content: "agents" });
      await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_SOUL_FILENAME, content: "soul" });
      await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_TOOLS_FILENAME, content: "tools" });
      await writeWorkspaceFile({
        dir: tempDir,
        name: DEFAULT_IDENTITY_FILENAME,
        content: "identity",
      });

      const files = await resolveBootstrapFilesForRun({
        workspaceDir: tempDir,
        sessionKey: "subagent:parent:child",
      });

      const names = files.map((f) => f.name);
      expect(names).toContain(DEFAULT_AGENTS_FILENAME);
      expect(names).toContain(DEFAULT_TOOLS_FILENAME);
      expect(names).not.toContain(DEFAULT_SOUL_FILENAME);
      expect(names).not.toContain(DEFAULT_IDENTITY_FILENAME);
    });

    it("returns all files for regular session keys", async () => {
      const tempDir = await makeTempWorkspace("ctx-run-reg-");
      await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_AGENTS_FILENAME, content: "agents" });
      await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_SOUL_FILENAME, content: "soul" });

      const files = await resolveBootstrapFilesForRun({
        workspaceDir: tempDir,
        sessionKey: "regular-session",
      });

      const nonMissing = files.filter((f) => !f.missing);
      expect(nonMissing.length).toBeGreaterThanOrEqual(2);
    });
  });
});
