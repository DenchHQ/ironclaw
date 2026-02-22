import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveWorkspaceRoot } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type WorkspaceContext = {
  exists: boolean;
  organization?: {
    id?: string;
    name?: string;
    slug?: string;
  };
  members?: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
  }>;
  defaults?: {
    default_view?: string;
    date_format?: string;
    naming_convention?: string;
  };
};

/**
 * Parse workspace_context.yaml with basic YAML extraction.
 * Handles the specific structure defined by the workspace skill.
 */
function parseWorkspaceContext(content: string): WorkspaceContext {
  const ctx: WorkspaceContext = { exists: true };

  // Extract organization block
  const orgMatch = content.match(
    /organization:\s*\n((?:\s{2,}.+\n)*)/,
  );
  if (orgMatch) {
    const orgBlock = orgMatch[1];
    const org: Record<string, string> = {};
    for (const line of orgBlock.split("\n")) {
      const kv = line.match(/^\s+(\w+)\s*:\s*"?([^"\n]+)"?/);
      if (kv) {org[kv[1]] = kv[2].trim();}
    }
    ctx.organization = {
      id: org.id,
      name: org.name,
      slug: org.slug,
    };
  }

  // Extract members list
  const membersMatch = content.match(
    /members:\s*\n((?:\s{2,}.+\n)*)/,
  );
  if (membersMatch) {
    const membersBlock = membersMatch[1];
    const members: WorkspaceContext["members"] = [];
    let current: Record<string, string> = {};

    for (const line of membersBlock.split("\n")) {
      const itemStart = line.match(/^\s+-\s+(\w+)\s*:\s*"?([^"\n]+)"?/);
      const propLine = line.match(/^\s+(\w+)\s*:\s*"?([^"\n]+)"?/);

      if (itemStart) {
        if (current.id) {members.push(current as never);}
        current = { [itemStart[1]]: itemStart[2].trim() };
      } else if (propLine && !line.trim().startsWith("-")) {
        current[propLine[1]] = propLine[2].trim();
      }
    }
    if (current.id) {members.push(current as never);}
    ctx.members = members;
  }

  // Extract defaults block
  const defaultsMatch = content.match(
    /defaults:\s*\n((?:\s{2,}.+\n)*)/,
  );
  if (defaultsMatch) {
    const defaultsBlock = defaultsMatch[1];
    const defaults: Record<string, string> = {};
    for (const line of defaultsBlock.split("\n")) {
      const kv = line.match(/^\s+(\w[\w_]*)\s*:\s*(.+)/);
      if (kv) {defaults[kv[1]] = kv[2].trim();}
    }
    ctx.defaults = {
      default_view: defaults.default_view,
      date_format: defaults.date_format,
      naming_convention: defaults.naming_convention,
    };
  }

  return ctx;
}

export async function GET() {
  const root = resolveWorkspaceRoot();
  if (!root) {
    return Response.json({ exists: false } satisfies WorkspaceContext);
  }

  const ctxPath = join(root, "workspace_context.yaml");
  if (!existsSync(ctxPath)) {
    return Response.json({ exists: true } satisfies WorkspaceContext);
  }

  try {
    const content = readFileSync(ctxPath, "utf-8");
    const parsed = parseWorkspaceContext(content);
    return Response.json(parsed);
  } catch {
    return Response.json({ exists: true } satisfies WorkspaceContext);
  }
}
