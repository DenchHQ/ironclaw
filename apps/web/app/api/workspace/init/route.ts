import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import {
  discoverProfiles,
  setUIActiveProfile,
  getEffectiveProfile,
  resolveWorkspaceRoot,
  registerWorkspacePath,
} from "@/lib/workspace";

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

const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const DEFAULT_GATEWAY_PORT = 18_789;
const GATEWAY_PORT_STEP = 20;
const ONBOARD_TIMEOUT_MS = 12 * 60_000;

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

type SpawnResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function resolveCommandForPlatform(command: string): string {
  if (process.platform === "win32" && !command.toLowerCase().endsWith(".cmd")) {
    return `${command}.cmd`;
  }
  return command;
}

function resolveOpenClawHomeDir(): string {
  return process.env.OPENCLAW_HOME?.trim() || homedir();
}

function resolveProfileStateDir(profile: string): string {
  if (!profile || profile.toLowerCase() === "default") {
    return join(resolveOpenClawHomeDir(), ".openclaw");
  }
  return join(resolveOpenClawHomeDir(), `.openclaw-${profile}`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseGatewayPort(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function firstNonEmptyLine(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const first = value
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (first) {
      return first;
    }
  }
  return undefined;
}

function readOpenClawConfig(stateDir: string): Record<string, unknown> {
  for (const filename of ["openclaw.json", "config.json"]) {
    const configPath = join(stateDir, filename);
    if (!existsSync(configPath)) {
      continue;
    }
    try {
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      const parsed = asRecord(raw);
      if (parsed) {
        return parsed;
      }
    } catch {
      // Try the next config candidate.
    }
  }
  return {};
}

function writeOpenClawConfig(stateDir: string, config: Record<string, unknown>): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "openclaw.json"), JSON.stringify(config, null, 2) + "\n", "utf-8");
}

function updateProfileConfig(params: {
  stateDir: string;
  gatewayPort: number;
  workspaceDir: string;
}): void {
  const config = readOpenClawConfig(params.stateDir);
  const gateway = asRecord(config.gateway) ?? {};
  gateway.mode = "local";
  gateway.port = params.gatewayPort;
  config.gateway = gateway;

  const agents = asRecord(config.agents) ?? {};
  const defaults = asRecord(agents.defaults) ?? {};
  defaults.workspace = params.workspaceDir;
  agents.defaults = defaults;
  config.agents = agents;

  writeOpenClawConfig(params.stateDir, config);
}

function resolveRequestedWorkspaceDir(rawPath: string | undefined, stateDir: string): string {
  if (!rawPath?.trim()) {
    return join(stateDir, "workspace");
  }
  let workspaceDir = rawPath.trim();
  if (workspaceDir.startsWith("~")) {
    workspaceDir = join(homedir(), workspaceDir.slice(1));
  }
  return resolve(workspaceDir);
}

function collectUsedGatewayPorts(): Set<number> {
  const used = new Set<number>();
  for (const profile of discoverProfiles()) {
    const config = readOpenClawConfig(profile.stateDir);
    const port = parseGatewayPort(asRecord(config.gateway)?.port);
    if (port) {
      used.add(port);
    }
  }
  return used;
}

function allocateGatewayPort(): number {
  const used = collectUsedGatewayPorts();
  let candidate = DEFAULT_GATEWAY_PORT;
  while (used.has(candidate)) {
    candidate += GATEWAY_PORT_STEP;
    if (candidate > 65_535) {
      throw new Error("Failed to allocate a free gateway port for the new profile.");
    }
  }
  return candidate;
}

async function runCommandWithTimeout(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<SpawnResult> {
  return await new Promise<SpawnResult>((resolveResult, reject) => {
    const child = spawn(resolveCommandForPlatform(command), args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.once("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolveResult({
        code: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      });
    });
  });
}

async function runOnboardForProfile(profile: string, gatewayPort: number): Promise<void> {
  const args = [
    "--profile",
    profile,
    "onboard",
    "--install-daemon",
    "--gateway-bind",
    "loopback",
    "--gateway-port",
    String(gatewayPort),
    "--non-interactive",
    "--accept-risk",
    "--skip-ui",
  ];
  const result = await runCommandWithTimeout("openclaw", args, ONBOARD_TIMEOUT_MS);
  if (result.code === 0) {
    return;
  }
  const detail = firstNonEmptyLine(result.stderr, result.stdout);
  throw new Error(detail ? `OpenClaw onboarding failed: ${detail}` : "OpenClaw onboarding failed.");
}

