type WorkspaceEmptyContent = { kind: "none" };

type WorkspaceSwitchDeps = {
  setBrowseDir: (dir: string | null) => void;
  setActivePath: (path: string | null) => void;
  setContent: (content: WorkspaceEmptyContent) => void;
  setChatSidebarPreview: (preview: null) => void;
  setShowChatSidebar: (show: boolean) => void;
  setActiveSessionId: (sessionId: string | null) => void;
  setActiveSubagentKey: (sessionKey: string | null) => void;
  resetMainChat: () => void;
  replaceUrlToWorkspace: () => void;
  reconnectWorkspaceWatcher: () => void;
  refreshSessions: () => void;
  refreshContext: () => void;
};

/**
 * Keep workspace switching deterministic:
 * clear file/chat selection first, then force a fresh chat session so
 * subsequent messages cannot reuse the prior workspace's session key.
 */
export function resetWorkspaceStateOnSwitch(deps: WorkspaceSwitchDeps): void {
  deps.setBrowseDir(null);
  deps.setActivePath(null);
  deps.setContent({ kind: "none" });
  deps.setChatSidebarPreview(null);
  deps.setShowChatSidebar(true);
  deps.setActiveSessionId(null);
  deps.setActiveSubagentKey(null);
  deps.resetMainChat();
  deps.replaceUrlToWorkspace();
  deps.reconnectWorkspaceWatcher();
  deps.refreshSessions();
  deps.refreshContext();
}
