"use client";

import type { UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatMessage } from "./chat-message";
import { createStreamParser } from "./chat-panel";
import { UnicodeSpinner } from "./unicode-spinner";
import { ChatEditor, type ChatEditorHandle } from "./tiptap/chat-editor";

type SubagentPanelProps = {
	sessionKey: string;
	task: string;
	label?: string;
	onBack: () => void;
};

type QueuedMessage = {
	id: string;
	text: string;
	mentionedFiles: Array<{ name: string; path: string }>;
};

function taskMessage(sessionKey: string, task: string): UIMessage {
	return {
		id: `task-${sessionKey}`,
		role: "user",
		parts: [{ type: "text", text: task }],
	} as UIMessage;
}

function buildMessagesFromParsed(
	sessionKey: string,
	task: string,
	parts: Array<Record<string, unknown>>,
): UIMessage[] {
	const messages: UIMessage[] = [taskMessage(sessionKey, task)];
	let assistantParts: UIMessage["parts"] = [];
	let assistantCount = 0;
	let userCount = 0;

	const pushAssistant = () => {
		if (assistantParts.length === 0) {return;}
		messages.push({
			id: `assistant-${sessionKey}-${assistantCount++}`,
			role: "assistant",
			parts: assistantParts,
		} as UIMessage);
		assistantParts = [];
	};

	for (const part of parts) {
		if (part.type === "user-message") {
			pushAssistant();
			messages.push({
				id: (part.id as string | undefined) ?? `user-${sessionKey}-${userCount++}`,
				role: "user",
				parts: [{ type: "text", text: (part.text as string) ?? "" }],
			} as UIMessage);
			continue;
		}
		assistantParts.push(part as UIMessage["parts"][number]);
	}
	pushAssistant();
	return messages;
}

