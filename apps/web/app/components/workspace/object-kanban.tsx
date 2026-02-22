"use client";

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";

type Field = {
  id: string;
  name: string;
  type: string;
  enum_values?: string[];
  enum_colors?: string[];
  related_object_name?: string;
};

type Status = {
  id: string;
  name: string;
  color?: string;
  sort_order?: number;
};

type ObjectKanbanProps = {
  objectName: string;
  fields: Field[];
  entries: Record<string, unknown>[];
  statuses: Status[];
  members?: Array<{ id: string; name: string }>;
  relationLabels?: Record<string, Record<string, string>>;
  onEntryClick?: (entryId: string) => void;
  onRefresh?: () => void;
};

// --- Helpers ---

/** Safely convert unknown (DuckDB) value to string for display. */
function safeString(val: unknown): string {
	if (val == null) {return "";}
	if (typeof val === "object") {return JSON.stringify(val);}
	if (typeof val === "string") {return val;}
	if (typeof val === "number" || typeof val === "boolean" || typeof val === "bigint") {return String(val);}
	return "";
}

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

function getEntryTitle(entry: Record<string, unknown>, fields: Field[]): string {
  const titleField = fields.find(
    (f) =>
      f.name.toLowerCase().includes("name") ||
      f.name.toLowerCase().includes("title"),
  );
  return titleField
    ? safeString(entry[titleField.name]) || "Untitled"
    : safeString(entry[fields[0]?.name]) || "Untitled";
}

// --- Draggable Card ---

function DraggableCard({
  entry,
  fields,
  members,
  relationLabels,
  onEntryClick,
}: {
  entry: Record<string, unknown>;
  fields: Field[];
  members?: Array<{ id: string; name: string }>;
  relationLabels?: Record<string, Record<string, string>>;
  onEntryClick?: (entryId: string) => void;
}) {
  const entryId = safeString(entry.entry_id) || "";
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: entryId,
    data: { entry },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        // Only open if not dragging
        if (!isDragging && onEntryClick) {
          e.stopPropagation();
          onEntryClick(entryId);
        }
      }}
      className="rounded-lg p-3 mb-2 transition-all duration-100 cursor-grab active:cursor-grabbing select-none"
      style={{
        background: "var(--color-surface)",
        border: `1px solid ${isDragging ? "var(--color-accent)" : "var(--color-border)"}`,
        opacity: isDragging ? 0.4 : 1,
        transform: isDragging ? "scale(1.02)" : undefined,
      }}
    >
      <CardContent
        entry={entry}
        fields={fields}
        members={members}
        relationLabels={relationLabels}
      />
    </div>
  );
}

// --- Card content (shared between draggable + overlay) ---

function CardContent({
  entry,
  fields,
  members,
  relationLabels,
}: {
  entry: Record<string, unknown>;
  fields: Field[];
  members?: Array<{ id: string; name: string }>;
  relationLabels?: Record<string, Record<string, string>>;
}) {
  const title = getEntryTitle(entry, fields);

  const displayFields = fields
    .filter(
      (f) =>
        f.type !== "richtext" &&
        entry[f.name] !== null &&
        entry[f.name] !== undefined &&
        entry[f.name] !== "",
    )
    .slice(0, 4);

  const titleField = fields.find(
    (f) =>
      f.name.toLowerCase().includes("name") ||
      f.name.toLowerCase().includes("title"),
  );

  return (
    <>
      <div
        className="text-sm font-medium mb-1.5 truncate"
        style={{ color: "var(--color-text)" }}
      >
        {title}
      </div>
      <div className="space-y-1">
        {displayFields
          .filter((f) => f !== titleField)
          .slice(0, 3)
          .map((field) => {
            const val = entry[field.name];
            if (!val) {return null;}

            let displayVal = safeString(val);
            if (field.type === "user") {
              const member = members?.find((m) => m.id === displayVal);
              if (member) {displayVal = member.name;}
            } else if (field.type === "relation") {
              const fieldLabels = relationLabels?.[field.name];
              const ids = parseRelationValue(displayVal);
              const labels = ids.map((id) => fieldLabels?.[id] ?? id);
              displayVal = labels.join(", ");
            }

            return (
              <div key={field.id} className="flex items-center gap-1.5 text-xs">
                <span style={{ color: "var(--color-text-muted)" }}>
                  {field.name}:
                </span>
                {field.type === "enum" ? (
                  <EnumBadgeMini
                    value={safeString(val)}
                    enumValues={field.enum_values}
                    enumColors={field.enum_colors}
                  />
                ) : field.type === "relation" ? (
                  <span
                    className="truncate inline-flex items-center gap-0.5"
                    style={{ color: "#60a5fa" }}
                  >
                    <svg
                      width="8"
                      height="8"
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
                    {displayVal}
                  </span>
                ) : (
                  <span
                    className="truncate"
                    style={{ color: "var(--color-text)" }}
                  >
                    {displayVal}
                  </span>
                )}
              </div>
            );
          })}
      </div>
    </>
  );
}

