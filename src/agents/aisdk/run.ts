/**
 * AI SDK v6 agent runner for openclaw.
 *
 * This module provides an AI SDK-based implementation that can run
 * in place of the pi-agent runner. It uses the same interface and
 * emits compatible events.
 *
 * Fork-friendly: parallel implementation, doesn't modify pi-agent code.
 */

import type { ThinkLevel } from "../../auto-reply/thinking.js";
import type { RunEmbeddedPiAgentParams } from "../pi-embedded-runner/run/params.js";
import type { EmbeddedPiRunResult, EmbeddedPiAgentMeta } from "../pi-embedded-runner/types.js";
import type { AiSdkConfig, ResolvedModel } from "./types.js";
import { resolveUserPath } from "../../utils.js";
import {
  resolveSkillsPromptForRun,
  applySkillEnvOverrides,
  applySkillEnvOverridesFromSnapshot,
  loadWorkspaceSkillEntries,
} from "../skills.js";
import { streamWithPiAgentEvents, type EventAdapterInput } from "./event-adapter.js";
import { resolveModel, getDefaultConfig, validateConfig } from "./provider.js";
import { createAiSdkTools, type ToolExecutionContext, type ConvertedAiSdkTool } from "./tools.js";

/**
 * Configuration for the AI SDK agent runner.
 */
export interface AiSdkRunnerConfig {
  /** AI SDK configuration */
  aiSdkConfig?: AiSdkConfig;
  /** Model reference (e.g., "anthropic/claude-sonnet-4") */
  modelRef?: string;
}

/**
 * Map OpenClaw ThinkLevel to AI SDK Anthropic thinking options.
 * Based on: https://ai-sdk.dev/providers/ai-sdk-providers/anthropic#reasoning
 */
export function mapThinkLevelToAnthropicOptions(
  thinkLevel?: ThinkLevel,
  provider?: string,
): { thinking?: { type: "enabled"; budgetTokens: number }; effort?: "high" | "medium" | "low" } {
  // Only apply to Anthropic provider
  if (provider !== "anthropic") {
    return {};
  }

  if (!thinkLevel || thinkLevel === "off") {
    return {};
  }

  // Map thinking levels to budget tokens
  const budgetMap: Record<Exclude<ThinkLevel, "off">, number> = {
    minimal: 2000,
    low: 4000,
    medium: 8000,
    high: 16000,
    xhigh: 32000,
  };

  const budgetTokens = budgetMap[thinkLevel] ?? 4000;
  const options: ReturnType<typeof mapThinkLevelToAnthropicOptions> = {
    thinking: { type: "enabled", budgetTokens },
  };

  // For xhigh, also set effort to high (for Claude Opus 4.5)
  if (thinkLevel === "xhigh") {
    options.effort = "high";
  } else if (thinkLevel === "high") {
    options.effort = "high";
  } else if (thinkLevel === "medium") {
    options.effort = "medium";
  } else {
    options.effort = "low";
  }

  return options;
}

/**
 * Result from the AI SDK agent run.
 * Compatible with EmbeddedPiRunResult.
 */
export type AiSdkRunResult = EmbeddedPiRunResult;

/**
 * Run the AI SDK agent with parameters matching runEmbeddedPiAgent.
 *
 * This is the main entry point for running the AI SDK engine.
 * It aims to be a drop-in replacement for runEmbeddedPiAgent.
 *
 * @param params - Run parameters (compatible with pi-agent params)
 * @param config - AI SDK specific configuration
 * @returns Run result (compatible with pi-agent result)
 */
