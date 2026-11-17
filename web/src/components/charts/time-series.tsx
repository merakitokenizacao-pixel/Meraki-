"use client";

import { useId, useMemo } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";

export type TSeries = {
  key: string;
  name: string;
  color: string;
  /** null = sem dado no dia (a linha fica com lacuna, nunca vira zero) */
  data: (number | null)[];
  width?: number;
  opacity?: number;
  area?: boolean;
  /** séries de contexto (cinza): fora do tooltip e agrupadas na legenda */
  muted?: boolean;
  dashed?: boolean;
};

export type TMarker = { index: number; label: string };

type DomainEnd = number | "auto" | "dataMin" | "dataMax";

/** Passo “redondo” (1, 2, 5 × 10ⁿ) para ~`count` intervalos — mesmo critério do d3. */
function tickStep(span: number, count: number) {
  const raw = span / count;
  let step = Math.pow(10, Math.floor(Math.log10(raw)));
  const err = raw / step;
  if (err >= Math.sqrt(50)) step *= 10;
  else if (err >= Math.sqrt(10)) step *= 5;
  else if (err >= Math.sqrt(2)) step *= 2;
  return step;
}

/** Eixo Y com marcações redondas. Extremos fixos são respeitados; extremos automáticos arredondam para fora. */
function niceAxis(values: (number | null)[], yDomain: [DomainEnd, DomainEnd], count = 4) {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (!finite.length) return null;
  const fixedLo = typeof yDomain[0] === "number";
  const fixedHi = typeof yDomain[1] === "number";
  let min = fixedLo ? (yDomain[0] as number) : Math.min(...finite);
  let max = fixedHi ? (yDomain[1] as number) : Math.max(...finite);
  if (max <= min) {
    const pad = Math.abs(min) * 0.1 || 1;
    if (!fixedLo) min -= pad;
    if (!fixedHi) max += pad;
  }
  const step = tickStep(max - min, count);
  let lo = fixedLo ? min : Math.floor(min / step + 1e-9) * step;
  if (!fixedLo && min >= 0 && lo < 0) lo = 0;
  const hi = fixedHi ? max : Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let k = Math.ceil(lo / step - 1e-9); k <= Math.floor(hi / step + 1e-9); k++) ticks.push(Number((k * step).toFixed(10)));
  return { domain: [lo, hi] as [number, number], ticks };
}

type Props = {
  labels: string[];
  series: TSeries[];
  height?: number;
  yDomain?: [DomainEnd, DomainEnd];
  yFormat?: (v: number) => string;
  valueFormat?: (v: number) => string;
  threshold?: { value: number; label: string };
  markers?: TMarker[];
  legend?: boolean;
  mutedLegend?: string;
  className?: string;
  yWidth?: number;
};

export function ChartLegend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-ink-3">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          {it.dashed ? (
            <span className="w-3.5 border-t border-dashed" style={{ borderColor: it.color }} />
          ) : (
            <span className="h-[2px] w-3.5 rounded-full" style={{ background: it.color }} />
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}

