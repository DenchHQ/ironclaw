"use client";

import { useState, useMemo } from "react";

type DiffCardProps = {
  /** Raw unified diff text (contents of a ```diff block) */
  diff: string;
};

type DiffFile = {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
};

type DiffHunk = {
  header: string;
  lines: DiffLine[];
};

type DiffLine = {
  type: "addition" | "deletion" | "context" | "header";
  content: string;
  oldLine?: number;
  newLine?: number;
};

/** Parse unified diff text into structured file sections. */
function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  const lines = raw.split("\n");
  let current: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // File header: --- a/path or --- /dev/null
    if (line.startsWith("--- ")) {
      const nextLine = lines[i + 1];
      if (nextLine?.startsWith("+++ ")) {
        const oldPath = line.replace(/^--- (a\/)?/, "").trim();
        const newPath = nextLine.replace(/^\+\+\+ (b\/)?/, "").trim();
        current = { oldPath, newPath, hunks: [], additions: 0, deletions: 0 };
        files.push(current);
        i++; // skip +++ line
        continue;
      }
    }

    // Hunk header: @@ -old,count +new,count @@
    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)/);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[2], 10);
      currentHunk = {
        header: line,
        lines: [{ type: "header", content: line }],
      };
      if (current) {
        current.hunks.push(currentHunk);
      } else {
        // Diff without file headers -- create an implicit file
        current = { oldPath: "", newPath: "", hunks: [currentHunk], additions: 0, deletions: 0 };
        files.push(current);
      }
      continue;
    }

    if (!currentHunk || !current) {continue;}

    if (line.startsWith("+")) {
      currentHunk.lines.push({ type: "addition", content: line.slice(1), newLine });
      current.additions++;
      newLine++;
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({ type: "deletion", content: line.slice(1), oldLine });
      current.deletions++;
      oldLine++;
    } else if (line.startsWith(" ") || line === "") {
      currentHunk.lines.push({ type: "context", content: line.slice(1) || "", oldLine, newLine });
      oldLine++;
      newLine++;
    }
  }

  // If no structured files were found, treat the whole thing as one block
  if (files.length === 0 && raw.trim()) {
    const fallbackLines = raw.split("\n").map((l): DiffLine => {
      if (l.startsWith("+")) {return { type: "addition", content: l.slice(1) };}
      if (l.startsWith("-")) {return { type: "deletion", content: l.slice(1) };}
      return { type: "context", content: l };
    });
    files.push({
      oldPath: "",
      newPath: "",
      hunks: [{ header: "", lines: fallbackLines }],
      additions: fallbackLines.filter((l) => l.type === "addition").length,
      deletions: fallbackLines.filter((l) => l.type === "deletion").length,
    });
  }

  return files;
}

function displayPath(file: DiffFile): string {
  if (file.newPath && file.newPath !== "/dev/null") {return file.newPath;}
  if (file.oldPath && file.oldPath !== "/dev/null") {return file.oldPath;}
  return "diff";
}

/* ─── Icons ─── */

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
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
      style={{
        transition: "transform 150ms ease",
        transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
      }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/* ─── Single file diff ─── */

function DiffFileCard({ file }: { file: DiffFile }) {
  const [expanded, setExpanded] = useState(true);
  const path = displayPath(file);

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: "var(--color-border)" }}
    >
      {/* File header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left"
        style={{
          background: "var(--color-surface)",
          borderBottom: expanded ? "1px solid var(--color-border)" : "none",
        }}
      >
        <ChevronIcon expanded={expanded} />
        <FileIcon />
        <span
          className="text-sm font-mono font-medium flex-1 truncate"
          style={{ color: "var(--color-text)" }}
        >
          {path}
        </span>
        {file.additions > 0 && (
          <span className="text-xs font-mono font-medium" style={{ color: "var(--diff-add-badge)" }}>
            +{file.additions}
          </span>
        )}
        {file.deletions > 0 && (
          <span className="text-xs font-mono font-medium" style={{ color: "var(--diff-del-badge)" }}>
            -{file.deletions}
          </span>
        )}
      </button>

      {/* Diff lines */}
      {expanded && (
        <div
          className="overflow-x-auto"
          style={{ background: "var(--color-bg)" }}
        >
          <table className="w-full text-xs font-mono leading-5 border-collapse" style={{ tabSize: 4 }}>
            <tbody>
              {file.hunks.map((hunk, hi) =>
                hunk.lines.map((line, li) => {
                  if (line.type === "header") {
                    return (
                      <tr key={`${hi}-${li}`}>
                        <td
                          colSpan={3}
                          className="px-3 py-1 select-none"
                          style={{
                            background: "var(--color-surface)",
                            color: "var(--color-text-muted)",
                          }}
                        >
                          {line.content}
                        </td>
                      </tr>
                    );
                  }

                  const bgColor =
                    line.type === "addition"
                      ? "var(--diff-add-bg)"
                      : line.type === "deletion"
                        ? "var(--diff-del-bg)"
                        : "transparent";
                  const textColor =
                    line.type === "addition"
                      ? "var(--diff-add-text)"
                      : line.type === "deletion"
                        ? "var(--diff-del-text)"
                        : "var(--color-text)";
                  const prefix =
                    line.type === "addition"
                      ? "+"
                      : line.type === "deletion"
                        ? "-"
                        : " ";

                  return (
                    <tr key={`${hi}-${li}`} style={{ background: bgColor }}>
                      {/* Old line number */}
                      <td
                        className="select-none text-right pr-2 pl-3"
                        style={{
                          color: "var(--color-text-muted)",
                          opacity: 0.5,
                          width: "1%",
                          whiteSpace: "nowrap",
                          userSelect: "none",
                        }}
                      >
                        {line.type !== "addition" ? line.oldLine : ""}
                      </td>
                      {/* New line number */}
                      <td
                        className="select-none text-right pr-3"
                        style={{
                          color: "var(--color-text-muted)",
                          opacity: 0.5,
                          width: "1%",
                          whiteSpace: "nowrap",
                          userSelect: "none",
                        }}
                      >
                        {line.type !== "deletion" ? line.newLine : ""}
                      </td>
                      {/* Content */}
                      <td
                        className="pr-4"
                        style={{ color: textColor }}
                      >
                        <span
                          className="select-none inline-block w-4 text-center"
                          style={{ opacity: 0.6, userSelect: "none" }}
                        >
                          {prefix}
                        </span>
                        {line.content}
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Main DiffCard ─── */

export function DiffCard({ diff }: DiffCardProps) {
  const files = useMemo(() => parseDiff(diff), [diff]);

  return (
    <div className="space-y-2 my-3">
      {files.map((file, i) => (
        <DiffFileCard key={i} file={file} />
      ))}
    </div>
  );
}
