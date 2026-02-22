/**
 * Pure utility functions for parsing report-json blocks from chat text.
 * Extracted from chat-message.tsx for testability.
 */

import type { ReportConfig } from "../app/components/charts/types";

export type { ReportConfig };

export type ParsedSegment =
  | { type: "text"; text: string }
  | { type: "report-artifact"; config: ReportConfig };

/**
 * Split text containing ```report-json ... ``` fenced blocks into
 * alternating text and report-artifact segments.
 */
export function splitReportBlocks(text: string): ParsedSegment[] {
  const reportFenceRegex = /```report-json\s*\n([\s\S]*?)```/g;
  const segments: ParsedSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(reportFenceRegex)) {
    const before = text.slice(lastIndex, match.index);
    if (before.trim()) {
      segments.push({ type: "text", text: before });
    }

    try {
      const config = JSON.parse(match[1]) as ReportConfig;
      if (config.panels && Array.isArray(config.panels)) {
        segments.push({ type: "report-artifact", config });
      } else {
        // Invalid report config -- render as plain text
        segments.push({ type: "text", text: match[0] });
      }
    } catch {
      // Invalid JSON -- render as plain text
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
 * Check if text contains any report-json fenced blocks.
 */
export function hasReportBlocks(text: string): boolean {
  return text.includes("```report-json");
}
