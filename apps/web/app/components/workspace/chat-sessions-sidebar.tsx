"use client";

import { useCallback, useMemo, useState } from "react";

type WebSession = {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
};

export type SidebarSubagentInfo = {
	childSessionKey: string;
	runId: string;
	task: string;
	label?: string;
	parentSessionId: string;
	status?: "running" | "completed" | "error";
};

type ChatSessionsSidebarProps = {
	sessions: WebSession[];
	activeSessionId: string | null;
	/** Title of the currently active session (shown in the header). */
	activeSessionTitle?: string;
	/** Session IDs with an actively running agent stream. */
	streamingSessionIds?: Set<string>;
	/** Subagents spawned by chat sessions. */
	subagents?: SidebarSubagentInfo[];
	/** Currently selected subagent session key (if viewing a subagent). */
	activeSubagentKey?: string | null;
	onSelectSession: (sessionId: string) => void;
	onNewSession: () => void;
	/** Called when a subagent is selected in the sidebar. */
	onSelectSubagent?: (sessionKey: string) => void;
	/** When true, renders as a mobile overlay drawer instead of a static sidebar. */
	mobile?: boolean;
	/** Close the mobile drawer. */
	onClose?: () => void;
	/** Fixed width in px when not mobile (overrides default 260). */
	width?: number;
};

/** Format a timestamp into a human-readable relative time string. */
function timeAgo(ts: number): string {
	const now = Date.now();
	const diff = now - ts;
	const seconds = Math.floor(diff / 1000);
	if (seconds < 60) {return "just now";}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {return `${minutes}m ago`;}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {return `${hours}h ago`;}
	const days = Math.floor(hours / 24);
	if (days < 30) {return `${days}d ago`;}
	const months = Math.floor(days / 30);
	if (months < 12) {return `${months}mo ago`;}
	return `${Math.floor(months / 12)}y ago`;
}

function PlusIcon() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M5 12h14" />
			<path d="M12 5v14" />
		</svg>
	);
}

function SubagentIcon() {
	return (
		<svg
			width="11"
			height="11"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M16 3h5v5" />
			<path d="m21 3-7 7" />
			<path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
		</svg>
	);
}

function ChatBubbleIcon() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
		</svg>
	);
}

