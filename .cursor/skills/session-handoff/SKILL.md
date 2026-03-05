---
name: session-handoff
description: Generate a concise markdown summary of the current chat session to carry context into a new agent session. Captures goals, decisions, rejected approaches, current state, and next steps. Use when the user asks to summarize a session, hand off context, create a session summary, or says things like "wrap up", "session notes", or "capture context".
---

# Session Handoff

Generate a markdown summary that preserves critical context from the current chat session so a new agent can pick up where this one left off.

## When to Use

Only when the user explicitly requests it (e.g. "summarize this session", "create a handoff", "wrap up session").

## Process

1. Review the full conversation history
2. Extract information for each section below
3. Write the summary using the template
4. Save to `docs/session-handoffs/YYYY-MM-DD-<slug>.md` (create the directory if needed)
5. Tell the user the file path so they can attach it to the next session

## What to Capture

Focus on information a fresh agent **cannot infer** from the codebase alone:

- **Rationale** behind decisions (the "why", not the "what")
- **Rejected approaches** and why they failed or were abandoned
- **Discoveries** — gotchas, constraints, or surprising behavior found during the session
- **Unfinished work** — what's in progress, what's blocked, what's next
- **Agreements** — anything the user confirmed or directed that shaped the approach

Omit anything obvious from reading the code or git diff.

## Template

Use this structure. Omit any section that has nothing meaningful to add.

```markdown
# Session Handoff — [Brief Title]

**Date**: YYYY-MM-DD
**Branch**: `branch-name`

## Goal

One or two sentences describing what we set out to accomplish.

## What Was Accomplished

- Bullet list of completed work
- Reference specific files/functions where helpful

## Key Decisions

| Decision           | Rationale   |
| ------------------ | ----------- |
| Chose X over Y     | Because Z   |
| Structured it as A | To enable B |

## Rejected Approaches

- **Approach name**: Why it was rejected (1-2 sentences)

## Discoveries & Gotchas

- Surprising behavior, constraints, or domain knowledge found during the session
- Things a new agent would trip over without this context

## Current State

Brief description of where things stand right now. Include:

- What's working
- What's broken or incomplete
- Any failing tests or lint errors

## Open Questions

- Unresolved decisions or things to investigate
- Questions that came up but weren't answered

## Suggested Next Steps

1. Ordered list of what to do next
2. Include enough context for each step to be actionable

## Key Files

Files that are central to this work (not every file touched — just the important ones):

- `path/to/file.ts` — brief note on its role
```

## Guidelines

- **Be concise.** Target 50-150 lines. A new agent reads this alongside everything else in its context window.
- **Be specific.** "Refactored chat service" is useless. "Extracted message-building helpers from `chat-service.ts` into `chat-service-helpers.ts` to isolate pure logic for testing" is useful.
- **Capture tension.** If there was a tradeoff or disagreement, note both sides.
- **Skip the obvious.** Don't summarize what the code already says. Focus on context that lives only in this conversation.
