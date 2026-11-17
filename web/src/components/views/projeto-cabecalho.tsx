import { PageHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/ui/status";
import { type DetalheProjeto, corProjeto, estadoDaSaude } from "@/lib/plataforma/modelo";
import { relativo } from "@/lib/tempo";
import { fmtDec } from "@/lib/format";
import { PartTabs } from "./partes-projeto";

/** Cabeçalho comum às partes do projeto (fica no layout: não recarrega ao trocar de parte). */
export function CabecalhoProjeto({ d }: { d: DetalheProjeto }) {
  const p = d.resumo;
  const meta = [
    {
      label: "Saúde",
      value: (
        <span className="inline-flex items-center gap-1.5">
          <StatusDot status={estadoDaSaude(p.saude)} className="size-1.5" />
          {p.saude === null ? "—" : fmtDec(p.saude, 0)}
        </span>
      ),
    },
    { label: "Contrato", value: p.contratoVersao === null ? "não publicado" : `v${p.contratoVersao}` },
    { label: "Fontes", value: p.fontes },
    { label: "Última coleta", value: relativo(p.ultimaColeta, d.agora) },
  ];
  return (
    <>
      <PageHeader
        leading={
          <span className="grid size-11 shrink-0 place-items-center rounded-[7px] border border-line-2 bg-muted">
            <span className="size-2.5 rounded-full" style={{ background: corProjeto(p.cor) }} />
          </span>
        }
        title={p.nome}
        description={p.descricao ?? p.slug}
      />
      <div className="mb-7 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <PartTabs
          slug={p.slug}
          counts={{
            sistemas: p.abertos.critico + p.abertos.alto + p.abertos.medio + p.abertos.baixo,
            agentes: p.agentesAbertos,
            gate: null,
            contrato: p.propostasAbertas,
          }}
        />
        <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px]">
          {meta.map((m) => (
            <div key={m.label} className="flex gap-1.5">
              <dt className="text-ink-3">{m.label}</dt>
              <dd className="text-ink-2 tnum">{m.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}

export function CabecalhoSkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando projeto">
      <div className="mb-7 flex items-center gap-4">
        <Skeleton className="size-11 rounded-[7px]" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-80" />
        </div>
      </div>
      <Skeleton className="mb-7 h-[40px] w-[420px] max-w-full rounded-[7px]" />
    </div>
  );
}

/** Esqueleto do conteúdo de uma parte: 4 indicadores e um bloco. */
export function ParteSkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando">
      <div className="grid gap-4 @2xl:grid-cols-2 @4xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-card border border-line bg-surface p-5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="mt-4 h-7 w-28" />
            <Skeleton className="mt-4 h-3.5 w-32" />
          </div>
        ))}
      </div>
      <div className="mt-9 rounded-card border border-line bg-surface p-5">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="mt-6 h-[240px] w-full" />
      </div>
    </div>
  );
}
