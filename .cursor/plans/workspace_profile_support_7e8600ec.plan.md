---
name: Workspace profile support
overview: Add full workspace profile and custom path support to the Ironclaw web app and the dench SKILL.md, so they respect OPENCLAW_PROFILE, OPENCLAW_HOME, OPENCLAW_STATE_DIR, and per-agent workspace config — matching the CLI's existing resolution logic.
todos:
  - id: centralize-helpers
    content: Add resolveOpenClawStateDir() to apps/web/lib/workspace.ts and update resolveWorkspaceRoot() with OPENCLAW_PROFILE + OPENCLAW_HOME + OPENCLAW_STATE_DIR support
    status: pending
  - id: fix-api-routes
    content: Replace all hardcoded join(homedir(), '.openclaw', ...) in ~13 web app API routes/lib files with the new shared helpers
    status: pending
  - id: fix-empty-state-ui
    content: Make empty-state.tsx show the resolved workspace path dynamically instead of hardcoded ~/.openclaw/workspace
    status: pending
  - id: fix-system-prompt
    content: Replace hardcoded ~/.openclaw/web-chat/ in system-prompt.ts line 173 with a dynamic path from the state dir context
    status: pending
  - id: skill-substitution
    content: Add workspace path substitution in buildWorkspaceSkillSnapshot() so injected SKILL.md content replaces ~/.openclaw/workspace with the actual resolved workspace dir
    status: pending
  - id: tree-api-profile
    content: Expose active profile name in the tree API response so the UI can show profile-aware workspace labels
    status: pending
isProject: false
---

# Full Workspace Profile and Custom Path Support

## Problem

The CLI core (`src/agents/workspace.ts`, `src/config/paths.ts`) already resolves workspace paths dynamically via `OPENCLAW_PROFILE`, `OPENCLAW_HOME`, `OPENCLAW_STATE_DIR`, and per-agent config — but the web app (`apps/web/`) and the injected dench skill (`skills/dench/SKILL.md`) hardcode `~/.openclaw` and `~/.openclaw/workspace` everywhere, ignoring profiles entirely.

**35 hardcoded `~/.openclaw` references** in `SKILL.md`, and **~15 hardcoded paths** across the web app API routes and UI.

## Approach

### 1. Centralize path resolution in the web app

Create two new helpers in [apps/web/lib/workspace.ts](apps/web/lib/workspace.ts) and update the existing `resolveWorkspaceRoot()`:

- `**resolveOpenClawStateDir()**` — mirrors `src/config/paths.ts:resolveStateDir()` logic: checks `OPENCLAW_STATE_DIR` env var, then `OPENCLAW_HOME`, falls back to `~/.openclaw`. Returns the base state directory (e.g. `~/.openclaw`).
- **Update `resolveWorkspaceRoot()**`— add`OPENCLAW_PROFILE`awareness between the`OPENCLAW_WORKSPACE` check and the fallback:
  1. `OPENCLAW_WORKSPACE` env var (existing)
  2. `OPENCLAW_PROFILE` -> `<stateDir>/workspace-<profile>` (new)
  3. `<stateDir>/workspace` (existing, but now uses `resolveOpenClawStateDir()` instead of hardcoded `~/.openclaw`)

```typescript
export function resolveOpenClawStateDir(): string {
  const override = process.env.OPENCLAW_STATE_DIR?.trim();
  if (override) return override.startsWith("~") ? join(homedir(), override.slice(1)) : override;
  const home = process.env.OPENCLAW_HOME?.trim() || homedir();
  return join(home, ".openclaw");
}

export function resolveWorkspaceRoot(): string | null {
  const stateDir = resolveOpenClawStateDir();
  const profile = process.env.OPENCLAW_PROFILE?.trim();
  const candidates = [
    process.env.OPENCLAW_WORKSPACE,
    profile && profile.toLowerCase() !== "default" ? join(stateDir, `workspace-${profile}`) : null,
    join(stateDir, "workspace"),
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return null;
}
```

### 2. Replace all hardcoded paths in web app API routes

Every file below uses `join(homedir(), ".openclaw", ...)` directly. Replace with calls to `resolveOpenClawStateDir()` or `resolveWorkspaceRoot()`:

