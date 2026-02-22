"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  FunnelChart,
  Funnel,
  LabelList,
} from "recharts";
import type { PanelConfig } from "./types";

// --- Color palette derived from CSS variables + accessible defaults ---

const CHART_PALETTE = [
  "#2563eb", // accent
  "#60a5fa", // blue
  "#22c55e", // green
  "#f59e0b", // amber
  "#c084fc", // purple
  "#fb923c", // orange
  "#14b8a6", // teal
  "#f43f5e", // rose
  "#a78bfa", // violet
  "#38bdf8", // sky
];

type ChartPanelProps = {
  config: PanelConfig;
  data: Record<string, unknown>[];
  /** Compact mode for inline chat cards */
  compact?: boolean;
};

// --- Shared tooltip/axis styles ---

const axisStyle = {
  fontSize: 11,
  fill: "var(--color-text-muted)",
};

const gridStyle = {
  stroke: "var(--color-border-strong)",
  strokeDasharray: "3 3",
};

function tooltipStyle() {
  return {
    contentStyle: {
      background: "var(--color-surface)",
      border: "1px solid var(--color-border)",
      borderRadius: 8,
      fontSize: 12,
      color: "var(--color-text)",
    },
    itemStyle: { color: "var(--color-text)" },
    labelStyle: { color: "var(--color-text-muted)", marginBottom: 4 },
  };
}

// --- Formatters ---

/** Safe string conversion for chart values (handles objects via JSON.stringify). */
function toDisplayStr(val: unknown): string {
  if (val == null) {return "";}
  if (typeof val === "object") {return JSON.stringify(val);}
  if (typeof val === "string") {return val;}
  if (typeof val === "number" || typeof val === "boolean") {return String(val);}
  // symbol, bigint, function — val is narrowed (object already handled above)
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(val);
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) {return "";}
  if (typeof val === "object") {return JSON.stringify(val);}
  if (typeof val === "number") {
    if (Math.abs(val) >= 1_000_000) {return `${(val / 1_000_000).toFixed(1)}M`;}
    if (Math.abs(val) >= 1_000) {return `${(val / 1_000).toFixed(1)}K`;}
    return Number.isInteger(val) ? String(val) : val.toFixed(2);
  }
  return toDisplayStr(val);
}

function formatLabel(val: unknown): string {
  if (val === null || val === undefined) {return "";}
  const str = toDisplayStr(val);
  // Truncate long date strings
  if (str.length > 16 && !isNaN(Date.parse(str))) {
    return str.slice(0, 10);
  }
  // Truncate long labels
  if (str.length > 20) {return str.slice(0, 18) + "...";}
  return str;
}

// --- Chart renderers ---

function CartesianChart({
  config,
  data,
  compact,
  ChartComponent,
  SeriesComponent,
  areaProps,
}: {
  config: PanelConfig;
  data: Record<string, unknown>[];
  compact?: boolean;
  ChartComponent: typeof BarChart    ;
  SeriesComponent: typeof Bar | typeof Line | typeof Area;
  areaProps?: Record<string, unknown>;
}) {
  const { mapping } = config;
  const xKey = mapping.xAxis ?? Object.keys(data[0] ?? {})[0] ?? "x";
  const yKeys = mapping.yAxis ?? Object.keys(data[0] ?? {}).filter((k) => k !== xKey);
  const colors = mapping.colors ?? CHART_PALETTE;
  const height = compact ? 200 : 320;
  const ttStyle = tooltipStyle();

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ChartComponent data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid {...gridStyle} />
        <XAxis
          dataKey={xKey}
          tick={axisStyle}
          tickFormatter={formatLabel}
          axisLine={{ stroke: "var(--color-border)" }}
          tickLine={false}
        />
        <YAxis
          tick={axisStyle}
          tickFormatter={formatValue}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <Tooltip {...ttStyle} formatter={formatValue} labelFormatter={formatLabel} />
        {yKeys.length > 1 && !compact && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {yKeys.map((key, i) => {
          const color = colors[i % colors.length];
          const props: Record<string, unknown> = {
            key,
            dataKey: key,
            fill: color,
            stroke: color,
            name: key,
            ...areaProps,
          };
          if (SeriesComponent === Bar) {
            props.radius = [4, 4, 0, 0];
            props.maxBarSize = 48;
          }
          if (SeriesComponent === Line) {
            props.strokeWidth = 2;
            props.dot = { r: 3, fill: color };
            props.activeDot = { r: 5 };
          }
          if (SeriesComponent === Area) {
            props.fillOpacity = 0.15;
            props.strokeWidth = 2;
          }
          // @ts-expect-error - dynamic component props
          return <SeriesComponent {...props} />;
        })}
      </ChartComponent>
    </ResponsiveContainer>
  );
}

