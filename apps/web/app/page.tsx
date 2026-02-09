"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatMessage } from "./components/chat-message";
import { Sidebar } from "./components/sidebar";

const transport = new DefaultChatTransport({ api: "/api/chat" });

export default function Home() {
  const { messages, sendMessage, status, stop, error, setMessages } = useChat({ transport });
  const [input, setInput] = useState("");
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [startingNewSession, setStartingNewSession] = useState(false);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Track which messages have already been persisted to avoid double-saves
  const savedMessageIdsRef = useRef<Set<string>>(new Set());

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const isStreaming = status === "streaming" || status === "submitted";

  const refreshSidebar = useCallback(() => {
    setSidebarRefreshKey((k) => k + 1);
  }, []);

  /** Persist messages to the web session's .jsonl file.
   *  Saves the full `parts` array (reasoning, tool calls, output, text)
   *  alongside a plain-text `content` field for backward compat / sidebar. */
  const saveMessages = useCallback(
    async (
      sessionId: string,
      msgs: Array<{
        id: string;
        role: string;
        content: string;
        parts?: unknown[];
      }>,
      title?: string,
    ) => {
      const toSave = msgs.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        // Persist full UIMessage parts so reasoning + tool calls survive reload
        ...(m.parts ? { parts: m.parts } : {}),
        timestamp: new Date().toISOString(),
      }));
      try {
        await fetch(`/api/web-sessions/${sessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: toSave, title }),
        });
        for (const m of msgs) savedMessageIdsRef.current.add(m.id);
        refreshSidebar();
      } catch (err) {
        console.error("Failed to save messages:", err);
      }
    },
    [refreshSidebar],
  );

  /** Create a new web chat session and return its ID */
  const createSession = useCallback(async (title: string): Promise<string> => {
    const res = await fetch("/api/web-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const data = await res.json();
    return data.session.id;
  }, []);

  /** Extract plain text from a UIMessage */
  const getMessageText = useCallback(
    (msg: (typeof messages)[number]): string => {
      return (
        msg.parts
          ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("\n") ?? ""
      );
    },
    [],
  );

  // When streaming finishes, save the assistant's response
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const wasStreaming =
      prevStatusRef.current === "streaming" || prevStatusRef.current === "submitted";
    const isNowReady = status === "ready";

    if (wasStreaming && isNowReady && currentSessionId) {
      // Save any unsaved messages (typically the assistant response).
      // Include the full parts array so reasoning, tool calls, and their
      // outputs persist across session reloads.
      const unsaved = messages.filter((m) => !savedMessageIdsRef.current.has(m.id));
      if (unsaved.length > 0) {
        const toSave = unsaved.map((m) => ({
          id: m.id,
          role: m.role,
          content: getMessageText(m),
          parts: m.parts,
        }));
        saveMessages(currentSessionId, toSave);
      }
    }
    prevStatusRef.current = status;
  }, [status, messages, currentSessionId, saveMessages, getMessageText]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    const userText = input.trim();
    setInput("");

    // "/new" triggers a new session (same as clicking the + button)
    if (userText.toLowerCase() === "/new") {
      handleNewSession();
      return;
    }

    // Create a session if we don't have one yet
    let sessionId = currentSessionId;
    if (!sessionId) {
      const title = userText.length > 60 ? userText.slice(0, 60) + "..." : userText;
      sessionId = await createSession(title);
      setCurrentSessionId(sessionId);
      refreshSidebar();
    }

    // Save the user message immediately (include parts for consistency)
    const userMsgId = `user-${Date.now()}`;
    await saveMessages(sessionId, [
      {
        id: userMsgId,
        role: "user",
        content: userText,
        parts: [{ type: "text", text: userText }],
      },
    ]);

    // Send to agent
    sendMessage({ text: userText });
  };

  /** Load a previous web chat session */
  const handleSessionSelect = useCallback(
    async (sessionId: string) => {
      if (sessionId === currentSessionId) return;

      setLoadingSession(true);
      setCurrentSessionId(sessionId);
      savedMessageIdsRef.current.clear();

      try {
        const response = await fetch(`/api/web-sessions/${sessionId}`);
        if (!response.ok) throw new Error("Failed to load session");

        const data = await response.json();
        const sessionMessages: Array<{
          id: string;
          role: "user" | "assistant";
          content: string;
          parts?: Array<Record<string, unknown>>;
        }> = data.messages || [];

        // Convert to UIMessage format and mark all as saved.
        // Restore from saved `parts` if available (preserves reasoning,
        // tool calls, output), falling back to plain text for old sessions.
        const uiMessages = sessionMessages.map((msg) => {
          savedMessageIdsRef.current.add(msg.id);
          return {
            id: msg.id,
            role: msg.role,
            parts: msg.parts ?? [{ type: "text" as const, text: msg.content }],
          };
        });

        setMessages(uiMessages);
      } catch (err) {
        console.error("Error loading session:", err);
      } finally {
        setLoadingSession(false);
      }
    },
    [currentSessionId, setMessages],
  );

  /** Start a brand new session: clear UI, send /new to agent */
  const handleNewSession = useCallback(async () => {
    // Clear the UI immediately
    setCurrentSessionId(null);
    setMessages([]);
    savedMessageIdsRef.current.clear();

    // Send /new to the agent backend to start a fresh session
    setStartingNewSession(true);
    try {
      await fetch("/api/new-session", { method: "POST" });
    } catch (err) {
      console.error("Failed to send /new:", err);
    } finally {
      setStartingNewSession(false);
    }
  }, [setMessages]);

  return (
    <div className="flex h-screen">
      <Sidebar
        onSessionSelect={handleSessionSelect}
        onNewSession={handleNewSession}
        activeSessionId={currentSessionId ?? undefined}
        refreshKey={sidebarRefreshKey}
      />

      {/* Main chat area */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Chat header */}
        <header className="px-6 py-3 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-surface)]">
          <div>
            <h2 className="text-sm font-semibold">
              {currentSessionId ? "Chat Session" : "New Chat"}
            </h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              {startingNewSession
                ? "Starting new session..."
                : loadingSession
                  ? "Loading session..."
                  : status === "ready"
                    ? "Ready"
                    : status === "submitted"
                      ? "Thinking..."
                      : status === "streaming"
                        ? "Streaming..."
                        : status === "error"
                          ? "Error"
                          : status}
            </p>
          </div>
          <div className="flex gap-2">
            {isStreaming && (
              <button
                onClick={() => stop()}
                className="px-3 py-1 text-xs rounded-md bg-[var(--color-border)] hover:bg-[var(--color-text-muted)] text-[var(--color-text)] transition-colors"
              >
                Stop
              </button>
            )}
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6">
          {loadingSession ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-8 h-8 border-2 border-[var(--color-border)] border-t-[var(--color-accent)] rounded-full animate-spin mx-auto mb-4" />
                <p className="text-sm text-[var(--color-text-muted)]">Loading session...</p>
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-6xl mb-4">🦞</p>
                <h3 className="text-lg font-semibold mb-1">OpenClaw Chat</h3>
                <p className="text-sm text-[var(--color-text-muted)]">
                  Send a message to start a conversation with your agent.
                </p>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto py-4">
              {messages.map((message) => (
                <ChatMessage key={message.id} message={message} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Error display */}
        {error && (
          <div className="px-6 py-2 bg-red-900/20 border-t border-red-800/30">
            <p className="text-sm text-red-400">Error: {error.message}</p>
          </div>
        )}

        {/* Input */}
        <div className="px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-surface)]">
          <form onSubmit={handleSubmit} className="max-w-3xl mx-auto flex gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message OpenClaw..."
              disabled={isStreaming || loadingSession || startingNewSession}
              className="flex-1 px-4 py-3 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent disabled:opacity-50 text-sm"
            />
            <button
              type="submit"
              disabled={!input.trim() || isStreaming || loadingSession || startingNewSession}
              className="px-5 py-3 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white rounded-xl font-medium text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isStreaming ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                "Send"
              )}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
