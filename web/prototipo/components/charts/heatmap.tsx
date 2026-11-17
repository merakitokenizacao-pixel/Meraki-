"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** Rampa sequencial azul para fundo escuro: o zero recua para a superfície, o máximo acende. */
const RAMP = ["#1c1c21", "#16345c", "#184f95", "#1c5cab", "#2a78d6", "#3987e5", "#6da7ec"];

export function Heatmap({
  rows,
  columns,
  unit = "incidentes",
}: {
  rows: { key: string; label: React.ReactNode; values: number[] }[];
  columns: string[];
  unit?: string;
}) {
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const max = Math.max(1, ...rows.flatMap((r) => r.values));
  const step = (v: number) => (v === 0 ? 0 : Math.min(RAMP.length - 1, Math.ceil((v / max) * (RAMP.length - 1))));

  return (
    <div onMouseLeave={() => setHover(null)}>
      <div className="space-y-[3px]">
        {rows.map((row, r) => (
          <div key={row.key} className="flex items-center gap-3">
            <div className="w-[76px] shrink-0 text-[12px] text-ink-2">{row.label}</div>
            <div className="relative grid flex-1 gap-[3px]" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
              {row.values.map((v, c) => (
                <span
                  key={c}
                  onMouseEnter={() => setHover({ r, c })}
                  className={cn("h-[22px] rounded-[4px]", hover?.r === r && hover?.c === c && "outline-2 outline-offset-1 outline-ink-2")}
                  style={{ background: RAMP[step(v)] }}
                />
              ))}
              {hover?.r === r && (
                <div
                  className="pointer-events-none absolute bottom-full z-20 mb-2 -translate-x-1/2 animate-fade rounded-[8px] border border-line-2 bg-raised px-2.5 py-1.5 whitespace-nowrap shadow-pop"
                  style={{ left: `${((hover.c + 0.5) / columns.length) * 100}%` }}
                >
                  <div className="text-[12px] font-medium text-ink tnum">
                    {row.values[hover.c]} {row.values[hover.c] === 1 ? unit.replace(/s$/, "") : unit}
                  </div>
                  <div className="mt-0.5 text-[11px] text-ink-3 tnum">{columns[hover.c]}</div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between pl-[88px] text-[11px] text-ink-3 tnum">
        <span>{columns[0]}</span>
        <div className="flex items-center gap-1.5">
          <span>Menos</span>
          {RAMP.map((c) => (
            <span key={c} className="size-3 rounded-[3px]" style={{ background: c }} />
          ))}
          <span>Mais</span>
        </div>
        <span>{columns[columns.length - 1]}</span>
      </div>
    </div>
  );
}
