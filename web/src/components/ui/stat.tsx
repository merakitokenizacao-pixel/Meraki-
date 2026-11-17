import { Card } from "@/components/ui/card";
import { Delta } from "@/components/ui/delta";
import { StatusDot } from "@/components/ui/status";
import type { Status } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Cartão de indicador único — mesma anatomia em todas as telas (rótulo, valor, rodapé). */
export function StatCard({
  label,
  value,
  unit,
  delta,
  deltaUnit = "%",
  goodWhen = "up",
  decimals = 1,
  foot,
  status,
  className,
  children,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  delta?: number;
  deltaUnit?: string;
  goodWhen?: "up" | "down" | "neutral";
  decimals?: number;
  foot?: React.ReactNode;
  status?: Status;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className={cn("flex min-w-0 flex-col p-5", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-[12.5px] text-ink-3">{label}</span>
        {status && <StatusDot status={status} />}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="text-[28px] leading-none font-semibold tracking-[-0.03em] text-ink">{value}</span>
        {unit && <span className="text-[13px] text-ink-3">{unit}</span>}
      </div>
      {children}
      {(delta !== undefined || foot) && (
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-3 text-[12px]">
          {delta !== undefined && <Delta value={delta} unit={deltaUnit} goodWhen={goodWhen} decimals={decimals} />}
          {foot && <span className="text-ink-3">{foot}</span>}
        </div>
      )}
    </Card>
  );
}
