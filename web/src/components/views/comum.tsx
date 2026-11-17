import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { projectHref } from "@/components/shell/nav";
import { Card, CardFooter } from "@/components/ui/card";
import { SegmentBar } from "@/components/ui/meter";
import { Pill, ProjectTag } from "@/components/ui/misc";
import { STATUS_META, StatusDot } from "@/components/ui/status";
import { type Contagem, type ResumoProjeto, SEV, SEVERIDADES, estadoDaSaude } from "@/lib/plataforma/modelo";
import { relativo } from "@/lib/tempo";
import { fmtDec, fmtInt } from "@/lib/format";
import { cn } from "@/lib/utils";

export const totalAbertos = (c: Contagem) => SEVERIDADES.reduce((s, k) => s + c[k], 0);

/** Distribuição dos achados abertos por severidade — barra fina + legenda com números. */
export function DistribuicaoSeveridade({ abertos, className }: { abertos: Contagem; className?: string }) {
  const total = totalAbertos(abertos);
  return (
    <div className={className}>
      {total ? (
        <SegmentBar parts={SEVERIDADES.map((s) => ({ label: SEV[s].label, value: abertos[s], color: STATUS_META[SEV[s].status].hex }))} />
      ) : (
        <div className="h-1.5 w-full rounded-full bg-muted" />
      )}
      <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[11.5px] text-ink-3">
        {total ? (
          SEVERIDADES.filter((s) => abertos[s] > 0).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <StatusDot status={SEV[s].status} className="size-1.5" />
              {SEV[s].label} <span className="text-ink-2 tnum">{abertos[s]}</span>
            </span>
          ))
        ) : (
          <span>Nenhum achado aberto</span>
        )}
      </div>
    </div>
  );
}

export function fmtCobertura(v: number | null) {
  return v === null ? "—" : `${fmtDec(v, v % 1 ? 1 : 0)}%`;
}

/** Cartão de projeto da visão geral: saúde, achados por severidade e o que pede decisão. */
export function CartaoProjeto({ p, agora }: { p: ResumoProjeto; agora: number }) {
  const estado = estadoDaSaude(p.saude);
  const linhas: { label: string; value: React.ReactNode; destaque?: boolean }[] = [
    { label: "Achados novos (desde a linha de base)", value: fmtInt(p.novos), destaque: p.novos > 0 },
    { label: "Dívida herdada", value: fmtInt(p.herdados) },
    { label: "Cobertura do contrato", value: fmtCobertura(p.cobertura) },
    { label: "Propostas aguardando decisão", value: fmtInt(p.propostasAbertas), destaque: p.propostasAbertas > 0 },
    {
      label: "Gate · 30 dias",
      value: p.gate.negou + p.gate.perguntou + p.gate.permitiu ? `${p.gate.negou} negou · ${p.gate.permitiu} permitiu` : "sem decisões",
    },
  ];
  return (
    <Card className="flex min-w-0 flex-col">
      <div className="flex items-center justify-between gap-3 px-5 pt-[18px]">
        <ProjectTag projeto={p} className="text-[13.5px] font-medium text-ink" />
        <Pill title={p.contratoVersao === null ? "Nenhum contrato publicado" : `Contrato publicado na versão ${p.contratoVersao}`}>
          {p.contratoVersao === null ? "sem contrato" : `contrato v${p.contratoVersao}`}
        </Pill>
      </div>
      <div className="flex-1 px-5 pt-4">
        <div className="flex items-baseline gap-2">
          <span className="text-[30px] leading-none font-semibold tracking-[-0.03em] text-ink tnum">{p.saude === null ? "—" : fmtDec(p.saude, 0)}</span>
          <span className="text-[13px] text-ink-3">/ 100</span>
          <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-ink-3">
            <StatusDot status={estado} className="size-1.5" />
            saúde · coleta {relativo(p.ultimaColeta, agora)}
          </span>
        </div>
        <DistribuicaoSeveridade abertos={p.abertos} className="mt-4" />
      </div>
      <dl className="mt-5 border-t border-line px-5 py-1">
        {linhas.map((m) => (
          <div key={m.label} className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-0">
            <dt className="truncate text-[13px] text-ink-2">{m.label}</dt>
            <dd className={cn("shrink-0 text-right text-[13px] font-medium tnum", m.destaque ? "text-ink" : "text-ink-2")}>{m.value}</dd>
          </div>
        ))}
      </dl>
      <CardFooter>
        <span className="text-[12px] text-ink-3">
          {p.fontes} fontes · {fmtInt(p.objetos)} objetos
          {p.coletasComErro > 0 && <span className="text-crit-ink"> · {p.coletasComErro} com erro</span>}
        </span>
        <Link href={projectHref(p.slug)} className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2 transition-colors hover:text-ink">
          Abrir projeto
          <ArrowRight className="size-3.5" />
        </Link>
      </CardFooter>
    </Card>
  );
}

/** Grade de rótulo/valor das gavetas e cabeçalhos. */
export function MetaGrid({ items, cols = 4 }: { items: { label: string; value: React.ReactNode }[]; cols?: 2 | 3 | 4 }) {
  return (
    <dl className={cn("grid grid-cols-2 gap-x-6 gap-y-4", cols === 3 && "sm:grid-cols-3", cols === 4 && "sm:grid-cols-4")}>
      {items.map((m) => (
        <div key={m.label} className="min-w-0">
          <dt className="text-[11.5px] text-ink-3">{m.label}</dt>
          <dd className="mt-1 truncate text-[13px] text-ink">{m.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Bloco de código (SQL, corpo de função, evidência) — rola em vez de quebrar a página. */
export function Bloco({ children, className }: { children: string; className?: string }) {
  return (
    <pre
      className={cn(
        "max-h-[320px] overflow-auto rounded-[7px] border border-line bg-sunken px-3.5 py-3 font-mono text-[11.5px] leading-relaxed whitespace-pre text-ink-2 scrollbar-thin",
        className,
      )}
    >
      {children}
    </pre>
  );
}

export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-[13px] font-medium text-ink">{children}</h3>
      {aside}
    </div>
  );
}