export function ChatSessionsSidebar({
	sessions,
	activeSessionId,
	activeSessionTitle: _activeSessionTitle,
	streamingSessionIds,
	subagents,
	activeSubagentKey,
	onSelectSession,
	onNewSession,
	onSelectSubagent,
	mobile,
	onClose,
	width: widthProp,
}: ChatSessionsSidebarProps) {
	const [hoveredId, setHoveredId] = useState<string | null>(null);

	const handleSelect = useCallback(
		(id: string) => {
			onSelectSession(id);
			onClose?.();
		},
		[onSelectSession, onClose],
	);

	const handleSelectSubagentItem = useCallback(
		(sessionKey: string) => {
			onSelectSubagent?.(sessionKey);
			onClose?.();
		},
		[onSelectSubagent, onClose],
	);

	// Index subagents by parent session ID
	const subagentsByParent = useMemo(() => {
		const map = new Map<string, SidebarSubagentInfo[]>();
		if (!subagents) {return map;}
		for (const sa of subagents) {
			let list = map.get(sa.parentSessionId);
			if (!list) {
				list = [];
				map.set(sa.parentSessionId, list);
			}
			list.push(sa);
		}
		return map;
	}, [subagents]);

	// Group sessions: today, yesterday, this week, this month, older
	const grouped = groupSessions(sessions);

	const width = mobile ? "280px" : (widthProp ?? 260);
	const sidebar = (
		<aside
			className={`flex flex-col h-full flex-shrink-0 ${mobile ? "drawer-right" : "border-l"}`}
			style={{
				width: typeof width === "number" ? `${width}px` : width,
				borderColor: "var(--color-border)",
				background: "var(--color-surface)",
			}}
		>
			<div
				className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
				style={{ borderColor: "var(--color-border)" }}
			>
				<div className="min-w-0 flex-1">
					<span
						className="text-sm font-medium truncate block"
						style={{ color: "var(--color-text)" }}
					>
						Chats
					</span>
				</div>
				<button
					type="button"
					onClick={onNewSession}
					className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex-shrink-0 ml-2"
					style={{
						color: "var(--color-accent)",
						background: "var(--color-accent-light)",
					}}
					title="New chat"
				>
					<PlusIcon />
					New
				</button>
			</div>

			{/* Session list */}
			<div className="flex-1 overflow-y-auto">
				{sessions.length === 0 ? (
					<div className="px-4 py-8 text-center">
						<div
							className="mx-auto w-10 h-10 rounded-xl flex items-center justify-center mb-3"
							style={{
								background: "var(--color-surface-hover)",
								color: "var(--color-text-muted)",
							}}
						>
							<ChatBubbleIcon />
						</div>
						<p
							className="text-xs"
							style={{ color: "var(--color-text-muted)" }}
						>
							No conversations yet.
							<br />
							Start a new chat to begin.
						</p>
					</div>
				) : (
					<div className="px-2 py-1">
						{grouped.map((group) => (
							<div key={group.label}>
								<div
									className="px-2 pt-3 pb-1 text-[10px] font-medium uppercase tracking-wider"
									style={{ color: "var(--color-text-muted)" }}
								>
									{group.label}
								</div>
							{group.sessions.map((session) => {
								const isActive = session.id === activeSessionId && !activeSubagentKey;
								const isHovered = session.id === hoveredId;
								const isStreamingSession = streamingSessionIds?.has(session.id) ?? false;
								const sessionSubagents = subagentsByParent.get(session.id);
								return (
									<div key={session.id}>
									<button
										type="button"
										onClick={() => handleSelect(session.id)}
										onMouseEnter={() => setHoveredId(session.id)}
										onMouseLeave={() => setHoveredId(null)}
										className="w-full text-left px-2 py-2 rounded-lg transition-colors cursor-pointer"
										style={{
											background: isActive
												? "var(--color-accent-light)"
												: isHovered
													? "var(--color-surface-hover)"
													: "transparent",
										}}
									>
										<div className="flex items-center gap-1.5">
											{isStreamingSession && (
												<span
													className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse"
													style={{ background: "var(--color-accent)" }}
													title="Agent is running"
												/>
											)}
											<div
												className="text-xs font-medium truncate"
												style={{
													color: isActive
														? "var(--color-accent)"
														: "var(--color-text)",
												}}
											>
												{session.title || "Untitled chat"}
											</div>
										</div>
										<div className="flex items-center gap-2 mt-0.5" style={{ paddingLeft: isStreamingSession ? "calc(0.375rem + 6px)" : undefined }}>
											{isStreamingSession && (
												<span
													className="text-[10px] font-medium"
													style={{ color: "var(--color-accent)" }}
												>
													Streaming
												</span>
											)}
											<span
												className="text-[10px]"
												style={{ color: "var(--color-text-muted)" }}
											>
												{timeAgo(session.updatedAt)}
											</span>
											{session.messageCount > 0 && (
												<span
													className="text-[10px]"
													style={{ color: "var(--color-text-muted)" }}
												>
													{session.messageCount} msg{session.messageCount !== 1 ? "s" : ""}
												</span>
											)}
										</div>
									</button>
									{/* Subagent sub-items */}
									{sessionSubagents && sessionSubagents.length > 0 && (
										<div className="ml-4 border-l" style={{ borderColor: "var(--color-border)" }}>
											{sessionSubagents.map((sa) => {
												const isSubActive = activeSubagentKey === sa.childSessionKey;
												const isSubRunning = sa.status === "running";
												const subLabel = sa.label || sa.task;
												const truncated = subLabel.length > 40 ? subLabel.slice(0, 40) + "..." : subLabel;
												return (
													<button
														key={sa.childSessionKey}
														type="button"
														onClick={() => handleSelectSubagentItem(sa.childSessionKey)}
														className="w-full text-left pl-3 pr-2 py-1.5 rounded-r-lg transition-colors cursor-pointer"
														style={{
															background: isSubActive
																? "var(--color-accent-light)"
																: "transparent",
														}}
													>
														<div className="flex items-center gap-1.5">
															{isSubRunning && (
																<span
																	className="inline-block w-1 h-1 rounded-full flex-shrink-0 animate-pulse"
																	style={{ background: "var(--color-accent)" }}
																	title="Subagent running"
																/>
															)}
															<SubagentIcon />
															<span
																className="text-[11px] truncate"
																style={{
																	color: isSubActive
																		? "var(--color-accent)"
																		: "var(--color-text-muted)",
																}}
															>
																{truncated}
															</span>
														</div>
													</button>
												);
											})}
										</div>
									)}
									</div>
									);
								})}
							</div>
						))}
					</div>
				)}
			</div>
		</aside>
	);

    if (!mobile) { return sidebar; }

	return (
		<div className="drawer-backdrop" onClick={() => void onClose?.()}>
			{/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
			<div onClick={(e) => e.stopPropagation()} className="fixed inset-y-0 right-0 z-50">
				{sidebar}
			</div>
		</div>
	);
}

// ── Grouping helpers ──

type SessionGroup = {
	label: string;
	sessions: WebSession[];
};

function groupSessions(sessions: WebSession[]): SessionGroup[] {
	const now = new Date();
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const yesterdayStart = todayStart - 86400000;
	const weekStart = todayStart - 7 * 86400000;
	const monthStart = todayStart - 30 * 86400000;

	const today: WebSession[] = [];
	const yesterday: WebSession[] = [];
	const thisWeek: WebSession[] = [];
	const thisMonth: WebSession[] = [];
	const older: WebSession[] = [];

	for (const s of sessions) {
		const t = s.updatedAt;
		if (t >= todayStart) {today.push(s);}
		else if (t >= yesterdayStart) {yesterday.push(s);}
		else if (t >= weekStart) {thisWeek.push(s);}
		else if (t >= monthStart) {thisMonth.push(s);}
		else {older.push(s);}
	}

	const groups: SessionGroup[] = [];
	if (today.length > 0) {groups.push({ label: "Today", sessions: today });}
	if (yesterday.length > 0) {groups.push({ label: "Yesterday", sessions: yesterday });}
	if (thisWeek.length > 0) {groups.push({ label: "This Week", sessions: thisWeek });}
	if (thisMonth.length > 0) {groups.push({ label: "This Month", sessions: thisMonth });}
	if (older.length > 0) {groups.push({ label: "Older", sessions: older });}
	return groups;
}
