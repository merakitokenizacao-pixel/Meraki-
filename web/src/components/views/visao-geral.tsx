import Link from "next/link";
import { ArrowRight, Bot, FileCheck, LineChart, ScanSearch } from "lucide-react";
import { projectHref } from "@/components/shell/nav";
import { buttonClass } from "@/components/ui/button";
import { Card, CardFooter, CardHeader, PageHeader, Section } from "@/components/ui/card";
import { GraficoSaude } from "./grafico-saude";
import { EmptyState, Mono, Pill, ProjectTag } from "@/components/ui/misc";
import { DecisaoChip, SevChip, StatusDot } from "@/components/ui/status";
import { type DadosVisaoGeral, type Proposta, TIPO_PROPOSTA } from "@/lib/plataforma/modelo";
import { relativo } from "@/lib/tempo";
import { fmtDec } from "@/lib/format";
import { plural } from "@/lib/url";
import { cn } from "@/lib/utils";
import { CartaoProjeto } from "./comum";

function Banner({ d }: { d: DadosVisaoGeral }) {
  const criticos = d.projetos.reduce((s, p) => s + p.abertos.critico, 0);
  const novosGraves = d.projetos.reduce((s, p) => s + p.novosGraves, 0);
  if (!novosGraves) return null;
  return (
    <Link
      href="/achados?origem=novos"
      className="mb-8 flex items-center gap-3 rounded-card border border-crit/30 bg-crit-soft px-4 py-3 transition-colors hover:border-crit/50"
    >
      <StatusDot status="crit" pulse />
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
        <span className="font-medium">{plural(novosGraves, "achado novo grave", "achados novos graves")} desde a linha de base</span>
        <span className="text-ink-2">
          {" "}
          — dívida que entrou depois da primeira coleta. {plural(criticos, "achado crítico aberto", "achados críticos abertos")} no total.
        </span>
      </span>
      <span className="hidden shrink-0 items-center gap-1 text-[12.5px] text-ink-2 sm:inline-flex">
        Ver achados novos
        <ArrowRight className="size-3.5" />
      </span>
    </Link>
  );
}

function LinhaProposta({ p, agora }: { p: Proposta; agora: number }) {
  return (
    <li className="border-b border-line last:border-0">
      <Link
        href={projectHref(p.projeto.slug, "contrato")}
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-colors hover:bg-subtle @4xl:grid-cols-[92px_minmax(0,1fr)_150px_120px_96px]"
      >
        <span className="col-span-2 @4xl:col-span-1">
          <Pill>{p.origem === "agente" ? "Agente" : "Você"}</Pill>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] font-medium text-ink">{p.justificativa}</span>
          <span className="mt-0.5 block truncate text-[12px] text-ink-3">
            {TIPO_PROPOSTA[p.tipo] ?? p.tipo}
            {p.objetos.length > 0 && (
              <>
                {" · "}
                <Mono className="text-[11.5px] text-ink-3">{p.objetos.join(", ")}</Mono>
              </>
            )}
          </span>
        </span>
        <span className="hidden @4xl:block">
          <ProjectTag projeto={p.projeto} />
        </span>
        <span className="hidden flex-wrap gap-1 @4xl:flex">
          {p.regras.slice(0, 3).map((r) => (
            <Pill key={r} className="h-5 px-1.5 font-mono text-[10.5px]">
              {r}
            </Pill>
          ))}
        </span>
        <span className="text-right text-[12px] text-ink-3">{relativo(p.criadoEm, agora)}</span>
      </Link>
    </li>
  );
}

function Tendencia({ d }: { d: DadosVisaoGeral }) {
  const dias = [...new Set(d.serie.map((s) => s.dia))].sort();
  if (dias.length < 2) {
    return (
      <Card>
        <EmptyState
          icon={<LineChart className="size-5" />}
          title="A tendência aparece a partir do segundo dia de coleta"
          description={
            d.projetos.length
              ? `Hoje: ${d.projetos.map((p) => `${p.nome} com saúde ${p.saude === null ? "—" : fmtDec(p.saude, 0)}`).join(" · ")}. O motor grava um ponto por dia e projeto.`
              : "O motor grava um ponto por dia e projeto."
          }
        />
      </Card>
    );
  }
  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader icon={<LineChart />} title="Saúde por projeto" description="0 a 100, calculada a cada verificação · um ponto por dia" />
      <div className="px-3 pb-4 sm:px-5">
        <GraficoSaude serie={d.serie} projetos={d.projetos.map((p) => ({ slug: p.slug, nome: p.nome, cor: p.cor }))} />
      </div>
    </Card>
  );
}

