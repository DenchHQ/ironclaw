---
name: ship-changes
description: Group uncommitted changes into independent PRs with granular commit messages, thorough descriptions, and /e2e triggers. Use when the user wants to commit, create PRs, ship changes, or says "ship it", "commit and PR", or "clean up my changes".
---

# Ship Changes

Group uncommitted work into independent PRs — each with its own branch, commit(s), description, and optional `/e2e` trigger. PRs are not stacked; they all target the same base branch.

## Step 1: Analyze Uncommitted Changes

Run all of these to get the full picture:

```bash
# Current branch and base
git branch --show-current
git log --oneline staging..HEAD  # existing commits on branch

# All uncommitted changes
git status
git diff --stat                  # unstaged
git diff --cached --stat         # staged
git diff                         # unstaged content
git diff --cached                # staged content

# Untracked files
git ls-files --others --exclude-standard
```

Read the content of changed/new files as needed to understand what each change does.

## Step 2: Gather Context for the "Why"

Before grouping or writing anything, search for context that explains **why** these changes exist. This context feeds into commit messages, PR descriptions, and journey sections.

### Check for session handoffs

```bash
ls docs/session-handoffs/ 2>/dev/null
```

Read any handoff files found. Extract:

- The original goal and motivation
- Key decisions and their rationale
- Rejected approaches and why they were abandoned
- Discoveries or gotchas found along the way

### Check for planning docs

Search for related design docs, RFCs, or planning notes:

```bash
# Planning/design docs in the repo
find docs/ -name "*.md" 2>/dev/null | head -20
ls *.md 2>/dev/null

# Check if the branch name references an issue
git branch --show-current  # e.g. bp/feat-avatar-upload or issue-123-avatar
```

If the branch references a GitHub issue, read it:

```bash
gh issue view <number>
```

Read any related docs and extract the motivation, requirements, and design decisions.

### Build a context summary

Mentally assemble:

- **Why** this work was done (the problem or opportunity)
- **What approaches were considered** (and why some were rejected)
- **Key decisions** that shaped the implementation
- **Trade-offs** made and their rationale

This context is used in Steps 4 and 5.

## Step 3: Group Related Changes

Cluster changes into logical units. Each group becomes its own PR.

### Grouping Principles

| Signal                     | Inference                            |
| -------------------------- | ------------------------------------ |
| Same feature/domain        | Same PR                              |
| Type change + usage change | Same PR                              |
| Test + implementation      | Same PR                              |
| Config/infra change        | Separate PR                          |
| Unrelated bug fix          | Separate PR                          |
| Formatting/lint fix        | Separate PR (or bundle all together) |

A single-file change that's unrelated to everything else is its own PR. Don't force unrelated things together.

### Ordering

Create PRs in this order (earlier PRs should not depend on later ones):

1. Infrastructure / config / dependencies
2. Types / schemas / shared code
3. Core logic / business rules
4. API routes / integrations
5. UI components / pages
6. Tests
7. Cleanup / formatting

If two PRs truly depend on each other, note the dependency in each PR's description. But prefer independent PRs.

## Step 4: Propose PR Plan

Present the plan for approval:

```
## Proposed PRs

Base: staging

PR 1: type(scope): short description
  - path/to/file1.ts
  - path/to/file2.ts
  Why: [one sentence]

PR 2: type(scope): short description
  - path/to/file3.ts
  Why: [one sentence]

PR 3: ...

---
Does this grouping look right? I can adjust before creating.
```

**Wait for user approval before proceeding.**

## Step 5: Execute

After approval, create each PR.

### 5a. Save current state

```bash
ORIGINAL_BRANCH=$(git branch --show-current)

# Stash everything including untracked files
git stash push -u -m "ship-changes: temporary stash"
```

### 5b. Create each PR

For each group in the plan:

```bash
# Start from the base branch
git checkout staging
git checkout -b <prefix>/<n>-<brief-name>

# Restore only this group's files from the stash
git checkout stash@{0} -- <file1> <file2> ...

# Stage and commit
git add -A
git commit -m "$(cat <<'EOF'
type(scope): imperative description

Why this change matters in one sentence.
EOF
)"

# Push and create PR
git push -u origin HEAD
gh pr create --base staging --title "type(scope): concise title" --body "$(cat <<'EOF'
### changes

- [Each bullet: WHAT changed + WHY it was done this way]
- [Write for a reviewer who hasn't seen the code or the planning]

### why

[1-3 sentences: the problem or opportunity that motivated this work.]

### journey

<details>
<summary>Approaches considered & decisions made</summary>

[Summarize from session handoffs and planning docs. Keep it concise — only the important points:]

- **Approach tried/considered**: Why it was chosen or rejected
- **Key decision**: Rationale
- **Discovery/gotcha**: What we learned that shaped the implementation

</details>

### validate

- [ ] [Specific thing a reviewer should check or test]

### customer impact statement (for changelog)

[One sentence describing user-facing impact, or "No user-facing changes"]

### other notes

[Trade-offs, follow-ups, known limitations. Or "-" if none.]

### stack

<!-- branch-stack -->

### ci / cd

**migration test**: check the box below to run migration tests:

- [ ] Run migration test on DB

**evals**: check the box below to run AI evals:

- [ ] Run evals
EOF
)"
```

