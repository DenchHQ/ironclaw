import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveOpenClawPackageRoot } from "../infra/openclaw-root.js";

// ---------------------------------------------------------------------------
// Seed data (matches the pre-built assets/seed/workspace.duckdb exactly)
// ---------------------------------------------------------------------------

type SeedField = {
  name: string;
  type: string;
  required?: boolean;
  enumValues?: string[];
};

type SeedObject = {
  id: string;
  name: string;
  description: string;
  icon: string;
  defaultView: string;
  entryCount: number;
  fields: SeedField[];
};

/** Fixed seed objects matching what's baked into assets/seed/workspace.duckdb. */
const SEED_OBJECTS: SeedObject[] = [
  {
    id: "seed_obj_people_00000000000000",
    name: "people",
    description: "Contact management",
    icon: "users",
    defaultView: "table",
    entryCount: 5,
    fields: [
      { name: "Full Name", type: "text", required: true },
      { name: "Email Address", type: "email", required: true },
      { name: "Phone Number", type: "phone" },
      { name: "Company", type: "text" },
      { name: "Status", type: "enum", enumValues: ["Active", "Inactive", "Lead"] },
      { name: "Notes", type: "richtext" },
    ],
  },
  {
    id: "seed_obj_company_0000000000000",
    name: "company",
    description: "Company tracking",
    icon: "building-2",
    defaultView: "table",
    entryCount: 3,
    fields: [
      { name: "Company Name", type: "text", required: true },
      {
        name: "Industry",
        type: "enum",
        enumValues: ["Technology", "Finance", "Healthcare", "Education", "Retail", "Other"],
      },
      { name: "Website", type: "text" },
      { name: "Type", type: "enum", enumValues: ["Client", "Partner", "Vendor", "Prospect"] },
      { name: "Notes", type: "richtext" },
    ],
  },
  {
    id: "seed_obj_task_000000000000000",
    name: "task",
    description: "Task tracking board",
    icon: "check-square",
    defaultView: "kanban",
    entryCount: 5,
    fields: [
      { name: "Title", type: "text", required: true },
      { name: "Description", type: "text" },
      { name: "Status", type: "enum", enumValues: ["In Queue", "In Progress", "Done"] },
      { name: "Priority", type: "enum", enumValues: ["Low", "Medium", "High"] },
      { name: "Due Date", type: "date" },
      { name: "Notes", type: "richtext" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Filesystem projection generators
// ---------------------------------------------------------------------------

function generateObjectYaml(obj: SeedObject): string {
  const lines: string[] = [
    `id: "${obj.id}"`,
    `name: "${obj.name}"`,
    `description: "${obj.description}"`,
    `icon: "${obj.icon}"`,
    `default_view: "${obj.defaultView}"`,
    `entry_count: ${obj.entryCount}`,
    `fields:`,
  ];

  for (const field of obj.fields) {
    lines.push(`  - name: "${field.name}"`);
    lines.push(`    type: ${field.type}`);
    if (field.required) {
      lines.push(`    required: true`);
    }
    if (field.enumValues) {
      lines.push(`    values: ${JSON.stringify(field.enumValues)}`);
    }
  }

  return lines.join("\n") + "\n";
}

function generateWorkspaceMd(objects: SeedObject[]): string {
  const lines: string[] = [
    "# Workspace Schema",
    "",
    "Auto-generated summary of the workspace database.",
    "",
  ];

  for (const obj of objects) {
    lines.push(`## ${obj.name}`);
    lines.push("");
    lines.push(`- **Description**: ${obj.description}`);
    lines.push(`- **View**: \`${obj.defaultView}\``);
    lines.push(`- **Entries**: ${obj.entryCount}`);
    lines.push(`- **Fields**:`);
    for (const field of obj.fields) {
      const req = field.required ? " (required)" : "";
      const vals = field.enumValues ? ` — ${field.enumValues.join(", ")}` : "";
      lines.push(`  - ${field.name} (\`${field.type}\`)${req}${vals}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Path resolution for the pre-built seed database
// ---------------------------------------------------------------------------

const _moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Relative-path fallbacks for source (src/agents/) and bundled (dist/) layouts. */
const SEED_DB_FALLBACKS = [
  path.resolve(_moduleDir, "../../assets/seed/workspace.duckdb"),
  path.resolve(_moduleDir, "../assets/seed/workspace.duckdb"),
];

/** Locate the pre-built workspace.duckdb shipped in assets/seed/. */
async function resolveSeedDbPath(): Promise<string | null> {
  // Primary: use the robust package-root resolver (handles source, dist, global installs).
  const packageRoot = await resolveOpenClawPackageRoot({
    moduleUrl: import.meta.url,
    argv1: process.argv[1],
    cwd: process.cwd(),
  });
  if (packageRoot) {
    const candidate = path.join(packageRoot, "assets", "seed", "workspace.duckdb");
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // fall through to relative fallbacks
    }
  }

  // Fallback: try relative paths from module dir.
  for (const candidate of SEED_DB_FALLBACKS) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Seed a fresh workspace by copying the pre-built DuckDB database and
 * generating filesystem projections (.object.yaml + WORKSPACE.md).
 *
 * No DuckDB CLI or npm package required — the database is a static asset.
 *
 * Skips gracefully if workspace.duckdb already exists.
 *
 * @returns true if the database was copied and projections created.
 */
export async function seedWorkspaceDuckDB(workspaceDir: string): Promise<boolean> {
  const dbPath = path.join(workspaceDir, "workspace.duckdb");

  // Idempotent: skip if database already exists
  try {
    await fs.access(dbPath);
    return false;
  } catch {
    // doesn't exist yet — proceed
  }

  // Locate the pre-built seed database
  const seedDb = await resolveSeedDbPath();
  if (!seedDb) {
    // Seed database not found (e.g. stripped install) — skip silently
    return false;
  }

  try {
    await fs.copyFile(seedDb, dbPath);
  } catch {
    // Copy failed — clean up partial file
    await fs.unlink(dbPath).catch(() => {});
    return false;
  }

  // Create filesystem projections
  for (const obj of SEED_OBJECTS) {
    const objDir = path.join(workspaceDir, obj.name);
    await fs.mkdir(objDir, { recursive: true });
    await fs.writeFile(path.join(objDir, ".object.yaml"), generateObjectYaml(obj), "utf-8");
  }

  // Write WORKSPACE.md (only if missing)
  try {
    await fs.writeFile(path.join(workspaceDir, "WORKSPACE.md"), generateWorkspaceMd(SEED_OBJECTS), {
      encoding: "utf-8",
      flag: "wx",
    });
  } catch {
    // already exists — skip
  }

  return true;
}
