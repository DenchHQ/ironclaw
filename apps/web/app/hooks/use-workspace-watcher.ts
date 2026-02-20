"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export type TreeNode = {
  name: string;
  path: string;
  type: "object" | "document" | "folder" | "file" | "database" | "report";
  icon?: string;
  defaultView?: "table" | "kanban";
  children?: TreeNode[];
  /** True when the entry is a symbolic link. */
  symlink?: boolean;
};

/**
 * Hook that fetches the workspace tree and subscribes to SSE file-change events
 * for live reactivity. Falls back to polling if SSE is unavailable.
 *
 * Supports a browse mode: when `browseDir` is set, the tree is fetched from
 * the browse API instead of the workspace tree API.
 */
export function useWorkspaceWatcher() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [exists, setExists] = useState(false);

  // Browse mode state
  const [browseDirRaw, setBrowseDirRaw] = useState<string | null>(null);
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [openclawDir, setOpenclawDir] = useState<string | null>(null);
  const [activeProfile, setActiveProfile] = useState<string | null>(null);

  // Show hidden (dot) files/folders
  const [showHidden, setShowHidden] = useState(false);

  const mountedRef = useRef(true);
  const retryDelayRef = useRef(1000);
  // Version counter: prevents stale fetch responses from overwriting newer data.
  // Each fetch increments the counter; only the latest version's response is applied.
  const fetchVersionRef = useRef(0);

  // Bumping this key forces the SSE connection to tear down and reconnect
  // (used after profile switches so the watcher targets the new workspace).
  const [sseReconnectKey, setSseReconnectKey] = useState(0);

  // Fetch the workspace tree from the tree API
  const fetchWorkspaceTree = useCallback(async () => {
    const version = ++fetchVersionRef.current;
    try {
      const qs = showHidden ? "?showHidden=1" : "";
      const res = await fetch(`/api/workspace/tree${qs}`);
      const data = await res.json();
      if (mountedRef.current && fetchVersionRef.current === version) {
        setTree(data.tree ?? []);
        setExists(data.exists ?? false);
        setWorkspaceRoot(data.workspaceRoot ?? null);
        setOpenclawDir(data.openclawDir ?? null);
        setActiveProfile(data.profile ?? null);
        setLoading(false);
      }
    } catch {
      if (mountedRef.current && fetchVersionRef.current === version) {setLoading(false);}
    }
  }, [showHidden]);

  // Fetch a directory listing from the browse API
  const fetchBrowseTree = useCallback(async (dir: string) => {
    const version = ++fetchVersionRef.current;
    try {
      setLoading(true);
      const hiddenQs = showHidden ? "&showHidden=1" : "";
      const res = await fetch(`/api/workspace/browse?dir=${encodeURIComponent(dir)}${hiddenQs}`);
      const data = await res.json();
      if (mountedRef.current && fetchVersionRef.current === version) {
        setTree(data.entries ?? []);
        setParentDir(data.parentDir ?? null);
        setExists(true);
        setLoading(false);
      }
    } catch {
      if (mountedRef.current && fetchVersionRef.current === version) {setLoading(false);}
    }
  }, [showHidden]);

  // Smart setBrowseDir: auto-return to workspace mode when navigating to the
  // workspace root, so all virtual folders (Chats, Cron, etc.) and DuckDB
  // object detection are restored.
  const browseDirRef = useRef<string | null>(null);
  const setBrowseDir = useCallback((dir: string | null) => {
    let nextDir = dir;
    if (dir != null && workspaceRoot && dir === workspaceRoot) {
      nextDir = null;
    }
    // Mark loading synchronously when entering a new browse directory so the
    // very first render after navigation already shows the loading state
    // (prevents a flash of stale tree data).
    if (nextDir != null && nextDir !== browseDirRef.current) {
      setLoading(true);
    }
    browseDirRef.current = nextDir;
    setBrowseDirRaw(nextDir);
  }, [workspaceRoot]);

  // Expose the raw value for reads
  const browseDir = browseDirRaw;

  // Unified fetch based on current mode
  const fetchTree = useCallback(async () => {
    if (browseDirRaw) {
      await fetchBrowseTree(browseDirRaw);
    } else {
      await fetchWorkspaceTree();
    }
  }, [browseDirRaw, fetchBrowseTree, fetchWorkspaceTree]);

  // Manual refresh for use after mutations
  const refresh = useCallback(() => {
    void fetchTree();
  }, [fetchTree]);

  // Force SSE reconnection + tree refresh (e.g. after profile switch).
  const reconnect = useCallback(() => {
    setSseReconnectKey((k) => k + 1);
    void fetchTree();
  }, [fetchTree]);

  // Re-fetch when browseDir changes
  useEffect(() => {
    mountedRef.current = true;
    void fetchTree();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchTree]);

  // SSE subscription -- only active in workspace mode (not browse mode)
  useEffect(() => {
    if (browseDirRaw) {return;}

    let eventSource: EventSource | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let alive = true;

    // Debounce rapid SSE events into a single tree refetch
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    function debouncedRefetch() {
      if (debounceTimer) {clearTimeout(debounceTimer);}
      debounceTimer = setTimeout(() => {
        if (alive) {void fetchWorkspaceTree();}
      }, 300);
    }

    function connectSSE() {
      if (!alive) {return;}

      try {
        eventSource = new EventSource("/api/workspace/watch");

        eventSource.addEventListener("connected", () => {
          // Reset retry delay on successful connection
          retryDelayRef.current = 1000;
          // Stop polling fallback if it was active
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
        });

        eventSource.addEventListener("change", () => {
          debouncedRefetch();
        });

        eventSource.addEventListener("error", () => {
          // SSE errored -- close and schedule reconnect
          eventSource?.close();
          eventSource = null;
          scheduleReconnect();
        });
      } catch {
        // SSE not supported or network error -- fall back to polling
        startPolling();
      }
    }

    function scheduleReconnect() {
      if (!alive) {return;}
      // Start polling as fallback while we wait to reconnect
      startPolling();
      const delay = retryDelayRef.current;
      retryDelayRef.current = Math.min(delay * 2, 30_000);
      reconnectTimeout = setTimeout(() => {
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        connectSSE();
      }, delay);
    }

    function startPolling() {
      if (pollInterval || !alive) {return;}
      pollInterval = setInterval(() => {
        if (alive) {void fetchWorkspaceTree();}
      }, 5000);
    }

    connectSSE();

    return () => {
      alive = false;
      if (eventSource) {eventSource.close();}
      if (pollInterval) {clearInterval(pollInterval);}
      if (reconnectTimeout) {clearTimeout(reconnectTimeout);}
      if (debounceTimer) {clearTimeout(debounceTimer);}
    };
  }, [browseDirRaw, fetchWorkspaceTree, sseReconnectKey]);

  return { tree, loading, exists, refresh, reconnect, browseDir, setBrowseDir, parentDir, workspaceRoot, openclawDir, activeProfile, showHidden, setShowHidden };
}
