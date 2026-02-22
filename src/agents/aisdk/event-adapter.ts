/**
 * AI SDK v6 event adapter for openclaw.
 *
 * This module converts AI SDK stream events to pi-agent compatible events.
 * This ensures all existing consumers (UI, CLI, messaging channels) work
 * without modification when using the AI SDK engine.
 *
 * Fork-friendly: emits same event protocol as pi-agent.
 */

import { streamText, type LanguageModel } from "ai";
import type { ConvertedAiSdkTool } from "./tools.js";

/**
 * Pi-agent compatible event types.
 * Matches the AgentEvent type from @mariozechner/pi-agent-core.
 */
export type PiAgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: PiAgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: PiAgentMessage; toolResults: PiToolResultMessage[] }
  | { type: "message_start"; message: PiAgentMessage }
  | {
      type: "message_update";
      message: PiAgentMessage;
      assistantMessageEvent: PiAssistantMessageEvent;
    }
  | { type: "message_end"; message: PiAgentMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      args: unknown;
      partialResult: unknown;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
    };

/**
 * Pi-agent message format (simplified).
 */
export interface PiAgentMessage {
  role: "user" | "assistant" | "toolResult";
  content: PiMessageContent[];
  timestamp?: number;
}

/**
 * Pi-agent message content block.
 */
export type PiMessageContent =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; id: string; name: string; arguments: unknown }
  | { type: "image"; data: string; mimeType: string };

/**
 * Pi-agent tool result message.
 */
export interface PiToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
  details?: unknown;
}

/**
 * Pi-agent assistant message event (streaming update).
 */
export interface PiAssistantMessageEvent {
  type: "text" | "thinking" | "toolCall";
  text?: string;
  thinking?: string;
  toolCall?: { id: string; name: string; arguments: unknown };
}

/**
 * Anthropic-specific provider options for thinking/reasoning.
 * Based on: https://ai-sdk.dev/providers/ai-sdk-providers/anthropic#reasoning
 */
export interface AnthropicProviderOptions {
  /** Enable thinking/reasoning with budget */
  thinking?: { type: "enabled"; budgetTokens: number };
  /** Effort level for Claude Opus 4.5 */
  effort?: "high" | "medium" | "low";
}

/**
 * Input parameters for the event adapter stream.
 */
export interface EventAdapterInput {
  /** Language model to use */
  model: LanguageModel;
  /** System prompt */
  system?: string;
  /** Messages history (in AI SDK format) */
  messages: Array<{
    role: "user" | "assistant" | "tool";
    content: string | unknown[];
  }>;
  /** Tools available to the model */
  tools?: Record<string, ConvertedAiSdkTool>;
  /** Temperature for generation */
  temperature?: number;
  /** Maximum output tokens */
  maxTokens?: number;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Top-p sampling parameter */
  topP?: number;
  /** Provider-specific options (e.g., Anthropic thinking/reasoning) */
  providerOptions?: {
    anthropic?: AnthropicProviderOptions;
  };
}

/**
 * Stream AI SDK responses as pi-agent compatible events.
 *
 * This is the main integration point between AI SDK and openclaw's event system.
 * It wraps streamText() and yields events that match the pi-agent protocol.
 *
 * @param input - Stream input parameters
 * @yields PiAgentEvent - Events compatible with pi-agent consumers
 */
