"use client";

import { useEffect, useState, useMemo } from "react";
import { createHighlighter, type Highlighter } from "shiki";
import { DiffCard } from "../diff-viewer";

/** Map file extensions to shiki language identifiers. */
const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  json: "json",
  jsonc: "jsonc",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  md: "markdown",
  mdx: "mdx",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "fish",
  ps1: "powershell",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  dockerfile: "dockerfile",
  docker: "dockerfile",
  makefile: "makefile",
  cmake: "cmake",
  r: "r",
  lua: "lua",
  php: "php",
  vue: "vue",
  svelte: "svelte",
  diff: "diff",
  patch: "diff",
  ini: "ini",
  env: "ini",
  tf: "terraform",
  proto: "proto",
  zig: "zig",
  elixir: "elixir",
  ex: "elixir",
  erl: "erlang",
  hs: "haskell",
  scala: "scala",
  clj: "clojure",
  dart: "dart",
};

/** All language IDs we might need to load. */
const ALL_LANGS = [...new Set(Object.values(EXT_TO_LANG))];

function extFromFilename(filename: string): string {
  const lower = filename.toLowerCase();
  // Handle special filenames
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) {return "dockerfile";}
  if (lower === "makefile" || lower === "gnumakefile") {return "makefile";}
  if (lower === "cmakelists.txt") {return "cmake";}
  return lower.split(".").pop() ?? "";
}

export function langFromFilename(filename: string): string {
  const ext = extFromFilename(filename);
  return EXT_TO_LANG[ext] ?? "text";
}

export function isCodeFile(filename: string): boolean {
  const ext = extFromFilename(filename);
  return ext in EXT_TO_LANG;
}

type CodeViewerProps = {
  content: string;
  filename: string;
};

// Singleton highlighter so we only create it once
let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark", "github-light"],
      langs: ALL_LANGS,
    });
  }
  return highlighterPromise;
}

export function CodeViewer({ content, filename }: CodeViewerProps) {
  const lang = langFromFilename(filename);
  const ext = extFromFilename(filename);

  // For .diff/.patch files, use the DiffCard instead
  if (ext === "diff" || ext === "patch") {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8">
        <DiffCard diff={content} />
      </div>
    );
  }

  return <HighlightedCode content={content} filename={filename} lang={lang} />;
}

function HighlightedCode({
  content,
  filename,
  lang,
}: {
  content: string;
  filename: string;
  lang: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const lineCount = useMemo(() => content.split("\n").length, [content]);

  useEffect(() => {
    let cancelled = false;
    void getHighlighter().then((highlighter) => {
      if (cancelled) {return;}
      const result = highlighter.codeToHtml(content, {
        lang: lang === "text" ? "text" : lang,
        themes: {
          dark: "github-dark",
          light: "github-light",
        },
        // We'll handle line numbers ourselves
      });
      setHtml(result);
    });
    return () => { cancelled = true; };
  }, [content, lang]);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* File header */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 rounded-t-lg border border-b-0"
        style={{
          background: "var(--color-surface)",
          borderColor: "var(--color-border)",
        }}
      >
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
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
        <span
          className="text-sm font-medium flex-1 truncate"
          style={{ color: "var(--color-text)" }}
        >
          {filename}
        </span>
        <span
          className="text-xs px-1.5 py-0.5 rounded"
          style={{
            background: "var(--color-surface-hover)",
            color: "var(--color-text-muted)",
          }}
        >
          {lang.toUpperCase()}
        </span>
        <span
          className="text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          {lineCount} lines
        </span>
      </div>

      {/* Code content */}
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
          // Fallback: plain text with line numbers while loading
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
  );
}
