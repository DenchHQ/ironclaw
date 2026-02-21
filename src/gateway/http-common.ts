import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayAuthResult } from "./auth.js";
import { readJsonBody } from "./hooks.js";

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export function sendText(res: ServerResponse, status: number, body: string) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(body);
}

export function sendMethodNotAllowed(res: ServerResponse, allow = "POST") {
  res.setHeader("Allow", allow);
  sendText(res, 405, "Method Not Allowed");
}

export function sendUnauthorized(res: ServerResponse, reason?: string) {
  sendJson(res, 401, {
    error: {
      message: reason ?? "Unauthorized — check your gateway auth token or password",
      type: "unauthorized",
    },
  });
}

export function sendRateLimited(res: ServerResponse, retryAfterMs?: number) {
  if (retryAfterMs && retryAfterMs > 0) {
    res.setHeader("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
  }
  sendJson(res, 429, {
    error: {
      message: "Too many failed authentication attempts. Please try again later.",
      type: "rate_limited",
    },
  });
}

export function sendGatewayAuthFailure(res: ServerResponse, authResult: GatewayAuthResult) {
  if (authResult.rateLimited) {
    sendRateLimited(res, authResult.retryAfterMs);
    return;
  }
  const reason = authResult.reason;
  const message = reason
    ? formatHttpAuthFailureReason(reason)
    : "Unauthorized — check your gateway auth token or password";
  sendUnauthorized(res, message);
}

function formatHttpAuthFailureReason(reason: string): string {
  switch (reason) {
    case "token_missing":
      return "Gateway token missing — provide OPENCLAW_GATEWAY_TOKEN or set gateway.auth.token in your config";
    case "token_mismatch":
      return "Gateway token mismatch — the provided token does not match the gateway. Check OPENCLAW_GATEWAY_TOKEN or gateway.auth.token";
    case "token_missing_config":
      return "Gateway token not configured on the server — set gateway.auth.token or OPENCLAW_GATEWAY_TOKEN on the gateway host";
    case "password_missing":
      return "Gateway password missing — provide OPENCLAW_GATEWAY_PASSWORD or set gateway.auth.password in your config";
    case "password_mismatch":
      return "Gateway password mismatch — the provided password does not match the gateway. Check OPENCLAW_GATEWAY_PASSWORD or gateway.auth.password";
    case "password_missing_config":
      return "Gateway password not configured on the server — set gateway.auth.password or OPENCLAW_GATEWAY_PASSWORD on the gateway host";
    case "trusted_proxy_config_missing":
      return "Trusted proxy mode enabled but no proxy config found — set gateway.auth.trustedProxy in your config";
    case "trusted_proxy_no_proxies_configured":
      return "Trusted proxy mode enabled but gateway.trustedProxies is empty — add at least one trusted proxy IP";
    case "trusted_proxy_untrusted_source":
      return "Request did not come from a trusted proxy — check gateway.trustedProxies includes your proxy's IP";
    case "trusted_proxy_user_missing":
      return "Trusted proxy did not provide a user identity header — check your proxy forwards the configured userHeader";
    case "trusted_proxy_user_not_allowed":
      return "User not in the trusted proxy allowUsers list — add the user to gateway.auth.trustedProxy.allowUsers";
    case "device_token_mismatch":
      return "Device token mismatch — rotate or reissue the device token";
    case "rate_limited":
      return "Too many failed authentication attempts — wait and retry later";
    default:
      return `Unauthorized (${reason})`;
  }
}

export function sendInvalidRequest(res: ServerResponse, message: string) {
  sendJson(res, 400, {
    error: { message, type: "invalid_request_error" },
  });
}

export async function readJsonBodyOrError(
  req: IncomingMessage,
  res: ServerResponse,
  maxBytes: number,
): Promise<unknown> {
  const body = await readJsonBody(req, maxBytes);
  if (!body.ok) {
    if (body.error === "payload too large") {
      sendJson(res, 413, {
        error: { message: "Payload too large", type: "invalid_request_error" },
      });
      return undefined;
    }
    if (body.error === "request body timeout") {
      sendJson(res, 408, {
        error: { message: "Request body timeout", type: "invalid_request_error" },
      });
      return undefined;
    }
    sendInvalidRequest(res, body.error);
    return undefined;
  }
  return body.value;
}

export function writeDone(res: ServerResponse) {
  res.write("data: [DONE]\n\n");
}

export function setSseHeaders(res: ServerResponse) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}
