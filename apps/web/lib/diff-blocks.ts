/**
 * Pure utility functions for parsing ```diff blocks from chat/document text.
 * Mirrors the pattern in report-blocks.ts for testability.
 */

export type DiffSegment =
  | { type: "text"; text: string }
  | { type: "diff-artifact"; diff: string };

/**
 * Split text containing ```diff ... ``` fenced blocks into
 * alternating text and diff-artifact segments.
 */
export function splitDiffBlocks(text: string): DiffSegment[] {
  const diffFenceRegex = /```diff\s*\n([\s\S]*?)```/g;
  const segments: DiffSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(diffFenceRegex)) {
    const before = text.slice(lastIndex, match.index);
    if (before.trim()) {
      segments.push({ type: "text", text: before });
    }

    const diffContent = match[1].trimEnd();
    if (diffContent) {
      segments.push({ type: "diff-artifact", diff: diffContent });
    } else {
      // Empty diff block -- render as plain text
      segments.push({ type: "text", text: match[0] });
    }

    lastIndex = (match.index ?? 0) + match[0].length;
  }

  const remaining = text.slice(lastIndex);
  if (remaining.trim()) {
    segments.push({ type: "text", text: remaining });
  }

  return segments;
}

/**
 * Check if text contains any diff fenced blocks.
 */
export function hasDiffBlocks(text: string): boolean {
  return text.includes("```diff");
}
