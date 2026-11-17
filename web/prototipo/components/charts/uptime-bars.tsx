"use client";

import { useState } from "react";
import { STATUS_META } from "@/components/ui/status";
import type { Status } from "@/lib/types";
import { cn } from "@/lib/utils";

const BAR: Record<Status, string> = {
  ok: "bg-ok/30 hover:bg-ok/55",
  maint: "bg-maint/50 hover:bg-maint/75",
  warn: "bg-warn hover:brightness-110",
  serious: "bg-serious hover:brightness-110",
  crit: "bg-crit hover:brightness-110",
};

/** Barras de status: períodos saudáveis recuam, problemas se destacam. */
export function UptimeBars({ buckets, labels, className }: { buckets: Status[]; labels: string[]; className?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className={cn("relative", className)} onMouseLeave={() => setHover(null)}>
      <div className="flex h-6 items-stretch gap-[2px]">
        {buckets.map((s, i) => (
          <span key={i} onMouseEnter={() => setHover(i)} className={cn("min-w-[2px] flex-1 rounded-[2px] transition-colors", BAR[s])} />
        ))}
      </div>
      {hover !== null && (
        <div
          className="pointer-events-none absolute bottom-full z-20 mb-2 -translate-x-1/2 animate-fade rounded-[8px] border border-line-2 bg-raised px-2.5 py-1.5 whitespace-nowrap shadow-pop"
          style={{ left: `${((hover + 0.5) / buckets.length) * 100}%` }}
        >
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
            <span className={cn("size-2 rounded-full", STATUS_META[buckets[hover]].dot)} />
            {STATUS_META[buckets[hover]].label}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-3 tnum">{labels[hover]}</div>
        </div>
      )}
    </div>
  );
}
