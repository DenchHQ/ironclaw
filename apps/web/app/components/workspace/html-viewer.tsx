"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { createHighlighter, type Highlighter } from "shiki";

type HtmlViewerProps = {
  filename: string;
  /** Raw URL for iframe rendering (served with text/html) */
  rawUrl: string;
  /** JSON API URL to fetch source content on demand (for code view) */
  contentUrl: string;
};

type ViewMode = "rendered" | "code";

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark", "github-light"],
      langs: ["html"],
    });
  }
  return highlighterPromise;
}

export function HtmlViewer({ filename, rawUrl, contentUrl }: HtmlViewerProps) {
  const [mode, setMode] = useState<ViewMode>("rendered");
  const [source, setSource] = useState<string | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);

  const handleCodeToggle = useCallback(() => {
    setMode("code");
    if (source !== null) {return;}
    setSourceLoading(true);
    void fetch(contentUrl)
      .then((r) => r.json())
      .then((data: { content: string }) => setSource(data.content))
      .catch(() => setSource("<!-- Failed to load source -->"))
      .finally(() => setSourceLoading(false));
  }, [contentUrl, source]);

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div
        className="flex items-center gap-3 px-5 py-3 border-b flex-shrink-0"
        style={{ borderColor: "var(--color-border)" }}
      >
        <HtmlIcon />
        <span className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
          {filename}
        </span>
        <span
          className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0"
          style={{
            background: "#f9731618",
            color: "#f97316",
            border: "1px solid #f9731630",
          }}
        >
          HTML
        </span>

        {/* Mode toggle */}
        <div
          className="flex items-center ml-auto rounded-lg p-0.5"
          style={{ background: "var(--color-surface-hover)" }}
        >
          <button
            type="button"
            onClick={() => setMode("rendered")}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors duration-100 cursor-pointer"
            style={{
              background: mode === "rendered" ? "var(--color-surface)" : "transparent",
              color: mode === "rendered" ? "var(--color-text)" : "var(--color-text-muted)",
              boxShadow: mode === "rendered" ? "0 1px 2px rgba(0,0,0,0.1)" : "none",
            }}
          >
            <EyeIcon />
            Preview
          </button>
          <button
            type="button"
            onClick={handleCodeToggle}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors duration-100 cursor-pointer"
            style={{
              background: mode === "code" ? "var(--color-surface)" : "transparent",
              color: mode === "code" ? "var(--color-text)" : "var(--color-text-muted)",
              boxShadow: mode === "code" ? "0 1px 2px rgba(0,0,0,0.1)" : "none",
            }}
          >
            <CodeIcon />
            Code
          </button>
        </div>

        {/* Open in new tab */}
        <a
          href={rawUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded-md transition-colors duration-100"
          style={{ color: "var(--color-text-muted)" }}
          title="Open in new tab"
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          <ExternalLinkIcon />
        </a>
      </div>

      {/* Content */}
      {mode === "rendered" ? (
        <RenderedView rawUrl={rawUrl} />
      ) : sourceLoading || source === null ? (
        <div className="flex-1 flex items-center justify-center">
          <div
            className="w-6 h-6 border-2 rounded-full animate-spin"
            style={{
              borderColor: "var(--color-border)",
              borderTopColor: "var(--color-accent)",
            }}
          />
        </div>
      ) : (
        <CodeView content={source} />
      )}
    </div>
  );
}

// --- Rendered HTML view (sandboxed iframe) ---

function RenderedView({ rawUrl }: { rawUrl: string }) {
  return (
    <div className="flex-1 overflow-hidden" style={{ background: "white" }}>
      <iframe
        src={rawUrl}
        className="w-full h-full border-0"
        sandbox="allow-same-origin allow-scripts allow-popups"
        title="HTML preview"
        style={{ minHeight: "calc(100vh - 120px)" }}
      />
    </div>
  );
}

// --- Syntax-highlighted code view ---

function CodeView({ content }: { content: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const lineCount = useMemo(() => content.split("\n").length, [content]);

  useEffect(() => {
    let cancelled = false;
    void getHighlighter().then((highlighter) => {
      if (cancelled) {return;}
      const result = highlighter.codeToHtml(content, {
        lang: "html",
        themes: { dark: "github-dark", light: "github-light" },
      });
      setHtml(result);
    });
    return () => { cancelled = true; };
  }, [content]);

  return (
    <div className="flex-1 overflow-auto" style={{ background: "var(--color-surface)" }}>
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div
          className="flex items-center gap-2 px-4 py-2.5 rounded-t-lg border border-b-0"
          style={{
            background: "var(--color-surface)",
            borderColor: "var(--color-border)",
          }}
        >
          <CodeIcon />
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            HTML
          </span>
          <span className="text-xs ml-auto" style={{ color: "var(--color-text-muted)" }}>
            {lineCount} lines
          </span>
        </div>

        <div
          className="code-viewer-content rounded-b-lg border overflow-x-auto"
          style={{
            background: "var(--color-bg)",
            borderColor: "var(--color-border)",
          }}
        >
          {html ? (
            <div
              className="code-viewer-highlighted"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is trusted
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <pre className="text-sm leading-6" style={{ margin: 0 }}>
              <code>
                {content.split("\n").map((line, idx) => (
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
                    <span className="pr-4 flex-1" style={{ color: "var(--color-text)" }}>
                      {line || " "}
                    </span>
                  </div>
                ))}
              </code>
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Icons ---

function HtmlIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
      <line x1="12" x2="10" y1="2" y2="22" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}
