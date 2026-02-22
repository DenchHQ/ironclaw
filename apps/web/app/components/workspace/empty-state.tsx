"use client";

import { useState } from "react";
import { CreateWorkspaceDialog } from "./create-workspace-dialog";

export function EmptyState({
	workspaceExists,
	expectedPath,
	onWorkspaceCreated,
}: {
	workspaceExists: boolean;
	/** The resolved workspace path to display (e.g. from the tree API). */
	expectedPath?: string | null;
	/** Called after a workspace is created from this empty state. */
	onWorkspaceCreated?: () => void;
}) {
	const [showCreate, setShowCreate] = useState(false);

	return (
		<div className="flex flex-col items-center justify-center h-full gap-6 px-8">
			{/* Icon */}
			<div
				className="w-20 h-20 rounded-2xl flex items-center justify-center"
				style={{
					background: "var(--color-surface)",
					border: "1px solid var(--color-border)",
					boxShadow: "var(--shadow-sm)",
				}}
			>
				<svg
					width="40"
					height="40"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
					style={{
						color: "var(--color-text-muted)",
						opacity: 0.5,
					}}
				>
					<rect width="7" height="7" x="3" y="3" rx="1" />
					<rect
						width="7"
						height="7"
						x="14"
						y="3"
						rx="1"
					/>
					<rect
						width="7"
						height="7"
						x="14"
						y="14"
						rx="1"
					/>
					<rect
						width="7"
						height="7"
						x="3"
						y="14"
						rx="1"
					/>
				</svg>
			</div>

			{/* Text */}
			<div className="text-center max-w-md">
				<h2
					className="font-instrument text-2xl tracking-tight mb-2"
					style={{ color: "var(--color-text)" }}
				>
					{workspaceExists
						? "Workspace is empty"
						: "No workspace found"}
				</h2>
				<p
					className="text-sm leading-relaxed"
					style={{ color: "var(--color-text-muted)" }}
				>
				{workspaceExists ? (
					<>
						The workspace exists but has no
						knowledge tree yet. Ask the CRM agent to
						create objects and documents to populate
						it.
					</>
				) : (
					<>
						The workspace directory was not
						found. Create one to get started, or start a
						conversation and the agent will set it up
						automatically.
					</>
				)}
				</p>
			</div>

			{/* Create workspace button — prominent when no workspace exists */}
			{!workspaceExists && (
				<button
					onClick={() => setShowCreate(true)}
					className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
					style={{
						background: "var(--color-accent)",
						color: "#fff",
					}}
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<path d="M12 5v14" /><path d="M5 12h14" />
					</svg>
					Create Workspace
				</button>
			)}

			{/* Hint */}
			<div
				className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm"
				style={{
					background: "var(--color-surface)",
					border: "1px solid var(--color-border)",
					color: "var(--color-text-muted)",
					boxShadow: "var(--shadow-sm)",
				}}
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					style={{
						color: "var(--color-accent)",
						flexShrink: 0,
					}}
				>
					<circle cx="12" cy="12" r="10" />
					<path d="M12 16v-4" />
					<path d="M12 8h.01" />
				</svg>
				<span>
					Expected location:{" "}
					<code
						className="px-1.5 py-0.5 rounded-md text-xs"
						style={{
							background: "var(--color-surface-hover)",
							border: "1px solid var(--color-border)",
						}}
					>
						{expectedPath
							? expectedPath.replace(/^\/Users\/[^/]+/, "~")
							: "~/.openclaw/workspace"}
					</code>
				</span>
			</div>

			{/* Back link */}
			<a
				href="/"
				className="flex items-center gap-2 text-sm mt-2"
				style={{ color: "var(--color-accent)" }}
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="m12 19-7-7 7-7" />
					<path d="M19 12H5" />
				</svg>
				Back to Home
			</a>

			{/* Create workspace dialog */}
			<CreateWorkspaceDialog
				isOpen={showCreate}
				onClose={() => setShowCreate(false)}
				onCreated={onWorkspaceCreated}
			/>
		</div>
	);
}