export function SubagentPanel({ sessionKey, task, label, onBack }: SubagentPanelProps) {
	const editorRef = useRef<ChatEditorHandle>(null);
	const [editorEmpty, setEditorEmpty] = useState(true);
	const [messages, setMessages] = useState<UIMessage[]>(() => [taskMessage(sessionKey, task)]);
	const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
	const [isStreaming, setIsStreaming] = useState(false);
	const [connected, setConnected] = useState(false);
	const [isReconnecting, setIsReconnecting] = useState(false);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const userScrolledAwayRef = useRef(false);
	const streamAbortRef = useRef<AbortController | null>(null);
	const scrollRafRef = useRef(0);

	const displayLabel = label || (task.length > 60 ? task.slice(0, 60) + "..." : task);

	const streamFromResponse = useCallback(
		async (
			res: Response,
			onUpdate: (parts: Array<Record<string, unknown>>) => void,
			signal: AbortSignal,
		) => {
			if (!res.body) {return;}
			const parser = createStreamParser();
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let frameRequested = false;
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
							const event = JSON.parse(chunk.slice(6)) as Record<string, unknown>;
							parser.processEvent(event);
						} catch {
							// ignore malformed event
						}
					}
				}
				if (!frameRequested) {
					frameRequested = true;
					requestAnimationFrame(() => {
						frameRequested = false;
						if (!signal.aborted) {
							onUpdate(parser.getParts() as Array<Record<string, unknown>>);
						}
					});
				}
			}
			if (!signal.aborted) {
				onUpdate(parser.getParts() as Array<Record<string, unknown>>);
			}
		},
		[],
	);

	const reconnect = useCallback(async () => {
		streamAbortRef.current?.abort();
		const abort = new AbortController();
		streamAbortRef.current = abort;
		setIsReconnecting(true);
		try {
			const res = await fetch(`/api/chat/stream?sessionKey=${encodeURIComponent(sessionKey)}`, {
				signal: abort.signal,
			});
			if (!res.ok || !res.body) {
				setConnected(false);
				setIsStreaming(false);
				return;
			}
			setConnected(true);
			setIsStreaming(res.headers.get("X-Run-Active") !== "false");
			await streamFromResponse(
				res,
				(parts) => setMessages(buildMessagesFromParsed(sessionKey, task, parts)),
				abort.signal,
			);
		} catch (err) {
			if ((err as Error).name !== "AbortError") {
				console.error("Subagent reconnect error:", err);
			}
		} finally {
			setIsReconnecting(false);
			if (!abort.signal.aborted) {
				setIsStreaming(false);
				streamAbortRef.current = null;
			}
		}
	}, [sessionKey, task, streamFromResponse]);

	const sendSubagentMessage = useCallback(
		async (text: string, mentionedFiles: Array<{ name: string; path: string }>) => {
			const trimmed = text.trim();
			const hasMentions = mentionedFiles.length > 0;
			if (!trimmed && !hasMentions) {return;}

			const allFilePaths = mentionedFiles.map((f) => f.path);
			const payloadText = allFilePaths.length > 0
				? `[Attached files: ${allFilePaths.join(", ")}]\n\n${trimmed}`
				: trimmed;

			const optimisticUser: UIMessage = {
				id: `user-${Date.now()}-${Math.random().toString(36).slice(2)}`,
				role: "user",
				parts: [{ type: "text", text: payloadText }],
			} as UIMessage;
			const baseMessages = [...messages, optimisticUser];
			setMessages(baseMessages);

			streamAbortRef.current?.abort();
			const abort = new AbortController();
			streamAbortRef.current = abort;
			setIsStreaming(true);
			setConnected(true);

			try {
				const res = await fetch("/api/chat", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					signal: abort.signal,
					body: JSON.stringify({
						sessionKey,
						messages: [optimisticUser],
					}),
				});
				if (!res.ok || !res.body) {
					setIsStreaming(false);
					return;
				}
				await streamFromResponse(
					res,
					(parts) => {
						const assistantMsg: UIMessage = {
							id: `assistant-${sessionKey}-${Date.now()}`,
							role: "assistant",
							parts: parts as UIMessage["parts"],
						} as UIMessage;
						setMessages([...baseMessages, assistantMsg]);
					},
					abort.signal,
				);
			} catch (err) {
				if ((err as Error).name !== "AbortError") {
					console.error("Subagent send error:", err);
				}
			} finally {
				if (!abort.signal.aborted) {
					setIsStreaming(false);
					streamAbortRef.current = null;
				}
			}
		},
		[messages, sessionKey, streamFromResponse],
	);

	const handleEditorSubmit = useCallback(
		async (text: string, mentionedFiles: Array<{ name: string; path: string }>) => {
			if (isStreaming || isReconnecting) {
				setQueuedMessages((prev) => [
					...prev,
					{
						id: crypto.randomUUID(),
						text,
						mentionedFiles,
					},
				]);
				return;
			}
			await sendSubagentMessage(text, mentionedFiles);
		},
		[isStreaming, isReconnecting, sendSubagentMessage],
	);

	const handleStop = useCallback(async () => {
		streamAbortRef.current?.abort();
		streamAbortRef.current = null;
		setIsStreaming(false);
		setIsReconnecting(false);
		try {
			await fetch("/api/chat/stop", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sessionKey }),
			});
		} catch {
			// ignore
		}
	}, [sessionKey]);

	useEffect(() => {
		void reconnect();
		return () => {
			streamAbortRef.current?.abort();
		};
	}, [reconnect]);

	useEffect(() => {
		const wasBusy = isStreaming || isReconnecting;
		if (wasBusy || queuedMessages.length === 0) {return;}
		const [next, ...rest] = queuedMessages;
		setQueuedMessages(rest);
		queueMicrotask(() => {
			void sendSubagentMessage(next.text, next.mentionedFiles);
		});
	}, [isStreaming, isReconnecting, queuedMessages, sendSubagentMessage]);

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
		if (scrollRafRef.current) {return;}
		scrollRafRef.current = requestAnimationFrame(() => {
			scrollRafRef.current = 0;
			messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
		});
	}, [messages]);

	const statusLabel = useMemo(() => {
		if (!connected && (isStreaming || isReconnecting)) {return <UnicodeSpinner name="braille">Connecting</UnicodeSpinner>;}
		if (isReconnecting) {return <UnicodeSpinner name="braille">Resuming</UnicodeSpinner>;}
		if (isStreaming) {return <UnicodeSpinner name="braille" />;}
		return "Completed";
	}, [connected, isStreaming, isReconnecting]);

	return (
		<div ref={scrollContainerRef} className="h-full overflow-y-auto">
			<div className="flex flex-col min-h-full">
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
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
							<path d="m12 19-7-7 7-7" />
							<path d="M19 12H5" />
						</svg>
					</button>
					<div className="min-w-0 flex-1">
						<h2 className="text-sm font-semibold truncate" style={{ color: "var(--color-text)" }}>
							{displayLabel}
						</h2>
						<p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
							{statusLabel}
						</p>
					</div>
				</header>

				<div className="flex-1 px-6">
					<div className="max-w-2xl mx-auto py-3">
						{messages.map((message, i) => (
							<ChatMessage key={message.id} message={message} isStreaming={(isStreaming || isReconnecting) && i === messages.length - 1} />
						))}
						<div ref={messagesEndRef} />
					</div>
				</div>

				<div
					className="px-3 pb-3 pt-0 md:px-6 md:pb-5 sticky bottom-0 z-20 backdrop-blur-md"
					style={{ background: "var(--color-bg-glass)" }}
				>
					<div className="max-w-[720px] mx-auto rounded-3xl overflow-hidden" style={{ background: "var(--color-chat-input-bg)", border: "1px solid var(--color-border)" }}>
						{queuedMessages.length > 0 && (
							<div className="px-3 pt-3">
								<div className="rounded-xl overflow-hidden" style={{ border: "1px dashed var(--color-border-strong)", background: "var(--color-bg-elevated)" }}>
									<div className="px-3 py-1.5 text-[11px] font-medium tracking-wide uppercase" style={{ borderBottom: "1px solid var(--color-border)", color: "var(--color-text-muted)", fontFamily: "var(--font-mono, monospace)" }}>
										Queued ({queuedMessages.length})
									</div>
									<div className="flex flex-col gap-1 p-1.5">
										{queuedMessages.map((msg) => (
											<div key={msg.id} className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2" style={{ background: "var(--color-bg-secondary)" }}>
												<p className="flex-1 text-[13px] leading-[1.45] line-clamp-2" style={{ color: "var(--color-text)", whiteSpace: "pre-wrap" }}>
													{msg.text}
												</p>
												<button
													type="button"
													className="rounded-md p-1 transition-colors hover:bg-[var(--color-bg)]"
													style={{ color: "var(--color-text-muted)" }}
													onClick={() => setQueuedMessages((prev) => prev.filter((m) => m.id !== msg.id))}
												>
													<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
														<path d="M18 6 6 18" />
														<path d="m6 6 12 12" />
													</svg>
												</button>
											</div>
										))}
									</div>
								</div>
							</div>
						)}
						<ChatEditor
							ref={editorRef}
							onSubmit={handleEditorSubmit}
							onChange={(isEmpty) => setEditorEmpty(isEmpty)}
							placeholder={isStreaming || isReconnecting ? "Type to queue a message..." : "Type @ to mention files..."}
						/>
						<div className="flex items-center justify-end px-3 pb-2.5">
							<div className="flex items-center gap-1.5">
								{(isStreaming || isReconnecting) && (
									<button
										type="button"
										onClick={() => void handleStop()}
										className="w-7 h-7 rounded-full flex items-center justify-center"
										style={{ background: "var(--color-text)", color: "var(--color-bg)" }}
										title="Stop generating"
									>
										<svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
											<rect width="10" height="10" rx="1.5" />
										</svg>
									</button>
								)}
								<button
									type="button"
									onClick={() => {
										editorRef.current?.submit();
									}}
									disabled={editorEmpty}
									className="w-7 h-7 rounded-full flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
									style={{
										background: !editorEmpty ? ((isStreaming || isReconnecting) ? "var(--color-text-muted)" : "var(--color-accent)") : "var(--color-border-strong)",
										color: "white",
									}}
									title={(isStreaming || isReconnecting) ? "Queue message" : "Send message"}
								>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
										<path d="M12 19V5" />
										<path d="m5 12 7-7 7 7" />
									</svg>
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