export function TimeSeriesChart({
  labels,
  series,
  height = 240,
  yDomain = ["auto", "auto"],
  yFormat,
  valueFormat,
  threshold,
  markers,
  legend = true,
  mutedLegend,
  className,
  yWidth = 44,
}: Props) {
  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const data = useMemo(
    () =>
      labels.map((label, i) => {
        const row: Record<string, string | number | null> = { label };
        for (const s of series) row[s.key] = s.data[i];
        return row;
      }),
    [labels, series],
  );
  const [d0, d1] = yDomain;
  const axis = useMemo(
    () => niceAxis([...series.flatMap((s) => s.data), ...(threshold ? [threshold.value] : [])], [d0, d1]),
    [series, threshold, d0, d1],
  );
  const main = series.filter((s) => !s.muted);
  const hasMuted = series.some((s) => s.muted);
  const fmt = valueFormat ?? ((v: number) => String(v));

  const legendItems = [
    ...main.map((s) => ({ label: s.name, color: s.color })),
    ...(hasMuted ? [{ label: mutedLegend ?? "Outros", color: "var(--color-ink-4)" }] : []),
    ...(threshold ? [{ label: threshold.label, color: "var(--color-ink-3)", dashed: true }] : []),
  ];

  return (
    <div className={cn("w-full", className)}>
      {legend && legendItems.length > 1 && (
        <div className="mb-3">
          <ChartLegend items={legendItems} />
        </div>
      )}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height }}>
          <ComposedChart data={data} margin={{ top: markers?.length ? 24 : 8, right: 18, bottom: 0, left: 0 }}>
            <defs>
              {series
                .filter((s) => s.area)
                .map((s) => (
                  <linearGradient key={s.key} id={`${gid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                  </linearGradient>
                ))}
            </defs>
            <CartesianGrid vertical={false} stroke="var(--color-grid)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: "var(--color-line-2)" }}
              tickMargin={8}
              minTickGap={40}
              interval="preserveStartEnd"
            />
            <YAxis
              width={yWidth}
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              domain={axis?.domain ?? yDomain}
              ticks={axis?.ticks}
              interval={0}
              tickFormatter={yFormat}
              allowDecimals
            />
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: "var(--color-ink-4)", strokeWidth: 1 }}
              content={(p) => {
                const props = p as unknown as { active?: boolean; label?: string; payload?: { payload: Record<string, number | null> }[] };
                if (!props.active || !props.payload?.length) return null;
                const row = props.payload[0].payload;
                return (
                  <div className="min-w-[160px] rounded-[7px] border border-line-2 bg-raised px-3 py-2.5 shadow-pop">
                    <div className="mb-2 text-[11.5px] text-ink-3 tnum">{props.label}</div>
                    <div className="space-y-1.5">
                      {main.map((s) => (
                        <div key={s.key} className="flex items-center gap-2 text-[12px]">
                          <span className="h-[2px] w-3 rounded-full" style={{ background: s.color }} />
                          <span className="font-medium text-ink tnum">{row[s.key] === null || row[s.key] === undefined ? "—" : fmt(row[s.key] as number)}</span>
                          <span className="truncate text-ink-3">{s.name}</span>
                        </div>
                      ))}
                      {threshold && (
                        <div className="flex items-center gap-2 border-t border-line-2 pt-1.5 text-[11.5px] text-ink-3">
                          <span className="w-3 border-t border-dashed border-ink-3" />
                          {threshold.label}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }}
            />
            {threshold && (
              <ReferenceLine y={threshold.value} stroke="var(--color-ink-3)" strokeDasharray="4 4" strokeWidth={1} ifOverflow="extendDomain" />
            )}
            {markers?.map((m) =>
              m.index >= 0 ? (
                <ReferenceLine
                  key={m.label}
                  x={labels[m.index]}
                  stroke="var(--color-ink-3)"
                  strokeWidth={1}
                  label={(lp: unknown) => {
                    const vb = (lp as { viewBox?: { x: number; y: number } }).viewBox;
                    if (!vb) return <g />;
                    const w = m.label.length * 6.1 + 14;
                    return (
                      <g>
                        <rect x={vb.x - w / 2} y={vb.y - 21} width={w} height={18} rx={9} fill="var(--color-raised)" stroke="var(--color-line-2)" />
                        <text x={vb.x} y={vb.y - 8.5} textAnchor="middle" fill="var(--color-ink-2)" fontSize={11}>
                          {m.label}
                        </text>
                      </g>
                    );
                  }}
                />
              ) : null,
            )}
            {series
              .filter((s) => s.muted)
              .map((s) => (
                <Line
                  key={s.key}
                  dataKey={s.key}
                  name={s.name}
                  type="monotone"
                  stroke={s.color}
                  strokeWidth={s.width ?? 1.25}
                  strokeOpacity={s.opacity ?? 0.9}
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                />
              ))}
            {main.map((s) =>
              s.area ? (
                <Area
                  key={s.key}
                  dataKey={s.key}
                  name={s.name}
                  type="monotone"
                  stroke={s.color}
                  strokeWidth={s.width ?? 2}
                  fill={`url(#${gid}-${s.key})`}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-surface)", fill: s.color }}
                  animationDuration={600}
                />
              ) : (
                <Line
                  key={s.key}
                  dataKey={s.key}
                  name={s.name}
                  type="monotone"
                  stroke={s.color}
                  strokeWidth={s.width ?? 2}
                  strokeOpacity={s.opacity ?? 1}
                  strokeDasharray={s.dashed ? "4 4" : undefined}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-surface)", fill: s.color }}
                  animationDuration={600}
                />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
