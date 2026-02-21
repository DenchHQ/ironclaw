"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export type ProfileInfo = {
  name: string;
  stateDir: string;
  workspaceDir: string | null;
  isActive: boolean;
  hasConfig: boolean;
};

export type ProfileSwitcherTriggerProps = {
  isOpen: boolean;
  onClick: () => void;
  activeProfile: string;
  switching: boolean;
};

type ProfileSwitcherProps = {
  onProfileSwitch?: () => void;
  onCreateWorkspace?: () => void;
  /** When set, this renders instead of the default button; dropdown still opens below. */
  trigger?: (props: ProfileSwitcherTriggerProps) => React.ReactNode;
};

export function ProfileSwitcher({ onProfileSwitch, onCreateWorkspace, trigger }: ProfileSwitcherProps) {
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [activeProfile, setActiveProfile] = useState("default");
  const [isOpen, setIsOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch("/api/profiles");
      const data = await res.json();
      setProfiles(data.profiles ?? []);
      setActiveProfile(data.activeProfile ?? "default");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void fetchProfiles();
  }, [fetchProfiles]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const handleSwitch = async (profileName: string) => {
    if (profileName === activeProfile) {
      setIsOpen(false);
      return;
    }
    setSwitching(true);
    try {
      const res = await fetch("/api/profiles/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: profileName }),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveProfile(data.activeProfile ?? "default");
        onProfileSwitch?.();
        void fetchProfiles();
      }
    } catch {
      // ignore
    } finally {
      setSwitching(false);
      setIsOpen(false);
    }
  };

  // Don't show the switcher if there's only one profile and no way to create more
  const showSwitcher = profiles.length > 0;
  const handleToggle = () => {
    if (showSwitcher) { setIsOpen((o) => !o); }
  };

  if (!trigger && !showSwitcher) { return null; }

  return (
    <div
      className={`relative ${trigger ? "flex-1 min-w-0" : ""}`}
      ref={dropdownRef}
    >
      {trigger ? (
        trigger({
          isOpen,
          onClick: handleToggle,
          activeProfile,
          switching,
        })
      ) : (
        <button
          onClick={handleToggle}
          disabled={switching}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
          style={{ color: "var(--color-text-secondary)" }}
          title="Switch workspace profile"
        >
          {/* Workspace icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
          </svg>
          <span className="truncate max-w-[120px]">
            {activeProfile === "default" ? "Default" : activeProfile}
          </span>
          <svg
            className={`w-3 h-3 transition-transform ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}

      {showSwitcher && isOpen && (
        <div
          className="absolute left-0 top-full mt-1 w-64 rounded-lg overflow-hidden z-50"
          style={{
            background: "var(--color-surface-raised)",
            border: "1px solid var(--color-border)",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          {/* Header */}
          <div
            className="px-3 py-2 text-xs font-medium"
            style={{
              color: "var(--color-text-muted)",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            Workspace Profiles
          </div>

          {/* Profile list */}
          <div className="py-1 max-h-64 overflow-y-auto">
            {profiles.map((p) => {
              const isCurrent = p.name === activeProfile;
              return (
                <button
                  key={p.name}
                  onClick={() => handleSwitch(p.name)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--color-surface-hover)]"
                  style={{ color: "var(--color-text)" }}
                >
                  {/* Active indicator */}
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{
                      background: isCurrent ? "var(--color-success)" : "transparent",
                      border: isCurrent ? "none" : "1px solid var(--color-border-strong)",
                    }}
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium">
                        {p.name === "default" ? "Default" : p.name}
                      </span>
                    </div>
                    <div
                      className="text-xs truncate mt-0.5"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      {p.workspaceDir
                        ? p.workspaceDir.replace(/^\/Users\/[^/]+/, "~")
                        : "No workspace yet"}
                    </div>
                  </div>

                  {isCurrent && (
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{
                        background: "var(--color-accent-light)",
                        color: "var(--color-accent)",
                      }}
                    >
                      Active
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Create new */}
          <div style={{ borderTop: "1px solid var(--color-border)" }}>
            <button
              onClick={() => {
                setIsOpen(false);
                onCreateWorkspace?.();
              }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm transition-colors hover:bg-[var(--color-surface-hover)]"
              style={{ color: "var(--color-accent)" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14" /><path d="M5 12h14" />
              </svg>
              New Workspace
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
