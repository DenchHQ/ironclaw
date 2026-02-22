/**
 * AI SDK v6 integration for openclaw.
 *
 * This module provides an alternative LLM engine using Vercel's AI SDK,
 * alongside the existing pi-agent implementation. Users can choose between
 * engines via configuration.
 *
 * Fork-friendly design:
 * - All AI SDK code lives in this separate `aisdk/` directory
 * - Original pi-agent code remains untouched
 * - Minimal integration points for easy upstream merges
 */

// Types
export type {
  AiSdkConfig,
  AiSdkMessage,
  AiSdkMessageContent,
  AiSdkStreamInput,
  AiSdkTool,
  DirectProviderId,
  DirectProviderConfig,
  GatewayConfig,
  ModelRef,
  ProviderMode,
  ResolvedModel,
} from "./types.js";

// Provider management
export {
  getDefaultConfig,
  listAvailableProviders,
  parseModelRef,
  resolveModel,
  validateConfig,
} from "./provider.js";

// Tool conversion
export type { ConvertedAiSdkTool, ToolExecutionContext, ToolResult } from "./tools.js";
export { convertPiToolToAiSdk, convertPiToolsToAiSdk, createAiSdkTools } from "./tools.js";

// Event adapter (pi-agent protocol compatibility)
export type {
  AnthropicProviderOptions,
  EventAdapterInput,
  PiAgentEvent,
  PiAgentMessage,
  PiAssistantMessageEvent,
  PiMessageContent,
  PiToolResultMessage,
} from "./event-adapter.js";
export { collectPiAgentEvents, streamWithPiAgentEvents } from "./event-adapter.js";

// Agent runner (main entry point)
export type { AiSdkRunnerConfig, AiSdkRunResult } from "./run.js";
export { isAiSdkEngineAvailable, mapThinkLevelToAnthropicOptions, runAiSdkAgent } from "./run.js";
