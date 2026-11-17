import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, Bot } from "lucide-react";
import { projectHref } from "@/components/shell/nav";
import { PageHeader } from "@/components/ui/card";
import { Mono, Pill } from "@/components/ui/misc";
import { StatCard } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status";
import { type DetalheAgente, SEV, SEVERIDADES } from "@/lib/plataforma/modelo";
import { dataHora, relativo } from "@/lib/tempo";
import { fmtInt } from "@/lib/format";
import { plural } from "@/lib/url";
import { AbasDoAgente } from "./agente-abas";
import { BotaoRodar } from "./agente-casos";
import { estadoDaRodada, estadoDoAgente, estadoDoRepasse, pct, suficiente, taxa } from "./agente-comum";
import { DistribuicaoSeveridade, totalAbertos } from "./comum";

/** Página de um agente de IA: o que ele alcança, o que está coberto, o que a última mudança quebrou e como vai no uso real. */
export function AgenteView({ d }: { d: DetalheAgente }) {
  const a = d.resumo;
  const minima = a.metas.aprovacao_minima ?? 0.9;
  const pub = a.rodadaPublicada;
  const rasc = a.rodadaRascunho;
  const p = a.producao;
  const total = totalAbertos(a.abertos);
  const piorSev = SEVERIDADES.find((k) => a.abertos[k] > 0);
  const estado = estadoDoAgente(a);

  return (
    <>
      <Link href={projectHref(d.projeto.slug, "agentes")} className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-ink-3 transition-colors hover:text-ink">
        <ArrowLeft className="size-3.5" />
        Todos os agentes
      </Link>
      <PageHeader
        leading={
          <span className="grid size-11 shrink-0 place-items-center rounded-[7px] border border-line-2 bg-muted text-ink-2">
            <Bot className="size-5" strokeWidth={1.75} />
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {a.nome}
            <StatusChip status={estado} label={a.pior ? `${SEV[a.pior.severidade].label} · ${a.pior.regra}` : "Sem achados"} />
            {a.contrato ? <Pill title="Nome do agente no contrato">contrato: {a.contrato}</Pill> : <Pill>fora do contrato</Pill>}
          </span>
        }
        description={
          <>
            {a.workflow.nome} <Mono className="text-[12px] text-ink-3">({a.workflow.id})</Mono>
            {a.modelo && ` · ${a.modelo}`}
            {` · ${plural(a.tools, "tool", "tools")}`}
            {a.desativado && " · node desativado"}
          </>
        }
        actions={<BotaoRodar projeto={d.projeto.id} agente={a.chave} casos={a.casos.ativos} emCurso={a.rodadaEmCurso} agora={d.agora} />}
      />

      <div className="grid gap-4 @2xl:grid-cols-2 @4xl:grid-cols-4">
        <StatCard
          label="Versão no ar"
          value={<span className="font-mono text-[24px]">{a.versao ? `v${a.versao.slice(0, 8)}` : "—"}</span>}
          status={a.divergente ? "warn" : a.versao ? "ok" : "maint"}
          foot={
            a.publicacao ? (
              <span title={a.publicacao.inicioMinimo ? `Publicada entre ${dataHora(a.publicacao.inicioMinimo)} e ${dataHora(a.publicacao.inicio)}` : dataHora(a.publicacao.inicio)}>
                {`no ar ${relativo(a.publicacao.inicio, d.agora)}`}
                {a.publicacao.origem === "coleta" ? " · hora vista na coleta" : " · hora do gate"}
                {a.divergente && a.rascunho ? ` · rascunho v${a.rascunho.slice(0, 8)} diferente` : ""}
              </span>
            ) : a.versao ? (
              "publicada"
            ) : (
              "workflow nunca publicado"
            )
          }
        />
        <StatCard
          label="Aprovação nos casos"
          value={pub ? pct(pub.aprovacao) : "—"}
          status={pub ? estadoDaRodada(pub, minima) : a.versao ? "warn" : undefined}
          delta={pub?.aprovacao != null && rasc?.aprovacao != null ? (rasc.aprovacao - pub.aprovacao) * 100 : undefined}
          deltaUnit=" pts"
          foot={
            pub
              ? `${pub.passaram}/${pub.casos} na versão no ar · meta ${pct(minima)}${rasc ? " · rascunho vs no ar" : ""}`
              : a.versao
                ? "a versão no ar nunca rodou os casos"
                : `${plural(a.casos.ativos, "caso ativo", "casos ativos")}`
          }
        />
        <StatCard
          label="Repasse para humano · 7 dias"
          value={p && suficiente(p) ? pct(taxa(p.repasses, p.conversas)) : "—"}
          status={p && suficiente(p) ? estadoDoRepasse(p, a.metas.repasse_maximo) : undefined}
          foot={
            !p || !a.conversasMapeadas
              ? "conversas não mapeadas no contrato"
              : !suficiente(p)
                ? `${fmtInt(p.conversas)} conversas · dados insuficientes`
                : `${fmtInt(p.conversas)} conversas${a.metas.repasse_maximo !== undefined ? ` · meta até ${pct(a.metas.repasse_maximo)}` : ""}`
          }
        />
        <StatCard
          label="Achados abertos"
          value={fmtInt(total)}
          status={piorSev ? SEV[piorSev].status : "ok"}
          foot={a.casos.nuncaRodaram ? `${plural(a.casos.nuncaRodaram, "caso nunca rodou", "casos nunca rodaram")}` : `${plural(a.casos.ativos, "caso ativo", "casos ativos")} · ${a.casos.criticos} críticos`}
        >
          <DistribuicaoSeveridade abertos={a.abertos} className="mt-4" />
        </StatCard>
      </div>

      <Suspense fallback={null}>
        <AbasDoAgente d={d} />
      </Suspense>
    </>
  );
}