#### Trigger E2E test (per PR)

If the PR has user-facing changes, post a `/e2e` comment:

```bash
gh pr comment <PR_NUMBER> --body "/e2e <guidance>"
```

The guidance should name the specific user flow and page/route affected. Skip `/e2e` for PRs with no user-facing changes (refactor, config, docs) and note why.

### 5c. Clean up

After all PRs are created, the work is shipped — drop the stash and stay clean:

```bash
# Drop the stash — the changes now live in PR branches
git stash drop

# Stay on the last PR branch, or checkout the base branch
git checkout staging
```

Do NOT pop the stash back. The uncommitted changes are already in their PR branches.

### Commit Message Rules

- Format: `type(scope): description`
- Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`
- Subject line: max 72 chars, imperative mood ("add" not "added")
- Body: one sentence explaining the **why**, not the what
- Total: 2 lines max (subject + body)

### PR Title Rules

- Same conventional commit format as commit messages
- Keep under 72 chars

### PR Description Rules

- **changes**: One bullet per logical change. Each bullet explains both WHAT and WHY.
- **why**: The motivating problem or opportunity. Pull from session handoffs, planning docs, or issue descriptions. If nothing exists, derive from the code changes.
- **journey**: Only include if session handoffs or planning docs exist. Summarize paths taken, paths rejected, and key decisions. Keep in a `<details>` block so it doesn't overwhelm.
- **validate**: Concrete steps. "Works correctly" is too vague. "Navigate to /settings, toggle dark mode, verify styles update" is good.
- **customer impact**: Written for a changelog. If no user-facing change, say so.

## Step 6: Report

After all PRs are created, report them:

```
## Created PRs

✅ PR #101: fix(ui): increase button click target
   Base: staging
   URL: https://github.com/...

✅ PR #102: feat(db): add avatar_url to users
   Base: staging
   URL: https://github.com/...

✅ PR #103: feat(settings): add avatar upload
   Base: staging
   URL: https://github.com/...
   /e2e: posted
```

## Step 7: Update Docs (Optional)

If any PRs have user-facing changes, offer to update product docs. Follow the [update-docs skill](./update-docs/SKILL.md):

1. Collect the `### customer impact statement` from each created PR
2. Skip any marked "No user-facing changes"
3. **Changelog**: generate or append to today's entry
4. **Docs**: for new features, check if existing docs cover it — offer to create or update pages

## Pushing Fixes to Existing PRs

When a PR needs changes (review feedback, lint fixes, etc.):

```bash
# Switch to the PR branch
git checkout <branch-name>

# Make changes, then commit and push
git add <files>
git commit -m "$(cat <<'EOF'
fix(scope): address review feedback

Brief explanation of what was fixed and why.
EOF
)"
git push
```

If you don't remember the branch name:

```bash
gh pr list --author @me --state open
gh pr checkout <PR_NUMBER>
```

## Complete Example

```
$ git status
M  packages/db/src/queries/users.ts
M  packages/db/src/schema/users.ts
M  apps/nextjs-app/app/settings/page.tsx
M  apps/nextjs-app/components/settings/profile-form.tsx
A  apps/nextjs-app/components/settings/avatar-upload.tsx
M  packages/ui/src/button.tsx

$ ls docs/session-handoffs/
2026-02-18-avatar-upload.md

## Context gathered:
- Goal: Let users set a profile avatar (requested by 3 enterprise customers)
- Rejected: Client-side image cropping (too complex for v1, can add later)
- Decision: Store in GCS, serve via CDN URL in avatar_url column
- Gotcha: Needed to update the users query layer, not just schema

## Proposed PRs

Base: staging

PR 1: fix(ui): increase button click target
  - packages/ui/src/button.tsx
  Why: Below WCAG 44px minimum for touch targets.

PR 2: feat(db): add avatar_url to users schema and queries
  - packages/db/src/schema/users.ts
  - packages/db/src/queries/users.ts
  Why: Backend support for avatar upload feature.

PR 3: feat(settings): add avatar upload to profile settings
  - apps/nextjs-app/app/settings/page.tsx
  - apps/nextjs-app/components/settings/profile-form.tsx
  - apps/nextjs-app/components/settings/avatar-upload.tsx
  Why: Users can upload and change their profile avatar.

## Created PRs

✅ PR #101: fix(ui): increase button click target
   Base: staging — no /e2e (no user flow change)

✅ PR #102: feat(db): add avatar_url to users
   Base: staging — no /e2e (backend-only)

✅ PR #103: feat(settings): add avatar upload
   Base: staging
   /e2e: test avatar upload on profile settings — upload image, verify it displays
```
