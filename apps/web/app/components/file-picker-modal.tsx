"use client";

import {
	Fragment,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

// ── Types ──

type BrowseEntry = {
	name: string;
	path: string;
	type: "folder" | "file" | "document" | "database";
	children?: BrowseEntry[];
};

export type SelectedFile = {
	name: string;
	path: string;
};

type FilePickerModalProps = {
	open: boolean;
	onClose: () => void;
	onSelect: (files: SelectedFile[]) => void;
};

// ── Helpers ──

function getCategoryFromName(
	name: string,
): "image" | "video" | "audio" | "pdf" | "code" | "document" | "folder" | "other" {
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	if (
		["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico", "tiff", "heic"].includes(ext)
	)
		{return "image";}
	if (["mp4", "webm", "mov", "avi", "mkv", "flv"].includes(ext)) {return "video";}
	if (["mp3", "wav", "ogg", "aac", "flac", "m4a"].includes(ext)) {return "audio";}
	if (ext === "pdf") {return "pdf";}
	if (
		[
			"js", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java",
			"cpp", "c", "h", "css", "html", "json", "yaml", "yml",
			"toml", "md", "sh", "bash", "sql", "swift", "kt",
		].includes(ext)
	)
		{return "code";}
	if (
		["doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "csv"].includes(ext)
	)
		{return "document";}
	return "other";
}

function buildBreadcrumbs(
	dir: string,
): { label: string; path: string }[] {
	const segments: { label: string; path: string }[] = [];
	const homeMatch = dir.match(/^(\/Users\/[^/]+|\/home\/[^/]+)/);
	const homeDir = homeMatch?.[1];

	if (homeDir) {
		segments.push({ label: "~", path: homeDir });
		const rest = dir.slice(homeDir.length);
		const parts = rest.split("/").filter(Boolean);
		let currentPath = homeDir;
		for (const part of parts) {
			currentPath += "/" + part;
			segments.push({ label: part, path: currentPath });
		}
	} else if (dir === "/") {
		segments.push({ label: "/", path: "/" });
	} else {
		segments.push({ label: "/", path: "/" });
		const parts = dir.split("/").filter(Boolean);
		let currentPath = "";
		for (const part of parts) {
			currentPath += "/" + part;
			segments.push({ label: part, path: currentPath });
		}
	}
	return segments;
}

const pickerColors: Record<string, { bg: string; fg: string }> = {
	folder: { bg: "rgba(245, 158, 11, 0.12)", fg: "#f59e0b" },
	image: { bg: "rgba(16, 185, 129, 0.12)", fg: "#10b981" },
	video: { bg: "rgba(139, 92, 246, 0.12)", fg: "#8b5cf6" },
	audio: { bg: "rgba(245, 158, 11, 0.12)", fg: "#f59e0b" },
	pdf: { bg: "rgba(239, 68, 68, 0.12)", fg: "#ef4444" },
	code: { bg: "rgba(59, 130, 246, 0.12)", fg: "#3b82f6" },
	document: { bg: "rgba(107, 114, 128, 0.12)", fg: "#6b7280" },
	other: { bg: "rgba(107, 114, 128, 0.08)", fg: "#9ca3af" },
};

// ── Icons ──

function PickerIcon({
	category,
	size = 16,
}: {
	category: string;
	size?: number;
}) {
	const props = {
		width: size,
		height: size,
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 2,
		strokeLinecap: "round" as const,
		strokeLinejoin: "round" as const,
	};
	switch (category) {
		case "folder":
			return (
				<svg {...props}>
					<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
				</svg>
			);
		case "image":
			return (
				<svg {...props}>
					<rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
					<circle cx="9" cy="9" r="2" />
					<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
				</svg>
			);
		case "video":
			return (
				<svg {...props}>
					<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
					<rect x="2" y="6" width="14" height="12" rx="2" />
				</svg>
			);
		case "audio":
			return (
				<svg {...props}>
					<path d="M9 18V5l12-2v13" />
					<circle cx="6" cy="18" r="3" />
					<circle cx="18" cy="16" r="3" />
				</svg>
			);
		case "pdf":
			return (
				<svg {...props}>
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
					<path d="M14 2v6h6" />
					<path d="M10 13h4" />
					<path d="M10 17h4" />
				</svg>
			);
		case "code":
			return (
				<svg {...props}>
					<polyline points="16 18 22 12 16 6" />
					<polyline points="8 6 2 12 8 18" />
				</svg>
			);
		case "document":
			return (
				<svg {...props}>
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
					<path d="M14 2v6h6" />
					<path d="M16 13H8" />
					<path d="M16 17H8" />
					<path d="M10 9H8" />
				</svg>
			);
		default:
			return (
				<svg {...props}>
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
					<path d="M14 2v6h6" />
				</svg>
			);
	}
}

// ── Main component ──

export function FilePickerModal({
	open,
	onClose,
	onSelect,
}: FilePickerModalProps) {
	const [currentDir, setCurrentDir] = useState<string | null>(null);
	const [displayDir, setDisplayDir] = useState("");
	const [entries, setEntries] = useState<BrowseEntry[]>([]);
	const [parentDir, setParentDir] = useState<string | null>(null);
	const [selected, setSelected] = useState<
		Map<string, SelectedFile>
	>(new Map());
	const [loading, setLoading] = useState(false);
	const [search, setSearch] = useState("");
	const [creatingFolder, setCreatingFolder] = useState(false);
	const [newFolderName, setNewFolderName] = useState("");
	const [error, setError] = useState<string | null>(null);

	// Animation
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		if (open) {
			requestAnimationFrame(() =>
				requestAnimationFrame(() => setVisible(true)),
			);
		} else {
			setVisible(false);
		}
	}, [open]);

	// Reset transient state on close
	useEffect(() => {
		if (!open) {
			setSearch("");
			setCreatingFolder(false);
			setNewFolderName("");
			setError(null);
		}
	}, [open]);

	// Search input ref for autofocus
	const searchRef = useRef<HTMLInputElement>(null);
	const newFolderRef = useRef<HTMLInputElement>(null);

	// Fetch directory
	const fetchDir = useCallback(async (dir: string | null) => {
		setLoading(true);
		setError(null);
		try {
			const url = dir
				? `/api/workspace/browse?dir=${encodeURIComponent(dir)}`
				: "/api/workspace/browse";
			const res = await fetch(url);
			if (!res.ok) {throw new Error("Failed to list directory");}
			const data = await res.json();
			setEntries(data.entries || []);
			setDisplayDir(data.currentDir || "");
			setParentDir(data.parentDir ?? null);
		} catch {
			setError("Could not load this directory");
			setEntries([]);
		} finally {
			setLoading(false);
		}
	}, []);

	// Fetch on open and navigation
	useEffect(() => {
		if (open) { void fetchDir(currentDir); }
	}, [open, currentDir, fetchDir]);

	// Escape key
	useEffect(() => {
		if (!open) {return;}
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") {onClose();}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [open, onClose]);

	// Handlers
	const toggleSelect = useCallback(
		(entry: BrowseEntry) => {
			setSelected((prev) => {
				const next = new Map(prev);
				if (next.has(entry.path)) {
					next.delete(entry.path);
				} else {
					next.set(entry.path, {
						name: entry.name,
						path: entry.path,
					});
				}
				return next;
			});
		},
		[],
	);

	const navigateInto = useCallback((path: string) => {
		setCurrentDir(path);
		setSearch("");
		setCreatingFolder(false);
	}, []);

	const handleCreateFolder = useCallback(async () => {
		if (!newFolderName.trim() || !displayDir) {return;}
		const folderPath = `${displayDir}/${newFolderName.trim()}`;
		try {
			await fetch("/api/workspace/mkdir", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ path: folderPath }),
			});
			setCreatingFolder(false);
			setNewFolderName("");
			void fetchDir(currentDir);
		} catch {
			setError("Failed to create folder");
		}
	}, [newFolderName, displayDir, currentDir, fetchDir]);

	const handleConfirm = useCallback(() => {
		onSelect(Array.from(selected.values()));
		setSelected(new Map());
		onClose();
	}, [selected, onSelect, onClose]);

	// Filter & sort entries (folders first, then alphabetically)
	const sorted = entries
		.filter(
			(e) =>
				!search ||
				e.name
					.toLowerCase()
					.includes(search.toLowerCase()),
		)
		.toSorted((a, b) => {
			if (a.type === "folder" && b.type !== "folder")
				{return -1;}
			if (a.type !== "folder" && b.type === "folder")
				{return 1;}
			return a.name.localeCompare(b.name);
		});

	const breadcrumbs = displayDir
		? buildBreadcrumbs(displayDir)
		: [];

	if (!open) {return null;}

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center"
			style={{
				opacity: visible ? 1 : 0,
				transition: "opacity 150ms ease-out",
			}}
		>
			{/* Backdrop */}
			<div
				className="absolute inset-0"
				style={{
					background: "rgba(0,0,0,0.4)",
					backdropFilter: "blur(4px)",
				}}
				onClick={onClose}
			/>

			{/* Modal */}
			<div
				className="relative flex flex-col rounded-2xl shadow-2xl overflow-hidden w-[calc(100%-2rem)] max-w-[540px]"
				style={{
					maxHeight: "70vh",
					background: "var(--color-surface)",
					border: "1px solid var(--color-border)",
					transform: visible
						? "scale(1)"
						: "scale(0.97)",
					transition:
						"transform 150ms ease-out",
				}}
			>
				{/* Header */}
				<div
					className="flex items-center justify-between px-5 py-3.5 border-b flex-shrink-0"
					style={{
						borderColor: "var(--color-border)",
					}}
				>
					<div className="flex items-center gap-2.5">
						<div
							className="w-8 h-8 rounded-lg flex items-center justify-center"
							style={{
								background:
									pickerColors.folder
										.bg,
								color: pickerColors
									.folder.fg,
							}}
						>
							<PickerIcon
								category="folder"
								size={18}
							/>
						</div>
						<div>
							<h2
								className="text-sm font-semibold"
								style={{
									color: "var(--color-text)",
								}}
							>
								Select Files
							</h2>
							<p
								className="text-[11px]"
								style={{
									color: "var(--color-text-muted)",
								}}
							>
								Browse and attach
								files
							</p>
						</div>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="w-7 h-7 rounded-lg flex items-center justify-center"
						style={{
							color: "var(--color-text-muted)",
							background:
								"var(--color-surface-hover)",
						}}
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
						>
							<path d="M18 6 6 18" />
							<path d="m6 6 12 12" />
						</svg>
					</button>
				</div>

				{/* Breadcrumb path */}
				{displayDir && (
					<div
						className="flex items-center gap-1 px-5 py-2 border-b overflow-x-auto flex-shrink-0"
						style={{
							borderColor:
								"var(--color-border)",
							scrollbarWidth: "thin",
						}}
					>
						{breadcrumbs.map(
							(seg, i) => (
								<Fragment
									key={
										seg.path
									}
								>
									{i >
										0 && (
										<span
											className="text-[10px] flex-shrink-0"
											style={{
												color: "var(--color-text-muted)",
												opacity: 0.5,
											}}
										>
											/
										</span>
									)}
									<button
										type="button"
										onClick={() =>
											navigateInto(
												seg.path,
											)
										}
										className="text-[12px] font-medium flex-shrink-0 rounded px-1 py-0.5 hover:underline"
										style={{
											color:
												i ===
												breadcrumbs.length -
													1
													? "var(--color-text)"
													: "var(--color-text-muted)",
										}}
									>
										{
											seg.label
										}
									</button>
								</Fragment>
							),
						)}
					</div>
				)}

				{/* Search bar + New Folder */}
				<div
					className="flex items-center gap-2 px-4 py-2 border-b flex-shrink-0"
					style={{
						borderColor: "var(--color-border)",
					}}
				>
					<div
						className="flex-1 flex items-center gap-2 rounded-lg px-2.5 py-1.5"
						style={{
							background:
								"var(--color-bg)",
							border: "1px solid var(--color-border)",
						}}
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							style={{
								color: "var(--color-text-muted)",
								flexShrink: 0,
							}}
						>
							<circle
								cx="11"
								cy="11"
								r="8"
							/>
							<path d="m21 21-4.3-4.3" />
						</svg>
						<input
							ref={searchRef}
							type="text"
							value={search}
							onChange={(e) =>
								setSearch(
									e.target.value,
								)
							}
							placeholder="Filter files..."
							className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-[var(--color-text-muted)]"
							style={{
								color: "var(--color-text)",
							}}
						/>
					</div>
					<button
						type="button"
						onClick={() => {
							setCreatingFolder(true);
							setTimeout(
								() =>
									newFolderRef.current?.focus(),
								50,
							);
						}}
						className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium whitespace-nowrap"
						style={{
							color: "var(--color-text-muted)",
							background:
								"var(--color-surface-hover)",
							border: "1px solid var(--color-border)",
						}}
					>
						<svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
						>
							<path d="M12 5v14" />
							<path d="M5 12h14" />
						</svg>
						Folder
					</button>
				</div>

				{/* File list */}
				<div
					className="flex-1 overflow-y-auto"
					style={{
						background: "var(--color-bg)",
						minHeight: 200,
					}}
				>
					{loading ? (
						<div className="flex items-center justify-center py-16">
							<div
								className="w-5 h-5 border-2 rounded-full animate-spin"
								style={{
									borderColor:
										"var(--color-border)",
									borderTopColor:
										"var(--color-accent)",
								}}
							/>
						</div>
					) : error ? (
						<div
							className="flex items-center justify-center py-16 text-[13px]"
							style={{
								color: "var(--color-text-muted)",
							}}
						>
							{error}
						</div>
					) : (
						<>
							{/* Parent directory row */}
							{parentDir && (
								<button
									type="button"
									onClick={() =>
										navigateInto(
											parentDir,
										)
									}
									className="w-full flex items-center gap-3 px-4 py-2 text-left"
									style={{
										color: "var(--color-text-muted)",
									}}
								>
									<div
										className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
										style={{
											background:
												"var(--color-surface-hover)",
										}}
									>
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
											<path d="m15 18-6-6 6-6" />
										</svg>
									</div>
									<span className="text-[13px] font-medium">
										..
									</span>
								</button>
							)}

							{/* New folder input */}
							{creatingFolder && (
								<div className="flex items-center gap-3 px-4 py-2">
									<div
										className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
										style={{
											background:
												pickerColors
													.folder
													.bg,
											color: pickerColors
												.folder
												.fg,
										}}
									>
										<PickerIcon category="folder" />
									</div>
									<input
										ref={
											newFolderRef
										}
										type="text"
										value={
											newFolderName
										}
										onChange={(
											e,
										) =>
											setNewFolderName(
												e
													.target
													.value,
											)
										}
										onKeyDown={(
											e,
										) => {
											if (
												e.key ===
												"Enter"
											) {
												void handleCreateFolder();
											}
											if (
												e.key ===
												"Escape"
											) {
												setCreatingFolder(
													false,
												);
												setNewFolderName(
													"",
												);
											}
										}}
										placeholder="Folder name..."
										className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-[var(--color-text-muted)] rounded px-2 py-1"
										style={{
											color: "var(--color-text)",
											background:
												"var(--color-surface)",
											border: "1px solid var(--color-accent)",
										}}
									/>
								</div>
							)}

							{/* Entries */}
							{sorted.length ===
								0 &&
								!parentDir && (
									<div
										className="flex items-center justify-center py-16 text-[13px]"
										style={{
											color: "var(--color-text-muted)",
										}}
									>
										This
										folder
										is
										empty
									</div>
								)}
							{sorted.map(
								(entry) => {
									const isFolder =
										entry.type ===
										"folder";
									const category =
										isFolder
											? "folder"
											: getCategoryFromName(
													entry.name,
												);
									const colors =
										pickerColors[
											category
										] ??
										pickerColors.other;
									const isSelected =
										selected.has(
											entry.path,
										);

									return (
										<div
											key={
												entry.path
											}
											className="flex items-center gap-3 px-4 py-1.5 group cursor-pointer"
											style={{
												background:
													isSelected
														? "color-mix(in srgb, var(--color-accent) 8%, transparent)"
														: undefined,
											}}
											onClick={() => {
												if (
													isFolder
												) {
													navigateInto(
														entry.path,
													);
												} else {
													toggleSelect(
														entry,
													);
												}
											}}
										>
											{/* Checkbox */}
											<button
												type="button"
												onClick={(
													e,
												) => {
													e.stopPropagation();
													toggleSelect(
														entry,
													);
												}}
												className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border"
												style={{
													borderColor:
														isSelected
															? "var(--color-accent)"
															: "var(--color-border-strong)",
													background:
														isSelected
															? "var(--color-accent)"
															: "transparent",
												}}
											>
												{isSelected && (
													<svg
														width="10"
														height="10"
														viewBox="0 0 24 24"
														fill="none"
														stroke="white"
														strokeWidth="3"
														strokeLinecap="round"
														strokeLinejoin="round"
													>
														<polyline points="20 6 9 17 4 12" />
													</svg>
												)}
											</button>

											{/* Icon */}
											<div
												className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
												style={{
													background:
														colors.bg,
													color: colors.fg,
												}}
											>
												<PickerIcon
													category={
														category
													}
												/>
											</div>

											{/* Name */}
											<span
												className="flex-1 text-[13px] truncate"
												style={{
													color: "var(--color-text)",
													fontWeight:
														isFolder
															? 500
															: 400,
												}}
												title={
													entry.path
												}
											>
												{
													entry.name
												}
											</span>

											{/* Folder chevron */}
											{isFolder && (
												<svg
													width="14"
													height="14"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2"
													strokeLinecap="round"
													strokeLinejoin="round"
													className="flex-shrink-0 opacity-0 group-hover:opacity-50 transition-opacity"
												>
													<path d="m9 18 6-6-6-6" />
												</svg>
											)}
										</div>
									);
								},
							)}
						</>
					)}
				</div>

				{/* Footer */}
				<div
					className="flex items-center justify-between px-5 py-3 border-t flex-shrink-0"
					style={{
						borderColor: "var(--color-border)",
						background: "var(--color-surface)",
					}}
				>
					<span
						className="text-[12px]"
						style={{
							color: "var(--color-text-muted)",
						}}
					>
						{selected.size > 0
							? `${selected.size} ${selected.size === 1 ? "item" : "items"} selected`
							: "No files selected"}
					</span>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={onClose}
							className="px-3 py-1.5 rounded-lg text-[13px] font-medium"
							style={{
								color: "var(--color-text-muted)",
								background:
									"var(--color-surface-hover)",
								border: "1px solid var(--color-border)",
							}}
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={handleConfirm}
							disabled={
								selected.size === 0
							}
							className="px-3 py-1.5 rounded-lg text-[13px] font-medium disabled:opacity-40 disabled:cursor-not-allowed"
							style={{
								color: "white",
								background:
									selected.size > 0
										? "var(--color-accent)"
										: "var(--color-border-strong)",
							}}
						>
							Attach{" "}
							{selected.size > 0 &&
								`${selected.size} ${selected.size === 1 ? "file" : "files"}`}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
