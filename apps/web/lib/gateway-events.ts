/**
 * Persistent WebSocket connection to the OpenClaw gateway daemon.
 *
 * Lazily initialized when the first subagent is detected. Receives
 * broadcast agent events and routes them to the SubagentRunManager
 * for live streaming in the web UI.
 */
import WebSocket from "ws";
import { randomUUID } from "node:crypto";

export type GatewayEvent = {
	event: string;
	payload?: Record<string, unknown>;
	seq?: number;
};

type GatewayEventListener = (evt: GatewayEvent) => void;

const GLOBAL_KEY = "__openclaw_gatewayEvents" as const;
const DEFAULT_PORT = 18789;
const PROTOCOL_VERSION = 3;

type GatewayConnection = {
	ws: WebSocket | null;
	closed: boolean;
	backoffMs: number;
	listeners: Set<GatewayEventListener>;
	subscribedKeys: Set<string>;
	reconnectTimer: ReturnType<typeof setTimeout> | null;
};

function getConnection(): GatewayConnection {
	const existing = (globalThis as Record<string, unknown>)[GLOBAL_KEY] as
		| GatewayConnection
		| undefined;
	if (existing) {return existing;}

	const conn: GatewayConnection = {
		ws: null,
		closed: false,
		backoffMs: 1000,
		listeners: new Set(),
		subscribedKeys: new Set(),
		reconnectTimer: null,
	};
	(globalThis as Record<string, unknown>)[GLOBAL_KEY] = conn;
	return conn;
}

function resolveGatewayUrl(): string {
	const envPort =
		process.env.OPENCLAW_GATEWAY_PORT?.trim() ||
		process.env.CLAWDBOT_GATEWAY_PORT?.trim();
	const port = envPort ? Number.parseInt(envPort, 10) || DEFAULT_PORT : DEFAULT_PORT;
	return `ws://127.0.0.1:${port}`;
}

function resolveAuthToken(): string | undefined {
	return (
		process.env.OPENCLAW_GATEWAY_TOKEN?.trim() ||
		process.env.CLAWDBOT_GATEWAY_TOKEN?.trim() ||
		undefined
	);
}

function connect(conn: GatewayConnection): void {
	if (conn.closed || conn.ws) {return;}

	const url = resolveGatewayUrl();
	let connectSent = false;

	try {
		const ws = new WebSocket(url, { maxPayload: 5 * 1024 * 1024 });
		conn.ws = ws;

		ws.on("open", () => {
			// Wait for connect.challenge before sending connect
		});

		ws.on("message", (data) => {
			try {
				const raw = typeof data === "string" ? data : data.toString("utf-8");
				const msg = JSON.parse(raw);

				// Event frame: { type: "evt", event, payload, seq }
				if (msg.type === "evt") {
					if (msg.event === "connect.challenge" && !connectSent) {
						connectSent = true;
						sendConnectRequest(ws, msg.payload?.nonce);
						return;
					}
					if (msg.event === "tick") {return;}

					const evt: GatewayEvent = {
						event: msg.event,
						payload: msg.payload,
						seq: msg.seq,
					};
					for (const listener of conn.listeners) {
						try { listener(evt); } catch { /* ignore */ }
					}
					return;
				}

				// Response frame: { type: "res", id, ok, payload }
				if (msg.type === "res" && msg.ok) {
					conn.backoffMs = 1000;
				}
			} catch {
				// ignore parse errors
			}
		});

		ws.on("close", () => {
			conn.ws = null;
			scheduleReconnect(conn);
		});

		ws.on("error", () => {
			// Error events are followed by close; reconnect handled there.
		});
	} catch {
		conn.ws = null;
		scheduleReconnect(conn);
	}
}

function sendConnectRequest(ws: WebSocket, nonce?: string): void {
	const token = resolveAuthToken();
	const id = randomUUID();
	const frame = {
		type: "req",
		id,
		method: "connect",
		params: {
			minProtocol: PROTOCOL_VERSION,
			maxProtocol: PROTOCOL_VERSION,
			client: {
				id: "web-subagent-listener",
				displayName: "Web Subagent Listener",
				version: "dev",
				platform: process.platform,
				mode: "backend",
				instanceId: randomUUID(),
			},
			caps: [],
			...(nonce ? { nonce } : {}),
			...(token ? { auth: { token } } : {}),
			role: "operator",
			scopes: ["operator.admin"],
		},
	};
	ws.send(JSON.stringify(frame));
}

function scheduleReconnect(conn: GatewayConnection): void {
	if (conn.closed || conn.subscribedKeys.size === 0) {return;}
	if (conn.reconnectTimer) {return;}

	const delay = conn.backoffMs;
	conn.backoffMs = Math.min(conn.backoffMs * 2, 30_000);
	conn.reconnectTimer = setTimeout(() => {
		conn.reconnectTimer = null;
		connect(conn);
	}, delay);
}

/**
 * Ensure the gateway connection is active and subscribe to events
 * for a specific session key. Returns an unsubscribe function.
 */
export function subscribeToSessionKey(
	sessionKey: string,
	callback: GatewayEventListener,
): () => void {
	const conn = getConnection();
	conn.subscribedKeys.add(sessionKey);

	const filtered: GatewayEventListener = (evt) => {
		const evtSessionKey =
			typeof evt.payload?.sessionKey === "string"
				? evt.payload.sessionKey
				: undefined;
		if (evtSessionKey === sessionKey) {
			callback(evt);
		}
	};

	conn.listeners.add(filtered);

	// Ensure connection is live
	if (!conn.ws && !conn.closed) {
		connect(conn);
	}

	return () => {
		conn.listeners.delete(filtered);
		conn.subscribedKeys.delete(sessionKey);
		// If no more subscriptions, let the connection close naturally
	};
}

/** Shut down the gateway connection (e.g. during cleanup). */
export function closeGatewayConnection(): void {
	const conn = getConnection();
	conn.closed = true;
	if (conn.reconnectTimer) {
		clearTimeout(conn.reconnectTimer);
		conn.reconnectTimer = null;
	}
	conn.ws?.close();
	conn.ws = null;
	conn.listeners.clear();
	conn.subscribedKeys.clear();
}
