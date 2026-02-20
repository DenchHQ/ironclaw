"use client";

type FileViewerProps = {
  content: string;
  filename: string;
  type: "yaml" | "text";
};

export function FileViewer({ content, filename, type }: FileViewerProps) {
  const lines = content.split("\n");

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
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
        </svg>
        <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
          {filename}
        </span>
        <span
          className="text-xs px-1.5 py-0.5 rounded ml-auto"
          style={{
            background: "var(--color-surface-hover)",
            color: "var(--color-text-muted)",
          }}
        >
          {type.toUpperCase()}
        </span>
      </div>

      {/* File content */}
      <div
        className="rounded-b-lg border overflow-x-auto"
        style={{
          background: "var(--color-bg)",
          borderColor: "var(--color-border)",
        }}
      >
        <pre className="text-sm leading-6" style={{ margin: 0 }}>
          <code>
            {lines.map((line, idx) => (
              <div
                key={idx}
                className="flex hover:bg-[var(--color-surface-hover)] transition-colors duration-75"
              >
                {/* Line number */}
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

                {/* Line content */}
                <span
                  className="pr-4 flex-1"
                  style={{ color: "var(--color-text)" }}
                >
                  {type === "yaml" ? (
                    <YamlLine line={line} />
                  ) : (
                    line || " "
                  )}
                </span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

/** Simple YAML syntax highlighting */
function YamlLine({ line }: { line: string }) {
  // Comment
  if (line.trim().startsWith("#")) {
    return <span style={{ color: "var(--color-text-muted)" }}>{line}</span>;
  }

  // Key: value
  const kvMatch = line.match(/^(\s*)([\w][\w_-]*)\s*(:)(.*)/);
  if (kvMatch) {
    const [, indent, key, colon, value] = kvMatch;
    return (
      <>
        <span>{indent}</span>
        <span style={{ color: "#60a5fa" }}>{key}</span>
        <span style={{ color: "var(--color-text-muted)" }}>{colon}</span>
        <YamlValue value={value} />
      </>
    );
  }

  // List item
  const listMatch = line.match(/^(\s*)(-)(\s*)(.*)/);
  if (listMatch) {
    const [, indent, dash, space, value] = listMatch;
    return (
      <>
        <span>{indent}</span>
        <span style={{ color: "var(--color-accent)" }}>{dash}</span>
        <span>{space}</span>
        <span style={{ color: "var(--color-text)" }}>{value}</span>
      </>
    );
  }

  return <span>{line || " "}</span>;
}

function YamlValue({ value }: { value: string }) {
  const trimmed = value.trim();

  // String in quotes
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return <span style={{ color: "#a5d6a7" }}> {trimmed}</span>;
  }

  // Boolean
  if (trimmed === "true" || trimmed === "false") {
    return <span style={{ color: "#f59e0b" }}> {trimmed}</span>;
  }

  // Number
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return <span style={{ color: "#c084fc" }}> {trimmed}</span>;
  }

  // Null
  if (trimmed === "null") {
    return (
      <span style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>
        {" "}
        {trimmed}
      </span>
    );
  }

  return <span style={{ color: "var(--color-text)" }}> {value}</span>;
}
