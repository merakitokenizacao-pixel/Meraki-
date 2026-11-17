import Link from "next/link";
import { Bot } from "lucide-react";
import { agenteHref, projectHref } from "@/components/shell/nav";
import { Card, Section } from "@/components/ui/card";
import { EmptyState, Mono, Pill } from "@/components/ui/misc";
import { IconBox } from "@/components/ui/objeto-icon";
import { StatCard } from "@/components/ui/stat";
import { SevChip, StatusChip, StatusDot } from "@/components/ui/status";
import { type Contagem, type DadosAgentesIA, type ResumoAgente, SEVERIDADES } from "@/lib/plataforma/modelo";
import { relativo } from "@/lib/tempo";
import { fmtInt, fmtMs } from "@/lib/format";
import { plural } from "@/lib/url";
import { cn } from "@/lib/utils";
import { ResultadoRodada, Versao, estadoDaRodada, estadoDoRepasse, pct, suficiente, taxa } from "./agente-comum";
import { DistribuicaoSeveridade, totalAbertos } from "./comum";

const COLS = "@5xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]";

function Linha({ a, slug, agora }: { a: ResumoAgente; slug: string; agora: number }) {
  const p = a.producao;
  const minima = a.metas.aprovacao_minima;
  return (
    <li className="border-b border-line last:border-0">
      <Link href={agenteHref(slug, a.id)} className={cn("grid grid-cols-1 items-center gap-x-5 gap-y-3 px-5 py-4 transition-colors hover:bg-subtle sm:grid-cols-2", COLS)}>
        <span className="flex min-w-0 items-center gap-3 sm:col-span-2 @5xl:col-span-1">
          <IconBox>
            <Bot />
          </IconBox>
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate text-[13.5px] font-medium text-ink">{a.nome}</span>
              {a.desativado && <Pill>desativado</Pill>}
            </span>
            <span className="mt-0.5 block truncate text-[12px] text-ink-3">
              {a.workflow.nome}
              {a.contrato ? ` · contrato: ${a.contrato}` : " · fora do contrato"}
            </span>
          </span>
        </span>

        <span className="min-w-0">
          <span className="block text-[11.5px] text-ink-3 @5xl:hidden">Versão</span>
          {a.versao ? (
            <Versao hash={a.versao} rotulo={a.publicacao ? `no ar ${relativo(a.publicacao.inicio, agora)}` : "publicada"} />
          ) : (
            <span className="text-[12.5px] text-ink-3">nunca publicado</span>
          )}
          {a.divergente && (
            <span className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ink-3">
              <StatusDot status="warn" className="size-1.5" />
              rascunho <Mono className="text-[11.5px]">v{a.rascunho?.slice(0, 8)}</Mono> diferente
            </span>
          )}
        </span>

        <span className="min-w-0">
          <span className="block text-[11.5px] text-ink-3 @5xl:hidden">Avaliação</span>
          <ResultadoRodada r={a.rodadaPublicada} minima={minima} />
          {a.rodadaRascunho && (
            <span className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ink-3 tnum">
              <StatusDot status={estadoDaRodada(a.rodadaRascunho, minima)} className="size-1.5" />
              rascunho {pct(a.rodadaRascunho.aprovacao)}
            </span>
          )}
          {!a.rodadaRascunho && a.casos.ativos > 0 && (
            <span className="mt-1 block text-[11.5px] text-ink-3">{plural(a.casos.ativos, "caso ativo", "casos ativos")}</span>
          )}
        </span>

        <span className="min-w-0">
          <span className="block text-[11.5px] text-ink-3 @5xl:hidden">Produção · 7 dias</span>
          {!p || !a.conversasMapeadas ? (
            <>
              <span className="block text-[12.5px] text-ink-3">conversas não mapeadas</span>
              {p && p.execucoes > 0 && (
                <span className="mt-1 block text-[11.5px] text-ink-3 tnum">
                  {fmtInt(p.execucoes)} execuções{p.p95 !== null && ` · p95 ${fmtMs(p.p95)}`}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2 tnum">
                <StatusDot status={suficiente(p) ? estadoDoRepasse(p, a.metas.repasse_maximo) : "maint"} className="size-1.5" />
                <span className="font-medium text-ink">{suficiente(p) ? pct(taxa(p.repasses, p.conversas)) : "—"}</span>
                <span className="text-ink-3">repasse</span>
              </span>
              <span className="mt-1 block text-[11.5px] text-ink-3 tnum">
                {fmtInt(p.conversas)} conversas{p.p95 !== null && ` · p95 ${fmtMs(p.p95)}`}
                {!suficiente(p) && " · dados insuficientes"}
              </span>
            </>
          )}
        </span>

        <span className="min-w-0">
          <span className="block text-[11.5px] text-ink-3 @5xl:hidden">Pior achado</span>
          {a.pior ? (
            <span className="flex min-w-0 items-center gap-2">
              <SevChip sev={a.pior.severidade} />
              <span className="min-w-0 truncate text-[12.5px] text-ink-2" title={a.pior.titulo}>
                <Mono className="text-[11.5px] text-ink-3">{a.pior.regra}</Mono> {a.pior.titulo}
              </span>
            </span>
          ) : (
            <StatusChip status="ok" label="Sem achados" />
          )}
        </span>
      </Link>
    </li>
  );
}

/** Parte "Agentes": os agentes de IA do projeto, do pior para o melhor — e desde qual versão. */
export function AgentesView({ slug, d }: { slug: string; d: DadosAgentesIA }) {
  const ag = d.agentes;
  if (!ag.length) {
    return (
      <Card>
        <EmptyState
          icon={<Bot className="size-5" />}
          title="Nenhum agente de IA coletado"
          description={
            <>
              O motor encontra os agentes nos workflows do n8n (nodes de AI Agent) a cada coleta. Declare cada um na seção <Mono>agentes</Mono> do{" "}
              <Link href={projectHref(slug, "contrato")} className="text-ink-2 underline-offset-2 hover:underline">
                contrato
              </Link>{" "}
              para medir produção e rodar casos de referência.
            </>
          }
        />
      </Card>
    );
  }

  const divergentes = ag.filter((a) => a.divergente).length;
  const comRodada = ag.filter((a) => a.rodadaPublicada?.aprovacao !== null && a.rodadaPublicada);
  const pior = [...comRodada].sort((x, y) => (x.rodadaPublicada!.aprovacao ?? 1) - (y.rodadaPublicada!.aprovacao ?? 1))[0];
  const semRodada = ag.filter((a) => a.versao && !a.rodadaPublicada).length;
  const medidos = ag.filter((a) => a.producao && a.producao.conversas > 0);
  const conversas = medidos.reduce((s, a) => s + a.producao!.conversas, 0);
  const repasses = medidos.reduce((s, a) => s + a.producao!.repasses, 0);
  const acimaDaMeta = medidos.filter((a) => suficiente(a.producao) && estadoDoRepasse(a.producao, a.metas.repasse_maximo) === "serious").length;
  const abertos = ag.reduce<Contagem>((s, a) => {
    for (const k of SEVERIDADES) s[k] += a.abertos[k];
    return s;
  }, { critico: 0, alto: 0, medio: 0, baixo: 0 });
  const piorSev = SEVERIDADES.find((k) => abertos[k] > 0);

  return (
    <>
      <div className="grid gap-4 @2xl:grid-cols-2 @4xl:grid-cols-4">
        <StatCard
          label="Agentes de IA"
          value={fmtInt(ag.length)}
          status={divergentes ? "warn" : undefined}
          foot={divergentes ? `${plural(divergentes, "rascunho diferente", "rascunhos diferentes")} do que está no ar` : "rascunho igual ao publicado em todos"}
        />
        <StatCard
          label="Pior aprovação no ar"
          value={pior ? pct(pior.rodadaPublicada!.aprovacao) : "—"}
          status={pior ? estadoDaRodada(pior.rodadaPublicada, pior.metas.aprovacao_minima) : semRodada ? "warn" : undefined}
          foot={pior ? `${pior.nome} · ${pior.rodadaPublicada!.passaram}/${pior.rodadaPublicada!.casos} casos${semRodada ? ` · ${semRodada} sem rodada` : ""}` : "nenhuma versão no ar foi avaliada"}
        />
        <StatCard
          label="Repasse para humano · 7 dias"
          value={conversas ? pct(taxa(repasses, conversas)) : "—"}
          status={acimaDaMeta ? "serious" : conversas ? "ok" : undefined}
          foot={conversas ? `${fmtInt(conversas)} conversas${acimaDaMeta ? ` · ${plural(acimaDaMeta, "agente acima", "agentes acima")} da meta` : ""}` : "nenhum agente com conversas mapeadas"}
        />
        <StatCard label="Achados abertos" value={fmtInt(totalAbertos(abertos))} status={piorSev ? (piorSev === "critico" ? "crit" : piorSev === "alto" ? "serious" : "warn") : "ok"} foot="pacotes agente, avaliação e produção">
          <DistribuicaoSeveridade abertos={abertos} className="mt-4" />
        </StatCard>
      </div>

      <Section title="Agentes" description="Do pior para o melhor: o pior achado aberto primeiro, depois a aprovação da versão no ar · clique para abrir">
        <Card className="overflow-hidden">
          <div className={cn("hidden gap-x-5 border-b border-line bg-sunken px-5 py-2 text-[11.5px] font-medium text-ink-3 @5xl:grid", COLS)}>
            <span>Agente</span>
            <span>Versão no ar</span>
            <span>Avaliação</span>
            <span>Produção · 7 dias</span>
            <span>Pior achado</span>
          </div>
          <ul>
            {ag.map((a) => (
              <Linha key={a.chave} a={a} slug={slug} agora={d.agora} />
            ))}
          </ul>
        </Card>
      </Section>
    </>
  );
}
