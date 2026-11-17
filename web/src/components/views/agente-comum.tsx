import { Mono } from "@/components/ui/misc";
import { StatusDot } from "@/components/ui/status";
import { MINIMO_CONVERSAS, type Producao, type ResumoAgente, type Rodada, SEV, versaoCurta } from "@/lib/plataforma/modelo";
import type { Status } from "@/lib/types";
import { fmtDec } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Fração (0–1) em porcentagem com uma casa: 0.969 → "96,9%". */
export const pct = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : `${fmtDec(x * 100, 1)}%`);

export const taxa = (n: number, d: number) => (d > 0 ? n / d : null);

/** Estado do agente: o pior achado aberto (sem achado, operacional). */
export function estadoDoAgente(r: Pick<ResumoAgente, "pior">): Status {
  return r.pior ? SEV[r.pior.severidade].status : "ok";
}

/** Aprovação frente à meta: abaixo dela é crítico, crítico falhando também. */
export function estadoDaRodada(r: Rodada | null, minima = 0.9): Status {
  if (!r || r.aprovacao === null) return "maint";
  if (r.criticosFalhos.length || r.aprovacao < minima) return "crit";
  return "ok";
}

/** Repasse frente à meta (sem meta, neutro). */
export function estadoDoRepasse(p: Producao | null, maximo?: number): Status {
  const t = p ? taxa(p.repasses, p.conversas) : null;
  if (t === null || maximo === undefined) return "maint";
  return t > maximo ? "serious" : "ok";
}

export const suficiente = (p: Pick<Producao, "conversas"> | null) => Boolean(p && p.conversas >= MINIMO_CONVERSAS);

/** Hash curto em mono, com o rótulo do que ele é (publicada, rascunho…). */
export function Versao({ hash, rotulo, className }: { hash: string | null; rotulo?: string; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)} title={hash ?? undefined}>
      <Mono className="text-ink">v{versaoCurta(hash)}</Mono>
      {rotulo && <span className="truncate text-[11.5px] text-ink-3">{rotulo}</span>}
    </span>
  );
}

/** Resultado de uma rodada em uma linha: ponto de estado, passaram/casos e a aprovação. */
export function ResultadoRodada({ r, minima, className }: { r: Rodada | null; minima?: number; className?: string }) {
  if (!r) return <span className={cn("text-[12.5px] text-ink-4", className)}>sem rodada</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12.5px] text-ink-2 tnum", className)}>
      <StatusDot status={estadoDaRodada(r, minima)} className="size-1.5" />
      <span className="font-medium text-ink">{pct(r.aprovacao)}</span>
      <span className="text-ink-3">
        {r.passaram}/{r.casos}
      </span>
    </span>
  );
}
