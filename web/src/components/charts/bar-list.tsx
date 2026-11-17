import { cn } from "@/lib/utils";

/** Barras horizontais de uma série, valor alinhado à direita. */
export function BarList({
  items,
  format,
  color = "var(--color-s1)",
  max,
  className,
}: {
  items: { key: string; label: React.ReactNode; value: number; sub?: React.ReactNode; color?: string }[];
  format: (v: number) => string;
  color?: string;
  max?: number;
  className?: string;
}) {
  const top = max ?? Math.max(...items.map((i) => i.value), 1);
  return (
    <div className={cn("space-y-3.5", className)}>
      {items.map((it) => (
        <div key={it.key}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="min-w-0 truncate text-ink-2">{it.label}</span>
            <span className="shrink-0 font-medium text-ink tnum">
              {format(it.value)}
              {it.sub && <span className="ml-1.5 font-normal text-ink-3">{it.sub}</span>}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-[width] duration-700"
              style={{ width: `${Math.max(1.5, (it.value / top) * 100)}%`, background: it.color ?? color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
