"use client";

import type { UIMessage } from "ai";
import { ChainOfThought, type ChainPart } from "./chain-of-thought";

/* ─── Part grouping ─── */

type MessageSegment =
	| { type: "text"; text: string }
	| { type: "chain"; parts: ChainPart[] };

/** Map AI SDK tool state string to a simplified status */
function toolStatus(state: string): "running" | "done" | "error" {
	if (state === "output-available") return "done";
	if (state === "error") return "error";
	return "running";
}

/**
 * Group consecutive non-text parts (reasoning + tools) into chain-of-thought
 * blocks, with text parts standing alone between them.
 */
function groupParts(parts: UIMessage["parts"]): MessageSegment[] {
	const segments: MessageSegment[] = [];
	let chain: ChainPart[] = [];

	const flush = () => {
		if (chain.length > 0) {
			segments.push({ type: "chain", parts: [...chain] });
			chain = [];
		}
	};

	for (const part of parts) {
		if (part.type === "text") {
			flush();
			segments.push({
				type: "text",
				text: (part as { type: "text"; text: string }).text,
			});
		} else if (part.type === "reasoning") {
			const rp = part as {
				type: "reasoning";
				text: string;
				state?: string;
			};
			chain.push({
				kind: "reasoning",
				text: rp.text,
				isStreaming: rp.state === "streaming",
			});
		} else if (part.type === "dynamic-tool") {
			const tp = part as {
				type: "dynamic-tool";
				toolName: string;
				toolCallId: string;
				state: string;
				input?: unknown;
				output?: unknown;
			};
			chain.push({
				kind: "tool",
				toolName: tp.toolName,
				toolCallId: tp.toolCallId,
				status: toolStatus(tp.state),
				args: asRecord(tp.input),
				output: asRecord(tp.output),
			});
		} else if (part.type.startsWith("tool-")) {
			const tp = part as {
				type: string;
				toolCallId: string;
				toolName?: string;
				state?: string;
				title?: string;
				input?: unknown;
				output?: unknown;
			};
			chain.push({
				kind: "tool",
				toolName:
					tp.title ??
					tp.toolName ??
					part.type.replace("tool-", ""),
				toolCallId: tp.toolCallId,
				status: toolStatus(tp.state ?? "input-available"),
				args: asRecord(tp.input),
				output: asRecord(tp.output),
			});
		}
	}

	flush();
	return segments;
}

/** Safely cast unknown to Record if it's a non-null object */
function asRecord(
	val: unknown,
): Record<string, unknown> | undefined {
	if (val && typeof val === "object" && !Array.isArray(val))
		return val as Record<string, unknown>;
	return undefined;
}

/* ─── Chat message ─── */

export function ChatMessage({ message }: { message: UIMessage }) {
	const isUser = message.role === "user";
	const segments = groupParts(message.parts);

	return (
		<div
			className={`flex gap-3 py-4 ${isUser ? "justify-end" : "justify-start"}`}
		>
			{!isUser && (
				<div className="flex-shrink-0 w-8 h-8 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-white text-sm font-bold">
					O
				</div>
			)}

			<div
				className={`max-w-[75%] rounded-2xl px-4 py-3 ${
					isUser
						? "bg-[var(--color-accent)] text-white"
						: "bg-[var(--color-surface)] text-[var(--color-text)]"
				}`}
			>
				{segments.map((segment, index) => {
					if (segment.type === "text") {
						return (
							<div
								key={index}
								className="whitespace-pre-wrap text-[15px] leading-relaxed"
							>
								{segment.text}
							</div>
						);
					}
					return (
						<ChainOfThought key={index} parts={segment.parts} />
					);
				})}
			</div>

			{isUser && (
				<div className="flex-shrink-0 w-8 h-8 rounded-full bg-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)] text-sm font-bold">
					U
				</div>
			)}
		</div>
	);
}
