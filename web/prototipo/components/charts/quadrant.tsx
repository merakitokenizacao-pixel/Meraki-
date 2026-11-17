"use client";

import { useRouter } from "next/navigation";
import { CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { STATUS_META } from "@/components/ui/status";
import { fmtDec } from "@/lib/format";
import type { Status } from "@/lib/types";

export type QuadrantPoint = {
  id: string;
  name: string;
  x: number;
  y: number;
  status: Status;
  detail: { accuracy: string; resolution: string };
  label?: boolean;
};

/** Precisão × resolução, cada agente relativo às próprias metas (100% = meta atingida). */
export function QuadrantScatter({ points, height = 320 }: { points: QuadrantPoint[]; height?: number }) {
  const router = useRouter();
  const xDomain: [number, number] = [86, 106];
  const yDomain: [number, number] = [72, 122];

  return (
    <div className="relative" style={{ height }}>
      <div className="pointer-events-none absolute inset-0 z-10 text-[11px] text-ink-4">
        <span className="absolute top-3 right-4">Acima das duas metas</span>
        <span className="absolute bottom-12 left-[56px] text-crit-ink/70">Abaixo das duas metas</span>
      </div>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 560, height }}>
        <ScatterChart margin={{ top: 12, right: 16, bottom: 18, left: 0 }}>
          <CartesianGrid stroke="var(--color-grid)" />
          <ReferenceArea x1={xDomain[0]} x2={100} y1={yDomain[0]} y2={100} fill="#d03b3b" fillOpacity={0.07} stroke="none" />
          <XAxis
            type="number"
            dataKey="x"
            domain={xDomain}
            ticks={[88, 92, 96, 100, 104]}
            tickFormatter={(v: number) => `${v}%`}
            tickLine={false}
            axisLine={{ stroke: "var(--color-line-2)" }}
            tickMargin={8}
            label={{ value: "Precisão (% da meta)", position: "insideBottom", offset: -12, fontSize: 11 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={yDomain}
            ticks={[80, 90, 100, 110, 120]}
            tickFormatter={(v: number) => `${v}%`}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <ReferenceLine x={100} stroke="var(--color-ink-3)" strokeDasharray="4 4" />
          <ReferenceLine y={100} stroke="var(--color-ink-3)" strokeDasharray="4 4" />
          <Tooltip
            cursor={false}
            isAnimationActive={false}
            content={(p) => {
              const props = p as unknown as { active?: boolean; payload?: { payload: QuadrantPoint }[] };
              if (!props.active || !props.payload?.length) return null;
              const pt = props.payload[0].payload;
              return (
                <div className="min-w-[200px] rounded-[10px] border border-line-2 bg-raised px-3 py-2.5 shadow-pop">
                  <div className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-ink">
                    <span className="size-2 rounded-full" style={{ background: STATUS_META[pt.status].hex }} />
                    {pt.name}
                  </div>
                  <div className="space-y-1 text-[12px] text-ink-2">
                    <div className="flex justify-between gap-4">
                      <span className="text-ink-3">Precisão</span>
                      <span className="tnum">
                        {pt.detail.accuracy} · {fmtDec(pt.x, 0)}% da meta
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-ink-3">Resolução</span>
                      <span className="tnum">
                        {pt.detail.resolution} · {fmtDec(pt.y, 0)}% da meta
                      </span>
                    </div>
                  </div>
                </div>
              );
            }}
          />
          <Scatter
            data={points}
            isAnimationActive={false}
            onClick={(d: unknown) => {
              const id = (d as { payload?: QuadrantPoint })?.payload?.id ?? (d as QuadrantPoint)?.id;
              if (id) router.push(`/agentes/${id}`);
            }}
            shape={(sp: unknown) => {
              const { cx, cy, payload } = sp as { cx: number; cy: number; payload: QuadrantPoint };
              const color = STATUS_META[payload.status].hex;
              return (
                <g className="cursor-pointer">
                  <circle cx={cx} cy={cy} r={13} fill="transparent" />
                  <circle cx={cx} cy={cy} r={5.5} fill={color} stroke="var(--color-surface)" strokeWidth={2} />
                  {payload.label && (
                    <text x={cx + 10} y={cy + 4} fontSize={11.5} fill="var(--color-ink-2)">
                      {payload.name}
                    </text>
                  )}
                </g>
              );
            }}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
