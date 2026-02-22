/**
 * Workspace link utilities.
 *
 * All workspace links use REAL URLs so they work if the browser follows them:
 *   Files/docs:  /workspace?path=knowledge/path/to/doc.md
 *   Objects:     /workspace?path=knowledge/leads
 *   Entries:     /workspace?entry=leads:abc123
 */

export type WorkspaceLink =
  | { kind: "file"; path: string }
  | { kind: "entry"; objectName: string; entryId: string };

// --- Builders ---

/** Build a real URL for an entry detail modal. */
export function buildEntryLink(objectName: string, entryId: string): string {
  return `/workspace?entry=${encodeURIComponent(objectName)}:${encodeURIComponent(entryId)}`;
}

/** Build a real URL for a file or object in the workspace. */
export function buildFileLink(path: string): string {
  return `/workspace?path=${encodeURIComponent(path)}`;
}

// --- Parsers ---

/** Parse a workspace URL into a structured link. Returns null if not a workspace link. */
export function parseWorkspaceLink(href: string): WorkspaceLink | null {
  // Handle full or relative /workspace?... URLs
  let url: URL | null = null;
  try {
    if (href.startsWith("/workspace")) {
      url = new URL(href, "http://localhost");
    } else if (href.includes("/workspace?")) {
      url = new URL(href);
    }
  } catch {
    // not a valid URL
  }

  if (url) {
    const entryParam = url.searchParams.get("entry");
    if (entryParam && entryParam.includes(":")) {
      const colonIdx = entryParam.indexOf(":");
      return {
        kind: "entry",
        objectName: entryParam.slice(0, colonIdx),
        entryId: entryParam.slice(colonIdx + 1),
      };
    }

    const pathParam = url.searchParams.get("path");
    if (pathParam) {
      return { kind: "file", path: pathParam };
    }
  }

  // Legacy: handle old @entry/ format for backward compat
  if (href.startsWith("@entry/")) {
    const rest = href.slice("@entry/".length);
    const slashIdx = rest.indexOf("/");
    if (slashIdx > 0) {
      return {
        kind: "entry",
        objectName: rest.slice(0, slashIdx),
        entryId: rest.slice(slashIdx + 1),
      };
    }
  }

  return null;
}

/** Check if an href is a workspace link (either /workspace?... or legacy @entry/). */
export function isWorkspaceLink(href: string): boolean {
  return (
    href.startsWith("/workspace?") ||
    href.startsWith("/workspace#") ||
    href === "/workspace" ||
    href.startsWith("@entry/")
  );
}

/** Check if an href is a workspace-internal link (not external URL). */
export function isInternalLink(href: string): boolean {
  return (
    !href.startsWith("http://") &&
    !href.startsWith("https://") &&
    !href.startsWith("mailto:")
  );
}

/** Check if an href is an entry link (any format). */
export function isEntryLink(href: string): boolean {
  if (href.startsWith("@entry/")) {return true;}
  if (href.startsWith("/workspace") && href.includes("entry=")) {return true;}
  return false;
}
