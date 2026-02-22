import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs([
      "node",
      "ironclaw",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "ironclaw", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "ironclaw", "--dev", "gateway"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "ironclaw", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "ironclaw", "--profile", "work", "status"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "ironclaw", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "ironclaw", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (dev first)", () => {
    const res = parseCliProfileArgs(["node", "ironclaw", "--dev", "--profile", "work", "status"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (profile first)", () => {
    const res = parseCliProfileArgs(["node", "ironclaw", "--profile", "work", "--dev", "status"]);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join(path.resolve("/home/peter"), ".openclaw-dev");
    expect(env.OPENCLAW_PROFILE).toBe("dev");
    expect(env.OPENCLAW_STATE_DIR).toBe(expectedStateDir);
    expect(env.OPENCLAW_CONFIG_PATH).toBe(path.join(expectedStateDir, "openclaw.json"));
    expect(env.OPENCLAW_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      OPENCLAW_STATE_DIR: "/custom",
      OPENCLAW_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.OPENCLAW_STATE_DIR).toBe("/custom");
    expect(env.OPENCLAW_GATEWAY_PORT).toBe("19099");
    expect(env.OPENCLAW_CONFIG_PATH).toBe(path.join("/custom", "openclaw.json"));
  });

  it("uses OPENCLAW_HOME when deriving profile state dir", () => {
    const env: Record<string, string | undefined> = {
      OPENCLAW_HOME: "/srv/openclaw-home",
      HOME: "/home/other",
    };
    applyCliProfileEnv({
      profile: "work",
      env,
      homedir: () => "/home/fallback",
    });

    const resolvedHome = path.resolve("/srv/openclaw-home");
    expect(env.OPENCLAW_STATE_DIR).toBe(path.join(resolvedHome, ".openclaw-work"));
    expect(env.OPENCLAW_CONFIG_PATH).toBe(
      path.join(resolvedHome, ".openclaw-work", "openclaw.json"),
    );
  });
});

describe("formatCliCommand", () => {
  it("returns command unchanged when no profile is set", () => {
    expect(formatCliCommand("ironclaw doctor --fix", {})).toBe("ironclaw doctor --fix");
  });

  it("returns command unchanged when profile is default", () => {
    expect(formatCliCommand("ironclaw doctor --fix", { OPENCLAW_PROFILE: "default" })).toBe(
      "ironclaw doctor --fix",
    );
  });

  it("returns command unchanged when profile is Default (case-insensitive)", () => {
    expect(formatCliCommand("ironclaw doctor --fix", { OPENCLAW_PROFILE: "Default" })).toBe(
      "ironclaw doctor --fix",
    );
  });

  it("returns command unchanged when profile is invalid", () => {
    expect(formatCliCommand("ironclaw doctor --fix", { OPENCLAW_PROFILE: "bad profile" })).toBe(
      "ironclaw doctor --fix",
    );
  });

  it("returns command unchanged when --profile is already present", () => {
    expect(
      formatCliCommand("ironclaw --profile work doctor --fix", { OPENCLAW_PROFILE: "work" }),
    ).toBe("ironclaw --profile work doctor --fix");
  });

  it("returns command unchanged when --dev is already present", () => {
    expect(formatCliCommand("ironclaw --dev doctor", { OPENCLAW_PROFILE: "dev" })).toBe(
      "ironclaw --dev doctor",
    );
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("ironclaw doctor --fix", { OPENCLAW_PROFILE: "work" })).toBe(
      "ironclaw --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("ironclaw doctor --fix", { OPENCLAW_PROFILE: "  jbopenclaw  " })).toBe(
      "ironclaw --profile jbopenclaw doctor --fix",
    );
  });

  it("handles command with no args after ironclaw", () => {
    expect(formatCliCommand("ironclaw", { OPENCLAW_PROFILE: "test" })).toBe(
      "ironclaw --profile test",
    );
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm ironclaw doctor", { OPENCLAW_PROFILE: "work" })).toBe(
      "pnpm ironclaw --profile work doctor",
    );
  });
});
