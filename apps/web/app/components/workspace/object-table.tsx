"use client";

import { useState, useMemo } from "react";

// --- Types ---

type Field = {
  id: string;
  name: string;
  type: string;
  enum_values?: string[];
  enum_colors?: string[];
  enum_multiple?: boolean;
  related_object_id?: string;
  relationship_type?: string;
  related_object_name?: string;
  sort_order?: number;
};

type ReverseRelation = {
  fieldName: string;
  sourceObjectName: string;
  sourceObjectId: string;
  displayField: string;
  entries: Record<string, Array<{ id: string; label: string }>>;
};

type ObjectTableProps = {
  objectName: string;
  fields: Field[];
  entries: Record<string, unknown>[];
  members?: Array<{ id: string; name: string }>;
  relationLabels?: Record<string, Record<string, string>>;
  reverseRelations?: ReverseRelation[];
  onNavigateToObject?: (objectName: string) => void;
  onEntryClick?: (entryId: string) => void;
};

// --- Helpers ---

function parseRelationValue(value: string | null | undefined): string[] {
  if (!value) {return [];}
  const trimmed = value.trim();
  if (!trimmed) {return [];}
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {return parsed.map(String).filter(Boolean);}
    } catch {
      // not valid JSON
    }
  }
  return [trimmed];
}

// --- Sort helpers ---

type SortState = {
  column: string;
  direction: "asc" | "desc";
} | null;

function SortIcon({ active, direction }: { active: boolean; direction: "asc" | "desc" }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ opacity: active ? 1 : 0.3 }}
    >
      {direction === "asc" ? (
        <path d="m5 12 7-7 7 7" />
      ) : (
        <path d="m19 12-7 7-7-7" />
      )}
    </svg>
  );
}

// --- Cell Renderers ---

function EnumBadge({
  value,
  enumValues,
  enumColors,
}: {
  value: string;
  enumValues?: string[];
  enumColors?: string[];
}) {
  const idx = enumValues?.indexOf(value) ?? -1;
  const color = idx >= 0 && enumColors ? enumColors[idx] : "#94a3b8";

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
      style={{
        background: `${color}20`,
        color: color,
        border: `1px solid ${color}40`,
      }}
    >
      {value}
    </span>
  );
}

function BooleanCell({ value }: { value: unknown }) {
  const isTrue =
    value === true || value === "true" || value === "1" || value === "yes";
  return (
    <span style={{ color: isTrue ? "#22c55e" : "var(--color-text-muted)" }}>
      {isTrue ? "Yes" : "No"}
    </span>
  );
}

function UserCell({
  value,
  members,
}: {
  value: unknown;
  members?: Array<{ id: string; name: string }>;
}) {
  const memberId = String(value);
  const member = members?.find((m) => m.id === memberId);
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium flex-shrink-0"
        style={{
          background: "var(--color-accent)",
          color: "white",
        }}
      >
        {(member?.name ?? memberId).charAt(0).toUpperCase()}
      </span>
      <span className="truncate">{member?.name ?? memberId}</span>
    </span>
  );
}

/** Inline link icon (small arrow) for relation chips. */
function LinkIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-shrink-0"
      style={{ opacity: 0.5 }}
    >
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </svg>
  );
}

