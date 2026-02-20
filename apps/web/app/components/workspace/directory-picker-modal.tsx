"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";

type BrowseEntry = {
  name: string;
  path: string;
  type: "folder" | "file" | "document" | "database";
};

type DirectoryPickerModalProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  /** Starting directory (absolute). Falls back to the workspace root / home. */
  startDir?: string;
};

function buildBreadcrumbs(dir: string): { label: string; path: string }[] {
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

const folderColors = { bg: "rgba(245, 158, 11, 0.12)", fg: "#f59e0b" };

function FolderIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    </svg>
  );
}

export function DirectoryPickerModal({
  open,
  onClose,
  onSelect,
  startDir,
}: DirectoryPickerModalProps) {
  const [currentDir, setCurrentDir] = useState<string | null>(startDir ?? null);
  const [displayDir, setDisplayDir] = useState("");
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    } else {
      setVisible(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setCreatingFolder(false);
      setNewFolderName("");
      setError(null);
    }
  }, [open]);

  // Reset to startDir when reopening
  useEffect(() => {
    if (open) {
      setCurrentDir(startDir ?? null);
    }
  }, [open, startDir]);

  const searchRef = useRef<HTMLInputElement>(null);
  const newFolderRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (open) { void fetchDir(currentDir); }
  }, [open, currentDir, fetchDir]);

  useEffect(() => {
    if (!open) {return;}
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {onClose();}
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

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

  const handleSelectCurrent = useCallback(() => {
    if (displayDir) {
      onSelect(displayDir);
      onClose();
    }
  }, [displayDir, onSelect, onClose]);

  // Only show folders
  const folders = entries
    .filter((e) => e.type === "folder")
    .filter((e) => !search || e.name.toLowerCase().includes(search.toLowerCase()))
    .toSorted((a, b) => a.name.localeCompare(b.name));

  const breadcrumbs = displayDir ? buildBreadcrumbs(displayDir) : [];

  // Shorten display path for the footer
  const shortDir = displayDir
    .replace(/^\/Users\/[^/]+/, "~")
    .replace(/^\/home\/[^/]+/, "~");

  if (!open) {return null;}

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{
        opacity: visible ? 1 : 0,
        transition: "opacity 150ms ease-out",
      }}
    >
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />

      <div
        className="relative flex flex-col rounded-2xl shadow-2xl overflow-hidden w-[calc(100%-2rem)] max-w-[540px]"
        style={{
          maxHeight: "70vh",
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          transform: visible ? "scale(1)" : "scale(0.97)",
          transition: "transform 150ms ease-out",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3.5 border-b flex-shrink-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: folderColors.bg, color: folderColors.fg }}
            >
              <FolderIcon size={18} />
            </div>
            <div>
              <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                Choose Directory
              </h2>
              <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                Navigate to a folder for the workspace
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ color: "var(--color-text-muted)", background: "var(--color-surface-hover)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* Breadcrumbs */}
        {displayDir && (
          <div
            className="flex items-center gap-1 px-5 py-2 border-b overflow-x-auto flex-shrink-0"
            style={{ borderColor: "var(--color-border)", scrollbarWidth: "thin" }}
          >
            {breadcrumbs.map((seg, i) => (
              <Fragment key={seg.path}>
                {i > 0 && (
                  <span
                    className="text-[10px] flex-shrink-0"
                    style={{ color: "var(--color-text-muted)", opacity: 0.5 }}
                  >
                    /
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => navigateInto(seg.path)}
                  className="text-[12px] font-medium flex-shrink-0 rounded px-1 py-0.5 hover:underline"
                  style={{
                    color: i === breadcrumbs.length - 1
                      ? "var(--color-text)"
                      : "var(--color-text-muted)",
                  }}
                >
                  {seg.label}
                </button>
              </Fragment>
            ))}
          </div>
        )}

        {/* Search + New Folder */}
        <div
          className="flex items-center gap-2 px-4 py-2 border-b flex-shrink-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div
            className="flex-1 flex items-center gap-2 rounded-lg px-2.5 py-1.5"
            style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}
          >
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ color: "var(--color-text-muted)", flexShrink: 0 }}
            >
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter folders..."
              className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-[var(--color-text-muted)]"
              style={{ color: "var(--color-text)" }}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setCreatingFolder(true);
              setTimeout(() => newFolderRef.current?.focus(), 50);
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium whitespace-nowrap"
            style={{
              color: "var(--color-text-muted)",
              background: "var(--color-surface-hover)",
              border: "1px solid var(--color-border)",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14" /><path d="M5 12h14" />
            </svg>
            New Folder
          </button>
        </div>

        {/* Folder list */}
        <div
          className="flex-1 overflow-y-auto"
          style={{ background: "var(--color-bg)", minHeight: 200 }}
        >
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div
                className="w-5 h-5 border-2 rounded-full animate-spin"
                style={{ borderColor: "var(--color-border)", borderTopColor: "var(--color-accent)" }}
              />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-16 text-[13px]" style={{ color: "var(--color-text-muted)" }}>
              {error}
            </div>
          ) : (
            <>
              {/* Go up */}
              {parentDir && (
                <button
                  type="button"
                  onClick={() => navigateInto(parentDir)}
                  className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-[var(--color-surface-hover)] transition-colors"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  <div
                    className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
                    style={{ background: "var(--color-surface-hover)" }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m15 18-6-6 6-6" />
                    </svg>
                  </div>
                  <span className="text-[13px] font-medium">..</span>
                </button>
              )}

              {/* New folder input */}
              {creatingFolder && (
                <div className="flex items-center gap-3 px-4 py-2">
                  <div
                    className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
                    style={{ background: folderColors.bg, color: folderColors.fg }}
                  >
                    <FolderIcon />
                  </div>
                  <input
                    ref={newFolderRef}
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {void handleCreateFolder();}
                      if (e.key === "Escape") {
                        setCreatingFolder(false);
                        setNewFolderName("");
                      }
                    }}
                    placeholder="Folder name..."
                    className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-[var(--color-text-muted)] rounded px-2 py-1"
                    style={{
                      color: "var(--color-text)",
                      background: "var(--color-surface)",
                      border: "1px solid var(--color-accent)",
                    }}
                  />
                </div>
              )}

              {/* Folder entries */}
              {folders.length === 0 && !parentDir && (
                <div className="flex items-center justify-center py-16 text-[13px]" style={{ color: "var(--color-text-muted)" }}>
                  No subfolders here
                </div>
              )}
              {folders.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => navigateInto(entry.path)}
                  className="w-full flex items-center gap-3 px-4 py-1.5 group text-left hover:bg-[var(--color-surface-hover)] transition-colors"
                >
                  <div
                    className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
                    style={{ background: folderColors.bg, color: folderColors.fg }}
                  >
                    <FolderIcon />
                  </div>
                  <span
                    className="flex-1 text-[13px] font-medium truncate"
                    style={{ color: "var(--color-text)" }}
                    title={entry.path}
                  >
                    {entry.name}
                  </span>
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    className="flex-shrink-0 opacity-0 group-hover:opacity-50 transition-opacity"
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </button>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-5 py-3 border-t flex-shrink-0"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <div className="min-w-0 flex-1 mr-3">
            <p className="text-[11px] truncate" style={{ color: "var(--color-text-muted)" }} title={displayDir}>
              {shortDir || "Loading..."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-[13px] font-medium"
              style={{
                color: "var(--color-text-muted)",
                background: "var(--color-surface-hover)",
                border: "1px solid var(--color-border)",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSelectCurrent}
              disabled={!displayDir}
              className="px-3 py-1.5 rounded-lg text-[13px] font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                color: "white",
                background: displayDir ? "var(--color-accent)" : "var(--color-border-strong)",
              }}
            >
              Select This Folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