| File                                                    | What to change                                                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/app/api/workspace/tree/route.ts`              | `join(home, ".openclaw", "skills")` and `join(home, ".openclaw")` -> `resolveOpenClawStateDir()`                                           |
| `apps/web/app/api/workspace/virtual-file/route.ts`      | All 6 hardcoded paths in `resolveVirtualPath()` and `isSafePath()` -> derive from `resolveWorkspaceRoot()` and `resolveOpenClawStateDir()` |
| `apps/web/app/api/skills/route.ts`                      | `join(openclawDir, "skills")` and `join(openclawDir, "workspace", "skills")` -> use both helpers                                           |
| `apps/web/app/api/sessions/route.ts`                    | `resolveOpenClawDir()` local helper -> use shared `resolveOpenClawStateDir()`                                                              |
| `apps/web/app/api/memories/route.ts`                    | `join(homedir(), ".openclaw", "workspace")` -> `resolveWorkspaceRoot()`                                                                    |
| `apps/web/app/api/cron/jobs/route.ts`                   | Module-level `CRON_DIR` and `agentsDir` -> derive from `resolveOpenClawStateDir()`                                                         |
| `apps/web/app/api/cron/runs/search-transcript/route.ts` | agents dir -> `resolveOpenClawStateDir()`                                                                                                  |
| `apps/web/app/api/cron/runs/[sessionId]/route.ts`       | agents dir -> `resolveOpenClawStateDir()`                                                                                                  |
| `apps/web/app/api/cron/jobs/[jobId]/runs/route.ts`      | if hardcoded -> `resolveOpenClawStateDir()`                                                                                                |
| `apps/web/app/api/web-sessions/route.ts`                | `WEB_CHAT_DIR` -> derive from `resolveOpenClawStateDir()`                                                                                  |
| `apps/web/app/api/web-sessions/[id]/route.ts`           | same                                                                                                                                       |
| `apps/web/app/api/web-sessions/[id]/messages/route.ts`  | same                                                                                                                                       |
| `apps/web/lib/active-runs.ts`                           | `WEB_CHAT_DIR` -> derive from `resolveOpenClawStateDir()`                                                                                  |

### 3. Update the UI empty state

In [apps/web/app/components/workspace/empty-state.tsx](apps/web/app/components/workspace/empty-state.tsx) (line 128): the hardcoded `~/.openclaw/workspace` display string should be dynamic. Two options:

- **Option A**: Pass the resolved workspace path from the tree API response (it already returns `workspaceRoot`). The empty state can show that or a user-friendly tilde-collapsed version.
- **Option B**: Add an API endpoint or server component that returns the expected workspace path.

Option A is simplest — the tree API already returns `openclawDir` and `workspaceRoot`. Thread the expected path into the empty state component.

### 4. Fix hardcoded path in system prompt

In [src/agents/system-prompt.ts](src/agents/system-prompt.ts) line 173: the hardcoded `~/.openclaw/web-chat/` should use the `workspaceDir` parameter (or derive from the state dir that's already available in the prompt builder context). Replace with a template string that references the actual state directory.

### 5. Add workspace variable substitution for injected SKILL.md content

The dench `SKILL.md` has **35 instances** of `~/.openclaw/workspace`. Since this content is injected verbatim into the system prompt via `readSkillContent()`, we need a substitution mechanism.

In [src/agents/skills/workspace.ts](src/agents/skills/workspace.ts) around line 271 where `readSkillContent()` is called for injected skills:

```typescript
// After reading content, substitute workspace path placeholders
const content = readSkillContent(entry.skill.filePath);
if (content) {
  const resolved = content.replaceAll("~/.openclaw/workspace", workspaceDir);
  injectedSkills.push({ name: entry.skill.name, content: resolved });
}
```

This requires threading `workspaceDir` into `buildWorkspaceSkillSnapshot()` — which it already receives as its first argument.

Then update `skills/dench/SKILL.md` to use `~/.openclaw/workspace` as a canonical placeholder (it already does), and the substitution will replace it with the actual resolved path at injection time. No changes needed to the SKILL.md content itself.

### 6. Expose workspace info in the tree API response

The tree API ([apps/web/app/api/workspace/tree/route.ts](apps/web/app/api/workspace/tree/route.ts)) already returns `workspaceRoot` and `openclawDir`. Consider also returning `profile` (from `OPENCLAW_PROFILE`) so the UI can display profile-aware context (e.g. "Workspace (staging)" in the sidebar).
