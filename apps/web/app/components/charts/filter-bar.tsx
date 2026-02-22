"use client";

import { useEffect, useState, useCallback } from "react";
import type { FilterConfig, FilterState, FilterValue } from "./types";

type FilterBarProps = {
  filters: FilterConfig[];
  value: FilterState;
  onChange: (state: FilterState) => void;
};

// --- Icons ---

function FilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" /><path d="m6 6 12 12" />
    </svg>
  );
}

// --- Individual filter components ---

function DateRangeFilter({
  filter,
  value,
  onChange,
}: {
  filter: FilterConfig;
  value: FilterValue | undefined;
  onChange: (v: FilterValue) => void;
}) {
  const current = value?.type === "dateRange" ? value : { type: "dateRange" as const };

  return (
    <div className="flex items-center gap-1.5">
      <label className="text-[11px] whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
        {filter.label}
      </label>
      <input
        type="date"
        value={current.from ?? ""}
        onChange={(e) => onChange({ ...current, from: e.target.value || undefined })}
        className="px-2 py-1 rounded-md text-[11px] outline-none"
        style={{
          background: "var(--color-bg)",
          border: "1px solid var(--color-border)",
          color: "var(--color-text)",
          colorScheme: "dark",
        }}
      />
      <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>to</span>
      <input
        type="date"
        value={current.to ?? ""}
        onChange={(e) => onChange({ ...current, to: e.target.value || undefined })}
        className="px-2 py-1 rounded-md text-[11px] outline-none"
        style={{
          background: "var(--color-bg)",
          border: "1px solid var(--color-border)",
          color: "var(--color-text)",
          colorScheme: "dark",
        }}
      />
    </div>
  );
}