export function VisaoGeralView({ d }: { d: DadosVisaoGeral }) {
  const fontes = d.projetos.reduce((s, p) => s + p.fontes, 0);
  const ultima = d.projetos.map((p) => p.ultimaColeta).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
  return (
    <div className="animate-enter">
      <PageHeader
        title="Visão geral"
        description={`${plural(d.projetos.length, "projeto", "projetos")} · ${plural(fontes, "fonte", "fontes")} · última coleta ${relativo(ultima, d.agora)}`}
        actions={
          <Link href="/achados" className={buttonClass("secondary")}>
            <ScanSearch />
            Ver achados
          </Link>
        }
      />

      <Banner d={d} />

      <Section title="Projetos" description="Saúde de 0 a 100 calculada pelo motor e achados abertos por severidade.">
        {d.projetos.length ? (
          <div className={cn("grid gap-4", d.projetos.length > 1 && "@3xl:grid-cols-2", d.projetos.length > 2 && "@6xl:grid-cols-3")}>
            {d.projetos.map((p) => (
              <CartaoProjeto key={p.id} p={p} agora={d.agora} />
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState title="Nenhum projeto nesta conta" description="Cadastre o projeto e as fontes na plataforma e rode `meraki coletar`." />
          </Card>
        )}
      </Section>

      <Section title="Precisa de decisão" description="Propostas de mudança de estrutura. O agente espera a decisão na tela Contrato.">
        <Card className="overflow-hidden">
          {d.propostas.length ? (
            <ul>
              {d.propostas.map((p) => (
                <LinhaProposta key={p.id} p={p} agora={d.agora} />
              ))}
            </ul>
          ) : (
            <EmptyState icon={<FileCheck className="size-5" />} title="Nenhuma proposta aguardando" description="Quando um agente propuser uma estrutura nova, ela aparece aqui." />
          )}
        </Card>
      </Section>

      <Section title="Atividade" description="O que entrou desde a linha de base e o que o gate decidiu.">
        <div className="grid gap-4 @4xl:grid-cols-2">
          <Card className="flex min-w-0 flex-col overflow-hidden">
            <CardHeader icon={<ScanSearch />} title="Achados novos" description="Abertos e fora da dívida herdada, do mais grave ao mais leve" />
            {d.novos.length ? (
              <ul className="border-t border-line">
                {d.novos.map((a) => (
                  <li key={a.id} className="border-b border-line last:border-0">
                    <Link href={`/achados?achado=${a.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-subtle">
                      <SevChip sev={a.severidade} className="w-[76px] justify-center" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">{a.titulo}</span>
                        <span className="mt-0.5 block truncate text-[12px] text-ink-3">
                          <Mono className="text-[11.5px] text-ink-3">{a.regra}</Mono> · {a.projeto.nome}
                        </span>
                      </span>
                      <span className="shrink-0 text-[12px] text-ink-3">{relativo(a.primeiroVisto, d.agora)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Nada novo" description="Todo achado aberto é dívida herdada da primeira coleta." />
            )}
            <CardFooter>
              <span className="text-[12px] text-ink-3">Dívida herdada fica na tela Achados</span>
              <Link href="/achados" className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2 hover:text-ink">
                Todos os achados
                <ArrowRight className="size-3.5" />
              </Link>
            </CardFooter>
          </Card>

          <Card className="flex min-w-0 flex-col overflow-hidden">
            <CardHeader icon={<Bot />} title="Gate · últimas decisões" description="Cada migration que um agente tentou aplicar" />
            {d.gate.length ? (
              <ul className="border-t border-line">
                {d.gate.map((g) => (
                  <li key={g.id} className="border-b border-line last:border-0">
                    <Link href={projectHref(g.projeto.slug, "gate")} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-subtle">
                      <DecisaoChip decisao={g.decisao} className="w-[84px] justify-center" />
                      <span className="min-w-0 flex-1">
                        <Mono className="block truncate text-[12px] text-ink">{g.resumo}</Mono>
                        <span className="mt-0.5 block truncate text-[12px] text-ink-3">
                          {g.projeto.nome} · {g.origem}
                          {g.regras.length > 0 && ` · ${g.regras.join(", ")}`}
                        </span>
                      </span>
                      <span className="shrink-0 text-[12px] text-ink-3">{relativo(g.criadoEm, d.agora)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Nenhuma decisão ainda" description="Ligue o hook do gate no agente (parte Agentes de cada projeto)." />
            )}
            <CardFooter>
              <span className="text-[12px] text-ink-3">Modo autônomo nega · modo pergunta pede confirmação</span>
            </CardFooter>
          </Card>
        </div>
      </Section>

      <Section title="Tendência" description="Saúde diária de cada projeto, na mesma escala.">
        <Tendencia d={d} />
      </Section>
    </div>
  );
}