/** A single relation chip showing a display label with an optional link icon. */
function RelationChip({
  label,
  objectName,
  onNavigate,
}: {
  label: string;
  objectName?: string;
  onNavigate?: (objectName: string) => void;
}) {
  const handleClick = objectName && onNavigate
    ? (e: React.MouseEvent) => {
        e.stopPropagation();
        onNavigate(objectName);
      }
    : undefined;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${handleClick ? "cursor-pointer" : ""}`}
      style={{
        background: "rgba(96, 165, 250, 0.1)",
        color: "#60a5fa",
        border: "1px solid rgba(96, 165, 250, 0.2)",
        maxWidth: "200px",
      }}
      onClick={handleClick}
      title={label}
    >
      <LinkIcon />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Render a relation field cell with resolved display labels. */
function RelationCell({
  value,
  field,
  relationLabels,
  onNavigate,
}: {
  value: unknown;
  field: Field;
  relationLabels?: Record<string, Record<string, string>>;
  onNavigate?: (objectName: string) => void;
}) {
  const fieldLabels = relationLabels?.[field.name];
  const ids = parseRelationValue(String(value));

  if (ids.length === 0) {
    return (
      <span style={{ color: "var(--color-text-muted)", opacity: 0.5 }}>
        --
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 flex-wrap">
      {ids.map((id) => (
        <RelationChip
          key={id}
          label={fieldLabels?.[id] ?? id}
          objectName={field.related_object_name}
          onNavigate={onNavigate}
        />
      ))}
    </span>
  );
}

/** Render a reverse relation cell (incoming links from another object). */
function ReverseRelationCell({
  links,
  sourceObjectName,
  onNavigate,
}: {
  links: Array<{ id: string; label: string }>;
  sourceObjectName: string;
  onNavigate?: (objectName: string) => void;
}) {
  if (!links || links.length === 0) {
    return (
      <span style={{ color: "var(--color-text-muted)", opacity: 0.5 }}>
        --
      </span>
    );
  }

  const displayLinks = links.slice(0, 5);
  const overflow = links.length - displayLinks.length;

  return (
    <span className="flex items-center gap-1 flex-wrap">
      {displayLinks.map((link) => (
        <RelationChip
          key={link.id}
          label={link.label}
          objectName={sourceObjectName}
          onNavigate={onNavigate}
        />
      ))}
      {overflow > 0 && (
        <span
          className="text-xs px-1.5 py-0.5 rounded"
          style={{ color: "var(--color-text-muted)" }}
        >
          +{overflow} more
        </span>
      )}
    </span>
  );
}

function CellValue({
  value,
  field,
  members,
  relationLabels,
  onNavigate,
}: {
  value: unknown;
  field: Field;
  members?: Array<{ id: string; name: string }>;
  relationLabels?: Record<string, Record<string, string>>;
  onNavigate?: (objectName: string) => void;
}) {
  if (value === null || value === undefined || value === "") {
    return (
      <span style={{ color: "var(--color-text-muted)", opacity: 0.5 }}>
        --
      </span>
    );
  }

  switch (field.type) {
    case "enum":
      return (
        <EnumBadge
          value={String(value)}
          enumValues={field.enum_values}
          enumColors={field.enum_colors}
        />
      );
    case "boolean":
      return <BooleanCell value={value} />;
    case "user":
      return <UserCell value={value} members={members} />;
    case "relation":
      return (
        <RelationCell
          value={value}
          field={field}
          relationLabels={relationLabels}
          onNavigate={onNavigate}
        />
      );
    case "email":
      return (
        <a
          href={`mailto:${value}`}
          className="underline underline-offset-2"
          style={{ color: "#60a5fa" }}
        >
          {String(value)}
        </a>
      );
    case "date":
      return <span>{String(value)}</span>;
    case "number":
      return <span className="tabular-nums">{String(value)}</span>;
    default:
      return <span className="truncate block max-w-[300px]">{String(value)}</span>;
  }
}

// --- Table Component ---

export function ObjectTable({
  objectName,
  fields,
  entries,
  members,
  relationLabels,
  reverseRelations,
  onNavigateToObject,
  onEntryClick,
}: ObjectTableProps) {
  const [sort, setSort] = useState<SortState>(null);

  const handleSort = (column: string) => {
    setSort((prev) => {
      if (prev?.column === column) {
        return prev.direction === "asc"
          ? { column, direction: "desc" }
          : null;
      }
      return { column, direction: "asc" };
    });
  };

  const sortedEntries = useMemo(() => {
    if (!sort) {return entries;}
    return [...entries].toSorted((a, b) => {
      const aVal = String(a[sort.column] ?? "");
      const bVal = String(b[sort.column] ?? "");
      const cmp = aVal.localeCompare(bVal, undefined, { numeric: true });
      return sort.direction === "asc" ? cmp : -cmp;
    });
  }, [entries, sort]);

  // Filter out reverse relations with no actual data
  const activeReverseRelations = useMemo(() => {
    if (!reverseRelations) {return [];}
    return reverseRelations.filter(
      (rr) => Object.keys(rr.entries).length > 0,
    );
  }, [reverseRelations]);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-text-muted)", opacity: 0.4 }}>
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="M3 9h18" /><path d="M3 15h18" /><path d="M9 3v18" />
        </svg>
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          No entries in <span className="font-medium" style={{ color: "var(--color-text)" }}>{objectName}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
        <thead>
          <tr>
            {/* Regular field columns */}
            {fields.map((field) => (
              <th
                key={field.id}
                className="text-left px-3 py-2.5 font-medium text-xs uppercase tracking-wider cursor-pointer select-none whitespace-nowrap border-b"
                style={{
                  color: "var(--color-text-muted)",
                  borderColor: "var(--color-border)",
                  background: "var(--color-surface)",
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                }}
                onClick={() => handleSort(field.name)}
              >
                <span className="flex items-center gap-1">
                  {field.name}
                  {field.type === "relation" && field.related_object_name && (
                    <span
                      className="text-[9px] font-normal normal-case tracking-normal opacity-60"
                      title={`Links to ${field.related_object_name}`}
                    >
                      ({field.related_object_name})
                    </span>
                  )}
                  <SortIcon
                    active={sort?.column === field.name}
                    direction={sort?.column === field.name ? sort.direction : "asc"}
                  />
                </span>
              </th>
            ))}

            {/* Reverse relation columns */}
            {activeReverseRelations.map((rr) => (
              <th
                key={`rev_${rr.sourceObjectName}_${rr.fieldName}`}
                className="text-left px-3 py-2.5 font-medium text-xs uppercase tracking-wider whitespace-nowrap border-b"
                style={{
                  color: "var(--color-text-muted)",
                  borderColor: "var(--color-border)",
                  background: "var(--color-surface)",
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                }}
              >
                <span className="flex items-center gap-1.5">
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ opacity: 0.4 }}
                  >
                    <path d="m12 19-7-7 7-7" />
                    <path d="M19 12H5" />
                  </svg>
                  <span className="capitalize">{rr.sourceObjectName}</span>
                  <span className="text-[9px] font-normal normal-case tracking-normal opacity-50">
                    via {rr.fieldName}
                  </span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedEntries.map((entry, idx) => (
            <tr
              key={String(entry.entry_id ?? idx)}
              className={`transition-colors duration-75 ${onEntryClick ? "cursor-pointer" : ""}`}
              style={{
                background:
                  idx % 2 === 0 ? "transparent" : "var(--color-surface)",
              }}
              onClick={() => {
                const eid = String(entry.entry_id ?? "");
                if (eid && onEntryClick) {onEntryClick(eid);}
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background =
                  "var(--color-surface-hover)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background =
                  idx % 2 === 0 ? "transparent" : "var(--color-surface)";
              }}
            >
              {/* Regular field cells */}
              {fields.map((field) => (
                <td
                  key={field.id}
                  className="px-3 py-2 border-b whitespace-nowrap"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <CellValue
                    value={entry[field.name]}
                    field={field}
                    members={members}
                    relationLabels={relationLabels}
                    onNavigate={onNavigateToObject}
                  />
                </td>
              ))}

              {/* Reverse relation cells */}
              {activeReverseRelations.map((rr) => {
                const entryId = String(entry.entry_id ?? "");
                const links = rr.entries[entryId] ?? [];
                return (
                  <td
                    key={`rev_${rr.sourceObjectName}_${rr.fieldName}`}
                    className="px-3 py-2 border-b whitespace-nowrap"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    <ReverseRelationCell
                      links={links}
                      sourceObjectName={rr.sourceObjectName}
                      onNavigate={onNavigateToObject}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
