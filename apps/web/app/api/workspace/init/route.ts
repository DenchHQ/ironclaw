import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { resolveOpenClawStateDir, setUIActiveProfile, getEffectiveProfile, resolveWorkspaceRoot, registerWorkspacePath } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Bootstrap file names (must match src/agents/workspace.ts)
// ---------------------------------------------------------------------------

const BOOTSTRAP_FILENAMES = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md",
] as const;

// Minimal fallback content used when templates can't be loaded from disk
const FALLBACK_CONTENT: Record<string, string> = {
  "AGENTS.md": "# AGENTS.md - Your Workspace\n\nThis folder is home. Treat it that way.\n",
  "SOUL.md": "# SOUL.md - Who You Are\n\nDescribe the personality and behavior of your agent here.\n",
  "TOOLS.md": "# TOOLS.md - Local Notes\n\nSkills define how tools work. This file is for your specifics.\n",
  "IDENTITY.md": "# IDENTITY.md - Who Am I?\n\nFill this in during your first conversation.\n",
  "USER.md": "# USER.md - About Your Human\n\nDescribe yourself and how you'd like the agent to interact with you.\n",
  "HEARTBEAT.md": "# HEARTBEAT.md\n\n# Keep this file empty (or with only comments) to skip heartbeat API calls.\n",
  "BOOTSTRAP.md": "# BOOTSTRAP.md - Hello, World\n\nYou just woke up. Time to figure out who you are.\n",
};

// ---------------------------------------------------------------------------
// CRM seed objects (mirrors src/agents/workspace-seed.ts)
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
// Helpers
// ---------------------------------------------------------------------------

function stripFrontMatter(content: string): string {
  if (!content.startsWith("---")) {return content;}
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) {return content;}
  return content.slice(endIndex + "\n---".length).replace(/^\s+/, "");
}

/** Try multiple candidate paths to find the monorepo root. */
function resolveProjectRoot(): string | null {
  const marker = join("docs", "reference", "templates", "AGENTS.md");
  const cwd = process.cwd();

  // CWD is the repo root (standalone builds)
  if (existsSync(join(cwd, marker))) {return cwd;}

  // CWD is apps/web/ (dev mode)
  const fromApps = resolve(cwd, "..", "..");
  if (existsSync(join(fromApps, marker))) {return fromApps;}

  return null;
}

function loadTemplateContent(filename: string, projectRoot: string | null): string {
  if (projectRoot) {
    const templatePath = join(projectRoot, "docs", "reference", "templates", filename);
    try {
      const raw = readFileSync(templatePath, "utf-8");
      return stripFrontMatter(raw);
    } catch {
      // fall through to fallback
    }
  }
  return FALLBACK_CONTENT[filename] ?? "";
}

function generateObjectYaml(obj: SeedObject): string {
  const lines: string[] = [
    `id: "${obj.id}"`,
    `name: "${obj.name}"`,
    `description: "${obj.description}"`,
    `icon: "${obj.icon}"`,
    `default_view: "${obj.defaultView}"`,
    `entry_count: ${obj.entryCount}`,
    "fields:",
  ];

  for (const field of obj.fields) {
    lines.push(`  - name: "${field.name}"`);
    lines.push(`    type: ${field.type}`);
    if (field.required) {lines.push("    required: true");}
    if (field.enumValues) {lines.push(`    values: ${JSON.stringify(field.enumValues)}`);}
  }

  return lines.join("\n") + "\n";
}

