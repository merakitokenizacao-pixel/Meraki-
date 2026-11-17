import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { fmtDec } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Delta({
  value,
  unit = "%",
  goodWhen = "up",
  decimals = 1,
  className,
  suffix,
}: {
  value: number;
  unit?: string;
  goodWhen?: "up" | "down" | "neutral";
  decimals?: number;
  className?: string;
  suffix?: string;
}) {
  const zero = Math.abs(value) < 1e-9;
  const up = value > 0;
  const good = zero || goodWhen === "neutral" ? null : (goodWhen === "up") === up;
  const Icon = zero ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[12px] font-medium whitespace-nowrap tnum",
        good === null ? "text-ink-3" : good ? "text-ok-ink" : "text-crit-ink",
        className,
      )}
    >
      <Icon className="size-3.5" strokeWidth={2.25} />
      {zero ? "0" : `${up ? "+" : "−"}${fmtDec(Math.abs(value), decimals)}`}
      {unit}
      {suffix && <span className="ml-1 font-normal text-ink-3">{suffix}</span>}
    </span>
  );
}
