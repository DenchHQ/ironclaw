"use client";

import { useState, useRef, useEffect } from "react";
import { DirectoryPickerModal } from "./directory-picker-modal";

type CreateWorkspaceDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: () => void;
};

function shortenPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

export function CreateWorkspaceDialog({ isOpen, onClose, onCreated }: CreateWorkspaceDialogProps) {
  const [profileName, setProfileName] = useState("");
  const [customPath, setCustomPath] = useState("");
  const [useCustomPath, setUseCustomPath] = useState(false);
  const [showDirPicker, setShowDirPicker] = useState(false);
  const [seedBootstrap, setSeedBootstrap] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ workspaceDir: string; seededFiles: string[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setProfileName("");
      setCustomPath("");
      setUseCustomPath(false);
      setShowDirPicker(false);
      setError(null);
      setResult(null);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Close on Escape (only if dir picker is not open)
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !showDirPicker) {onClose();}
    }
    if (isOpen) {
      document.addEventListener("keydown", handleKey);
      return () => document.removeEventListener("keydown", handleKey);
    }
  }, [isOpen, onClose, showDirPicker]);

  const handleCreate = async () => {
    const name = profileName.trim();
    if (!name) {
      setError("Please enter a workspace name.");
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      setError("Name must use only letters, numbers, hyphens, or underscores.");
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        profile: name,
        seedBootstrap,
      };
      if (useCustomPath && customPath.trim()) {
        body.path = customPath.trim();
      }

      const res = await fetch("/api/workspace/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create workspace.");
        return;
      }

      setResult({
        workspaceDir: data.workspaceDir,
        seededFiles: data.seededFiles ?? [],
      });
      onCreated?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  if (!isOpen) {return null;}

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {onClose();}
      }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-xl overflow-hidden"
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          boxShadow: "var(--shadow-xl)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <h2
            className="text-base font-semibold"
            style={{ color: "var(--color-text)" }}
          >
            New Workspace
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-[var(--color-surface-hover)] transition-colors"
            style={{ color: "var(--color-text-muted)" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {result ? (
            /* Success state */
            <div className="text-center py-4">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
                style={{ background: "rgba(22, 163, 74, 0.1)" }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                Workspace created
              </p>
              <code
                className="text-xs px-2 py-1 rounded mt-2 inline-block"
                style={{
                  background: "var(--color-surface-hover)",
                  color: "var(--color-text-secondary)",
                  border: "1px solid var(--color-border)",
                }}
              >
                {result.workspaceDir.replace(/^\/Users\/[^/]+/, "~")}
              </code>
              {result.seededFiles.length > 0 && (
                <p
                  className="text-xs mt-2"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Seeded: {result.seededFiles.join(", ")}
                </p>
              )}
            </div>
          ) : (
            /* Form */
            <>
              {/* Profile name */}
              <div>
                <label
                  className="block text-sm font-medium mb-1.5"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  Workspace name
                </label>
                <input
                  ref={inputRef}
                  type="text"
                  value={profileName}
                  onChange={(e) => {
                    setProfileName(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !creating) {void handleCreate();}
                  }}
                  placeholder="e.g. work, personal, project-x"
                  className="w-full px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  style={{
                    background: "var(--color-bg)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-text)",
                  }}
                />
                <p
                  className="text-xs mt-1"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  This creates a new profile with its own workspace directory.
                </p>
              </div>

              {/* Custom path toggle */}
              <div>
                <button
                  onClick={() => setUseCustomPath(!useCustomPath)}
                  className="flex items-center gap-2 text-xs transition-colors hover:opacity-80"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  <svg
                    className={`w-3.5 h-3.5 transition-transform ${useCustomPath ? "rotate-90" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  Custom directory path
                </button>

                {useCustomPath && (
                  <div className="mt-2 space-y-2">
                    {customPath ? (
                      <div
                        className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg"
                        style={{
                          background: "var(--color-bg)",
                          border: "1px solid var(--color-border)",
                        }}
                      >
                        <div
                          className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
                          style={{ background: "rgba(245, 158, 11, 0.12)", color: "#f59e0b" }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
                            {customPath.split("/").pop()}
                          </p>
                          <p className="text-[11px] truncate" style={{ color: "var(--color-text-muted)" }} title={customPath}>
                            {shortenPath(customPath)}
                          </p>
                        </div>
                        <button
                          onClick={() => setShowDirPicker(true)}
                          className="px-2 py-1 text-xs rounded-md transition-colors hover:opacity-80"
                          style={{ color: "var(--color-accent)" }}
                        >
                          Change
                        </button>
                        <button
                          onClick={() => setCustomPath("")}
                          className="p-1 rounded-md transition-colors hover:bg-[var(--color-surface-hover)]"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowDirPicker(true)}
                        className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-lg text-sm transition-colors hover:opacity-90"
                        style={{
                          background: "var(--color-bg)",
                          border: "1px dashed var(--color-border-strong)",
                          color: "var(--color-text-muted)",
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                        </svg>
                        Browse for a directory...
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Bootstrap toggle */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={seedBootstrap}
                  onChange={(e) => setSeedBootstrap(e.target.checked)}
                  className="rounded"
                  style={{ accentColor: "var(--color-accent)" }}
                />
                <span
                  className="text-sm"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  Seed bootstrap files and workspace database
                </span>
              </label>

              {error && (
                <p
                  className="text-sm px-3 py-2 rounded-lg"
                  style={{
                    background: "rgba(220, 38, 38, 0.08)",
                    color: "var(--color-error)",
                  }}
                >
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-5 py-3"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          {result ? (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg transition-colors"
              style={{
                background: "var(--color-accent)",
                color: "#fff",
              }}
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-lg transition-colors hover:bg-[var(--color-surface-hover)]"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleCreate()}
                disabled={creating || !profileName.trim()}
                className="px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                style={{
                  background: "var(--color-accent)",
                  color: "#fff",
                }}
              >
                {creating ? "Creating..." : "Create Workspace"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Directory picker modal */}
      <DirectoryPickerModal
        open={showDirPicker}
        onClose={() => setShowDirPicker(false)}
        onSelect={(path) => setCustomPath(path)}
        startDir="~"
      />
    </div>
  );
}
