"use client";

import { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

// --- Types ---

export type ContextMenuAction =
  | "open"
  | "newFile"
  | "newFolder"
  | "rename"
  | "duplicate"
  | "copy"
  | "paste"
  | "moveTo"
  | "getInfo"
  | "delete";

export type ContextMenuItem = {
  action: ContextMenuAction;
  label: string;
  shortcut?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
  separator?: false;
} | {
  separator: true;
};

export type ContextMenuTarget =
  | { kind: "file"; path: string; name: string; isSystem: boolean }
  | { kind: "folder"; path: string; name: string; isSystem: boolean }
  | { kind: "empty" };

// --- Menu item definitions per target kind ---

function getMenuItems(target: ContextMenuTarget): ContextMenuItem[] {
  const isSystem = target.kind !== "empty" && target.isSystem;

  if (target.kind === "file") {
    return [
      { action: "open", label: "Open" },
      { separator: true },
      { action: "rename", label: "Rename", shortcut: "Enter", disabled: isSystem },
      { action: "duplicate", label: "Duplicate", shortcut: "\u2318D", disabled: isSystem },
      { action: "copy", label: "Copy Path", shortcut: "\u2318C" },
      { separator: true },
      { action: "getInfo", label: "Get Info", shortcut: "\u2318I" },
      { separator: true },
      { action: "delete", label: "Move to Trash", shortcut: "\u2318\u232B", disabled: isSystem, danger: true },
    ];
  }

  if (target.kind === "folder") {
    return [
      { action: "open", label: "Open" },
      { separator: true },
      { action: "newFile", label: "New File", shortcut: "\u2318N", disabled: isSystem },
      { action: "newFolder", label: "New Folder", shortcut: "\u21E7\u2318N", disabled: isSystem },
      { separator: true },
      { action: "rename", label: "Rename", shortcut: "Enter", disabled: isSystem },
      { action: "duplicate", label: "Duplicate", shortcut: "\u2318D", disabled: isSystem },
      { action: "copy", label: "Copy Path", shortcut: "\u2318C" },
      { separator: true },
      { action: "getInfo", label: "Get Info", shortcut: "\u2318I" },
      { separator: true },
      { action: "delete", label: "Move to Trash", shortcut: "\u2318\u232B", disabled: isSystem, danger: true },
    ];
  }

  // Empty area
  return [
    { action: "newFile", label: "New File", shortcut: "\u2318N" },
    { action: "newFolder", label: "New Folder", shortcut: "\u21E7\u2318N" },
    { separator: true },
    { action: "paste", label: "Paste", shortcut: "\u2318V", disabled: true },
  ];
}

// --- Lock icon for system files ---

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

// --- Context Menu Component ---

type ContextMenuProps = {
  x: number;
  y: number;
  target: ContextMenuTarget;
  onAction: (action: ContextMenuAction) => void;
  onClose: () => void;
};

export function ContextMenu({ x, y, target, onAction, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const items = getMenuItems(target);
  const isSystem = target.kind !== "empty" && target.isSystem;

  // Clamp position to viewport
  const clampedPos = useRef({ x, y });
  useEffect(() => {
    const el = menuRef.current;
    if (!el) {return;}
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let cx = x;
    let cy = y;
    if (cx + rect.width > vw - 8) {cx = vw - rect.width - 8;}
    if (cy + rect.height > vh - 8) {cy = vh - rect.height - 8;}
    if (cx < 8) {cx = 8;}
    if (cy < 8) {cy = 8;}
    clampedPos.current = { x: cx, y: cy };
    el.style.left = `${cx}px`;
    el.style.top = `${cy}px`;
  }, [x, y]);

  // Close on click-outside, escape, scroll
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {onClose();}
    }
    function handleScroll() {
      onClose();
    }

    document.addEventListener("mousedown", handleClickOutside, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  const handleItemClick = useCallback(
    (action: ContextMenuAction, disabled?: boolean) => {
      if (disabled) {return;}
      onAction(action);
      onClose();
    },
    [onAction, onClose],
  );

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[200px] py-1 rounded-lg shadow-xl border"
      style={{
        left: x,
        top: y,
        background: "var(--color-surface)",
        borderColor: "var(--color-border)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        animation: "contextMenuFadeIn 100ms ease-out",
      }}
      role="menu"
    >
      {/* System file badge */}
      {isSystem && (
        <div
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px]"
          style={{ color: "var(--color-text-muted)" }}
        >
          <LockIcon />
          <span>System file (locked)</span>
        </div>
      )}

      {items.map((item, i) => {
        if ("separator" in item && item.separator) {
          return (
            <div
              key={`sep-${i}`}
              className="my-1 mx-2 border-t"
              style={{ borderColor: "var(--color-border)" }}
            />
          );
        }

        const menuItem = item;
        const isDisabled = menuItem.disabled;

        return (
          <button
            key={menuItem.action}
            type="button"
            role="menuitem"
            disabled={isDisabled}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-left transition-colors"
            style={{
              color: isDisabled
                ? "var(--color-text-muted)"
                : menuItem.danger
                  ? "#ef4444"
                  : "var(--color-text)",
              opacity: isDisabled ? 0.5 : 1,
              cursor: isDisabled ? "default" : "pointer",
            }}
            onMouseEnter={(e) => {
              if (!isDisabled) {
                (e.currentTarget as HTMLElement).style.background = menuItem.danger
                  ? "rgba(239, 68, 68, 0.1)"
                  : "var(--color-surface-hover)";
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
            onClick={() => handleItemClick(menuItem.action, isDisabled)}
          >
            {menuItem.icon}
            <span className="flex-1">{menuItem.label}</span>
            {isDisabled && isSystem && <LockIcon />}
            {menuItem.shortcut && (
              <span
                className="text-[11px] ml-4"
                style={{ color: "var(--color-text-muted)" }}
              >
                {menuItem.shortcut}
              </span>
            )}
          </button>
        );
      })}

      {/* Global animation style */}
      <style>{`
        @keyframes contextMenuFadeIn {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>,
    document.body,
  );
}
