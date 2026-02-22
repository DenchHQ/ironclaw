"use client";

import { useEffect, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SessionMessage, SessionMessagePart, CronRunSessionResponse } from "../../types/cron";

/* ─── Main component ─── */

export function CronRunChat({ sessionId }: { sessionId: string }) {
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch(`/api/cron/runs/${encodeURIComponent(sessionId)}`);
      if (!res.ok) {
        setError(res.status === 404 ? "Session transcript not found" : "Failed to load session");
        return;
      }
      const data: CronRunSessionResponse = await res.json();
      setMessages(data.messages ?? []);
    } catch {
      setError("Failed to load session");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void fetchSession();
  }, [fetchSession]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4">
        <div
          className="w-4 h-4 border-[1.5px] rounded-full animate-spin"
          style={{ borderColor: "var(--color-border)", borderTopColor: "var(--color-accent)" }}
        />
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Loading session transcript...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="text-xs rounded-lg px-3 py-2"
        style={{ color: "var(--color-text-muted)", background: "var(--color-surface-hover)" }}
      >
        {error}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="text-xs py-2" style={{ color: "var(--color-text-muted)" }}>
        Empty session transcript.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-[11px] uppercase tracking-wider font-medium mb-2" style={{ color: "var(--color-text-muted)" }}>
        Session Transcript
      </div>
      {messages.map((msg) => (
        <CronChatMessage key={msg.id} message={msg} />
      ))}
    </div>
  );
}

/* ─── Transcript search fallback (no sessionId) ─── */

