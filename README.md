# Ironclaw

**AI-powered CRM platform with multi-channel agent gateway, DuckDB workspace, and knowledge management.**

<p align="center">
  <a href="https://www.npmjs.com/package/ironclaw"><img src="https://img.shields.io/npm/v/ironclaw?style=for-the-badge&color=000" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

---

Ironclaw is a personal AI assistant and CRM toolkit that runs on your own devices. It connects to your existing messaging channels (WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, iMessage, Microsoft Teams, and more), manages structured data through a DuckDB-powered workspace, and provides a rich web interface for knowledge management and reporting.

Built on [OpenClaw](https://github.com/openclaw/openclaw) with **Vercel AI SDK v6** as the default LLM orchestration layer.

## Features

- **Multi-channel inbox** -- WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, iMessage, Microsoft Teams, Matrix, WebChat, and more.
- **DuckDB workspace** -- Structured data objects, file management, full-text search, and bulk operations through a local DuckDB-backed store.
- **Web UI (Dench)** -- Modern chat interface with chain-of-thought reasoning, report cards, media viewer, and a database explorer. Supports light and dark themes.
- **Agent gateway** -- Local-first WebSocket control plane for sessions, channels, tools, and events. Routes agent execution through lane-based concurrency.
- **Vercel AI SDK v6** -- Default LLM engine with support for Anthropic, OpenAI, Google, Groq, Mistral, xAI, OpenRouter, and Azure. Full extended thinking/reasoning support.
- **Knowledge management** -- File tree, search index, workspace objects with custom fields, and entry-level detail views.
- **TanStack data tables** -- Sortable, filterable, bulk-selectable tables for workspace objects powered by `@tanstack/react-table`.
- **Companion apps** -- macOS menu bar app, iOS/Android nodes with voice, camera, and canvas capabilities.
- **Skills platform** -- Bundled, managed, and workspace-scoped skills with install gating.

## Install

**Runtime: Node 22+**

### From npm

```bash
npm install -g ironclaw@latest

ironclaw onboard --install-daemon
```

### From source

```bash
git clone https://github.com/kumarabhirup/openclaw-ai-sdk.git
cd openclaw-ai-sdk

pnpm install
pnpm build

pnpm dev onboard --install-daemon
```

## Quick start

```bash
# Start the gateway
ironclaw gateway --port 18789 --verbose

# Send a message
ironclaw message send --to +1234567890 --message "Hello from Ironclaw"

# Talk to the agent
ironclaw agent --message "Summarize today's tasks" --thinking high
```

## Web UI

The web application lives in `apps/web/` and is built with Next.js. It provides:

- **Chat panel** with streaming responses, chain-of-thought display, and markdown rendering (via `react-markdown` + `remark-gfm`).
- **Workspace sidebar** with a file manager tree, knowledge tree, and database viewer.
- **Object tables** with sorting, filtering, row selection, and bulk delete.
- **Entry detail modals** with field editing and media previews.
- **Report cards** with chart panels and filter bars.
- **Media viewer** supporting images, video, audio, and PDFs.

To run the web UI in development:

```bash
cd apps/web
pnpm install
pnpm dev
```

## Configuration

Ironclaw stores its config at `~/.openclaw/openclaw.json`. Minimal example:

```json5
{
  agent: {
    model: "anthropic/claude-opus-4-6",
  },
}
```

### Supported providers

| Provider   | Environment Variable           | Models                            |
| ---------- | ------------------------------ | --------------------------------- |
| Anthropic  | `ANTHROPIC_API_KEY`            | Claude 4/3.x, Opus, Sonnet, Haiku |
| OpenAI     | `OPENAI_API_KEY`               | GPT-4o, GPT-4, o1, o3             |
| Google     | `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini 2.x, 1.5 Pro               |
| OpenRouter | `OPENROUTER_API_KEY`           | 100+ models                       |
| Groq       | `GROQ_API_KEY`                 | Llama, Mixtral                    |
| Mistral    | `MISTRAL_API_KEY`              | Mistral models                    |
| xAI        | `XAI_API_KEY`                  | Grok models                       |
| Azure      | `AZURE_OPENAI_API_KEY`         | Azure OpenAI models               |

### Thinking / reasoning

```bash
# Set thinking level (maps to AI SDK budgetTokens)
ironclaw agent --message "Complex analysis" --thinking high

# Levels: off, minimal, low, medium, high, xhigh
```

## Channel setup

Each channel is configured in `~/.openclaw/openclaw.json` under `channels.*`:

- **WhatsApp** -- Link via `ironclaw channels login`. Set `channels.whatsapp.allowFrom`.
- **Telegram** -- Set `TELEGRAM_BOT_TOKEN` or `channels.telegram.botToken`.
- **Slack** -- Set `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN`.
- **Discord** -- Set `DISCORD_BOT_TOKEN` or `channels.discord.token`.
- **Signal** -- Requires `signal-cli` + `channels.signal` config.
- **iMessage** -- Via BlueBubbles (recommended) or legacy macOS-only integration.
- **Microsoft Teams** -- Configure a Teams app + Bot Framework.
- **WebChat** -- Uses the Gateway WebSocket directly, no extra config.

## Chat commands

Send these in any connected channel:

| Command                       | Description                     |
| ----------------------------- | ------------------------------- |
| `/status`                     | Session status (model + tokens) |
| `/new` or `/reset`            | Reset the session               |
| `/compact`                    | Compact session context         |
| `/think <level>`              | Set thinking level              |
| `/verbose on\|off`            | Toggle verbose output           |
| `/usage off\|tokens\|full`    | Per-response usage footer       |
| `/restart`                    | Restart the gateway             |
| `/activation mention\|always` | Group activation toggle         |

## Architecture

```
WhatsApp / Telegram / Slack / Discord / Signal / iMessage / Teams / WebChat
               |
               v
  +----------------------------+
  |          Gateway           |
  |     (control plane)        |
  |   ws://127.0.0.1:18789    |
  +-------------+--------------+
                |
                +-- Vercel AI SDK v6 engine
                +-- CLI (ironclaw ...)
                +-- Web UI (Dench)
                +-- macOS app
                +-- iOS / Android nodes
```

## Project structure

```
src/              Core CLI, commands, gateway, agent, media pipeline
apps/web/         Next.js web UI (Dench)
apps/ios/         iOS companion node
apps/android/     Android companion node
apps/macos/       macOS menu bar app
extensions/       Channel plugins (MS Teams, Matrix, Zalo, voice-call)
docs/             Documentation
scripts/          Build, deploy, and utility scripts
skills/           Workspace skills
```

## Development

```bash
pnpm install          # Install deps
pnpm build            # Type-check + build
pnpm check            # Lint + format check
pnpm test             # Run tests (vitest)
pnpm test:coverage    # Tests with coverage
pnpm dev              # Dev mode (auto-reload)
```

## Security

- DM pairing is enabled by default -- unknown senders receive a pairing code.
- Approve senders with `ironclaw pairing approve <channel> <code>`.
- Non-main sessions can be sandboxed in Docker (`agents.defaults.sandbox.mode: "non-main"`).
- Run `ironclaw doctor` to surface risky or misconfigured DM policies.

## Upstream

Ironclaw is a fork of [OpenClaw](https://github.com/openclaw/openclaw). To sync with upstream:

```bash
git remote add upstream https://github.com/openclaw/openclaw.git
git fetch upstream
git merge upstream/main
```

## License

[MIT](LICENSE)
