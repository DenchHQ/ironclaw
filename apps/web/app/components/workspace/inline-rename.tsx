"use client";

import { useState, useRef, useEffect, useCallback } from "react";

type InlineRenameProps = {
  currentName: string;
  onCommit: (newName: string) => void;
  onCancel: () => void;
};

/**
 * Inline text input that replaces a tree node label for renaming.
 * Commits on Enter or blur, cancels on Escape.
 * Shows a shake animation on validation error.
 */
export function InlineRename({ currentName, onCommit, onCancel }: InlineRenameProps) {
  const [value, setValue] = useState(currentName);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus and select the name (without extension)
  useEffect(() => {
    const input = inputRef.current;
    if (!input) {return;}
    input.focus();
    const dotIndex = currentName.lastIndexOf(".");
    if (dotIndex > 0) {
      input.setSelectionRange(0, dotIndex);
    } else {
      input.select();
    }
  }, [currentName]);

  const validate = useCallback(
    (name: string): boolean => {
      const trimmed = name.trim();
      if (!trimmed) {return false;}
      if (trimmed.includes("/") || trimmed.includes("\\")) {return false;}
      return true;
    },
    [],
  );

  const handleCommit = useCallback(() => {
    const trimmed = value.trim();
    if (!validate(trimmed)) {
      setError(true);
      setTimeout(() => setError(false), 500);
      return;
    }
    if (trimmed === currentName) {
      onCancel();
      return;
    }
    onCommit(trimmed);
  }, [value, currentName, validate, onCommit, onCancel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        handleCommit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    },
    [handleCommit, onCancel],
  );

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        setError(false);
      }}
      onBlur={handleCommit}
      onKeyDown={handleKeyDown}
      className="flex-1 text-sm rounded px-1 py-0 outline-none min-w-0"
      style={{
        background: "var(--color-bg)",
        color: "var(--color-text)",
        border: error ? "1px solid #ef4444" : "1px solid var(--color-accent)",
        animation: error ? "renameShake 300ms ease" : undefined,
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    />
  );
}

/** Shake animation style (injected once globally via the FileManagerTree) */
export const RENAME_SHAKE_STYLE = `
  @keyframes renameShake {
    0%, 100% { transform: translateX(0); }
    20%, 60% { transform: translateX(-3px); }
    40%, 80% { transform: translateX(3px); }
  }
`;
