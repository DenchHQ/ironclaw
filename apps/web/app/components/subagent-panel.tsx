"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { ChatMessage } from "./chat-message";
import { UnicodeSpinner } from "./unicode-spinner";
import type { UIMessage } from "ai";

type ParsedPart =
	| { type: "text"; text: string }
	| { type: "reasoning"; text: string; state?: string }
	| {
			type: "dynamic-tool";
			toolName: string;
			toolCallId: string;
			state: string;
			input?: Record<string, unknown>;
			output?: Record<string, unknown>;
		};

function createSubagentStreamParser() {
	const parts: ParsedPart[] = [];
	let currentTextIdx = -1;
	let currentReasoningIdx = -1;

	function processEvent(event: Record<string, unknown>) {
		const t = event.type as string;
		switch (t) {
			case "reasoning-start":
				parts.push({ type: "reasoning", text: "", state: "streaming" });
				currentReasoningIdx = parts.length - 1;
				break;
			case "reasoning-delta": {
				if (currentReasoningIdx >= 0) {
					const p = parts[currentReasoningIdx] as { type: "reasoning"; text: string };
					p.text += event.delta as string;
				}
				break;
			}
			case "reasoning-end":
				if (currentReasoningIdx >= 0) {
					const p = parts[currentReasoningIdx] as { type: "reasoning"; state?: string };
					delete p.state;
				}
				currentReasoningIdx = -1;
				break;
			case "text-start":
				parts.push({ type: "text", text: "" });
				currentTextIdx = parts.length - 1;
				break;
			case "text-delta": {
				if (currentTextIdx >= 0) {
					const p = parts[currentTextIdx] as { type: "text"; text: string };
					p.text += event.delta as string;
				}
				break;
			}
			case "text-end":
				currentTextIdx = -1;
				break;
			case "tool-input-start":
				parts.push({
					type: "dynamic-tool",
					toolCallId: event.toolCallId as string,
					toolName: event.toolName as string,
					state: "input-available",
					input: {},
				});
				break;
			case "tool-input-available":
				for (let i = parts.length - 1; i >= 0; i--) {
					const p = parts[i];
					if (p.type === "dynamic-tool" && p.toolCallId === event.toolCallId) {
						p.input = (event.input as Record<string, unknown>) ?? {};
						break;
					}
				}
				break;
			case "tool-output-available":
				for (let i = parts.length - 1; i >= 0; i--) {
					const p = parts[i];
					if (p.type === "dynamic-tool" && p.toolCallId === event.toolCallId) {
						p.state = "output-available";
						p.output = (event.output as Record<string, unknown>) ?? {};
						break;
					}
				}
				break;
			case "tool-output-error":
				for (let i = parts.length - 1; i >= 0; i--) {
					const p = parts[i];
					if (p.type === "dynamic-tool" && p.toolCallId === event.toolCallId) {
						p.state = "error";
						p.output = { error: event.errorText as string };
						break;
					}
				}
				break;
		}
	}

	return {
		processEvent,
		getParts: (): ParsedPart[] => parts.map((p) => ({ ...p })),
	};
}

type SubagentPanelProps = {
	sessionKey: string;
	task: string;
	label?: string;
	onBack: () => void;
};

