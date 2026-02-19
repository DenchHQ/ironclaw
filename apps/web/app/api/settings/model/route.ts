import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function resolveConfigPath(): string {
  const envPath = process.env.OPENCLAW_CONFIG;
  if (envPath) {return envPath;}
  return join(homedir(), ".openclaw", "openclaw.json");
}

function readConfig(configPath: string): Record<string, unknown> {
  if (!existsSync(configPath)) {return {};}
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

function writeConfig(configPath: string, config: Record<string, unknown>): void {
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * POST /api/settings/model
 *
 * Body: { model: string }
 *
 * Updates agents.defaults.model in openclaw.json.
 * This is the primary model used by the agent.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { model } = body as { model?: string };

    if (!model || model.trim().length === 0) {
      return NextResponse.json(
        { error: "model is required (e.g. 'anthropic/claude-sonnet-4-5')" },
        { status: 400 },
      );
    }

    const configPath = resolveConfigPath();
    const config = readConfig(configPath);

    // Ensure agents.defaults exists
    if (!config.agents || typeof config.agents !== "object") {
      config.agents = {};
    }
    const agents = config.agents as Record<string, unknown>;
    if (!agents.defaults || typeof agents.defaults !== "object") {
      agents.defaults = {};
    }
    const defaults = agents.defaults as Record<string, unknown>;

    defaults.model = model.trim();

    writeConfig(configPath, config);

    return NextResponse.json({
      ok: true,
      model: model.trim(),
      configPath,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to save model config: ${String(err)}` },
      { status: 500 },
    );
  }
}

/**
 * GET /api/settings/model
 *
 * Returns the current default model.
 */
export async function GET() {
  const configPath = resolveConfigPath();

  if (!existsSync(configPath)) {
    return NextResponse.json({ model: null });
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    const modelRaw =
      (config as Record<string, unknown>).agents &&
      typeof (config as Record<string, unknown>).agents === "object"
        ? ((config as Record<string, unknown>).agents as Record<string, unknown>).defaults &&
          typeof ((config as Record<string, unknown>).agents as Record<string, unknown>).defaults === "object"
          ? (((config as Record<string, unknown>).agents as Record<string, unknown>).defaults as Record<string, unknown>).model
          : null
        : null;

    // Normalize to string: could be string or { primary: string }
    const modelStr = 
      typeof modelRaw === "string" 
        ? modelRaw 
        : (modelRaw && typeof modelRaw === "object" && "primary" in modelRaw)
          ? String((modelRaw as any).primary)
          : null;

    return NextResponse.json({ model: modelStr });
  } catch {
    return NextResponse.json({ model: null });
  }
}