function EnumBadgeMini({
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
      className="inline-flex items-center px-1.5 py-0 rounded text-[11px] font-medium"
      style={{
        background: `${color}20`,
        color: color,
      }}
    >
      {value}
    </span>
  );
}

// --- Droppable Column ---

function DroppableColumn({
  columnName,
  color,
  items,
  cardFields,
  members,
  relationLabels,
  onEntryClick,
  isOver,
  groupFieldId,
  objectName,
  onRefresh,
}: {
  columnName: string;
  color: string;
  items: Record<string, unknown>[];
  cardFields: Field[];
  members?: Array<{ id: string; name: string }>;
  relationLabels?: Record<string, Record<string, string>>;
  onEntryClick?: (entryId: string) => void;
  isOver: boolean;
  groupFieldId?: string;
  objectName: string;
  onRefresh?: () => void;
}) {
  const { setNodeRef } = useDroppable({ id: `column:${columnName}` });
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(columnName);
  const [renaming, setRenaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingName && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingName]);

  const handleRename = useCallback(async () => {
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === columnName || !groupFieldId) {
      setEditingName(false);
      setNameValue(columnName);
      return;
    }

    setRenaming(true);
    try {
      const res = await fetch(
        `/api/workspace/objects/${encodeURIComponent(objectName)}/fields/${encodeURIComponent(groupFieldId)}/enum-rename`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldValue: columnName, newValue: trimmed }),
        },
      );
      if (res.ok) {
        onRefresh?.();
      } else {
        setNameValue(columnName);
      }
    } catch {
      setNameValue(columnName);
    } finally {
      setRenaming(false);
      setEditingName(false);
    }
  }, [nameValue, columnName, groupFieldId, objectName, onRefresh]);

  return (
    <div
      ref={setNodeRef}
      className="flex-shrink-0 flex flex-col rounded-xl transition-colors duration-150"
      style={{
        width: "280px",
        background: isOver ? "var(--color-surface)" : "var(--color-bg)",
        border: `1px solid ${isOver ? "var(--color-accent)" : "var(--color-border)"}`,
      }}
    >
      {/* Column header */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        <span
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ background: color }}
        />
        {editingName ? (
          <input
            ref={inputRef}
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {void handleRename();}
              if (e.key === "Escape") {
                setNameValue(columnName);
                setEditingName(false);
              }
            }}
            disabled={renaming}
            className="text-sm font-medium flex-1 bg-transparent outline-none rounded px-1 -mx-1"
            style={{
              color: "var(--color-text)",
              border: "1px solid var(--color-accent)",
            }}
          />
        ) : (
          <span
            className="text-sm font-medium flex-1 cursor-text rounded px-1 -mx-1 hover:bg-[var(--color-surface-hover)] transition-colors"
            style={{ color: "var(--color-text)" }}
            onDoubleClick={() => {
              if (groupFieldId) {
                setNameValue(columnName);
                setEditingName(true);
              }
            }}
            title={groupFieldId ? "Double-click to rename" : undefined}
          >
            {columnName}
          </span>
        )}
        <span
          className="text-xs px-1.5 py-0.5 rounded-full"
          style={{
            background: "var(--color-surface)",
            color: "var(--color-text-muted)",
          }}
        >
          {items.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2" style={{ minHeight: "80px" }}>
        {items.length === 0 ? (
          <div
            className="flex items-center justify-center py-8 rounded-lg border border-dashed text-xs transition-colors"
            style={{
              borderColor: isOver ? "var(--color-accent)" : "var(--color-border)",
              color: isOver ? "var(--color-accent)" : "var(--color-text-muted)",
            }}
          >
            {isOver ? "Drop here" : "No entries"}
          </div>
        ) : (
          items.map((entry, idx) => (
            <DraggableCard
              key={safeString(entry.entry_id) || String(idx)}
              entry={entry}
              fields={cardFields}
              members={members}
              relationLabels={relationLabels}
              onEntryClick={onEntryClick}
            />
          ))
        )}
      </div>
    </div>
  );
}

