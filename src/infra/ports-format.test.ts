import { describe, expect, it } from "vitest";
import { classifyPortListener } from "./ports-format.js";

describe("classifyPortListener", () => {
  it("classifies openclaw as gateway", () => {
    expect(classifyPortListener({ commandLine: "node openclaw gateway run" }, 18789)).toBe(
      "gateway",
    );
  });

  it("classifies ironclaw as gateway", () => {
    expect(classifyPortListener({ commandLine: "node ironclaw gateway run" }, 18789)).toBe(
      "gateway",
    );
  });

  it("classifies ssh tunnels", () => {
    expect(classifyPortListener({ commandLine: "ssh -L 18789:localhost:18789" }, 18789)).toBe(
      "ssh",
    );
  });

  it("classifies unknown processes", () => {
    expect(classifyPortListener({ commandLine: "nginx" }, 18789)).toBe("unknown");
  });
});
