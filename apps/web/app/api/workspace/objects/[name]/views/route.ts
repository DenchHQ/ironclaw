import { NextResponse } from "next/server";
import { getObjectViews, saveObjectViews } from "@/lib/workspace";
import type { SavedView, ViewTypeSettings } from "@/lib/object-filters";

type Params = { params: Promise<{ name: string }> };

/**
 * GET /api/workspace/objects/[name]/views
 *
 * Returns saved views, active_view, and view_settings from the object's .object.yaml.
 */
export async function GET(_req: Request, ctx: Params) {
	const { name } = await ctx.params;
	const objectName = decodeURIComponent(name);

	try {
		const { views, activeView, viewSettings } = getObjectViews(objectName);
		return NextResponse.json({ views, activeView, viewSettings });
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
 * Save views, active_view, and view_settings to the object's .object.yaml.
 * Body: { views: SavedView[], activeView?: string, viewSettings?: ViewTypeSettings }
 */
export async function PUT(req: Request, ctx: Params) {
	const { name } = await ctx.params;
	const objectName = decodeURIComponent(name);

	try {
		const body = (await req.json()) as {
			views?: SavedView[];
			activeView?: string;
			viewSettings?: ViewTypeSettings;
		};

		const views = body.views ?? [];
		const activeView = body.activeView;
		const viewSettings = body.viewSettings;

		const ok = saveObjectViews(objectName, views, activeView, viewSettings);
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
