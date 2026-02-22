import { Type } from "@sinclair/typebox";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { type AnyAgentTool, jsonResult } from "./common.js";
import { callGatewayTool, readGatewayCallOptions } from "./gateway.js";

const log = createSubsystemLogger("self-update-tool");

const DEFAULT_UPDATE_TIMEOUT_MS = 20 * 60_000;

const SelfUpdateToolSchema = Type.Object({
  gatewayUrl: Type.Optional(Type.String()),
  gatewayToken: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
  sessionKey: Type.Optional(Type.String()),
  note: Type.Optional(Type.String()),
  restartDelayMs: Type.Optional(Type.Number()),
});

/**
 * A non-owner-only tool that only triggers `update.run` on the gateway.
 * Unlike the full `gateway` tool (which exposes config mutation and restart),
 * this tool is safe for any authorized sender.
 */
export function createSelfUpdateTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Self Update",
    name: "self_update",
    description:
      "Update Ironclaw to the latest version and restart the gateway. Use when the user asks to update, upgrade, or get the latest version.",
    parameters: SelfUpdateToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const gatewayOpts = readGatewayCallOptions(params);

      const sessionKey =
        typeof params.sessionKey === "string" && params.sessionKey.trim()
          ? params.sessionKey.trim()
          : opts?.agentSessionKey?.trim() || undefined;
      const note =
        typeof params.note === "string" && params.note.trim() ? params.note.trim() : undefined;
      const restartDelayMs =
        typeof params.restartDelayMs === "number" && Number.isFinite(params.restartDelayMs)
          ? Math.floor(params.restartDelayMs)
          : undefined;

      const updateTimeoutMs = gatewayOpts.timeoutMs ?? DEFAULT_UPDATE_TIMEOUT_MS;
      const updateGatewayOpts = {
        ...gatewayOpts,
        timeoutMs: updateTimeoutMs,
      };

      log.info(`self_update tool: update requested (sessionKey=${sessionKey ?? "none"})`);

      const result = await callGatewayTool("update.run", updateGatewayOpts, {
        sessionKey,
        note,
        restartDelayMs,
        timeoutMs: updateTimeoutMs,
      });
      return jsonResult({ ok: true, result });
    },
  };
}
