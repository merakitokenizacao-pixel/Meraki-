import { cn } from "@/lib/utils";

/** Sparkline discreta; o ponto atual leva o acento (ou a cor de status). */
export function Sparkline({
  data,
  width = 96,
  height = 28,
  className,
  stroke = "var(--color-ink-3)",
  accent = "var(--color-ink)",
  fill = false,
  baseline,
  strokeWidth = 1.5,
}: {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
  stroke?: string;
  accent?: string;
  fill?: boolean;
  baseline?: number;
  strokeWidth?: number;
}) {
  if (data.length < 2) return null;
  const pad = 3;
  let min = Math.min(...data);
  let max = Math.max(...data);
  if (baseline !== undefined) {
    min = Math.min(min, baseline);
    max = Math.max(max, baseline);
  }
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (data.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const d = data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = data[data.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn("block overflow-visible", className)} aria-hidden>
      {fill && <path d={`${d} L${x(data.length - 1)},${height} L${x(0)},${height} Z`} fill={accent} fillOpacity={0.08} />}
      {baseline !== undefined && (
        <line x1={pad} x2={width - pad} y1={y(baseline)} y2={y(baseline)} stroke="var(--color-ink-4)" strokeWidth={1} strokeDasharray="2 3" />
      )}
      <path d={d} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(data.length - 1)} cy={y(last)} r={2.75} fill={accent} stroke="var(--color-surface)" strokeWidth={1.5} />
    </svg>
  );
}
