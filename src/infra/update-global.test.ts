import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CommandRunner } from "./update-global.js";
import {
  detectGlobalInstallManagerByPresence,
  detectGlobalInstallManagerForRoot,
  resolveGlobalPackageRoot,
} from "./update-global.js";

function makeMockRunner(globalRoot: string): CommandRunner {
  return async (argv) => {
    const cmd = argv.join(" ");
    if (cmd === "npm root -g" || cmd === "pnpm root -g") {
      return { stdout: globalRoot, stderr: "", code: 0 };
    }
    return { stdout: "", stderr: "not found", code: 1 };
  };
}

describe("update-global package name detection", () => {
  it("resolveGlobalPackageRoot returns ironclaw path", async () => {
    const root = await resolveGlobalPackageRoot("npm", makeMockRunner("/tmp/mock-root"), 3000);
    expect(root).toBe("/tmp/mock-root/ironclaw");
  });

  it("detectGlobalInstallManagerForRoot matches ironclaw package root", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-update-global-"));
    const globalRoot = path.join(tmp, "node_modules");
    const pkgRoot = path.join(globalRoot, "ironclaw");
    await fs.mkdir(pkgRoot, { recursive: true });

    const manager = await detectGlobalInstallManagerForRoot(
      makeMockRunner(globalRoot),
      pkgRoot,
      3000,
    );
    expect(manager).toBe("npm");

    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("detectGlobalInstallManagerForRoot matches legacy openclaw package root", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-update-global-"));
    const globalRoot = path.join(tmp, "node_modules");
    const pkgRoot = path.join(globalRoot, "openclaw");
    await fs.mkdir(pkgRoot, { recursive: true });

    const manager = await detectGlobalInstallManagerForRoot(
      makeMockRunner(globalRoot),
      pkgRoot,
      3000,
    );
    expect(manager).toBe("npm");

    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("detectGlobalInstallManagerByPresence finds ironclaw dir", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-update-global-"));
    const ironclawDir = path.join(tmp, "ironclaw");
    await fs.mkdir(ironclawDir, { recursive: true });

    const manager = await detectGlobalInstallManagerByPresence(makeMockRunner(tmp), 3000);
    expect(manager).toBe("npm");

    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("detectGlobalInstallManagerByPresence finds openclaw dir", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-update-global-"));
    const openclawDir = path.join(tmp, "openclaw");
    await fs.mkdir(openclawDir, { recursive: true });

    const manager = await detectGlobalInstallManagerByPresence(makeMockRunner(tmp), 3000);
    expect(manager).toBe("npm");

    await fs.rm(tmp, { recursive: true, force: true });
  });
});