export async function runAiSdkAgent(
  params: RunEmbeddedPiAgentParams,
  config?: AiSdkRunnerConfig,
): Promise<AiSdkRunResult> {
  const started = Date.now();

  // Resolve AI SDK configuration
  const aiSdkConfig = config?.aiSdkConfig ?? getDefaultConfig();

  // Determine model reference
  const provider = params.provider ?? "anthropic";
  const modelId = params.model ?? "claude-sonnet-4";
  const modelRef = config?.modelRef ?? `${provider}/${modelId}`;

  // Resolve the model
  let resolvedModel: ResolvedModel;
  try {
    resolvedModel = await resolveModel(modelRef, aiSdkConfig);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      payloads: [{ text: `Error resolving model: ${message}`, isError: true }],
      meta: {
        durationMs: Date.now() - started,
        error: { kind: "context_overflow", message },
      },
    };
  }

  // Resolve workspace directory
  const effectiveWorkspace = resolveUserPath(params.workspaceDir);

  // === Skills Integration ===
  // Apply skill environment overrides and build skills prompt
  let restoreSkillEnv: (() => void) | undefined;
  let skillsPrompt = "";

  try {
    const shouldLoadSkillEntries = !params.skillsSnapshot || !params.skillsSnapshot.resolvedSkills;
    const skillEntries = shouldLoadSkillEntries
      ? loadWorkspaceSkillEntries(effectiveWorkspace)
      : [];

    // Apply environment overrides from skills
    restoreSkillEnv = params.skillsSnapshot
      ? applySkillEnvOverridesFromSnapshot({
          snapshot: params.skillsSnapshot,
          config: params.config,
        })
      : applySkillEnvOverrides({
          skills: skillEntries ?? [],
          config: params.config,
        });

    // Resolve skills prompt
    skillsPrompt = resolveSkillsPromptForRun({
      skillsSnapshot: params.skillsSnapshot,
      entries: shouldLoadSkillEntries ? skillEntries : undefined,
      config: params.config,
      workspaceDir: effectiveWorkspace,
    });
  } catch (error) {
    console.error("[AI SDK Runner] Error loading skills:", error);
    // Continue without skills if loading fails
  }

  // Create tool execution context
  const toolContext: ToolExecutionContext = {
    sessionKey: params.sessionKey,
    workspaceDir: effectiveWorkspace,
    abortSignal: params.abortSignal,
    messageId: params.runId,
  };

  // Create tools if not disabled
  let tools: Record<string, ConvertedAiSdkTool> | undefined;
  if (!params.disableTools) {
    try {
      tools = await createAiSdkTools(
        {
          workspaceDir: effectiveWorkspace,
          sessionKey: params.sessionKey,
          config: params.config,
          abortSignal: params.abortSignal,
          messageProvider: params.messageProvider,
          agentAccountId: params.agentAccountId,
          messageTo: params.messageTo,
          messageThreadId: params.messageThreadId,
          groupId: params.groupId,
          groupChannel: params.groupChannel,
          groupSpace: params.groupSpace,
          spawnedBy: params.spawnedBy,
          senderId: params.senderId,
          senderName: params.senderName,
          senderUsername: params.senderUsername,
          senderE164: params.senderE164,
          modelProvider: provider,
          modelId,
          currentChannelId: params.currentChannelId,
          currentThreadTs: params.currentThreadTs,
          replyToMode: params.replyToMode,
          hasRepliedRef: params.hasRepliedRef,
        },
        toolContext,
      );
    } catch (error) {
      console.error("[AI SDK Runner] Error creating tools:", error);
      // Continue without tools if creation fails
    }
  }

  // === Build System Prompt ===
  // Combine extra system prompt, skills prompt, and base prompt
  const systemParts: string[] = [];
  if (params.extraSystemPrompt) {
    systemParts.push(params.extraSystemPrompt);
  }
  if (skillsPrompt) {
    systemParts.push(skillsPrompt);
  }
  // Note: The main system prompt should be built by the caller (e.g., buildEmbeddedSystemPrompt)
  // For now, we just pass through what we receive
  const systemPrompt = systemParts.length > 0 ? systemParts.join("\n\n") : undefined;

  // Build messages - for now, just the user prompt
  // TODO: Load session history from sessionFile when implementing full session support
  const messages: EventAdapterInput["messages"] = [{ role: "user", content: params.prompt }];

  // === Thinking/Reasoning Options (Anthropic-specific) ===
  // Map OpenClaw thinkLevel to AI SDK Anthropic provider options
  const anthropicOptions = mapThinkLevelToAnthropicOptions(params.thinkLevel, provider);

  // Create stream input
  const streamInput: EventAdapterInput = {
    model: resolvedModel.model,
    system: systemPrompt,
    messages,
    tools,
    temperature: 0.7,
    maxTokens: 4096,
    abortSignal: params.abortSignal,
    // Pass provider-specific options for thinking/reasoning
    providerOptions:
      anthropicOptions.thinking || anthropicOptions.effort
        ? {
            anthropic: anthropicOptions,
          }
        : undefined,
  };

  // Collect payloads from the stream
  const payloads: AiSdkRunResult["payloads"] = [];
  let accumulatedText = "";
  let agentMeta: EmbeddedPiAgentMeta | undefined;
  let aborted = false;

  try {
    // Stream events and process them
    for await (const event of streamWithPiAgentEvents(streamInput)) {
      // Call event callback if provided
      if (params.onAgentEvent) {
        params.onAgentEvent({
          stream: "agent",
          data: event as Record<string, unknown>,
        });
      }

      // Process events
      switch (event.type) {
        case "message_start":
          if (params.onAssistantMessageStart) {
            await params.onAssistantMessageStart();
          }
          break;

        case "message_update":
          // Extract text from the event
          if (event.assistantMessageEvent.type === "text" && event.assistantMessageEvent.text) {
            accumulatedText += event.assistantMessageEvent.text;
            if (params.onPartialReply) {
              await params.onPartialReply({ text: event.assistantMessageEvent.text });
            }
          }
          if (
            event.assistantMessageEvent.type === "thinking" &&
            event.assistantMessageEvent.thinking
          ) {
            if (params.onReasoningStream) {
              await params.onReasoningStream({ text: event.assistantMessageEvent.thinking });
            }
          }
          break;

        case "message_end":
          // Block reply if callback provided
          if (params.onBlockReply && accumulatedText) {
            await params.onBlockReply({ text: accumulatedText });
          }
          if (params.onBlockReplyFlush) {
            await params.onBlockReplyFlush();
          }
          break;

        case "tool_execution_end":
          // Report tool result if callbacks provided
          if (params.onToolResult && params.shouldEmitToolResult?.()) {
            const resultText =
              typeof event.result === "string" ? event.result : JSON.stringify(event.result);
            await params.onToolResult({ text: resultText });
          }
          break;

        case "agent_end":
          // Build agent meta
          agentMeta = {
            sessionId: params.sessionId,
            provider: resolvedModel.providerId,
            model: resolvedModel.modelId,
            // TODO: Get actual usage from AI SDK response
            usage: { input: 0, output: 0, total: 0 },
          };
          break;
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      aborted = true;
    } else {
      const message = error instanceof Error ? error.message : String(error);
      payloads.push({ text: `Error: ${message}`, isError: true });
    }
  }

  // Add final text as payload
  if (accumulatedText) {
    payloads.push({ text: accumulatedText });
  }

  // Restore skill environment overrides
  if (restoreSkillEnv) {
    try {
      restoreSkillEnv();
    } catch (error) {
      console.error("[AI SDK Runner] Error restoring skill env:", error);
    }
  }

  return {
    payloads: payloads.length > 0 ? payloads : undefined,
    meta: {
      durationMs: Date.now() - started,
      agentMeta,
      aborted,
    },
  };
}

/**
 * Check if AI SDK engine is available (has required configuration).
 */
export function isAiSdkEngineAvailable(config?: AiSdkConfig): boolean {
  const cfg = config ?? getDefaultConfig();
  return validateConfig(cfg) === null;
}