export async function* streamWithPiAgentEvents(
  input: EventAdapterInput,
): AsyncGenerator<PiAgentEvent, void, undefined> {
  // Emit agent start
  yield { type: "agent_start" };

  const allMessages: PiAgentMessage[] = [];
  const currentTurnToolResults: PiToolResultMessage[] = [];
  let currentMessage: PiAgentMessage | null = null;
  let accumulatedText = "";
  let accumulatedReasoning = "";
  // Track tool call inputs as they stream in
  const toolCallInputs = new Map<string, { toolName: string; input: string }>();

  try {
    // Start streaming from AI SDK
    // Build stream options with provider-specific settings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const streamOptions: any = {
      model: input.model,
      system: input.system,
      messages: input.messages,
      tools: input.tools,
      temperature: input.temperature,
      maxOutputTokens: input.maxTokens,
      abortSignal: input.abortSignal,
      topP: input.topP,
    };

    // Add provider options for thinking/reasoning if specified
    if (input.providerOptions) {
      streamOptions.providerOptions = input.providerOptions;
    }

    const stream = streamText(streamOptions);

    // Emit turn start
    yield { type: "turn_start" };

    // Initialize assistant message
    currentMessage = {
      role: "assistant",
      content: [],
      timestamp: Date.now(),
    };

    // Emit message start
    yield { type: "message_start", message: currentMessage };

    // Process the full stream (streamText returns a stream object, not a promise)
    for await (const event of stream.fullStream) {
      switch (event.type) {
        case "text-delta": {
          // Accumulate text
          accumulatedText += event.text;

          // Update current message content
          const textBlock = currentMessage.content.find(
            (c): c is { type: "text"; text: string } => c.type === "text",
          );
          if (textBlock) {
            textBlock.text = accumulatedText;
          } else {
            currentMessage.content.push({ type: "text", text: accumulatedText });
          }

          // Emit message update
          yield {
            type: "message_update",
            message: currentMessage,
            assistantMessageEvent: { type: "text", text: event.text },
          };
          break;
        }

        case "reasoning-delta": {
          // Handle thinking/reasoning content
          accumulatedReasoning += event.text;
          const thinkingBlock = currentMessage.content.find(
            (c): c is { type: "thinking"; thinking: string } => c.type === "thinking",
          );
          if (thinkingBlock) {
            thinkingBlock.thinking = accumulatedReasoning;
          } else {
            currentMessage.content.push({ type: "thinking", thinking: accumulatedReasoning });
          }

          yield {
            type: "message_update",
            message: currentMessage,
            assistantMessageEvent: { type: "thinking", thinking: event.text },
          };
          break;
        }

        case "tool-input-start": {
          // Start tracking this tool call's input
          toolCallInputs.set(event.id, { toolName: event.toolName, input: "" });
          break;
        }

        case "tool-input-delta": {
          // Accumulate tool input
          const existing = toolCallInputs.get(event.id);
          if (existing) {
            existing.input += event.delta;
          }
          break;
        }

        case "tool-call": {
          // Get the tool input (already parsed by AI SDK)
          // The event has toolCallId, toolName, and either args or input
          const toolCallId = event.toolCallId;
          const toolName = event.toolName;
          // AI SDK v6 uses 'input' but may also be available as 'args' in some cases
          const toolInput = "args" in event ? event.args : "input" in event ? event.input : {};

          // Add tool call to message content
          const toolCallBlock = {
            type: "toolCall" as const,
            id: toolCallId,
            name: toolName,
            arguments: toolInput,
          };
          currentMessage.content.push(toolCallBlock);

          // Emit tool execution start
          yield {
            type: "tool_execution_start",
            toolCallId,
            toolName,
            args: toolInput,
          };

          // Also emit message update for the tool call
          yield {
            type: "message_update",
            message: currentMessage,
            assistantMessageEvent: {
              type: "toolCall",
              toolCall: { id: toolCallId, name: toolName, arguments: toolInput },
            },
          };
          break;
        }

        case "tool-result": {
          // Get the result (AI SDK v6 uses 'output' not 'result')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ev = event as any;
          const toolOutput = ev.output ?? ev.result ?? {};

          // Create tool result message
          const toolResult: PiToolResultMessage = {
            role: "toolResult",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            content: [
              {
                type: "text",
                text: typeof toolOutput === "string" ? toolOutput : JSON.stringify(toolOutput),
              },
            ],
            isError: false,
            details: toolOutput,
          };
          currentTurnToolResults.push(toolResult);

          // Emit tool execution end
          yield {
            type: "tool_execution_end",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            result: toolOutput,
            isError: false,
          };
          break;
        }

        case "tool-error": {
          // Handle tool errors
          const errorOutput = "error" in event ? event.error : "Tool execution failed";

          const toolResult: PiToolResultMessage = {
            role: "toolResult",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            content: [
              {
                type: "text",
                text: typeof errorOutput === "string" ? errorOutput : JSON.stringify(errorOutput),
              },
            ],
            isError: true,
            details: errorOutput,
          };
          currentTurnToolResults.push(toolResult);

          yield {
            type: "tool_execution_end",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            result: errorOutput,
            isError: true,
          };
          break;
        }

        case "start-step": {
          // New step starting - this happens in multi-step tool loops
          // For now, we don't have multi-step support enabled (maxSteps not set)
          break;
        }

        case "finish-step": {
          // Step finished - this happens in multi-step tool loops
          break;
        }

        case "finish": {
          // Stream finished
          break;
        }

        case "error": {
          // Handle error
          console.error("[AI SDK Event Adapter] Stream error:", event.error);
          break;
        }

        // Ignore other event types we don't need to translate
        default:
          break;
      }
    }

    // End message
    if (currentMessage) {
      yield { type: "message_end", message: currentMessage };
      allMessages.push(currentMessage);
    }

    // Emit turn end
    yield {
      type: "turn_end",
      message: currentMessage ?? { role: "assistant", content: [] },
      toolResults: currentTurnToolResults,
    };
  } catch (error) {
    // Log error but still try to emit agent_end
    console.error("[AI SDK Event Adapter] Stream error:", error);
  }

  // Emit agent end
  yield { type: "agent_end", messages: allMessages };
}

/**
 * Run a single LLM call and return pi-agent compatible events.
 * Convenience wrapper for simple use cases.
 */
export async function collectPiAgentEvents(input: EventAdapterInput): Promise<PiAgentEvent[]> {
  const events: PiAgentEvent[] = [];
  for await (const event of streamWithPiAgentEvents(input)) {
    events.push(event);
  }
  return events;
}