function SelectFilter({
  filter,
  value,
  onChange,
  options,
}: {
  filter: FilterConfig;
  value: FilterValue | undefined;
  onChange: (v: FilterValue) => void;
  options: string[];
}) {
  const current = value?.type === "select" ? value.value : undefined;

  return (
    <div className="flex items-center gap-1.5">
      <label className="text-[11px] whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
        {filter.label}
      </label>
      <select
        value={current ?? ""}
        onChange={(e) => onChange({ type: "select", value: e.target.value || undefined })}
        className="px-2 py-1 rounded-md text-[11px] outline-none cursor-pointer"
        style={{
          background: "var(--color-bg)",
          border: "1px solid var(--color-border)",
          color: "var(--color-text)",
          minWidth: 100,
        }}
      >
        <option value="">All</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}

function MultiSelectFilter({
  filter,
  value,
  onChange,
  options,
}: {
  filter: FilterConfig;
  value: FilterValue | undefined;
  onChange: (v: FilterValue) => void;
  options: string[];
}) {
  const current = value?.type === "multiSelect" ? (value.values ?? []) : [];

  const toggleOption = (opt: string) => {
    const next = current.includes(opt)
      ? current.filter((v) => v !== opt)
      : [...current, opt];
    onChange({ type: "multiSelect", values: next.length > 0 ? next : undefined });
  };

  return (
    <div className="flex items-center gap-1.5">
      <label className="text-[11px] whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
        {filter.label}
      </label>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => {
          const selected = current.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggleOption(opt)}
              className="px-2 py-0.5 rounded-full text-[10px] transition-colors cursor-pointer"
              style={{
                background: selected ? "var(--color-accent-light)" : "var(--color-surface)",
                border: `1px solid ${selected ? "var(--color-accent)" : "var(--color-border)"}`,
                color: selected ? "var(--color-accent)" : "var(--color-text-muted)",
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NumberFilter({
  filter,
  value,
  onChange,
}: {
  filter: FilterConfig;
  value: FilterValue | undefined;
  onChange: (v: FilterValue) => void;
}) {
  const current = value?.type === "number" ? value : { type: "number" as const };

  return (
    <div className="flex items-center gap-1.5">
      <label className="text-[11px] whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
        {filter.label}
      </label>
      <input
        type="number"
        placeholder="Min"
        value={current.min ?? ""}
        onChange={(e) => onChange({ ...current, min: e.target.value ? Number(e.target.value) : undefined })}
        className="px-2 py-1 rounded-md text-[11px] outline-none w-20"
        style={{
          background: "var(--color-bg)",
          border: "1px solid var(--color-border)",
          color: "var(--color-text)",
        }}
      />
      <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>to</span>
      <input
        type="number"
        placeholder="Max"
        value={current.max ?? ""}
        onChange={(e) => onChange({ ...current, max: e.target.value ? Number(e.target.value) : undefined })}
        className="px-2 py-1 rounded-md text-[11px] outline-none w-20"
        style={{
          background: "var(--color-bg)",
          border: "1px solid var(--color-border)",
          color: "var(--color-text)",
        }}
      />
    </div>
  );
}

// --- Main FilterBar ---

export function FilterBar({ filters, value, onChange }: FilterBarProps) {
  // Fetch options for select/multiSelect filters
  const [optionsMap, setOptionsMap] = useState<Record<string, string[]>>({});

  const fetchOptions = useCallback(async () => {
    const toFetch = filters.filter(
      (f) => (f.type === "select" || f.type === "multiSelect") && f.sql,
    );
    if (toFetch.length === 0) {return;}

    const results: Record<string, string[]> = {};
    await Promise.all(
      toFetch.map(async (f) => {
        try {
          const res = await fetch("/api/workspace/reports/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sql: f.sql }),
          });
          if (!res.ok) {return;}
          const data = await res.json();
          const rows: Record<string, unknown>[] = data.rows ?? [];
          // Extract the first column's values as options
          const opts = rows
            .map((r) => {
              const vals = Object.values(r);
              const v = vals[0];
              if (v == null) {return null;}
              if (typeof v === "object") {return JSON.stringify(v);}
              // eslint-disable-next-line @typescript-eslint/no-base-to-string -- v narrowed, object handled above
              return typeof v === "string" ? v : (typeof v === "number" || typeof v === "boolean" ? String(v) : String(v));
            })
            .filter((v): v is string => v !== null);
          results[f.id] = opts;
        } catch {
          // skip failed option fetches
        }
      }),
    );
    setOptionsMap(results);
  }, [filters]);

  useEffect(() => {
    void fetchOptions();
  }, [fetchOptions]);

  const handleFilterChange = useCallback(
    (filterId: string, v: FilterValue) => {
      onChange({ ...value, [filterId]: v });
    },
    [value, onChange],
  );

  const hasActiveFilters = Object.values(value).some((v) => {
    if (!v) {return false;}
    if (v.type === "dateRange") {return v.from || v.to;}
    if (v.type === "select") {return v.value;}
    if (v.type === "multiSelect") {return v.values && v.values.length > 0;}
    if (v.type === "number") {return v.min !== undefined || v.max !== undefined;}
    return false;
  });

  const clearFilters = () => onChange({});

  if (filters.length === 0) {return null;}

  return (
    <div
      className="flex items-center gap-4 px-4 py-2.5 border-b flex-wrap"
      style={{ borderColor: "var(--color-border)" }}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
        <FilterIcon />
        Filters
      </span>

      {filters.map((filter) => {
        const fv = value[filter.id];
        switch (filter.type) {
          case "dateRange":
            return (
              <DateRangeFilter
                key={filter.id}
                filter={filter}
                value={fv}
                onChange={(v) => handleFilterChange(filter.id, v)}
              />
            );
          case "select":
            return (
              <SelectFilter
                key={filter.id}
                filter={filter}
                value={fv}
                onChange={(v) => handleFilterChange(filter.id, v)}
                options={optionsMap[filter.id] ?? []}
              />
            );
          case "multiSelect":
            return (
              <MultiSelectFilter
                key={filter.id}
                filter={filter}
                value={fv}
                onChange={(v) => handleFilterChange(filter.id, v)}
                options={optionsMap[filter.id] ?? []}
              />
            );
          case "number":
            return (
              <NumberFilter
                key={filter.id}
                filter={filter}
                value={fv}
                onChange={(v) => handleFilterChange(filter.id, v)}
              />
            );
          default:
            return null;
        }
      })}

      {hasActiveFilters && (
        <button
          type="button"
          onClick={clearFilters}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] transition-colors cursor-pointer"
          style={{
            color: "var(--color-accent)",
            background: "var(--color-accent-light)",
          }}
        >
          <XIcon />
          Clear
        </button>
      )}
    </div>
  );
}
