# Clawdbot ACP Bridge

This document describes how the Clawdbot ACP (Agent Client Protocol) bridge works,
how it maps ACP sessions to Gateway sessions, and how IDEs should invoke it.

## Overview

`clawdbot acp` exposes an ACP agent over stdio and forwards prompts to a running
Clawdbot Gateway over WebSocket. It keeps ACP session ids mapped to Gateway
session keys so IDEs can reconnect to the same agent transcript or reset it on
request.

Key goals:

- Minimal ACP surface area (stdio, NDJSON).
- Stable session mapping across reconnects.
- Works with existing Gateway session store (list/resolve/reset).
- Safe defaults (isolated ACP session keys by default).

## Execution Model

- ACP client spawns `clawdbot acp` and speaks ACP messages over stdio.
- The bridge connects to the Gateway using existing auth config (or CLI flags).
- ACP `prompt` translates to Gateway `chat.send`.
- Gateway streaming events are translated back into ACP streaming events.
- ACP `cancel` maps to Gateway `chat.abort` for the active run.

## Session Mapping

By default each ACP session is mapped to a dedicated Gateway session key:

- `acp:<uuid>` unless overridden.

You can override or reuse sessions in two ways:

1) CLI defaults

```bash
clawdbot acp --session agent:main:main
clawdbot acp --session-label "support inbox"
clawdbot acp --reset-session
```

2) ACP metadata per session

```json
{
  "_meta": {
    "sessionKey": "agent:main:main",
    "sessionLabel": "support inbox",
    "resetSession": true,
    "requireExisting": false
  }
}
```

Rules:

- `sessionKey`: direct Gateway session key.
- `sessionLabel`: resolve an existing session by label.
- `resetSession`: mint a new transcript for the key before first use.
- `requireExisting`: fail if the key/label does not exist.

### Session Listing

ACP `listSessions` maps to Gateway `sessions.list` and returns a filtered
summary suitable for IDE session pickers. `_meta.limit` can cap the number of
sessions returned.

## Prompt Translation

ACP prompt inputs are converted into a Gateway `chat.send`:

- `text` and `resource` blocks become prompt text.
- `resource_link` with image mime types become attachments.
- The working directory can be prefixed into the prompt (default on, can be
  disabled with `--no-prefix-cwd`).

Gateway streaming events are translated into ACP `message` and `tool_call`
updates. Terminal Gateway states map to ACP `done` with stop reasons:

- `complete` -> `stop`
- `aborted` -> `cancel`
- `error` -> `error`

## Auth + Gateway Discovery

`clawdbot acp` resolves the Gateway URL and auth from CLI flags or config:

- `--url` / `--token` / `--password` take precedence.
- Otherwise use configured `gateway.remote.*` settings.

## Operational Notes

- ACP sessions are stored in memory for the bridge process lifetime.
- Gateway session state is persisted by the Gateway itself.
- `--verbose` logs ACP/Gateway bridge events to stderr (never stdout).
- ACP runs can be canceled and the active run id is tracked per session.

## Compatibility

- ACP bridge uses `@agentclientprotocol/sdk` (currently 0.13.x).
- Works with ACP clients that implement `initialize`, `newSession`,
  `loadSession`, `prompt`, `cancel`, and `listSessions`.

## Testing

- Unit: `src/acp/session.test.ts` covers run id lifecycle.
- Full gate: `pnpm lint && pnpm build && pnpm test && pnpm docs:build`.

## Related Docs

- CLI usage: `docs/cli/acp.md`
- Session model: `docs/concepts/session.md`
- Session management internals: `docs/reference/session-management-compaction.md`
