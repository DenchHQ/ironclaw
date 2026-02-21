import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveOpenClawStateDir, resolveWorkspaceRoot } from "@/lib/workspace";

export const dynamic = "force-dynamic";

type SkillEntry = {
  name: string;
  description: string;
  emoji?: string;
  source: string;
  filePath: string;
};

/** Parse YAML frontmatter from a SKILL.md file (lightweight, no deps). */
function parseSkillFrontmatter(content: string): {
  name?: string;
  description?: string;
  emoji?: string;
} {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};

  const yaml = match[1];
  const result: Record<string, string> = {};
  for (const line of yaml.split("\n")) {
    const kv = line.match(/^(\w+)\s*:\s*(.+)/);
    if (kv) {
      result[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
    }
  }
  return {
    name: result.name,
    description: result.description,
    emoji: result.emoji,
  };
}

function scanSkillDir(dir: string, source: string): SkillEntry[] {
  const skills: SkillEntry[] = [];
  if (!existsSync(dir)) return skills;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = join(dir, entry.name, "SKILL.md");
      if (!existsSync(skillMdPath)) continue;

      try {
        const content = readFileSync(skillMdPath, "utf-8");
        const meta = parseSkillFrontmatter(content);
        skills.push({
          name: meta.name ?? entry.name,
          description: meta.description ?? "",
          emoji: meta.emoji,
          source,
          filePath: skillMdPath,
        });
      } catch {
        // skip unreadable skill files
      }
    }
  } catch {
    // dir unreadable
  }

  return skills;
}

export async function GET() {
  const stateDir = resolveOpenClawStateDir();
  const workspaceRoot = resolveWorkspaceRoot() ?? join(stateDir, "workspace");

  const managedSkills = scanSkillDir(join(stateDir, "skills"), "managed");
  const workspaceSkills = scanSkillDir(
    join(workspaceRoot, "skills"),
    "workspace",
  );

  const allSkills = [...workspaceSkills, ...managedSkills];
  allSkills.sort((a, b) => a.name.localeCompare(b.name));

  return Response.json({ skills: allSkills });
}
