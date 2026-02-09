import { runAgent } from "@/lib/agent-runner";

// Force Node.js runtime (required for child_process)
export const runtime = "nodejs";

export const maxDuration = 30;

/** POST /api/new-session — send /new to the agent to start a fresh backend session */
export async function POST() {
  return new Promise<Response>((resolve) => {
    runAgent("/new", undefined, {
      onTextDelta: () => {},
      onThinkingDelta: () => {},
      onToolStart: () => {},
      onToolEnd: () => {},
      onLifecycleEnd: () => {},
      onError: (err) => {
        console.error("[new-session] Error:", err);
        resolve(
          Response.json({ ok: false, error: err.message }, { status: 500 }),
        );
      },
      onClose: () => {
        resolve(Response.json({ ok: true }));
      },
    });
  });
}
