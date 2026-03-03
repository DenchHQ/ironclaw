import { describe, it, expect, vi } from "vitest";
import { resetWorkspaceStateOnSwitch } from "./workspace-switch";

describe("resetWorkspaceStateOnSwitch", () => {
  it("clears file/chat state and forces a fresh main chat session", () => {
    const deps = {
      setBrowseDir: vi.fn(),
      setActivePath: vi.fn(),
      setContent: vi.fn(),
      setChatSidebarPreview: vi.fn(),
      setShowChatSidebar: vi.fn(),
      setActiveSessionId: vi.fn(),
      setActiveSubagentKey: vi.fn(),
      resetMainChat: vi.fn(),
      replaceUrlToWorkspace: vi.fn(),
      reconnectWorkspaceWatcher: vi.fn(),
      refreshSessions: vi.fn(),
      refreshContext: vi.fn(),
    };

    resetWorkspaceStateOnSwitch(deps);

    expect(deps.setBrowseDir).toHaveBeenCalledWith(null);
    expect(deps.setActivePath).toHaveBeenCalledWith(null);
    expect(deps.setContent).toHaveBeenCalledWith({ kind: "none" });
    expect(deps.setChatSidebarPreview).toHaveBeenCalledWith(null);
    expect(deps.setShowChatSidebar).toHaveBeenCalledWith(true);
    expect(deps.setActiveSessionId).toHaveBeenCalledWith(null);
    expect(deps.setActiveSubagentKey).toHaveBeenCalledWith(null);
    expect(deps.resetMainChat).toHaveBeenCalledTimes(1);
    expect(deps.replaceUrlToWorkspace).toHaveBeenCalledTimes(1);
    expect(deps.reconnectWorkspaceWatcher).toHaveBeenCalledTimes(1);
    expect(deps.refreshSessions).toHaveBeenCalledTimes(1);
    expect(deps.refreshContext).toHaveBeenCalledTimes(1);
  });
});
