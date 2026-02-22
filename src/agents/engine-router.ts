/**
 * LLM Engine Router for openclaw.
 *
 * This module provides a thin routing layer that dispatches agent runs
 * to either the original pi-agent engine or the new AI SDK engine
 * based on configuration.
 *
 * Fork-friendly: minimal integration point that reads config and routes.
 */

import type { OpenClawConfig } from "../config/config.js";
import type { LlmEngineType } from "../config/types.agents.js";
import type { RunEmbeddedPiAgentParams } from "./pi-embedded-runner/run/params.js";
import type { EmbeddedPiRunResult } from "./pi-embedded-runner/types.js";

/**
 * Re-export for convenience.
 */
export type LlmEngine = LlmEngineType;

/**
 * Default engine to use when not configured.
 */
export const DEFAULT_ENGINE: LlmEngine = "aisdk";

/**
 * Get the configured LLM engine from config.
 *
 * @param config - OpenClaw configuration
 * @returns The configured engine or default
 */
export function getConfiguredEngine(config?: OpenClawConfig): LlmEngine {
  const engineConfig = config?.agents?.engine;
  if (engineConfig === "pi-agent" || engineConfig === "aisdk") {
    return engineConfig;
  }
  return DEFAULT_ENGINE;
}

/**
 * Check if AI SDK engine is available (has required API keys).
 */
async function isAiSdkAvailable(): Promise<boolean> {
  try {
    const { isAiSdkEngineAvailable } = await import("./aisdk/run.js");
    return isAiSdkEngineAvailable();
  } catch {
    return false;
  }
}

/**
 * Run the agent using the appropriate engine based on configuration.
 *
 * This is the main entry point that should be used instead of calling
 * runEmbeddedPiAgent directly. It automatically routes to the correct
 * engine based on config.
 *
 * @param params - Run parameters (same as runEmbeddedPiAgent)
 * @returns Run result
 */
export async function runAgent(params: RunEmbeddedPiAgentParams): Promise<EmbeddedPiRunResult> {
  const engine = getConfiguredEngine(params.config);

  if (engine === "aisdk") {
    // Check if AI SDK is available
    const available = await isAiSdkAvailable();
    if (!available) {
      // Fall back to pi-agent if AI SDK is not configured
      console.warn(
        "[Engine Router] AI SDK engine selected but not available (missing API keys?). Falling back to pi-agent.",
      );
      return runPiAgent(params);
    }

    return runAiSdk(params);
  }

  return runPiAgent(params);
}

/**
 * Run using pi-agent engine.
 */
async function runPiAgent(params: RunEmbeddedPiAgentParams): Promise<EmbeddedPiRunResult> {
  const { runEmbeddedPiAgent } = await import("./pi-embedded-runner/run.js");
  return runEmbeddedPiAgent(params);
}

/**
 * Run using AI SDK engine.
 */
async function runAiSdk(params: RunEmbeddedPiAgentParams): Promise<EmbeddedPiRunResult> {
  const { runAiSdkAgent } = await import("./aisdk/run.js");

  // Map provider/model to AI SDK model reference
  const provider = params.provider ?? "anthropic";
  const model = params.model ?? "claude-sonnet-4";

  return runAiSdkAgent(params, {
    modelRef: `${provider}/${model}`,
  });
}

/**
 * Get information about the current engine configuration.
 */
export function getEngineInfo(config?: OpenClawConfig): {
  current: LlmEngine;
  default: LlmEngine;
  configPath: string;
} {
  return {
    current: getConfiguredEngine(config),
    default: DEFAULT_ENGINE,
    configPath: "agents.engine",
  };
}