function PieDonutChart({
  config,
  data,
  compact,
}: {
  config: PanelConfig;
  data: Record<string, unknown>[];
  compact?: boolean;
}) {
  const { mapping, type } = config;
  const nameKey = mapping.nameKey ?? Object.keys(data[0] ?? {})[0] ?? "name";
  const valueKey = mapping.valueKey ?? Object.keys(data[0] ?? {})[1] ?? "value";
  const colors = mapping.colors ?? CHART_PALETTE;
  const height = compact ? 200 : 320;
  const ttStyle = tooltipStyle();
  const innerRadius = type === "donut" ? "50%" : 0;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey={nameKey}
          cx="50%"
          cy="50%"
          innerRadius={innerRadius}
          outerRadius={compact ? 70 : 110}
          paddingAngle={2}
          label={compact ? undefined : ((props: unknown) => {
            const p = props as Record<string, unknown>;
            const name = p.name;
            const percent = typeof p.percent === "number" ? p.percent : 0;
            return `${formatLabel(name)} ${(percent * 100).toFixed(0)}%`;
          }) as never}
          labelLine={!compact}
          style={{ fontSize: 11 }}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={colors[i % colors.length]} />
          ))}
        </Pie>
        <Tooltip {...ttStyle} formatter={formatValue} />
        {!compact && <Legend wrapperStyle={{ fontSize: 11 }} />}
      </PieChart>
    </ResponsiveContainer>
  );
}

function RadarChartPanel({
  config,
  data,
  compact,
}: {
  config: PanelConfig;
  data: Record<string, unknown>[];
  compact?: boolean;
}) {
  const { mapping } = config;
  const nameKey = mapping.xAxis ?? mapping.nameKey ?? Object.keys(data[0] ?? {})[0] ?? "name";
  const valueKeys = mapping.yAxis ?? [Object.keys(data[0] ?? {})[1] ?? "value"];
  const colors = mapping.colors ?? CHART_PALETTE;
  const height = compact ? 200 : 320;
  const ttStyle = tooltipStyle();

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data} cx="50%" cy="50%" outerRadius={compact ? 60 : 100}>
        <PolarGrid stroke="var(--color-border)" />
        <PolarAngleAxis dataKey={nameKey} tick={{ fontSize: 11, fill: "var(--color-text-muted)" }} />
        <PolarRadiusAxis tick={{ fontSize: 10, fill: "var(--color-text-muted)" }} />
        {valueKeys.map((key, i) => (
          <Radar
            key={key}
            name={key}
            dataKey={key}
            stroke={colors[i % colors.length]}
            fill={colors[i % colors.length]}
            fillOpacity={0.2}
          />
        ))}
        <Tooltip {...ttStyle} />
        {!compact && valueKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
      </RadarChart>
    </ResponsiveContainer>
  );
}

