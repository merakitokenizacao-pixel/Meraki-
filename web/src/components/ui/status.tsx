import { DECISAO, type Decisao, SEV, type Severidade } from "@/lib/plataforma/modelo";
import type { Status } from "@/lib/types";
import { cn } from "@/lib/utils";

export const STATUS_META: Record<Status, { label: string; dot: string; text: string; soft: string; hex: string }> = {
  ok: { label: "Operacional", dot: "bg-ok", text: "text-ok-ink", soft: "bg-ok-soft", hex: "#0ca30c" },
  warn: { label: "Atenção", dot: "bg-warn", text: "text-warn-ink", soft: "bg-warn-soft", hex: "#fab219" },
  serious: { label: "Degradado", dot: "bg-serious", text: "text-serious-ink", soft: "bg-serious-soft", hex: "#ec835a" },
  crit: { label: "Crítico", dot: "bg-crit", text: "text-crit-ink", soft: "bg-crit-soft", hex: "#d03b3b" },
  maint: { label: "Neutro", dot: "bg-maint", text: "text-maint-ink", soft: "bg-maint-soft", hex: "#6c6c75" },
};

export function StatusDot({ status, pulse, className }: { status: Status; pulse?: boolean; className?: string }) {
  const m = STATUS_META[status];
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)} aria-hidden>
      {pulse && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", m.dot)} />}
      <span className={cn("relative size-full rounded-full", m.dot)} />
    </span>
  );
}

/** Chip neutro: a cor fica só no ponto, o texto sempre em tinta neutra. */
export function StatusChip({
  status,
  label,
  pulse,
  className,
}: {
  status: Status;
  label?: string;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border border-line-2 bg-raised px-2 text-[11.5px] font-medium whitespace-nowrap text-ink-2",
        className,
      )}
    >
      <StatusDot status={status} pulse={pulse} className="size-[7px]" />
      {label ?? STATUS_META[status].label}
    </span>
  );
}

/** Severidade de achado: sempre ponto + rótulo (nunca só cor). */
export function SevChip({ sev, className }: { sev: Severidade; className?: string }) {
  return <StatusChip status={SEV[sev].status} label={SEV[sev].label} className={className} />;
}

export function DecisaoChip({ decisao, className }: { decisao: Decisao; className?: string }) {
  return <StatusChip status={DECISAO[decisao].status} label={DECISAO[decisao].label} className={className} />;
}
