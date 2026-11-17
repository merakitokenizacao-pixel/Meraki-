"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  marker?: string;
  count?: number;
};

/** Controle segmentado com indicador deslizante. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegmentedOption<T>[];
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null);
  const activeIndex = options.findIndex((o) => o.value === value);

  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current[activeIndex];
      if (!el) return;
      const next = { left: el.offsetLeft, width: el.offsetWidth };
      setInd((prev) => (prev && prev.left === next.left && prev.width === next.width ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [activeIndex, options.length]);

  return (
    <div
      ref={wrap}
      role="tablist"
      aria-label={ariaLabel}
      className={cn("relative inline-flex shrink-0 items-center rounded-[7px] border border-line bg-sunken p-[3px]", className)}
    >
      {ind && (
        <span
          aria-hidden
          className="absolute top-[3px] bottom-[3px] rounded-[4px] border border-line-2 bg-raised shadow-pill transition-[left,width] duration-200 ease-out"
          style={{ left: ind.left, width: ind.width }}
        />
      )}
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative z-10 inline-flex items-center gap-1.5 rounded-[4px] font-medium whitespace-nowrap transition-colors",
              size === "sm" ? "h-[26px] px-2.5 text-[12px]" : "h-7 px-3 text-[12.5px]",
              active ? "text-ink" : "text-ink-3 hover:text-ink-2",
              active && !ind && "bg-raised",
            )}
          >
            {o.marker && <span className="size-[7px] rounded-full" style={{ background: o.marker }} />}
            {o.label}
            {o.count !== undefined && <span className={cn("tnum", active ? "text-ink-3" : "text-ink-4")}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