// --- Kanban Board ---

export function ObjectKanban({
  objectName,
  fields,
  entries,
  statuses,
  members,
  relationLabels,
  onEntryClick,
  onRefresh,
}: ObjectKanbanProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);
  // Optimistic local entries for instant drag feedback
  const [localEntries, setLocalEntries] = useState(entries);

  // Sync when parent entries change
  useEffect(() => {
    setLocalEntries(entries);
  }, [entries]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  // Find the grouping field
  const groupField = useMemo(() => {
    const statusField = fields.find(
      (f) =>
        f.type === "enum" &&
        f.name.toLowerCase().includes("status"),
    );
    if (statusField) {return statusField;}
    return fields.find((f) => f.type === "enum") ?? null;
  }, [fields]);

  // Determine columns
  const columns = useMemo(() => {
    if (statuses.length > 0) {
      return statuses.map((s) => ({
        name: s.name,
        color: s.color ?? "#94a3b8",
      }));
    }
    if (groupField?.enum_values) {
      return groupField.enum_values.map((v, i) => ({
        name: v,
        color: groupField.enum_colors?.[i] ?? "#94a3b8",
      }));
    }
    const unique = new Set<string>();
    for (const e of localEntries) {
      const val = groupField ? e[groupField.name] : undefined;
      if (val) {unique.add(safeString(val));}
    }
    return Array.from(unique).map((v) => ({ name: v, color: "#94a3b8" }));
  }, [statuses, groupField, localEntries]);

  // Group entries by column
  const grouped = useMemo(() => {
    const groups: Record<string, Record<string, unknown>[]> = {};
    for (const col of columns) {groups[col.name] = [];}
    groups["_ungrouped"] = [];

    for (const entry of localEntries) {
      const val = groupField ? safeString(entry[groupField.name]) : "";
      if (groups[val]) {
        groups[val].push(entry);
      } else {
        groups["_ungrouped"].push(entry);
      }
    }
    return groups;
  }, [columns, localEntries, groupField]);

  const cardFields = fields.filter((f) => f !== groupField);

  // Active drag entry for overlay
  const activeEntry = useMemo(() => {
    if (!activeId) {return null;}
    return localEntries.find((e) => String(e.entry_id) === activeId) ?? null;
  }, [activeId, localEntries]);

  // Handle drag start
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  // Track which column is being hovered
  const handleDragOver = useCallback((event: { over: { id: string | number } | null }) => {
    const overId = event.over?.id ? String(event.over.id) : null;
    if (overId?.startsWith("column:")) {
      setOverColumnId(overId.replace("column:", ""));
    } else {
      setOverColumnId(null);
    }
  }, []);

  // Handle drag end - move card to new column
  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveId(null);
      setOverColumnId(null);

      const { active, over } = event;
      if (!over || !groupField) {return;}

      const overId = String(over.id);
      if (!overId.startsWith("column:")) {return;}

      const targetColumn = overId.replace("column:", "");
      const entryId = String(active.id);
      const entry = localEntries.find((e) => String(e.entry_id) === entryId);
      if (!entry) {return;}

      const currentValue = safeString(entry[groupField.name]);
      if (currentValue === targetColumn) {return;}

      // Optimistic update
      setLocalEntries((prev) =>
        prev.map((e) =>
          String(e.entry_id) === entryId
            ? { ...e, [groupField.name]: targetColumn }
            : e,
        ),
      );

      // Persist via API
      try {
        const res = await fetch(
          `/api/workspace/objects/${encodeURIComponent(objectName)}/entries/${encodeURIComponent(entryId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields: { [groupField.name]: targetColumn } }),
          },
        );
        if (res.ok) {
          onRefresh?.();
        } else {
          // Revert on failure
          setLocalEntries((prev) =>
            prev.map((e) =>
              String(e.entry_id) === entryId
                ? { ...e, [groupField.name]: currentValue }
                : e,
            ),
          );
        }
      } catch {
        // Revert on error
        setLocalEntries((prev) =>
          prev.map((e) =>
            String(e.entry_id) === entryId
              ? { ...e, [groupField.name]: currentValue }
              : e,
          ),
        );
      }
    },
    [groupField, localEntries, objectName, onRefresh],
  );

  if (!groupField) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          No enum field found for kanban grouping in{" "}
          <span className="font-medium" style={{ color: "var(--color-text)" }}>
            {objectName}
          </span>
        </p>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div
        className="flex gap-4 overflow-x-auto pb-4 px-1"
        style={{ minHeight: "400px" }}
      >
        {columns.map((col) => (
          <DroppableColumn
            key={col.name}
            columnName={col.name}
            color={col.color}
            items={grouped[col.name] ?? []}
            cardFields={cardFields}
            members={members}
            relationLabels={relationLabels}
            onEntryClick={onEntryClick}
            isOver={overColumnId === col.name}
            groupFieldId={groupField.id}
            objectName={objectName}
            onRefresh={onRefresh}
          />
        ))}

        {/* Ungrouped entries */}
        {grouped["_ungrouped"]?.length > 0 && (
          <div
            className="flex-shrink-0 flex flex-col rounded-xl"
            style={{
              width: "280px",
              background: "var(--color-bg)",
              border: "1px dashed var(--color-border)",
            }}
          >
            <div
              className="flex items-center gap-2 px-3 py-2.5 border-b"
              style={{ borderColor: "var(--color-border)" }}
            >
              <span
                className="text-sm font-medium"
                style={{ color: "var(--color-text-muted)" }}
              >
                Ungrouped
              </span>
              <span
                className="text-xs px-1.5 py-0.5 rounded-full"
                style={{
                  background: "var(--color-surface)",
                  color: "var(--color-text-muted)",
                }}
              >
                {grouped["_ungrouped"].length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {grouped["_ungrouped"].map((entry, idx) => (
                <DraggableCard
                  key={safeString(entry.entry_id) || String(idx)}
                  entry={entry}
                  fields={cardFields}
                  members={members}
                  relationLabels={relationLabels}
                  onEntryClick={onEntryClick}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Drag overlay - floating card that follows cursor */}
      <DragOverlay dropAnimation={null}>
        {activeEntry ? (
          <div
            className="rounded-lg p-3 shadow-xl"
            style={{
              width: "260px",
              background: "var(--color-surface)",
              border: "1px solid var(--color-accent)",
              transform: "rotate(2deg)",
            }}
          >
            <CardContent
              entry={activeEntry}
              fields={cardFields}
              members={members}
              relationLabels={relationLabels}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
