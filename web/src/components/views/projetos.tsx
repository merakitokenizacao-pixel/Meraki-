import Link from "next/link";
import { Layers } from "lucide-react";
import { projectHref } from "@/components/shell/nav";
import { Card, PageHeader } from "@/components/ui/card";
import { EmptyState, ProjectTag } from "@/components/ui/misc";
import { StatusDot } from "@/components/ui/status";
import { type ResumoProjeto, estadoDaSaude } from "@/lib/plataforma/modelo";
import { relativo } from "@/lib/tempo";
import { fmtDec, fmtInt } from "@/lib/format";
import { plural } from "@/lib/url";
import { cn } from "@/lib/utils";
import { DistribuicaoSeveridade, fmtCobertura, totalAbertos } from "./comum";

const COLS = "@4xl:grid-cols-[minmax(0,1.4fr)_84px_minmax(0,1fr)_72px_92px_84px_128px_80px]";

function Linha({ p, agora }: { p: ResumoProjeto; agora: number }) {
  return (
    <li className="border-b border-line last:border-0">
      <Link href={projectHref(p.slug)} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-5 py-4 transition-colors hover:bg-subtle", COLS)}>
        <span className="min-w-0">
          <ProjectTag projeto={p} className="text-[13.5px] font-medium text-ink" />
          {p.descricao && <span className="mt-1 block truncate text-[12px] text-ink-3">{p.descricao}</span>}
        </span>
        <span className="flex items-center justify-end gap-2 @4xl:justify-start">
          <StatusDot status={estadoDaSaude(p.saude)} />
          <span className="text-[15px] font-semibold text-ink tnum">{p.saude === null ? "—" : fmtDec(p.saude, 0)}</span>
        </span>
        <span className="col-span-2 min-w-0 @4xl:col-span-1">
          <DistribuicaoSeveridade abertos={p.abertos} />
        </span>
        <span className="hidden text-right text-[13px] text-ink tnum @4xl:block">{fmtInt(p.novos)}</span>
        <span className="hidden text-right text-[13px] text-ink-2 tnum @4xl:block">{fmtCobertura(p.cobertura)}</span>
        <span className="hidden text-right text-[13px] text-ink-2 tnum @4xl:block">{p.contratoVersao === null ? "—" : `v${p.contratoVersao}`}</span>
        <span className="hidden text-right text-[12.5px] text-ink-3 @4xl:block">
          {p.fontes} · {relativo(p.ultimaColeta, agora)}
        </span>
        <span className={cn("hidden text-right text-[13px] tnum @4xl:block", p.propostasAbertas ? "font-medium text-ink" : "text-ink-4")}>{p.propostasAbertas}</span>
      </Link>
    </li>
  );
}

export function ProjetosView({ projetos, agora }: { projetos: ResumoProjeto[]; agora: number }) {
  const abertos = projetos.reduce((s, p) => s + totalAbertos(p.abertos), 0);
  return (
    <div className="animate-enter">
      <PageHeader
        title="Todos os projetos"
        description={`${plural(projetos.length, "projeto", "projetos")} · ${plural(abertos, "achado aberto", "achados abertos")} · clique para abrir sistemas, agentes e contrato`}
      />
      <Card className="overflow-hidden">
        <div className={cn("hidden gap-x-4 border-b border-line bg-sunken px-5 py-2 text-[11.5px] font-medium text-ink-3 @4xl:grid", COLS)}>
          <span>Projeto</span>
          <span>Saúde</span>
          <span>Achados abertos</span>
          <span className="text-right">Novos</span>
          <span className="text-right">Cobertura</span>
          <span className="text-right">Contrato</span>
          <span className="text-right">Fontes · coleta</span>
          <span className="text-right">Propostas</span>
        </div>
        {projetos.length ? (
          <ul>
            {projetos.map((p) => (
              <Linha key={p.id} p={p} agora={agora} />
            ))}
          </ul>
        ) : (
          <EmptyState icon={<Layers className="size-5" />} title="Nenhum projeto nesta conta" description="Cadastre o projeto e as fontes na plataforma e rode a coleta." />
        )}
      </Card>
    </div>
  );
}
