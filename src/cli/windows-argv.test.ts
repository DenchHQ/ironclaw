import { describe, expect, it } from "vitest";
import { normalizeWindowsArgv } from "./windows-argv.js";

describe("normalizeWindowsArgv", () => {
  it("returns argv unchanged on non-windows platforms", () => {
    const argv = ["node", "ironclaw", "status"];
    expect(
      normalizeWindowsArgv(argv, {
        platform: "darwin",
      }),
    ).toEqual(argv);
  });

  it("removes duplicated node executable arguments on windows", () => {
    const execPath = "C:\\Program Files\\nodejs\\node.exe";
    const argv = ["node", execPath, "C:\\repo\\openclaw.mjs", execPath, "status"];

    expect(
      normalizeWindowsArgv(argv, {
        platform: "win32",
        execPath,
      }),
    ).toEqual(["node", "C:\\repo\\openclaw.mjs", "status"]);
  });

  it("strips control chars and wrapping quotes before exec-path matching", () => {
    const execPath = "C:\\Program Files\\nodejs\\node.exe";
    const argv = ["node", `"\u0000${execPath}\u0000"`, "C:\\repo\\openclaw.mjs", "status"];

    expect(
      normalizeWindowsArgv(argv, {
        platform: "win32",
        execPath,
        existsSync: () => true,
      }),
    ).toEqual(["node", "C:\\repo\\openclaw.mjs", "status"]);
  });
});