export function CronRunTranscriptSearch({
  jobId,
  runAtMs,
  summary,
  fallback,
}: {
  jobId: string;
  runAtMs?: number;
  summary?: string;
  fallback?: React.ReactNode;
}) {
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const fetchTranscript = useCallback(async () => {
    if (!runAtMs || !summary) {
      setLoading(false);
      setNotFound(true);
      return;
    }
    try {
      const params = new URLSearchParams({
        jobId,
        runAtMs: String(runAtMs),
        summary,
      });
      const res = await fetch(`/api/cron/runs/search-transcript?${params}`);
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      const data = await res.json() as { messages?: SessionMessage[] };
      if (data.messages && data.messages.length > 0) {
        setMessages(data.messages);
      } else {
        setNotFound(true);
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [jobId, runAtMs, summary]);

  useEffect(() => {
    void fetchTranscript();
  }, [fetchTranscript]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4">
        <div
          className="w-4 h-4 border-[1.5px] rounded-full animate-spin"
          style={{ borderColor: "var(--color-border)", borderTopColor: "var(--color-accent)" }}
        />
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Searching for transcript...</span>
      </div>
    );
  }

  if (notFound || messages.length === 0) {
    return <>{fallback}</>;
  }

  return (
    <div className="space-y-3">
      <div className="text-[11px] uppercase tracking-wider font-medium mb-2" style={{ color: "var(--color-text-muted)" }}>
        Session Transcript
      </div>
      {messages.map((msg) => (
        <CronChatMessage key={msg.id} message={msg} />
      ))}
    </div>
  );
}

/* ─── Message rendering ─── */

function CronChatMessage({ message }: { message: SessionMessage }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  // Group parts into segments
  const segments = groupPartsIntoSegments(message.parts);

  if (isSystem) {
    const textContent = message.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    return (
      <div
        className="text-xs rounded-lg px-3 py-2 font-mono"
        style={{
          background: "var(--color-surface-hover)",
          color: "var(--color-text-muted)",
          border: "1px dashed var(--color-border)",
        }}
      >
        <span className="font-medium">system:</span> {textContent.slice(0, 500)}
      </div>
    );
  }

  if (isUser) {
    const textContent = message.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    return (
      <div className="flex justify-end py-1">
        <div
          className="max-w-[80%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm"
          style={{
            background: "var(--color-user-bubble)",
            color: "var(--color-user-bubble-text)",
          }}
        >
          <p className="whitespace-pre-wrap">{textContent}</p>
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="py-2 space-y-2">
      {segments.map((segment, idx) => {
        if (segment.type === "text") {
          return (
            <div
              key={idx}
              className="chat-prose text-sm"
              style={{ color: "var(--color-text)" }}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {segment.text}
              </ReactMarkdown>
            </div>
          );
        }

        if (segment.type === "thinking") {
          return <ThinkingBlock key={idx} text={segment.thinking} />;
        }

        if (segment.type === "tool-group") {
          return <ToolGroup key={idx} tools={segment.tools} />;
        }

        return null;
      })}
    </div>
  );
}

/* ─── Part grouping ─── */

type ChatSegment =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool-group"; tools: Array<SessionMessagePart & { type: "tool-call" }> };

function groupPartsIntoSegments(parts: SessionMessagePart[]): ChatSegment[] {
  const segments: ChatSegment[] = [];
  let toolBuffer: Array<SessionMessagePart & { type: "tool-call" }> = [];

  const flushTools = () => {
    if (toolBuffer.length > 0) {
      segments.push({ type: "tool-group", tools: [...toolBuffer] });
      toolBuffer = [];
    }
  };

  for (const part of parts) {
    if (part.type === "text") {
      flushTools();
      segments.push({ type: "text", text: part.text });
    } else if (part.type === "thinking") {
      flushTools();
      segments.push({ type: "thinking", thinking: part.thinking });
    } else if (part.type === "tool-call") {
      toolBuffer.push(part as SessionMessagePart & { type: "tool-call" });
    }
  }
  flushTools();
  return segments;
}

/* ─── Thinking block (always expanded for historical runs) ─── */

function ThinkingBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(true);
  const isLong = text.length > 600;

  return (
    <div className="my-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 py-1 text-[13px] cursor-pointer"
        style={{ color: "var(--color-text-muted)" }}
      >
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="opacity-60"
        >
          <path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7z" />
          <path d="M10 21h4" />
        </svg>
        <span className="font-medium">Thinking</span>
        <svg
          width="12" height="12" viewBox="0 0 12 12" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform duration-200 ${expanded ? "" : "-rotate-90"}`}
        >
          <path d="M3 4.5L6 7.5L9 4.5" />
        </svg>
      </button>
      {expanded && (
        <div
          className={`text-[13px] whitespace-pre-wrap leading-relaxed pl-6 ${isLong && !expanded ? "max-h-24 overflow-hidden" : ""}`}
          style={{ color: "var(--color-text-secondary)" }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

/* ─── Tool group ─── */

function ToolGroup({ tools }: { tools: Array<SessionMessagePart & { type: "tool-call" }> }) {
  return (
    <div className="my-2 relative">
      {/* Timeline connector */}
      <div
        className="absolute w-px"
        style={{ left: 9, top: 8, bottom: 8, background: "var(--color-border)" }}
      />
      <div className="space-y-1">
        {tools.map((tool) => (
          <ToolCallStep key={tool.toolCallId} tool={tool} />
        ))}
      </div>
    </div>
  );
}

/* ─── Tool call step ─── */

function ToolCallStep({ tool }: { tool: SessionMessagePart & { type: "tool-call" } }) {
  const [showOutput, setShowOutput] = useState(false);
  const label = buildToolLabel(tool.toolName, tool.args);

  return (
    <div className="flex items-start gap-2.5 py-1">
      <div
        className="relative z-10 flex-shrink-0 w-5 h-5 mt-0.5 flex items-center justify-center rounded-full"
        style={{ background: "var(--color-bg)" }}
      >
        <ToolIcon toolName={tool.toolName} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] leading-snug" style={{ color: "var(--color-text-secondary)" }}>
          {label}
        </div>
        {tool.output && (
          <div className="mt-0.5">
            <button
              type="button"
              onClick={() => setShowOutput((v) => !v)}
              className="text-[11px] hover:underline cursor-pointer"
              style={{ color: "var(--color-accent)" }}
            >
              {showOutput ? "Hide output" : "Show output"}
            </button>
            {showOutput && (
              <pre
                className="mt-1 text-[11px] font-mono rounded-lg px-2.5 py-2 overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto leading-relaxed"
                style={{ color: "var(--color-text-muted)", background: "var(--color-bg)" }}
              >
                {tool.output.length > 3000 ? tool.output.slice(0, 3000) + "\n..." : tool.output}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Tool label builder ─── */

function buildToolLabel(toolName: string, args?: unknown): string {
  const a = args as Record<string, unknown> | undefined;
  const strVal = (key: string) => {
    const v = a?.[key];
    return typeof v === "string" && v.length > 0 ? v : null;
  };

  const n = toolName.toLowerCase().replace(/[_-]/g, "");

  if (["websearch", "search", "googlesearch"].some((k) => n.includes(k))) {
    const q = strVal("query") ?? strVal("search_query") ?? strVal("q");
    return q ? `Searching: ${q.slice(0, 80)}` : "Searching...";
  }
  if (["fetchurl", "fetch", "webfetch"].some((k) => n.includes(k))) {
    const u = strVal("url") ?? strVal("path");
    return u ? `Fetching: ${u.slice(0, 60)}` : "Fetching page";
  }
  if (["read", "readfile", "getfile"].some((k) => n.includes(k))) {
    const p = strVal("path") ?? strVal("file");
    return p ? `Reading: ${p.split("/").pop()}` : "Reading file";
  }
  if (["bash", "shell", "execute", "exec", "terminal"].some((k) => n.includes(k))) {
    const cmd = strVal("command") ?? strVal("cmd");
    return cmd ? `Running: ${cmd.slice(0, 60)}` : "Running command";
  }
  if (["write", "create", "edit", "str_replace", "save"].some((k) => n.includes(k))) {
    const p = strVal("path") ?? strVal("file");
    return p ? `Editing: ${p.split("/").pop()}` : "Editing file";
  }

  return toolName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ─── Tool icon ─── */

function ToolIcon({ toolName }: { toolName: string }) {
  const color = "var(--color-text-muted)";
  const n = toolName.toLowerCase().replace(/[_-]/g, "");

  if (["search", "websearch"].some((k) => n.includes(k))) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
      </svg>
    );
  }
  if (["bash", "shell", "exec", "terminal"].some((k) => n.includes(k))) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" /><line x1="12" x2="20" y1="19" y2="19" />
      </svg>
    );
  }
  if (["write", "edit", "create", "save"].some((k) => n.includes(k))) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
      </svg>
    );
  }
  // Default: file/read icon
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}
