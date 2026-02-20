"use client";

import { useState, useEffect } from "react";
import { read, utils, type WorkBook } from "xlsx";

const SPREADSHEET_EXTENSIONS = new Set([
  "xlsx", "xls", "xlsb", "xlsm", "xltx", "xltm",
  "ods", "fods",
  "csv", "tsv",
  "numbers",
]);

export function isSpreadsheetFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return SPREADSHEET_EXTENSIONS.has(ext);
}

type FileViewerProps =
  | { content: string; filename: string; type: "yaml" | "text" }
  | { filename: string; type: "spreadsheet"; url: string; content?: never };

export function FileViewer(props: FileViewerProps) {
  if (props.type === "spreadsheet") {
    return <SpreadsheetViewer filename={props.filename} url={props.url} />;
  }

  const { content, filename, type } = props;
  const lines = content.split("\n");

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <FileHeader filename={filename} label={type.toUpperCase()} />

      <div
        className="rounded-b-lg border overflow-x-auto"
        style={{
          background: "var(--color-bg)",
          borderColor: "var(--color-border)",
        }}
      >
        <pre className="text-sm leading-6" style={{ margin: 0 }}>
          <code>
            {lines.map((line, idx) => (
              <div
                key={idx}
                className="flex hover:bg-[var(--color-surface-hover)] transition-colors duration-75"
              >
                <span
                  className="select-none text-right pr-4 pl-4 flex-shrink-0 tabular-nums"
                  style={{
                    color: "var(--color-text-muted)",
                    opacity: 0.5,
                    minWidth: "3rem",
                    userSelect: "none",
                  }}
                >
                  {idx + 1}
                </span>

                <span
                  className="pr-4 flex-1"
                  style={{ color: "var(--color-text)" }}
                >
                  {type === "yaml" ? (
                    <YamlLine line={line} />
                  ) : (
                    line || " "
                  )}
                </span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

function FileHeader({ filename, label, icon }: { filename: string; label: string; icon?: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-2 px-4 py-2.5 rounded-t-lg border border-b-0"
      style={{
        background: "var(--color-surface)",
        borderColor: "var(--color-border)",
      }}
    >
      {icon ?? (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: "var(--color-text-muted)" }}
        >
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
        </svg>
      )}
      <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
        {filename}
      </span>
      <span
        className="text-xs px-1.5 py-0.5 rounded ml-auto"
        style={{
          background: "var(--color-surface-hover)",
          color: "var(--color-text-muted)",
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spreadsheet viewer
// ---------------------------------------------------------------------------

function SpreadsheetViewer({ filename, url }: { filename: string; url: string }) {
  const [workbook, setWorkbook] = useState<WorkBook | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setWorkbook(null);
    setActiveSheet(0);
    setError(null);

    fetch(url)
      .then((res) => {
        if (!res.ok) {throw new Error(`Failed to load file (${res.status})`);}
        return res.arrayBuffer();
      })
      .then((buf) => {
        if (cancelled) {return;}
        const wb = read(buf, { type: "array" });
        setWorkbook(wb);
      })
      .catch((err) => {
        if (!cancelled) {setError(String(err));}
      });

    return () => { cancelled = true; };
  }, [url]);

  const ext = filename.split(".").pop()?.toUpperCase() ?? "SPREADSHEET";

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-8">
        <FileHeader filename={filename} label={ext} icon={<SpreadsheetIcon />} />
        <div
          className="rounded-b-lg border p-8 text-center"
          style={{ background: "var(--color-bg)", borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
        >
          Failed to load spreadsheet: {error}
        </div>
      </div>
    );
  }

  if (!workbook) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-8">
        <FileHeader filename={filename} label={ext} icon={<SpreadsheetIcon />} />
        <div
          className="rounded-b-lg border p-8 text-center"
          style={{ background: "var(--color-bg)", borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
        >
          Loading spreadsheet...
        </div>
      </div>
    );
  }

  const sheetNames = workbook.SheetNames;
  const sheet = workbook.Sheets[sheetNames[activeSheet]];
  const rows: string[][] = sheet ? utils.sheet_to_json(sheet, { header: 1, defval: "" }) : [];

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <FileHeader filename={filename} label={ext} icon={<SpreadsheetIcon />} />

      {/* Sheet tabs */}
      {sheetNames.length > 1 && (
        <div
          className="flex gap-0 border-x overflow-x-auto"
          style={{ borderColor: "var(--color-border)" }}
        >
          {sheetNames.map((name, idx) => (
            <button
              key={name}
              type="button"
              onClick={() => setActiveSheet(idx)}
              className="px-4 py-1.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors"
              style={{
                background: idx === activeSheet ? "var(--color-bg)" : "var(--color-surface)",
                color: idx === activeSheet ? "var(--color-text)" : "var(--color-text-muted)",
                borderBottomColor: idx === activeSheet ? "var(--color-accent)" : "transparent",
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div
        className="rounded-b-lg border overflow-auto"
        style={{
          background: "var(--color-bg)",
          borderColor: "var(--color-border)",
          maxHeight: "70vh",
        }}
      >
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
            This sheet is empty.
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                {/* Row number header */}
                <th
                  className="sticky top-0 z-10 px-3 py-2 text-right select-none"
                  style={{
                    background: "var(--color-surface)",
                    borderBottom: "1px solid var(--color-border)",
                    borderRight: "1px solid var(--color-border)",
                    color: "var(--color-text-muted)",
                    minWidth: "3rem",
                  }}
                />
                {rows[0]?.map((_cell, colIdx) => (
                  <th
                    key={colIdx}
                    className="sticky top-0 z-10 px-3 py-2 text-left font-medium whitespace-nowrap"
                    style={{
                      background: "var(--color-surface)",
                      borderBottom: "1px solid var(--color-border)",
                      borderRight: "1px solid var(--color-border)",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    {columnLabel(colIdx)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  className="hover:bg-[var(--color-surface-hover)] transition-colors duration-75"
                >
                  <td
                    className="px-3 py-1.5 text-right select-none tabular-nums"
                    style={{
                      color: "var(--color-text-muted)",
                      opacity: 0.5,
                      borderRight: "1px solid var(--color-border)",
                      borderBottom: "1px solid var(--color-border)",
                      background: "var(--color-surface)",
                    }}
                  >
                    {rowIdx + 1}
                  </td>
                  {row.map((cell, colIdx) => (
                    <td
                      key={colIdx}
                      className="px-3 py-1.5 whitespace-pre-wrap"
                      style={{
                        color: "var(--color-text)",
                        borderRight: "1px solid var(--color-border)",
                        borderBottom: "1px solid var(--color-border)",
                        maxWidth: "300px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div
        className="mt-2 text-xs text-right"
        style={{ color: "var(--color-text-muted)" }}
      >
        {rows.length} row{rows.length !== 1 ? "s" : ""}
        {rows[0] ? ` \u00d7 ${rows[0].length} column${rows[0].length !== 1 ? "s" : ""}` : ""}
        {sheetNames.length > 1 ? ` \u00b7 ${sheetNames.length} sheets` : ""}
      </div>
    </div>
  );
}

/** Convert zero-based column index to Excel-style label (A, B, ..., Z, AA, AB, ...) */
function columnLabel(idx: number): string {
  let label = "";
  let n = idx;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

function SpreadsheetIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "#22c55e" }}
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M8 13h2" />
      <path d="M14 13h2" />
      <path d="M8 17h2" />
      <path d="M14 17h2" />
    </svg>
  );
}

/** Simple YAML syntax highlighting */
function YamlLine({ line }: { line: string }) {
  // Comment
  if (line.trim().startsWith("#")) {
    return <span style={{ color: "var(--color-text-muted)" }}>{line}</span>;
  }

  // Key: value
  const kvMatch = line.match(/^(\s*)([\w][\w_-]*)\s*(:)(.*)/);
  if (kvMatch) {
    const [, indent, key, colon, value] = kvMatch;
    return (
      <>
        <span>{indent}</span>
        <span style={{ color: "#60a5fa" }}>{key}</span>
        <span style={{ color: "var(--color-text-muted)" }}>{colon}</span>
        <YamlValue value={value} />
      </>
    );
  }

  // List item
  const listMatch = line.match(/^(\s*)(-)(\s*)(.*)/);
  if (listMatch) {
    const [, indent, dash, space, value] = listMatch;
    return (
      <>
        <span>{indent}</span>
        <span style={{ color: "var(--color-accent)" }}>{dash}</span>
        <span>{space}</span>
        <span style={{ color: "var(--color-text)" }}>{value}</span>
      </>
    );
  }

  return <span>{line || " "}</span>;
}

function YamlValue({ value }: { value: string }) {
  const trimmed = value.trim();

  // String in quotes
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return <span style={{ color: "#a5d6a7" }}> {trimmed}</span>;
  }

  // Boolean
  if (trimmed === "true" || trimmed === "false") {
    return <span style={{ color: "#f59e0b" }}> {trimmed}</span>;
  }

  // Number
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return <span style={{ color: "#c084fc" }}> {trimmed}</span>;
  }

  // Null
  if (trimmed === "null") {
    return (
      <span style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>
        {" "}
        {trimmed}
      </span>
    );
  }

  return <span style={{ color: "var(--color-text)" }}> {value}</span>;
}
