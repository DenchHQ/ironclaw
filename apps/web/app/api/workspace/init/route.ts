import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { resolveOpenClawStateDir, setUIActiveProfile, getEffectiveProfile, resolveWorkspaceRoot } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BOOTSTRAP_FILES: Record<string, string> = {
  "AGENTS.md": `# Workspace Agent Instructions

Add instructions here that your agent should follow when working in this workspace.
`,
  "SOUL.md": `# Soul

Describe the personality and behavior of your agent here.
`,
  "USER.md": `# User

Describe yourself — your preferences, context, and how you'd like the agent to interact with you.
`,
};

export async function POST(req: Request) {
  const body = (await req.json()) as {
    profile?: string;
    /** Absolute path override (optional; defaults to profile-based resolution). */
    path?: string;
    /** Seed bootstrap files into the new workspace. Default true. */
    seedBootstrap?: boolean;
  };

  const profileName = body.profile?.trim() || null;

  // Validate profile name if provided
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

  // Create the workspace directory
  try {
    mkdirSync(workspaceDir, { recursive: true });
  } catch (err) {
    return Response.json(
      { error: `Failed to create workspace directory: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  // Seed bootstrap files
  const seedBootstrap = body.seedBootstrap !== false;
  const seeded: string[] = [];
  if (seedBootstrap) {
    for (const [filename, content] of Object.entries(BOOTSTRAP_FILES)) {
      const filePath = join(workspaceDir, filename);
      if (!existsSync(filePath)) {
        try {
          writeFileSync(filePath, content, "utf-8");
          seeded.push(filename);
        } catch {
          // Skip files that can't be written (permissions, etc.)
        }
      }
    }
  }

  // If a profile was specified, switch to it
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
