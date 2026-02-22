"use client";

type BreadcrumbsProps = {
  path: string;
  onNavigate: (path: string) => void;
};

export function Breadcrumbs({ path, onNavigate }: BreadcrumbsProps) {
  const isAbsolute = path.startsWith("/");
  const segments = path.split("/").filter(Boolean);

  return (
    <nav className="flex items-center gap-1 text-xs md:text-sm py-2 overflow-x-auto min-w-0">
      <button
        type="button"
        onClick={() => onNavigate("")}
        className="px-1.5 py-0.5 rounded transition-colors cursor-pointer"
        style={{ color: "var(--color-text-muted)" }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.color = "var(--color-text)";
          (e.currentTarget as HTMLElement).style.background =
            "var(--color-surface-hover)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.color =
            "var(--color-text-muted)";
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }}
      >
        All Chats
      </button>

      {segments.map((segment, idx) => {
        const partialPath = (isAbsolute ? "/" : "") + segments.slice(0, idx + 1).join("/");
        const isLast = idx === segments.length - 1;

        return (
          <span key={partialPath} className="flex items-center gap-1">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--color-text-muted)", opacity: 0.4 }}
            >
              <path d="m9 18 6-6-6-6" />
            </svg>

            {isLast ? (
              <span
                className="px-1.5 py-0.5"
                style={{ color: "var(--color-text)" }}
              >
                {segment.replace(/\.md$/, "")}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(partialPath)}
                className="px-1.5 py-0.5 rounded transition-colors cursor-pointer"
                style={{ color: "var(--color-text-muted)" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.color =
                    "var(--color-text)";
                  (e.currentTarget as HTMLElement).style.background =
                    "var(--color-surface-hover)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.color =
                    "var(--color-text-muted)";
                  (e.currentTarget as HTMLElement).style.background =
                    "transparent";
                }}
              >
                {segment}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
