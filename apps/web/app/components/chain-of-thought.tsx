"use client";

import { useEffect, useRef, useState } from "react";

/* ─── Public types ─── */

export type ChainPart =
	| { kind: "reasoning"; text: string; isStreaming: boolean }
	| {
			kind: "tool";
			toolName: string;
			toolCallId: string;
			status: "running" | "done" | "error";
			args?: Record<string, unknown>;
			output?: Record<string, unknown>;
			errorText?: string;
		};

/* ─── Main component ─── */

export function ChainOfThought({ parts }: { parts: ChainPart[] }) {
	const [isOpen, setIsOpen] = useState(true);
	const prevActiveRef = useRef(true);

	const isActive = parts.some(
		(p) =>
			(p.kind === "reasoning" && p.isStreaming) ||
			(p.kind === "tool" && p.status === "running"),
	);

	// Auto-collapse once all steps finish (active → inactive transition)
	useEffect(() => {
		if (prevActiveRef.current && !isActive && parts.length > 0) {
			setIsOpen(false);
		}
		prevActiveRef.current = isActive;
	}, [isActive, parts.length]);

	// Aggregate reasoning text from all reasoning parts
	const reasoningText = parts
		.filter(
			(p): p is Extract<ChainPart, { kind: "reasoning" }> =>
				p.kind === "reasoning",
		)
		.map((p) => p.text)
		.join("");
	const isReasoningStreaming = parts.some(
		(p) => p.kind === "reasoning" && p.isStreaming,
	);

	// Tool steps
	const tools = parts.filter(
		(p): p is Extract<ChainPart, { kind: "tool" }> => p.kind === "tool",
	);
	const completedTools = tools.filter((t) => t.status === "done").length;
	const activeTool = tools.find((t) => t.status === "running");

	// Header label summarizes current/completed activity
	let headerLabel: string;
	if (isActive) {
		if (activeTool) {
			// Show what the active tool is doing
			const summary = getToolSummary(
				activeTool.toolName,
				activeTool.args,
			);
			headerLabel = summary || formatToolName(activeTool.toolName);
		} else {
			headerLabel = "Thinking";
		}
	} else if (tools.length > 0) {
		headerLabel = `Reasoned with ${completedTools} tool${completedTools !== 1 ? "s" : ""}`;
	} else {
		headerLabel = "Reasoned";
	}

	return (
		<div className="my-2 rounded-lg border border-[var(--color-border)] overflow-hidden">
			{/* Trigger */}
			<button
				type="button"
				onClick={() => setIsOpen((v) => !v)}
				className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
			>
				<SparkleIcon className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />

				<span className="font-medium truncate">{headerLabel}</span>

				{isActive && (
					<span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse flex-shrink-0" />
				)}

				<ChevronIcon
					className={`w-3 h-3 ml-auto flex-shrink-0 transition-transform duration-200 ${
						isOpen ? "" : "-rotate-90"
					}`}
				/>
			</button>

			{/* Collapsible content (smooth CSS grid animation) */}
			<div
				className="grid transition-[grid-template-rows] duration-200 ease-out"
				style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
			>
				<div className="overflow-hidden">
					<div className="px-3 pb-3 space-y-2">
						{/* Reasoning text block */}
						{reasoningText && (
							<ReasoningText
								text={reasoningText}
								isStreaming={isReasoningStreaming}
							/>
						)}

						{/* Tool step timeline */}
						{tools.length > 0 && (
							<div className="flex flex-col gap-1">
								{tools.map((tool) => (
									<ToolStep key={tool.toolCallId} {...tool} />
								))}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

/* ─── Sub-components ─── */

/** Expandable reasoning text display */
function ReasoningText({
	text,
	isStreaming,
}: {
	text: string;
	isStreaming: boolean;
}) {
	const [expanded, setExpanded] = useState(false);
	const isLong = text.length > 300;

	return (
		<div>
			<div
				className={`text-[11px] text-[var(--color-text-muted)] whitespace-pre-wrap leading-relaxed opacity-60 ${
					!expanded && isLong
						? "max-h-20 overflow-hidden"
						: "max-h-64 overflow-y-auto"
				}`}
			>
				{text}
				{isStreaming && (
					<span className="inline-block w-1 h-3 ml-0.5 bg-[var(--color-accent)] opacity-60 animate-pulse align-text-bottom" />
				)}
			</div>
			{isLong && !expanded && (
				<button
					type="button"
					onClick={() => setExpanded(true)}
					className="text-[11px] text-[var(--color-accent)] hover:underline mt-0.5 cursor-pointer"
				>
					Show more
				</button>
			)}
		</div>
	);
}

/** Rich tool step with args display and collapsible output */
function ToolStep({
	toolName,
	status,
	args,
	output,
	errorText,
}: {
	toolName: string;
	status: "running" | "done" | "error";
	args?: Record<string, unknown>;
	output?: Record<string, unknown>;
	errorText?: string;
}) {
	const [showOutput, setShowOutput] = useState(false);
	const displayType = getToolDisplayType(toolName);
	const primaryArg = getPrimaryArg(toolName, args);
	const outputText =
		typeof output?.text === "string" ? output.text : undefined;
	const exitCode =
		output?.exitCode !== undefined ? Number(output.exitCode) : undefined;

	return (
		<div className="flex flex-col gap-1">
			{/* Tool name + status */}
			<div className="flex items-center gap-2 text-xs">
				{status === "running" && (
					<span className="w-3 h-3 border border-[var(--color-text-muted)] border-t-[var(--color-accent)] rounded-full animate-spin flex-shrink-0" />
				)}
				{status === "done" && (
					<CheckIcon className="w-3 h-3 text-green-400 flex-shrink-0" />
				)}
				{status === "error" && (
					<XIcon className="w-3 h-3 text-red-400 flex-shrink-0" />
				)}

				<span
					className={`font-medium truncate ${
						status === "running"
							? "text-[var(--color-text)]"
							: "text-[var(--color-text-muted)]"
					}`}
				>
					{formatToolName(toolName)}
				</span>

				{/* Exit code badge for bash/exec tools */}
				{exitCode !== undefined && exitCode !== 0 && (
					<span className="text-[10px] text-red-400 font-mono">
						exit {exitCode}
					</span>
				)}
			</div>

			{/* Primary argument: command, path, query, code, etc. */}
			{primaryArg && (
				<div className="ml-5">
					{displayType === "bash" ? (
						<CodeBlock
							content={`$ ${primaryArg}`}
							maxLines={3}
						/>
					) : displayType === "code" ? (
						<CodeBlock content={primaryArg} maxLines={8} />
					) : (
						<div className="text-[11px] font-mono text-[var(--color-text-muted)] opacity-70 truncate">
							{primaryArg}
						</div>
					)}
				</div>
			)}

			{/* Error message */}
			{status === "error" && errorText && (
				<div className="ml-5 text-[11px] text-red-400 font-mono bg-red-900/10 rounded px-2 py-1">
					{errorText}
				</div>
			)}

			{/* Tool output */}
			{outputText && status === "done" && (
				<div className="ml-5">
					<button
						type="button"
						onClick={() => setShowOutput((v) => !v)}
						className="text-[10px] text-[var(--color-accent)] hover:underline cursor-pointer"
					>
						{showOutput ? "Hide output" : "Show output"}
					</button>
					{showOutput && (
						<CodeBlock
							content={outputText}
							maxLines={20}
						/>
					)}
				</div>
			)}
		</div>
	);
}

/** Monospace code block with optional line limit */
function CodeBlock({
	content,
	maxLines = 10,
}: {
	content: string;
	maxLines?: number;
}) {
	const [expanded, setExpanded] = useState(false);
	const lines = content.split("\n");
	const isLong = lines.length > maxLines;
	const displayContent =
		!expanded && isLong
			? lines.slice(0, maxLines).join("\n") + "\n..."
			: content;

	return (
		<div>
			<pre className="text-[11px] font-mono text-[var(--color-text-muted)] bg-[var(--color-bg)] rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-all max-h-64 overflow-y-auto leading-relaxed">
				{displayContent}
			</pre>
			{isLong && !expanded && (
				<button
					type="button"
					onClick={() => setExpanded(true)}
					className="text-[10px] text-[var(--color-accent)] hover:underline mt-0.5 cursor-pointer"
				>
					Show all {lines.length} lines
				</button>
			)}
		</div>
	);
}

/* ─── Tool classification helpers ─── */

type ToolDisplayType = "bash" | "code" | "file" | "search" | "generic";

function getToolDisplayType(toolName: string): ToolDisplayType {
	const name = toolName.toLowerCase().replace(/[_-]/g, "");
	if (
		["bash", "shell", "execute", "exec", "terminal", "command"].some((k) =>
			name.includes(k),
		)
	)
		return "bash";
	if (
		["runcode", "python", "javascript", "typescript", "notebook"].some(
			(k) => name.includes(k),
		)
	)
		return "code";
	if (
		["file", "read", "write", "create", "edit", "str_replace"].some((k) =>
			name.includes(k),
		)
	)
		return "file";
	if (
		["search", "web", "grep", "find", "glob"].some((k) =>
			name.includes(k),
		)
	)
		return "search";
	return "generic";
}

function getPrimaryArg(
	toolName: string,
	args?: Record<string, unknown>,
): string | undefined {
	if (!args) return undefined;
	const type = getToolDisplayType(toolName);
	switch (type) {
		case "bash":
			return strArg(args, "command") ?? strArg(args, "cmd");
		case "code":
			return strArg(args, "code") ?? strArg(args, "script");
		case "file":
			return (
				strArg(args, "path") ??
				strArg(args, "file") ??
				strArg(args, "file_path")
			);
		case "search":
			return (
				strArg(args, "query") ??
				strArg(args, "search") ??
				strArg(args, "pattern") ??
				strArg(args, "q")
			);
		default: {
			// Return first short string arg
			for (const val of Object.values(args)) {
				if (typeof val === "string" && val.length > 0 && val.length < 200) return val;
			}
			return undefined;
		}
	}
}

/** Safely extract a string value from an args object */
function strArg(
	args: Record<string, unknown>,
	key: string,
): string | undefined {
	const val = args[key];
	return typeof val === "string" && val.length > 0 ? val : undefined;
}

/** Build a short summary for the active tool (shown in collapsed header) */
function getToolSummary(
	toolName: string,
	args?: Record<string, unknown>,
): string | undefined {
	if (!args) return undefined;
	const type = getToolDisplayType(toolName);
	const primary = getPrimaryArg(toolName, args);
	if (!primary) return undefined;

	switch (type) {
		case "bash": {
			// Show first 40 chars of command
			const short =
				primary.length > 40 ? primary.slice(0, 40) + "..." : primary;
			return `Running: ${short}`;
		}
		case "file": {
			return `Reading ${primary.split("/").pop()}`;
		}
		case "search": {
			return `Searching: ${primary}`;
		}
		default:
			return undefined;
	}
}

/* ─── Helpers ─── */

/** Convert tool_name_like_this → Tool Name Like This */
function formatToolName(name: string): string {
	return name
		.replace(/_/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase())
		.trim();
}

/* ─── Inline SVG icons (avoids adding lucide-react dep) ─── */

function SparkleIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 16 16"
			fill="currentColor"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d="M8 0L9.8 6.2L16 8L9.8 9.8L8 16L6.2 9.8L0 8L6.2 6.2Z" />
		</svg>
	);
}

function ChevronIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 12 12"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M3 4.5L6 7.5L9 4.5" />
		</svg>
	);
}

function CheckIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 12 12"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M2.5 6L5 8.5L9.5 3.5" />
		</svg>
	);
}

function XIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 12 12"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M3 3L9 9M9 3L3 9" />
		</svg>
	);
}
