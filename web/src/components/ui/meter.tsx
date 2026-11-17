import { clamp, cn } from "@/lib/utils";

export type Tone = "neutral" | "accent" | "ok" | "warn" | "serious" | "crit";

const FILL: Record<Tone, string> = {
  neutral: "bg-ink-2",
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
  serious: "bg-serious",
  crit: "bg-crit",
};

export const HEX: Record<Tone, string> = {
  neutral: "#a8a8b0",
  accent: "#3987e5",
  ok: "#0ca30c",
  warn: "#fab219",
  serious: "#ec835a",
  crit: "#d03b3b",
};

/** Tom automático para métricas de uso (quanto maior, pior). */
export function usageTone(pct: number): Tone {
  return pct >= 90 ? "crit" : pct >= 80 ? "warn" : "neutral";
}

export function Meter({
  value,
  max = 100,
  tone,
  className,
  thick,
}: {
  value: number;
  max?: number;
  tone?: Tone;
  className?: string;
  thick?: boolean;
}) {
  const pct = clamp((value / max) * 100, 0, 100);
  const t = tone ?? usageTone(pct);
  return (
    <div className={cn("w-full overflow-hidden rounded-full bg-muted", thick ? "h-1.5" : "h-1", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", FILL[t])} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Medidor radial; `target` desenha um tique na meta. */
export function Ring({
  value,
  max = 100,
  size = 64,
  stroke = 5,
  tone = "accent",
  target,
  children,
}: {
  value: number;
  max?: number;
  size?: number;
  stroke?: number;
  tone?: Tone;
  target?: number;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = clamp(value / max, 0, 1);
  const cx = size / 2;
  const theta = target !== undefined ? clamp(target / max, 0, 1) * 2 * Math.PI : 0;
  const t1 = r - stroke / 2 - 2;
  const t2 = r + stroke / 2 + 2;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--color-muted)" strokeWidth={stroke} />
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke={HEX[tone]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${pct * c} ${c}`}
          className="transition-[stroke-dasharray] duration-700"
        />
        {target !== undefined && (
          <line
            x1={cx + t1 * Math.cos(theta)}
            y1={cx + t1 * Math.sin(theta)}
            x2={cx + t2 * Math.cos(theta)}
            y2={cx + t2 * Math.sin(theta)}
            stroke="var(--color-ink)"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        )}
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

/** Barra segmentada fina — distribuição de um todo (ex.: status). */
export function SegmentBar({ parts, className }: { parts: { value: number; color: string; label: string }[]; className?: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div className={cn("flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full", className)} role="img" aria-label={parts.map((p) => `${p.label}: ${p.value}`).join(", ")}>
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <div key={p.label} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${p.value}`} />
        ))}
    </div>
  );
}