function generateWorkspaceMd(objects: SeedObject[]): string {
  const lines: string[] = ["# Workspace Schema", "", "Auto-generated summary of the workspace database.", ""];
  for (const obj of objects) {
    lines.push(`## ${obj.name}`, "");
    lines.push(`- **Description**: ${obj.description}`);
    lines.push(`- **View**: \`${obj.defaultView}\``);
    lines.push(`- **Entries**: ${obj.entryCount}`);
    lines.push("- **Fields**:");
    for (const field of obj.fields) {
      const req = field.required ? " (required)" : "";
      const vals = field.enumValues ? ` — ${field.enumValues.join(", ")}` : "";
      lines.push(`  - ${field.name} (\`${field.type}\`)${req}${vals}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function writeIfMissing(filePath: string, content: string): boolean {
  if (existsSync(filePath)) {return false;}
  try {
    writeFileSync(filePath, content, { encoding: "utf-8", flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

function seedDuckDB(workspaceDir: string, projectRoot: string | null): boolean {
  const destPath = join(workspaceDir, "workspace.duckdb");
  if (existsSync(destPath)) {return false;}

  if (!projectRoot) {return false;}

  const seedDb = join(projectRoot, "assets", "seed", "workspace.duckdb");
  if (!existsSync(seedDb)) {return false;}

  try {
    copyFileSync(seedDb, destPath);
  } catch {
    return false;
  }

  // Create filesystem projections for CRM objects
  for (const obj of SEED_OBJECTS) {
    const objDir = join(workspaceDir, obj.name);
    mkdirSync(objDir, { recursive: true });
    writeIfMissing(join(objDir, ".object.yaml"), generateObjectYaml(obj));
  }

  writeIfMissing(join(workspaceDir, "WORKSPACE.md"), generateWorkspaceMd(SEED_OBJECTS));

  return true;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const body = (await req.json()) as {
    profile?: string;
    path?: string;
    seedBootstrap?: boolean;
  };

  const profileName = body.profile?.trim() || null;

  if (profileName && profileName !== "default" && !/^[a-zA-Z0-9_-]+$/.test(profileName)) {
    return Response.json(
      { error: "Invalid profile name. Use letters, numbers, hyphens, or underscores." },
      { status: 400 },
    );
  }

  // Determine workspace directory
  let workspaceDir: string;
  if (body.path?.trim()) {
    workspaceDir = body.path.trim();
    if (workspaceDir.startsWith("~")) {
      workspaceDir = join(homedir(), workspaceDir.slice(1));
    }
  } else {
    const stateDir = resolveOpenClawStateDir();
    if (profileName && profileName !== "default") {
      workspaceDir = join(stateDir, `workspace-${profileName}`);
    } else {
      workspaceDir = join(stateDir, "workspace");
    }
  }

  try {
    mkdirSync(workspaceDir, { recursive: true });
  } catch (err) {
    return Response.json(
      { error: `Failed to create workspace directory: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  const seedBootstrap = body.seedBootstrap !== false;
  const seeded: string[] = [];

  if (seedBootstrap) {
    const projectRoot = resolveProjectRoot();

    // Seed all bootstrap files from templates
    for (const filename of BOOTSTRAP_FILENAMES) {
      const filePath = join(workspaceDir, filename);
      if (!existsSync(filePath)) {
        const content = loadTemplateContent(filename, projectRoot);
        if (writeIfMissing(filePath, content)) {
          seeded.push(filename);
        }
      }
    }

    // Seed DuckDB + CRM object projections
    if (seedDuckDB(workspaceDir, projectRoot)) {
      seeded.push("workspace.duckdb");
      for (const obj of SEED_OBJECTS) {
        seeded.push(`${obj.name}/.object.yaml`);
      }
    }

    // Write workspace state so the gateway knows seeding was done
    const stateDir = join(workspaceDir, ".openclaw");
    const statePath = join(stateDir, "workspace-state.json");
    if (!existsSync(statePath)) {
      try {
        mkdirSync(stateDir, { recursive: true });
        const state = {
          version: 1,
          bootstrapSeededAt: new Date().toISOString(),
          duckdbSeededAt: existsSync(join(workspaceDir, "workspace.duckdb"))
            ? new Date().toISOString()
            : undefined,
        };
        writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
      } catch {
        // Best-effort state tracking
      }
    }
  }

  // Remember custom-path workspaces in the registry
  if (body.path?.trim() && profileName) {
    registerWorkspacePath(profileName, workspaceDir);
  }

  // Switch to the new profile
  if (profileName) {
    setUIActiveProfile(profileName === "default" ? null : profileName);
  }

  return Response.json({
    workspaceDir,
    profile: profileName || "default",
    activeProfile: getEffectiveProfile() || "default",
    seededFiles: seeded,
    workspaceRoot: resolveWorkspaceRoot(),
  });
}
