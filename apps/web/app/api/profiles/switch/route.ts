import { setUIActiveProfile, getEffectiveProfile, resolveWorkspaceRoot, resolveOpenClawStateDir } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json()) as { profile?: string };
  const profileName = body.profile?.trim();

  if (!profileName) {
    return Response.json({ error: "Missing profile name" }, { status: 400 });
  }

  // Validate profile name: letters, numbers, hyphens, underscores only
  if (profileName !== "default" && !/^[a-zA-Z0-9_-]+$/.test(profileName)) {
    return Response.json(
      { error: "Invalid profile name. Use letters, numbers, hyphens, or underscores." },
      { status: 400 },
    );
  }

  // "default" clears the override
  setUIActiveProfile(profileName === "default" ? null : profileName);

  const activeProfile = getEffectiveProfile();
  const workspaceRoot = resolveWorkspaceRoot();
  const stateDir = resolveOpenClawStateDir();

  return Response.json({
    activeProfile: activeProfile || "default",
    workspaceRoot,
    stateDir,
  });
}
