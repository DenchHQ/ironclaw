import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveOpenClawStateDir } from "@/lib/workspace";

export const runtime = "nodejs";

type RegistryEntry = {
	runId: string;
	childSessionKey: string;
	requesterSessionKey: string;
	task: string;
	label?: string;
	createdAt?: number;
	endedAt?: number;
	outcome?: { status: string; error?: string };
};

function readSubagentRegistry(): RegistryEntry[] {
	const registryPath = join(resolveOpenClawStateDir(), "subagents", "runs.json");
	if (!existsSync(registryPath)) {return [];}

	try {
		const raw = JSON.parse(readFileSync(registryPath, "utf-8"));
		if (!raw || typeof raw !== "object") {return [];}
		const runs = raw.runs;
		if (!runs || typeof runs !== "object") {return [];}
		return Object.values(runs);
	} catch {
		return [];
	}
}

export async function GET(req: Request) {
	const url = new URL(req.url);
	const sessionId = url.searchParams.get("sessionId");

	if (!sessionId) {
		return Response.json({ error: "sessionId required" }, { status: 400 });
	}

	const webSessionKey = `agent:main:web:${sessionId}`;
	const entries = readSubagentRegistry();

	const subagents = entries
		.filter((e) => e.requesterSessionKey === webSessionKey)
		.map((e) => ({
			sessionKey: e.childSessionKey,
			runId: e.runId,
			task: e.task,
			label: e.label || undefined,
			status: resolveStatus(e),
			startedAt: e.createdAt,
			endedAt: e.endedAt,
		}))
		.toSorted((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));

	return Response.json({ subagents });
}

function resolveStatus(e: RegistryEntry): "running" | "completed" | "error" {
	if (typeof e.endedAt !== "number") {return "running";}
	if (e.outcome?.status === "error") {return "error";}
	return "completed";
}