function copyIronclawProfileConfig(targetStateDir: string): string[] {
  const copied: string[] = [];
  const sourceStateDir = resolveProfileStateDir("ironclaw");
  const sourceConfig = join(sourceStateDir, "openclaw.json");
  const sourceAuthProfiles = join(sourceStateDir, "agents", "main", "agent", "auth-profiles.json");
  const targetConfig = join(targetStateDir, "openclaw.json");
  const targetAuthProfiles = join(targetStateDir, "agents", "main", "agent", "auth-profiles.json");

  if (existsSync(sourceConfig)) {
    mkdirSync(targetStateDir, { recursive: true });
    copyFileSync(sourceConfig, targetConfig);
    copied.push("openclaw.json");
  }

  if (existsSync(sourceAuthProfiles)) {
    mkdirSync(join(targetStateDir, "agents", "main", "agent"), { recursive: true });
    copyFileSync(sourceAuthProfiles, targetAuthProfiles);
    copied.push("agents/main/agent/auth-profiles.json");
  }

  return copied;
}

function syncManagedDenchSkill(stateDir: string, projectRoot: string | null): boolean {
  if (!projectRoot) {
    return false;
  }
  const sourceDir = join(projectRoot, "skills", "dench");
  const sourceSkillFile = join(sourceDir, "SKILL.md");
  if (!existsSync(sourceSkillFile)) {
    return false;
  }
  const targetDir = join(stateDir, "skills", "dench");
  mkdirSync(join(stateDir, "skills"), { recursive: true });
  cpSync(sourceDir, targetDir, { recursive: true, force: true });
  return true;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    profile?: string;
    path?: string;
    seedBootstrap?: boolean;
    copyConfigAuth?: boolean;
  };
  const profileName = body.profile?.trim() || "";
  if (!profileName) {
    return Response.json(
      { error: "Profile name is required." },
      { status: 400 },
    );
  }
  if (profileName.toLowerCase() === "default") {
    return Response.json(
      { error: "The 'default' profile already exists. Create a named profile instead." },
      { status: 400 },
    );
  }
  if (!PROFILE_NAME_RE.test(profileName)) {
    return Response.json(
      { error: "Invalid profile name. Use letters, numbers, hyphens, or underscores." },
      { status: 400 },
    );
  }

  const existingProfiles = discoverProfiles();
  if (existingProfiles.some((profile) => profile.name.toLowerCase() === profileName.toLowerCase())) {
    return Response.json(
      { error: `Profile '${profileName}' already exists.` },
      { status: 409 },
    );
  }

  const stateDir = resolveProfileStateDir(profileName);
  const workspaceDir = resolveRequestedWorkspaceDir(body.path, stateDir);
  const seedBootstrap = body.seedBootstrap !== false;
  const shouldCopyConfigAuth = body.copyConfigAuth !== false;
  const seeded: string[] = [];
  const copiedFiles: string[] = [];

  const projectRoot = resolveProjectRoot();
  let gatewayPort: number;
  try {
    gatewayPort = allocateGatewayPort();
  } catch (error) {
    return Response.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }

  try {
    mkdirSync(stateDir, { recursive: true });
    if (shouldCopyConfigAuth) {
      copiedFiles.push(...copyIronclawProfileConfig(stateDir));
    }
  } catch (err) {
    return Response.json(
      { error: `Failed to prepare profile directory: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  try {
    await runOnboardForProfile(profileName, gatewayPort);
  } catch (err) {
    return Response.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }

  try {
    updateProfileConfig({ stateDir, gatewayPort, workspaceDir });
    mkdirSync(workspaceDir, { recursive: true });
  } catch (err) {
    return Response.json(
      { error: `Failed to configure profile workspace: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  if (seedBootstrap) {
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

  const denchSynced = syncManagedDenchSkill(stateDir, projectRoot);

  // Remember custom-path workspaces in the registry
  if (body.path?.trim()) {
    registerWorkspacePath(profileName, workspaceDir);
  }

  // Switch to the new profile
  setUIActiveProfile(profileName);

  return Response.json({
    workspaceDir,
    stateDir,
    profile: profileName,
    activeProfile: getEffectiveProfile() || "default",
    gatewayPort,
    copiedFiles,
    seededFiles: seeded,
    denchSynced,
    workspaceRoot: resolveWorkspaceRoot(),
  });
}
