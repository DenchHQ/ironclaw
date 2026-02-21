import { discoverProfiles, getEffectiveProfile, resolveOpenClawStateDir } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const profiles = discoverProfiles();
  const activeProfile = getEffectiveProfile();
  const stateDir = resolveOpenClawStateDir();

  return Response.json({
    profiles,
    activeProfile: activeProfile || "default",
    stateDir,
  });
}
