import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const watchMock = vi.fn(() => ({
  on: vi.fn(),
  close: vi.fn(async () => undefined),
}));

vi.mock("chokidar", () => {
  return {
    default: { watch: watchMock },
  };
});

vi.mock("./bundled-dir.js", () => ({
  resolveBundledSkillsDir: () => "/mock/package/root/skills",
}));

describe("ensureSkillsWatcher", () => {
  it("ignores node_modules, dist, .git, and Python venvs by default", async () => {
    const mod = await import("./refresh.js");
    mod.ensureSkillsWatcher({ workspaceDir: "/tmp/workspace" });

    expect(watchMock).toHaveBeenCalledTimes(1);
    const targets = watchMock.mock.calls[0]?.[0] as string[];
    const opts = watchMock.mock.calls[0]?.[1] as { ignored?: unknown };

    expect(opts.ignored).toBe(mod.DEFAULT_SKILLS_WATCH_IGNORED);
    const posix = (p: string) => p.replaceAll("\\", "/");
    expect(targets).toEqual(
      expect.arrayContaining([
        posix(path.join("/tmp/workspace", "skills", "SKILL.md")),
        posix(path.join("/tmp/workspace", "skills", "*", "SKILL.md")),
        posix(path.join("/tmp/workspace", ".agents", "skills", "SKILL.md")),
        posix(path.join("/tmp/workspace", ".agents", "skills", "*", "SKILL.md")),
        posix(path.join(os.homedir(), ".agents", "skills", "SKILL.md")),
        posix(path.join(os.homedir(), ".agents", "skills", "*", "SKILL.md")),
      ]),
    );
    expect(targets.every((target) => target.includes("SKILL.md"))).toBe(true);
    const ignored = mod.DEFAULT_SKILLS_WATCH_IGNORED;

    // Node/JS paths
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/node_modules/pkg/index.js"))).toBe(
      true,
    );
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/dist/index.js"))).toBe(true);
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/.git/config"))).toBe(true);

    // Python virtual environments and caches
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/scripts/.venv/bin/python"))).toBe(
      true,
    );
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/venv/lib/python3.10/site.py"))).toBe(
      true,
    );
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/__pycache__/module.pyc"))).toBe(
      true,
    );
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/.mypy_cache/3.10/foo.json"))).toBe(
      true,
    );
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/.pytest_cache/v/cache"))).toBe(true);

    // Build artifacts and caches
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/build/output.js"))).toBe(true);
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/.cache/data.json"))).toBe(true);

    // Should NOT ignore normal skill files
    expect(ignored.some((re) => re.test("/tmp/.hidden/skills/index.md"))).toBe(false);
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/my-skill/SKILL.md"))).toBe(false);
  });

  it("includes bundled skills dir in watch paths", async () => {
    watchMock.mockClear();
    const mod = await import("./refresh.js");
    // Force a fresh watcher by using a different workspace dir
    mod.ensureSkillsWatcher({ workspaceDir: "/tmp/workspace-bundled-test" });

    expect(watchMock).toHaveBeenCalledTimes(1);
    const watchedPaths = watchMock.mock.calls[0]?.[0] as string[];

    // Should include workspace skills, managed skills, and bundled skills
    expect(watchedPaths).toContain("/tmp/workspace-bundled-test/skills");
    expect(watchedPaths).toContain("/mock/package/root/skills");
  });
});
