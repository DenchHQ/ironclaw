import { describe, expect, it } from "vitest";
import { getConfiguredEngine, getEngineInfo, DEFAULT_ENGINE } from "./engine-router.js";

describe("Engine Router", () => {
  describe("getConfiguredEngine", () => {
    it("returns aisdk by default when no config", () => {
      expect(getConfiguredEngine()).toBe("aisdk");
    });

    it("returns aisdk by default when config has no engine", () => {
      expect(getConfiguredEngine({})).toBe("aisdk");
      expect(getConfiguredEngine({ agents: {} })).toBe("aisdk");
    });

    it("returns pi-agent when configured", () => {
      expect(getConfiguredEngine({ agents: { engine: "pi-agent" } })).toBe("pi-agent");
    });

    it("returns aisdk when explicitly configured", () => {
      expect(getConfiguredEngine({ agents: { engine: "aisdk" } })).toBe("aisdk");
    });
  });

  describe("getEngineInfo", () => {
    it("returns current and default engine info", () => {
      const info = getEngineInfo();
      expect(info.current).toBe(DEFAULT_ENGINE);
      expect(info.default).toBe("aisdk");
      expect(info.configPath).toBe("agents.engine");
    });

    it("reflects configured engine", () => {
      const info = getEngineInfo({ agents: { engine: "pi-agent" } });
      expect(info.current).toBe("pi-agent");
      expect(info.default).toBe("aisdk");
    });
  });

  describe("DEFAULT_ENGINE", () => {
    it("is aisdk", () => {
      expect(DEFAULT_ENGINE).toBe("aisdk");
    });
  });
});
