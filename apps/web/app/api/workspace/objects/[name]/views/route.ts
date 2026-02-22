import { NextResponse } from "next/server";
import { getObjectViews, saveObjectViews } from "@/lib/workspace";
import type { SavedView } from "@/lib/object-filters";

type Params = { params: Promise<{ name: string }> };

/**
 * GET /api/workspace/objects/[name]/views
 *
 * Returns saved views and active_view from the object's .object.yaml.
 */
export async function GET(_req: Request, ctx: Params) {
	const { name } = await ctx.params;
	const objectName = decodeURIComponent(name);

	try {
		const { views, activeView } = getObjectViews(objectName);
		return NextResponse.json({ views, activeView });
	} catch (err) {
		return NextResponse.json(
			{ error: `Failed to read views: ${err instanceof Error ? err.message : String(err)}` },
			{ status: 500 },
		);
	}
}

/**
 * PUT /api/workspace/objects/[name]/views
 *
 * Save views and active_view to the object's .object.yaml.
 * Body: { views: SavedView[], activeView?: string }
 */
export async function PUT(req: Request, ctx: Params) {
	const { name } = await ctx.params;
	const objectName = decodeURIComponent(name);

	try {
		const body = (await req.json()) as {
			views?: SavedView[];
			activeView?: string;
		};

		const views = body.views ?? [];
		const activeView = body.activeView;

		const ok = saveObjectViews(objectName, views, activeView);
		if (!ok) {
			return NextResponse.json(
				{ error: "Object directory not found" },
				{ status: 404 },
			);
		}

		return NextResponse.json({ ok: true });
	} catch (err) {
		return NextResponse.json(
			{ error: `Failed to save views: ${err instanceof Error ? err.message : String(err)}` },
			{ status: 500 },
		);
	}
}
