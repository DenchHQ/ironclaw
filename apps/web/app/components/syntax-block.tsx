"use client";

import { useEffect, useState } from "react";
import { createHighlighter, type Highlighter } from "shiki";

// Singleton highlighter (shared with code-viewer)
let highlighterPromise: Promise<Highlighter> | null = null;

/** Languages to preload for chat code blocks. */
const CHAT_LANGS = [
  "typescript", "tsx", "javascript", "jsx",
  "python", "ruby", "go", "rust", "java",
  "c", "cpp", "csharp", "swift", "kotlin",
  "css", "scss", "html", "xml",
  "json", "yaml", "toml",
  "bash", "sql", "graphql",
  "markdown", "diff", "php", "lua",
  "vue", "svelte", "dart", "zig",
];

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark", "github-light"],
      langs: CHAT_LANGS,
    });
  }
  return highlighterPromise;
}

type SyntaxBlockProps = {
  code: string;
  lang: string;
};

/**
 * Renders a syntax-highlighted code block using shiki.
 * Falls back to plain monospace while loading.
 */
export function SyntaxBlock({ code, lang }: SyntaxBlockProps) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getHighlighter().then((hl) => {
      if (cancelled) {return;}
      try {
        const result = hl.codeToHtml(code, {
          lang,
          themes: {
            dark: "github-dark",
            light: "github-light",
          },
        });
        setHtml(result);
      } catch {
        // If the language isn't loaded, fall back to plain text
        try {
          const result = hl.codeToHtml(code, {
            lang: "text",
            themes: {
              dark: "github-dark",
              light: "github-light",
            },
          });
          setHtml(result);
        } catch {
          // Give up on highlighting
        }
      }
    });
    return () => { cancelled = true; };
  }, [code, lang]);

  if (html) {
    return (
      <div
        className="syntax-block"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is trusted
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  // Fallback: plain code while shiki loads
  return (
    <code className="block">{code}</code>
  );
}
