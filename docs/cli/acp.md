---
summary: "Run the ACP bridge for IDE integrations"
read_when:
  - Setting up ACP-based IDE integrations
  - Debugging ACP session routing to the Gateway
---

# acp

Run the ACP (Agent Client Protocol) bridge that talks to a Clawdbot Gateway.

This command speaks ACP over stdio for IDEs and forwards prompts to the Gateway
over WebSocket. It keeps ACP sessions mapped to Gateway session keys.

## Usage

```bash
clawdbot acp

# Remote Gateway
clawdbot acp --url wss://gateway-host:18789 --token <token>

# Attach to an existing session key
clawdbot acp --session agent:main:main

# Attach by label (must already exist)
clawdbot acp --session-label "support inbox"

# Reset the session key before the first prompt
clawdbot acp --session agent:main:main --reset-session
```

## Session mapping

By default, ACP sessions get an isolated Gateway session key with an `acp:` prefix.
To reuse a known session, pass a session key or label:

- `--session <key>`: use a specific Gateway session key.
- `--session-label <label>`: resolve an existing session by label.
- `--reset-session`: mint a fresh session id for that key (same key, new transcript).

If your ACP client supports metadata, you can override per session:

```json
{
  "_meta": {
    "sessionKey": "agent:main:main",
    "sessionLabel": "support inbox",
    "resetSession": true
  }
}
```

Learn more about session keys at [/concepts/session](/concepts/session).

## Options

- `--url <url>`: Gateway WebSocket URL (defaults to gateway.remote.url when configured).
- `--token <token>`: Gateway auth token.
- `--password <password>`: Gateway auth password.
- `--session <key>`: default session key.
- `--session-label <label>`: default session label to resolve.
- `--require-existing`: fail if the session key/label does not exist.
- `--reset-session`: reset the session key before first use.
- `--no-prefix-cwd`: do not prefix prompts with the working directory.
- `--verbose, -v`: verbose logging to stderr.