function ScatterChartPanel({
  config,
  data,
  compact,
}: {
  config: PanelConfig;
  data: Record<string, unknown>[];
  compact?: boolean;
}) {
  const { mapping } = config;
  const xKey = mapping.xAxis ?? Object.keys(data[0] ?? {})[0] ?? "x";
  const yKeys = mapping.yAxis ?? [Object.keys(data[0] ?? {})[1] ?? "y"];
  const colors = mapping.colors ?? CHART_PALETTE;
  const height = compact ? 200 : 320;
  const ttStyle = tooltipStyle();

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid {...gridStyle} />
        <XAxis dataKey={xKey} tick={axisStyle} name={xKey} axisLine={{ stroke: "var(--color-border)" }} tickLine={false} />
        <YAxis tick={axisStyle} tickFormatter={formatValue} axisLine={false} tickLine={false} width={48} />
        <Tooltip {...ttStyle} />
        {yKeys.map((key, i) => (
          <Scatter
            key={key}
            name={key}
            data={data}
            fill={colors[i % colors.length]}
          />
        ))}
        {!compact && yKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function FunnelChartPanel({
  config,
  data,
  compact,
}: {
  config: PanelConfig;
  data: Record<string, unknown>[];
  compact?: boolean;
}) {
  const { mapping } = config;
  const nameKey = mapping.nameKey ?? Object.keys(data[0] ?? {})[0] ?? "name";
  const valueKey = mapping.valueKey ?? Object.keys(data[0] ?? {})[1] ?? "value";
  const colors = mapping.colors ?? CHART_PALETTE;
  const height = compact ? 200 : 320;
  const ttStyle = tooltipStyle();

  // Funnel expects data with fill colors
  const funnelData = data.map((row, i) => ({
    ...row,
    fill: colors[i % colors.length],
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <FunnelChart>
        <Tooltip {...ttStyle} />
        <Funnel
          data={funnelData}
          dataKey={valueKey}
          nameKey={nameKey}
          isAnimationActive
        >
          <LabelList
            position="right"
            fill="var(--color-text-muted)"
            stroke="none"
            fontSize={11}
            dataKey={nameKey}
          />
        </Funnel>
      </FunnelChart>
    </ResponsiveContainer>
  );
}

// --- Main ChartPanel component ---

export function ChartPanel({ config, data, compact }: ChartPanelProps) {
  // Coerce numeric values for Recharts
  const processedData = useMemo(() => {
    if (!data || data.length === 0) {return [];}
    const { mapping } = config;
    const numericKeys = new Set([
      ...(mapping.yAxis ?? []),
      ...(mapping.valueKey ? [mapping.valueKey] : []),
    ]);

    return data.map((row) => {
      const out: Record<string, unknown> = { ...row };
      for (const key of numericKeys) {
        if (key in out) {
          const v = out[key];
          if (typeof v === "string" && v !== "" && !isNaN(Number(v))) {
            out[key] = Number(v);
          }
        }
      }
      return out;
    });
  }, [data, config]);

  if (processedData.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-xl"
        style={{
          height: compact ? 200 : 320,
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          color: "var(--color-text-muted)",
          fontSize: 13,
        }}
      >
        No data
      </div>
    );
  }

  switch (config.type) {
    case "bar":
      return <CartesianChart config={config} data={processedData} compact={compact} ChartComponent={BarChart} SeriesComponent={Bar} />;
    case "line":
      return <CartesianChart config={config} data={processedData} compact={compact} ChartComponent={LineChart} SeriesComponent={Line} />;
    case "area":
      return <CartesianChart config={config} data={processedData} compact={compact} ChartComponent={AreaChart} SeriesComponent={Area} />;
    case "pie":
      return <PieDonutChart config={config} data={processedData} compact={compact} />;
    case "donut":
      return <PieDonutChart config={config} data={processedData} compact={compact} />;
    case "radar":
    case "radialBar":
      return <RadarChartPanel config={config} data={processedData} compact={compact} />;
    case "scatter":
      return <ScatterChartPanel config={config} data={processedData} compact={compact} />;
    case "funnel":
      return <FunnelChartPanel config={config} data={processedData} compact={compact} />;
    default:
      return <CartesianChart config={config} data={processedData} compact={compact} ChartComponent={BarChart} SeriesComponent={Bar} />;
  }
}
