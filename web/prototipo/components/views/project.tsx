"use client";

import Link from "next/link";
import { Suspense, useMemo } from "react";
import { Sparkles } from "lucide-react";
import { FlowBase, FlowDiagram, FlowLegend } from "@/components/charts/flow-diagram";
import { PROJECT_PARTS, projectHref, type ProjectPart } from "@/components/shell/nav";
import { useShell } from "@/components/shell/provider";
import { Button } from "@/components/ui/button";
import { Card, CardFooter, PageHeader, Section } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat";
import { AgentCard, byStatus } from "@/components/views/agents";
import { ResourceTable } from "@/components/views/infra";
import { ResourceDrawer } from "@/components/views/resource-drawer";
import { AGENTS, AGENT_STATUS_LABEL, fleetSummary } from "@/lib/data/agents";
import { SYSTEM_FLOWS, agentFlow, type Flow } from "@/lib/data/flows";
import { RESOURCES, SATURATION_LIMIT, infraSummary } from "@/lib/data/infra";
import { projectById } from "@/lib/data/projects";
import { fmtBRL, fmtCompact, fmtPct } from "@/lib/format";
import { RANGES } from "@/lib/time";
import { worstStatus, type ProjectId } from "@/lib/types";
import { plural } from "@/lib/url";
import { cn } from "@/lib/utils";

/** Fundo pontilhado discreto da área do diagrama. */
const CANVAS: React.CSSProperties = {
  backgroundImage: "radial-gradient(rgb(255 255 255 / 0.045) 1px, transparent 1px)",
  backgroundSize: "18px 18px",
  backgroundPosition: "center",
};