export function SubagentPanel({ sessionKey, task, label, onBack }: SubagentPanelProps) {
	const [messages, setMessages] = useState<
		Array<{ id: string; role: "assistant"; parts: UIMessage["parts"] }>
	>([]);
	const [isStreaming, setIsStreaming] = useState(true);
	const [connected, setConnected] = useState(false);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const userScrolledAwayRef = useRef(false);
	const abortRef = useRef<AbortController | null>(null);

	const displayLabel = label || (task.length > 60 ? task.slice(0, 60) + "..." : task);

	// Auto-scroll
	useEffect(() => {
		const el = scrollContainerRef.current;
		if (!el) {return;}
		const onScroll = () => {
			const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
			userScrolledAwayRef.current = distanceFromBottom > 80;
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => el.removeEventListener("scroll", onScroll);
	}, []);

	useEffect(() => {
		if (userScrolledAwayRef.current) {return;}
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	// Reset state when switching between subagents
	useEffect(() => {
		setMessages([]);
		setIsStreaming(true);
		setConnected(false);
		userScrolledAwayRef.current = false;
	}, [sessionKey]);

	// Connect to subagent SSE stream
	useEffect(() => {
		const abort = new AbortController();
		abortRef.current = abort;

		const connect = async () => {
			try {
				const res = await fetch(
					`/api/chat/subagent-stream?sessionKey=${encodeURIComponent(sessionKey)}`,
					{ signal: abort.signal },
				);

				if (!res.ok || !res.body) {
					setIsStreaming(false);
					return;
				}

				const isActive = res.headers.get("X-Run-Active") !== "false";
				setConnected(true);
				setIsStreaming(isActive);

				const parser = createSubagentStreamParser();
				const reader = res.body.getReader();
				const decoder = new TextDecoder();
				const msgId = `subagent-${sessionKey}`;
				let buffer = "";
				let frameRequested = false;

				const updateUI = () => {
					if (abort.signal.aborted) {return;}
					const assistantMsg = {
						id: msgId,
						role: "assistant" as const,
						parts: parser.getParts() as UIMessage["parts"],
					};
					setMessages([assistantMsg]);
				};

				// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- loop
				while (true) {
					const { done, value } = await reader.read();
					if (done) {break;}

					buffer += decoder.decode(value, { stream: true });

					let idx;
					while ((idx = buffer.indexOf("\n\n")) !== -1) {
						const chunk = buffer.slice(0, idx);
						buffer = buffer.slice(idx + 2);

						if (chunk.startsWith("data: ")) {
							try {
								const event = JSON.parse(chunk.slice(6));
								parser.processEvent(event);
							} catch { /* skip */ }
						}
					}

					if (!frameRequested) {
						frameRequested = true;
						requestAnimationFrame(() => {
							frameRequested = false;
							updateUI();
						});
					}
				}

				updateUI();
				setIsStreaming(false);
			} catch (err) {
				if ((err as Error).name !== "AbortError") {
					console.error("Subagent stream error:", err);
				}
				setIsStreaming(false);
			}
		};

		void connect();
		return () => { abort.abort(); };
	}, [sessionKey]);

	const statusLabel = useMemo(() => {
		if (!connected && isStreaming) {return <UnicodeSpinner name="braille">Connecting</UnicodeSpinner>;}
		if (isStreaming) {return <UnicodeSpinner name="braille" />;}
		return "Completed";
	}, [connected, isStreaming]);

	return (
		<div ref={scrollContainerRef} className="h-full overflow-y-auto">
			<div className="flex flex-col min-h-full">
				{/* Header */}
				<header
					className="px-3 py-2 md:px-6 md:py-3 flex items-center gap-3 sticky top-0 z-20 backdrop-blur-md"
					style={{ background: "var(--color-bg-glass)" }}
				>
					<button
						type="button"
						onClick={onBack}
						className="p-1.5 rounded-lg flex-shrink-0"
						style={{ color: "var(--color-text-muted)" }}
						title="Back to parent chat"
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
					</button>
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<span
								className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded"
								style={{
									background: "var(--color-accent-light)",
									color: "var(--color-accent)",
								}}
							>
								Subagent
							</span>
							<h2
								className="text-sm font-semibold truncate"
								style={{ color: "var(--color-text)" }}
							>
								{displayLabel}
							</h2>
						</div>
						<p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
							{statusLabel}
						</p>
					</div>
					{isStreaming && (
						<span
							className="inline-block w-2 h-2 rounded-full animate-pulse flex-shrink-0"
							style={{ background: "var(--color-accent)" }}
						/>
					)}
				</header>

				{/* Messages */}
				<div className="flex-1 px-6">
					{messages.length === 0 && isStreaming ? (
						<div className="flex items-center justify-center h-full min-h-[40vh]">
							<div className="text-center">
								<div
									className="w-6 h-6 border-2 rounded-full animate-spin mx-auto mb-3"
									style={{
										borderColor: "var(--color-border)",
										borderTopColor: "var(--color-accent)",
									}}
								/>
								<p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
									Waiting for subagent...
								</p>
							</div>
						</div>
					) : messages.length === 0 ? (
						<div className="flex items-center justify-center h-full min-h-[40vh]">
							<p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
								No output from subagent.
							</p>
						</div>
					) : (
						<div className="max-w-2xl mx-auto py-3">
							{messages.map((message, i) => (
								<ChatMessage
									key={message.id}
									message={message}
									isStreaming={isStreaming && i === messages.length - 1}
								/>
							))}
							<div ref={messagesEndRef} />
						</div>
					)}
				</div>

				{/* Task description */}
				{task && task.length > 60 && (
					<div
						className="px-6 py-3 sticky bottom-0 z-10 backdrop-blur-md"
						style={{ background: "var(--color-bg-glass)" }}
					>
						<details className="text-xs" style={{ color: "var(--color-text-muted)" }}>
							<summary className="cursor-pointer font-medium">Task description</summary>
							<p className="mt-1 whitespace-pre-wrap leading-relaxed">{task}</p>
						</details>
					</div>
				)}
			</div>
		</div>
	);
}
