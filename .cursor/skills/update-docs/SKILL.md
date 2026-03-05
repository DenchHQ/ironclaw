---
name: update-docs
description: Update product documentation and changelog after shipping features. Generates changelog MDX entries, creates or updates guide/reference pages in apps/product-docs/, and updates docs.json navigation. Use when the user says "update docs", "update changelog", "write release notes", "add docs for this feature", or after shipping PRs with user-facing changes.
---

# Update Product Docs

Update `apps/product-docs/` after shipping changes. Covers two things:

1. **Changelog entries** — what changed and when
2. **Documentation pages** — guides, reference docs, and feature pages

---

## Part 1: Changelog

### Step 1: Collect Customer Impact Statements

**From PRs:**

```bash
gh pr list --state merged --limit 20 --json number,title,body
# Or for specific PRs
gh pr view <NUMBER> --json title,body
```

Extract the `### customer impact statement` from each PR body. Skip PRs marked "No user-facing changes".

**From local changes** (no PRs yet): read the changed files and write impact statements. Focus on what the **user** sees, not implementation details.

### Step 2: Categorize

| Category         | When to use                                   |
| ---------------- | --------------------------------------------- |
| **New Features** | Entirely new capability users didn't have     |
| **Improvements** | Enhancement to something that already existed |
| **Fixes**        | Bug fix for broken behavior                   |

Subcategorize by product area: **Web** | **Word** | **Playbooks Beta**

### Step 3: Write the Changelog Entry

**File path:** `apps/product-docs/changelog/{month}-{year}/{month-abbrev}-{day}-{year}.mdx`

```mdx
---
title: "Feb 24, 2026"
---

## New Features

### Web

• Description of new feature in customer-facing language.

## Improvements

### Web

• Description of improvement.

## Fixes

### Web

• Description of bug fix.
```

**Rules:**

- Use `•` (bullet character), not `-` or `*`
- Customer-facing language — no code references or internal jargon
- Each bullet is one sentence ending with a period
- Omit empty sections and empty product areas
- Order: New Features → Improvements → Fixes; Web → Word → Playbooks Beta

**If today's entry already exists**, append bullets to existing sections rather than creating a new file.

### Step 4: Update docs.json for Changelog

Only when creating a **new** entry. Edit `apps/product-docs/docs.json`:

1. Update `"url"` on the Changelog tab to point to the new entry
2. Add the page to the correct month group (newest first), or create a new month group at the top of `groups`

---

## Part 2: Documentation Pages

### When to Update Docs

| Change type              | Action                                           |
| ------------------------ | ------------------------------------------------ |
| New feature              | Create new page in `docs/` or `guides/`          |
| Changed feature behavior | Update existing page                             |
| New UI flow              | Update or create guide in `guides/`              |
| Removed feature          | Remove page, update docs.json nav                |
| Renamed/moved feature    | Update page title, redirects, and nav references |

Skip docs updates for refactors, performance changes, or internal-only changes with no user-facing impact.

### Docs Structure

```
apps/product-docs/
├── docs/                    # Reference documentation (what things are)
│   ├── chat/               # Chat feature docs
│   ├── gc-ai-for-word/     # Word plugin docs
│   ├── knowledge-bases/     # Knowledge base docs
│   └── organizations/      # Organization docs
├── guides/                  # How-to guides (how to do things)
│   ├── best-practice/
│   ├── gcai-for-word/
│   ├── getting-started/
│   ├── organizations/
│   ├── playbooks/
│   ├── prompting/
│   └── usage/
├── get-started/             # Onboarding pages
├── security/                # Security & compliance
└── api-reference/           # API docs
```

**Reference pages** (`docs/`): explain what a feature is and how it works.
**Guides** (`guides/`): walk through a specific task step by step.

### Page Format

```mdx
---
title: "Page Title"
description: "One-sentence description for SEO and navigation."
---

## Section Heading

Content written for end users (lawyers, legal professionals).

<Note>Callout for important context.</Note>

### Subsection

Step-by-step instructions or feature details.

<Frame>
  <img
    src="https://docs-images-gcai.s3.us-east-2.amazonaws.com/..."
    style={{ width: "100%", borderRadius: "8px" }}
  />
</Frame>
```

### Available Mintlify Components

- `<Note>` — informational callout
- `<Info>` — general info callout
- `<Warning>` — warning callout
- `<Frame>` — image wrapper with caption support
- `<Card>` / `<CardGroup cols={2}>` — feature grids
- `<Accordion>` / `<AccordionGroup>` — collapsible sections

### Writing Rules

- Write for legal professionals, not developers
- Use plain language — avoid technical jargon
- Show, don't tell — include screenshots/GIFs where helpful
- Images hosted on S3: `https://docs-images-gcai.s3.us-east-2.amazonaws.com/...`
- Step-by-step instructions use numbered lists
- Link to related pages with relative paths (e.g. `/guides/getting-started/first-steps`)

### Adding a New Page

1. Create the MDX file in the appropriate directory
2. Add the page to `docs.json` navigation under the correct tab and group
3. Add redirects in `docs.json` if replacing an existing page

### Updating docs.json Navigation for New Pages

Find the correct tab and group, then add the page path:

```json
{
  "group": "Chat",
  "pages": ["docs/chat/interface-overview", "docs/chat/your-new-page"]
}
```

---

## Workflow When Called from ship-changes or stack-prs

1. Collect `### customer impact statement` from each created PR
2. Skip any marked "No user-facing changes"
3. **Changelog**: generate or append to today's entry
4. **Docs**: for any New Features, check if existing docs cover it. If not, offer to create a new page or update an existing one.
5. Update `docs.json` navigation for any new pages

---

## Complete Example

Given these shipped PRs:

```
PR #201: feat(chat): add label management for chats
  Customer impact: You can now create, edit, and assign labels to organize your chats.

PR #202: fix(kb): fix document upload failing for large PDFs
  Customer impact: Fixed an issue where uploading large PDF files to Knowledge Bases would fail.
```

**Changelog** — `apps/product-docs/changelog/february-2026/feb-24-2026.mdx`:

```mdx
---
title: "Feb 24, 2026"
---

## New Features

### Web

• You can now create, edit, and assign labels to organize your chats.

## Fixes

### Web

• Fixed an issue where uploading large PDF files to Knowledge Bases would fail.
```

**Docs** — PR #201 is a new feature. Check if `docs/chat/` covers labels:

- No existing page → create `docs/chat/labels.mdx` with reference docs
- Add `"docs/chat/labels"` to the Chat group in docs.json
- Optionally create `guides/usage/organizing-chats-with-labels.mdx` for a how-to guide