/** Abas das duas partes do projeto — são links: cada parte tem a própria URL. */
function PartTabs({ id, part }: { id: ProjectId; part: ProjectPart }) {
  const { env } = useShell();
  const counts: Record<ProjectPart, number> = {
    sistemas: RESOURCES.filter((r) => r.project === id && (env === "all" || r.env === env)).length,
    agentes: AGENTS.filter((a) => a.project === id).length,
  };
  return (
    <nav aria-label="Partes do projeto" className="inline-flex items-center gap-0.5 rounded-[10px] border border-line bg-sunken p-[3px]">
      {PROJECT_PARTS.map((pt) => {
        const active = pt.key === part;
        const Icon = pt.icon;
        return (
          <Link
            key={pt.key}
            href={projectHref(id, pt.key)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-8 items-center gap-2 rounded-[7px] border px-3.5 text-[13px] font-medium transition-colors",
              active ? "border-line-2 bg-raised text-ink shadow-pill" : "border-transparent text-ink-3 hover:text-ink-2",
            )}
          >
            <Icon className="size-3.5" strokeWidth={1.75} />
            {pt.label}
            <span className={cn("tnum", active ? "text-ink-3" : "text-ink-4")}>{counts[pt.key]}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function FlowCard({ flow, footer }: { flow: Flow; footer: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="px-5 pt-5 pb-6" style={CANVAS}>
        <FlowDiagram flow={flow} />
      </div>
      <CardFooter className="flex-wrap">{footer}</CardFooter>
    </Card>
  );
}

function SystemsPart({ id }: { id: ProjectId }) {
  const { env, range } = useShell();
  const scope = useMemo(() => (env === "all" ? RESOURCES : RESOURCES.filter((r) => r.env === env)), [env]);
  const list = useMemo(() => scope.filter((r) => r.project === id), [scope, id]);
  const s = infraSummary(list, range);
  const totalCost = scope.reduce((x, r) => x + r.cost, 0);
  const flow = SYSTEM_FLOWS[id];
  const c = s.counts;

  return (
    <>
      <div className="grid gap-4 @2xl:grid-cols-2 @4xl:grid-cols-4">
        <StatCard
          label="Recursos com alerta"
          value={s.alerting}
          unit={`de ${s.total}`}
          status={s.alerting ? worstStatus(list.map((r) => r.status)) : "ok"}
          foot={
            [c.crit && plural(c.crit, "crítico", "críticos"), c.serious && plural(c.serious, "degradado", "degradados"), c.warn && `${c.warn} em atenção`]
              .filter(Boolean)
              .join(" · ") || "Nenhum alerta ativo"
          }
        />
        <StatCard label={`Disponibilidade · ${RANGES[range].window}`} value={fmtPct(s.uptime, 2)} foot="Meta de 99,90%" />
        <StatCard label={`Uso acima de ${SATURATION_LIMIT}%`} value={s.saturated} unit={`de ${s.total}`} foot="CPU, memória, conexões ou disco" />
        <StatCard
          label="Custo mensal"
          value={`${fmtBRL(s.cost / 1000, 0)} mil`}
          foot={totalCost ? `${fmtPct((s.cost / totalCost) * 100, 0)} do custo de todos os projetos` : undefined}
        />
      </div>

      <Section title={flow.title} description={flow.description}>
        <FlowCard flow={flow} footer={<>{flow.base ? <FlowBase ids={flow.base} /> : <span className="text-[12px] text-ink-3">Produção</span>}<FlowLegend flow={flow} /></>} />
      </Section>

      <Section title="Recursos" description="Agrupados por categoria e ordenados por severidade · clique para abrir o detalhe">
        <ResourceTable list={list} showProject={false} />
      </Section>
    </>
  );
}

function AgentsPart({ id }: { id: ProjectId }) {
  const agents = useMemo(() => AGENTS.filter((a) => a.project === id).sort(byStatus), [id]);
  const flow = useMemo(() => agentFlow(id), [id]);
  const f = fleetSummary(agents);
  const c = f.counts;

  return (
    <>
      <div className="grid gap-4 @2xl:grid-cols-2 @4xl:grid-cols-4">
        <StatCard
          label="Agentes fora da meta"
          value={f.offTarget}
          unit={`de ${f.total}`}
          status={worstStatus(agents.map((a) => a.status))}
          foot={
            [c.crit && plural(c.crit, "crítico", "críticos"), c.serious && `${c.serious} abaixo da meta`, c.warn && `${c.warn} em atenção`].filter(Boolean).join(" · ") ||
            "Todos na meta"
          }
        />
        <StatCard label="Precisão média" value={fmtPct(f.accuracy)} delta={f.accuracyDelta} deltaUnit=" pts" foot="vs. semana anterior" />
        <StatCard label="Taxa de resolução" value={fmtPct(f.resolution)} delta={f.resolutionDelta} deltaUnit=" pts" foot="vs. semana anterior" />
        <StatCard label="Taxa de alucinação" value={fmtPct(f.hallucination)} delta={f.hallucinationDelta} deltaUnit=" pts" goodWhen="down" foot="vs. semana anterior" />
      </div>

      <Section title={flow.title} description={flow.description}>
        <FlowCard
          flow={flow}
          footer={
            <>
              <span className="text-[12px] text-ink-3">{fmtCompact(f.volume)} conversas por dia · média dos últimos 7 dias</span>
              <FlowLegend flow={flow} labels={AGENT_STATUS_LABEL} />
            </>
          }
        />
      </Section>

      <Section title="Agentes" description="Ordenados por severidade. A meta de cada indicador é definida por agente.">
        {/* Grade que fecha sem sobras: 3 colunas só quando o total é múltiplo de 3. */}
        <div className={cn("grid gap-4 @2xl:grid-cols-2", agents.length % 3 === 0 && "@5xl:grid-cols-3")}>
          {agents.map((a) => (
            <AgentCard key={a.id} a={a} />
          ))}
        </div>
      </Section>
    </>
  );
}

/** Página de um projeto: duas partes — Sistemas e Agentes —, cada uma com o próprio fluxo. */
export function ProjectView({ id, part }: { id: ProjectId; part: ProjectPart }) {
  const { openCopilot } = useShell();
  const p = projectById(id)!;
  return (
    <div className="animate-enter">
      <PageHeader
        leading={
          <span className="grid size-11 shrink-0 place-items-center rounded-[10px] border border-line-2 bg-muted">
            <span className="size-2.5 rounded-full" style={{ background: p.color }} />
          </span>
        }
        title={p.name}
        description={`${p.area} · ${p.description}`}
        actions={
          <Button onClick={() => openCopilot(part === "sistemas" ? `Recursos do ${p.name} em produção` : `Agentes do ${p.name}`)}>
            <Sparkles />
            Perguntar ao Copilot
          </Button>
        }
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <PartTabs id={id} part={part} />
        <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px]">
          <div className="flex gap-1.5">
            <dt className="text-ink-3">Squad</dt>
            <dd className="text-ink-2">{p.squad.replace(/^Squad /, "")}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-ink-3">Responsável</dt>
            <dd className="text-ink-2">{p.lead}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-ink-3">Índice de saúde</dt>
            <dd className="text-ink-2 tnum">{p.health}</dd>
          </div>
        </dl>
      </div>

      {part === "sistemas" ? <SystemsPart id={id} /> : <AgentsPart id={id} />}

      <Suspense fallback={null}>
        <ResourceDrawer />
      </Suspense>
    </div>
  );
}
