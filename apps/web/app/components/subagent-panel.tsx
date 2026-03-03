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
	onSubagentClick?: (task: string) => void;
	onFilePathClick?: (path: string) => Promise<boolean | void> | boolean | void;
};

type QueuedMessage = {
	id: string;
	text: string;
	mentionedFiles: Array<{ name: string; path: string }>;
};

function QueueItem({
	msg,
	idx,
	onEdit,
	onSendNow,
	onRemove,
}: {
	msg: QueuedMessage;
	idx: number;
	onEdit: (id: string, text: string) => void;
	onSendNow: (id: string) => void;
	onRemove: (id: string) => void;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(msg.text);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	const autoResize = () => {
		const el = inputRef.current;
		if (!el) {
			return;
		}
		el.style.height = "auto";
		el.style.height = `${el.scrollHeight}px`;
	};

	useEffect(() => {
		if (!editing) {
			return;
		}
		inputRef.current?.focus();
		const len = inputRef.current?.value.length ?? 0;
		inputRef.current?.setSelectionRange(len, len);
		autoResize();
	}, [editing]);

	const commitEdit = () => {
		const trimmed = draft.trim();
		if (trimmed && trimmed !== msg.text) {
			onEdit(msg.id, trimmed);
		} else {
			setDraft(msg.text);
		}
		setEditing(false);
	};

	return (
		<div
			className={`flex items-start gap-2.5 group py-2 ${idx > 0 ? "border-t" : ""}`}
			style={idx > 0 ? { borderColor: "var(--color-border)" } : undefined}
		>
			<span
				className="shrink-0 mt-px text-[11px] font-medium tabular-nums w-4"
				style={{ color: "var(--color-text-muted)" }}
			>
				{idx + 1}
			</span>
			{editing ? (
				<textarea
					ref={inputRef}
					className="flex-1 text-[13px] leading-[1.45] min-w-0 resize-none rounded-md px-2 py-1 outline-none"
					style={{
						color: "var(--color-text-secondary)",
						background: "var(--color-bg)",
						border: "1px solid var(--color-border)",
					}}
					rows={1}
					value={draft}
					onChange={(e) => {
						setDraft(e.target.value);
						autoResize();
					}}
					onBlur={commitEdit}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							commitEdit();
						}
						if (e.key === "Escape") {
							setDraft(msg.text);
							setEditing(false);
						}
					}}
				/>
			) : (
				<div className="flex-1 min-w-0 flex items-center gap-2">
					<p
						className="text-[13px] leading-[1.45] line-clamp-1 min-w-0"
						style={{ color: "var(--color-text-secondary)" }}
					>
						{msg.text}
					</p>
				</div>
			)}
			{!editing && (
				<div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
					<button
						type="button"
						className="rounded-md p-1 transition-colors hover:bg-stone-100 dark:hover:bg-stone-800"
						title="Edit message"
						onClick={() => {
							setDraft(msg.text);
							setEditing(true);
						}}
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-stone-400">
							<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
							<path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
						</svg>
					</button>
					<button
						type="button"
						className="rounded-md p-1 transition-colors hover:bg-stone-100 dark:hover:bg-stone-800"
						title="Send now"
						onClick={() => onSendNow(msg.id)}
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-stone-400">
							<path d="M12 19V5" />
							<path d="m5 12 7-7 7 7" />
						</svg>
					</button>
					<button
						type="button"
						className="rounded-md p-1 transition-colors hover:bg-stone-100 dark:hover:bg-stone-800"
						title="Remove from queue"
						onClick={() => onRemove(msg.id)}
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-stone-400">
							<path d="M3 6h18" />
							<path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
							<path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
						</svg>
					</button>
				</div>
			)}
		</div>
	);
}

export function taskMessage(sessionKey: string, task: string): UIMessage {
	return {
		id: `task-${sessionKey}`,
		role: "user",
		parts: [{ type: "text", text: task }],
	} as UIMessage;
}

export function buildMessagesFromParsed(
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

export function SubagentPanel({
	sessionKey,
	task,
	label,
	onBack,
	onSubagentClick,
	onFilePathClick,
}: SubagentPanelProps) {
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

	const removeQueuedMessage = useCallback((id: string) => {
		setQueuedMessages((prev) => prev.filter((m) => m.id !== id));
	}, []);

	const updateQueuedMessageText = useCallback((id: string, text: string) => {
		setQueuedMessages((prev) =>
			prev.map((m) => (m.id === id ? { ...m, text } : m)),
		);
	}, []);

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
		setIsStreaming(false);
		streamAbortRef.current = null;
	}, [sessionKey]);

	const forceSendQueuedMessage = useCallback(
		async (id: string) => {
			const msg = queuedMessages.find((m) => m.id === id);
			if (!msg) {
				return;
			}
			setQueuedMessages((prev) => prev.filter((m) => m.id !== id));
			await handleStop();
			setTimeout(() => {
				void sendSubagentMessage(msg.text, msg.mentionedFiles);
			}, 100);
		},
		[queuedMessages, handleStop, sendSubagentMessage],
	);

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
							<ChatMessage
								key={message.id}
								message={message}
								isStreaming={(isStreaming || isReconnecting) && i === messages.length - 1}
								onSubagentClick={onSubagentClick}
								onFilePathClick={onFilePathClick}
							/>
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
								<div
									className="rounded-xl border overflow-hidden"
									style={{
										background: "var(--color-surface)",
										borderColor: "var(--color-border)",
										boxShadow: "var(--shadow-sm)",
									}}
								>
									<div
										className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider"
										style={{
											color: "var(--color-text-muted)",
											background: "var(--color-surface-hover)",
										}}
									>
										Queued ({queuedMessages.length})
									</div>
									<div className="flex flex-col p-2">
										{queuedMessages.map((msg, idx) => (
											<QueueItem
												key={msg.id}
												msg={msg}
												idx={idx}
												onEdit={updateQueuedMessageText}
												onSendNow={forceSendQueuedMessage}
												onRemove={removeQueuedMessage}
											/>
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
								{isStreaming || isReconnecting ? (
									<button
										type="button"
										onClick={() => {
											editorRef.current?.submit();
										}}
										disabled={editorEmpty}
										className="h-7 px-3 rounded-full flex items-center gap-1.5 text-[12px] font-medium disabled:opacity-40 disabled:cursor-not-allowed"
										style={{
											background: !editorEmpty
												? "var(--color-accent)"
												: "var(--color-surface-hover)",
											color: !editorEmpty
												? "white"
												: "var(--color-text-muted)",
										}}
										title="Add to queue"
									>
										<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
											<polyline points="9 10 4 15 9 20" />
											<path d="M20 4v7a4 4 0 0 1-4 4H4" />
										</svg>
										Queue
									</button>
								) : (
									<button
										type="button"
										onClick={() => {
											editorRef.current?.submit();
										}}
										disabled={editorEmpty}
										className="w-7 h-7 rounded-full flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
										style={{
											background: !editorEmpty
												? "var(--color-accent)"
												: "var(--color-border-strong)",
											color: "white",
										}}
										title="Send message"
									>
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
											<path d="M12 19V5" />
											<path d="m5 12 7-7 7 7" />
										</svg>
									</button>
								)}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
