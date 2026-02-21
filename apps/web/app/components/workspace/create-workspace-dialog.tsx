"use client";

import { useState, useRef, useEffect } from "react";

type CreateWorkspaceDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: () => void;
};

export function CreateWorkspaceDialog({ isOpen, onClose, onCreated }: CreateWorkspaceDialogProps) {
  const [profileName, setProfileName] = useState("");
  const [customPath, setCustomPath] = useState("");
  const [useCustomPath, setUseCustomPath] = useState(false);
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
      setError(null);
      setResult(null);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {onClose();}
    }
    if (isOpen) {
      document.addEventListener("keydown", handleKey);
      return () => document.removeEventListener("keydown", handleKey);
    }
  }, [isOpen, onClose]);

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
                  <input
                    type="text"
                    value={customPath}
                    onChange={(e) => setCustomPath(e.target.value)}
                    placeholder="~/my-workspace or /absolute/path"
                    className="w-full mt-2 px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                    style={{
                      background: "var(--color-bg)",
                      border: "1px solid var(--color-border)",
                      color: "var(--color-text)",
                    }}
                  />
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
                  Seed bootstrap files (AGENTS.md, SOUL.md, USER.md)
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
    </div>
  );
}
