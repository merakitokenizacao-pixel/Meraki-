"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Bot, Server, Share2, Siren, Sparkles } from "lucide-react";
import { TimeSeriesChart } from "@/components/charts/time-series";
import { useShell } from "@/components/shell/provider";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardFooter, CardHeader, PageHeader, Section } from "@/components/ui/card";
import { Delta } from "@/components/ui/delta";
import { Meter, SegmentBar } from "@/components/ui/meter";
import { Avatar, Mono, ProjectTag } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { STATUS_META, SevBadge, StatusDot } from "@/components/ui/status";
import { AGENTS, agentSeries, fleetSummary } from "@/lib/data/agents";
import { ACTIVE_INCIDENTS, INCIDENTS, incidentSummary } from "@/lib/data/incidents";
import { RESOURCES, SATURATION_LIMIT, infraSummary, resourceById, resourceSeries } from "@/lib/data/infra";
import { ATTENTION } from "@/lib/data/overview";
import { PEOPLE } from "@/lib/data/people";
import { PROJECTS } from "@/lib/data/projects";
import { fmtBRL, fmtDec, fmtMs, fmtPct } from "@/lib/format";
import { RANGES, TODAY_LONG, axisLabels, durationLabel, indexFor } from "@/lib/time";
import type { Status } from "@/lib/types";
import { cn } from "@/lib/utils";

/* ─────────────────────── Resumo por domínio ─────────────────────── */

type DomainMetric = { label: string; value: string; delta?: number; deltaUnit?: string; goodWhen?: "up" | "down"; decimals?: number };

function DomainCard({
  icon,
  title,
  href,
  linkLabel,
  headline,
  caption,
  parts,
  metrics,
}: {
  icon: React.ReactNode;
  title: string;
  href: string;
  linkLabel: string;
  headline: React.ReactNode;
  caption: string;
  parts: { label: string; value: number; status: Status }[];
  metrics: DomainMetric[];
}) {
  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader icon={icon} title={title} />
      <div className="flex-1 px-5">
        <div className="text-[30px] leading-none font-semibold tracking-[-0.03em] text-ink">{headline}</div>
        <div className="mt-2 text-[12.5px] text-ink-3">{caption}</div>
        <SegmentBar className="mt-4" parts={parts.map((p) => ({ label: p.label, value: p.value, color: STATUS_META[p.status].hex }))} />
        <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[11.5px] text-ink-3">
          {parts
            .filter((p) => p.value > 0)
            .map((p) => (
              <span key={p.label} className="inline-flex items-center gap-1.5">
                <StatusDot status={p.status} className="size-1.5" />
                {p.label} <span className="text-ink-2 tnum">{p.value}</span>
              </span>
            ))}
        </div>
      </div>
      <dl className="mt-5 border-t border-line px-5 py-1">
        {metrics.map((m) => (
          <div key={m.label} className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-0">
            <dt className="truncate text-[13px] text-ink-2">{m.label}</dt>
            <dd className="flex shrink-0 items-center gap-2.5">
              {m.delta !== undefined && <Delta value={m.delta} unit={m.deltaUnit ?? "%"} goodWhen={m.goodWhen ?? "up"} decimals={m.decimals ?? 1} />}
              <span className="w-[76px] text-right text-[13px] font-medium text-ink tnum">{m.value}</span>
            </dd>
          </div>
        ))}
      </dl>
      <CardFooter>
        <Link href={href} className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2 transition-colors hover:text-ink">
          {linkLabel}
          <ArrowRight className="size-3.5" />
        </Link>
      </CardFooter>
    </Card>
  );
}

function DomainSummary() {
  const { env, range } = useShell();
  const resources = env === "all" ? RESOURCES : RESOURCES.filter((r) => r.env === env);
  const infra = infraSummary(resources, range);
  const fleet = fleetSummary();
  const inc = incidentSummary();
  const compare = RANGES[range].compare;

  return (
    <div className="grid gap-4 @3xl:grid-cols-3">
      <DomainCard
        icon={<Server />}
        title="Sistemas"
        href="/infraestrutura"
        linkLabel="Abrir sistemas"
        headline={
          <>
            {infra.alerting}
            <span className="text-[18px] font-normal text-ink-3"> de {infra.total}</span>
          </>
        }
        caption={`recursos com alerta · ${compare}`}
        parts={[
          { label: "Crítico", value: infra.counts.crit, status: "crit" },
          { label: "Degradado", value: infra.counts.serious, status: "serious" },
          { label: "Atenção", value: infra.counts.warn, status: "warn" },
          { label: "Operacional", value: infra.counts.ok, status: "ok" },
          { label: "Manutenção", value: infra.counts.maint, status: "maint" },
        ]}
        metrics={[
          { label: `Disponibilidade (${RANGES[range].window})`, value: fmtPct(infra.uptime, 2) },
          { label: `Recursos com uso ≥ ${SATURATION_LIMIT}%`, value: `${infra.saturated} de ${infra.total}` },
          { label: "Custo mensal", value: `${fmtBRL(infra.cost / 1000, 0)} mil`, delta: infra.costDelta, goodWhen: "down" },
        ]}
      />
      <DomainCard
        icon={<Bot />}
        title="Agentes de IA"
        href="/agentes"
        linkLabel="Abrir agentes"
        headline={
          <>
            {fleet.offTarget}
            <span className="text-[18px] font-normal text-ink-3"> de {fleet.total}</span>
          </>
        }
        caption="agentes fora da meta de qualidade"
        parts={[
          { label: "Crítico", value: fleet.counts.crit, status: "crit" },
          { label: "Abaixo da meta", value: fleet.counts.serious, status: "serious" },
          { label: "Atenção", value: fleet.counts.warn, status: "warn" },
          { label: "Na meta", value: fleet.counts.ok, status: "ok" },
        ]}
        metrics={[
          { label: "Precisão média", value: fmtPct(fleet.accuracy), delta: fleet.accuracyDelta, deltaUnit: " pts" },
          { label: "Taxa de resolução", value: fmtPct(fleet.resolution), delta: fleet.resolutionDelta, deltaUnit: " pts" },
          { label: "Taxa de alucinação", value: fmtPct(fleet.hallucination), delta: fleet.hallucinationDelta, deltaUnit: " pts", goodWhen: "down" },
        ]}
      />
      <DomainCard
        icon={<Siren />}
        title="Incidentes"
        href="/incidentes"
        linkLabel="Abrir incidentes"
        headline={inc.active}
        caption="incidentes ativos agora"
        parts={[
          { label: "SEV-1", value: inc.sev[1], status: "crit" },
          { label: "SEV-2", value: inc.sev[2], status: "serious" },
          { label: "SEV-3", value: inc.sev[3], status: "warn" },
          { label: "SEV-4", value: inc.sev[4], status: "maint" },
        ]}
        metrics={[
          { label: "Tempo até reconhecer", value: durationLabel(inc.mtta), delta: inc.mttaDelta, goodWhen: "down", decimals: 0 },
          { label: "Tempo até resolver", value: durationLabel(inc.mttr), delta: inc.mttrDelta, goodWhen: "down", decimals: 0 },
          { label: "Detectados pelo Meraki", value: `${inc.byMeraki} de ${inc.active}` },
        ]}
      />
    </div>
  );
}

/* ─────────────────────── Fila de atenção ─────────────────────── */

const KIND_LABEL = { infra: "Sistema", agent: "Agente de IA", incident: "Incidente" } as const;
const ATTENTION_COLS = "@4xl:grid-cols-[88px_minmax(0,1fr)_128px_96px_132px_92px_116px]";

function AttentionTable() {
  const [kind, setKind] = useState<"all" | "infra" | "agent" | "incident">("all");
  const items = kind === "all" ? ATTENTION : ATTENTION.filter((a) => a.kind === kind);
  const count = (k: string) => ATTENTION.filter((a) => a.kind === k).length;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <Segmented
          size="sm"
          ariaLabel="Filtrar por domínio"
          value={kind}
          onChange={setKind}
          options={[
            { value: "all", label: "Todos", count: ATTENTION.length },
            { value: "infra", label: "Sistemas", count: count("infra") },
            { value: "agent", label: "Agentes", count: count("agent") },
            { value: "incident", label: "Incidentes", count: count("incident") },
          ]}
        />
        <span className="text-[12px] text-ink-3">Ordenado por severidade e impacto</span>
      </div>
      <div className={cn("hidden border-y border-line bg-sunken px-5 py-2 text-[11.5px] font-medium text-ink-3 @4xl:grid @4xl:gap-4", ATTENTION_COLS)}>
        <span>Severidade</span>
        <span>Problema</span>
        <span>Domínio</span>
        <span>Projeto</span>
        <span>Responsável</span>
        <span>Duração</span>
        <span className="text-right">Indicador</span>
      </div>
      <ul className="border-t border-line @4xl:border-t-0">
        {items.map((it) => (
          <li key={it.id} className="border-b border-line last:border-0">
            <Link
              href={it.href}
              className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-colors hover:bg-subtle", ATTENTION_COLS)}
            >
              <span className="col-span-2 @4xl:col-span-1">
                <SevBadge sev={it.sev} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-medium text-ink">{it.title}</span>
                <span className="mt-0.5 block truncate text-[12px] text-ink-3">
                  <Mono className="text-[11.5px] text-ink-3">{it.entity}</Mono> · {it.detail}
                </span>
              </span>
              <span className="hidden text-[12.5px] text-ink-2 @4xl:block">{KIND_LABEL[it.kind]}</span>
              <span className="hidden @4xl:block">
                <ProjectTag id={it.project} />
              </span>
              <span className="hidden min-w-0 items-center gap-2 text-[12.5px] text-ink-2 @4xl:flex">
                <Avatar name={PEOPLE[it.owner].name} size={20} />
                <span className="truncate">{PEOPLE[it.owner].name}</span>
              </span>
              <span className="hidden text-[12.5px] text-ink-3 tnum @4xl:block">{durationLabel(it.since)}</span>
              <span className="text-right">
                <span className="block text-[13.5px] font-medium text-ink tnum">{it.metric.value}</span>
                <span className="mt-1 flex items-center justify-end gap-2">
                  <span className="text-[11.5px] text-ink-3">{it.metric.label}</span>
                  {it.metric.meter !== undefined && (
                    <Meter value={it.metric.meter} tone={it.metric.tone === "maint" ? "neutral" : it.metric.tone} className="w-10" />
                  )}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ─────────────────────── Tendências ─────────────────────── */

const DB_CONTEXT = ["atlas-pg-replica-1", "orion-pg-ledger", "vega-mysql-orders", "orion-mongo-docs", "nimbus-pgvector-catalog"];

function DatabaseLatency() {
  const { range } = useShell();
  const labels = useMemo(() => axisLabels(range), [range]);
  const series = useMemo(() => {
    const primary = resourceById("atlas-pg-primary")!;
    return [
      ...DB_CONTEXT.map((id) => ({ key: id, name: id, color: "var(--color-ink-4)", data: resourceSeries(resourceById(id)!, "latency", range), muted: true })),
      { key: primary.id, name: "atlas-pg-primary", color: "var(--color-s1)", data: resourceSeries(primary, "latency", range), area: true },
    ];
  }, [range]);
  const deploy = indexFor(range, 121);
  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader
        icon={<Server />}
        title="Latência p95 dos bancos de produção"
        description="atlas-pg-primary em destaque; demais bancos em cinza"
        actions={
          <Link href="/infraestrutura?recurso=atlas-pg-primary" className={buttonClass("ghost", "sm")}>
            Detalhes
          </Link>
        }
      />
      <div className="px-3 pb-4 sm:px-5">
        <TimeSeriesChart
          labels={labels}
          series={series}
          height={232}
          threshold={{ value: 250, label: "SLO 250 ms" }}
          markers={deploy >= 0 ? [{ index: deploy, label: "deploy v2.18.0" }] : []}
          mutedLegend="Outros 5 bancos"
          valueFormat={(v) => fmtMs(v)}
          yWidth={40}
        />
      </div>
    </Card>
  );
}

function AgentAccuracy() {
  const { range } = useShell();
  const labels = useMemo(() => axisLabels(range), [range]);
  const series = useMemo(() => {
    const aurora = AGENTS.find((a) => a.id === "aurora")!;
    return [
      ...AGENTS.filter((a) => a.id !== "aurora").map((a) => ({
        key: a.id,
        name: a.name,
        color: "var(--color-ink-4)",
        data: agentSeries(a, "accuracy", range),
        muted: true,
      })),
      { key: aurora.id, name: "Aurora", color: "var(--color-s1)", data: agentSeries(aurora, "accuracy", range), area: true },
    ];
  }, [range]);
  const deploy = indexFor(range, 4282);
  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader
        icon={<Bot />}
        title="Precisão dos agentes"
        description="Aurora em destaque; demais agentes em cinza"
        actions={
          <Link href="/agentes/aurora" className={buttonClass("ghost", "sm")}>
            Detalhes
          </Link>
        }
      />
      <div className="px-3 pb-4 sm:px-5">
        <TimeSeriesChart
          labels={labels}
          series={series}
          height={232}
          yDomain={[75, 100]}
          threshold={{ value: 90, label: "Meta 90%" }}
          markers={deploy >= 0 ? [{ index: deploy, label: "Aurora v2.4.0" }] : []}
          mutedLegend="Outros 11 agentes"
          valueFormat={(v) => `${fmtDec(v, 1)}%`}
          yFormat={(v) => `${v}%`}
          yWidth={40}
        />
      </div>
    </Card>
  );
}

/* ─────────────────────── Projetos ─────────────────────── */

function Projects() {
  return (
    <div className="grid gap-4 @lg:grid-cols-2 @4xl:grid-cols-5">
      {PROJECTS.map((p) => {
        const incidents = INCIDENTS.filter((i) => i.project === p.id && i.status !== "resolved" && i.status !== "maintenance").length;
        const resources = RESOURCES.filter((r) => r.project === p.id && r.status !== "ok" && r.status !== "maint").length;
        const agents = AGENTS.filter((a) => a.project === p.id && a.status !== "ok").length;
        const tone: Status = p.health >= 85 ? "ok" : p.health >= 75 ? "warn" : "crit";
        return (
          <Link key={p.id} href={`/projetos/${p.id}`} className="group last:@lg:col-span-2 last:@4xl:col-span-1">
            <Card className="h-full p-5 transition-colors group-hover:border-line-2 group-hover:bg-subtle">
              <div className="flex items-center justify-between gap-2">
                <ProjectTag id={p.id} className="text-[13px] text-ink" />
                <span className="text-[12px] text-ink-3">{p.area}</span>
              </div>
              <div className="mt-4 flex items-baseline justify-between gap-2">
                <span className="text-[28px] leading-none font-semibold tracking-[-0.03em] text-ink tnum">{p.health}</span>
                <Delta value={p.healthDelta} unit="" decimals={0} />
              </div>
              <Meter value={p.health} tone={tone === "ok" ? "neutral" : tone} className="mt-3" />
              <dl className="mt-4 space-y-1.5 text-[12px]">
                {[
                  ["Incidentes ativos", incidents],
                  ["Recursos com alerta", resources],
                  ["Agentes fora da meta", agents],
                ].map(([label, v]) => (
                  <div key={label} className="flex items-center justify-between">
                    <dt className="text-ink-3">{label}</dt>
                    <dd className={cn("tnum", Number(v) > 0 ? "text-ink" : "text-ink-4")}>{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}

/* ─────────────────────── Página ─────────────────────── */

export function OverviewView() {
  const { toast, openCopilot, env, range } = useShell();
  const sev1 = ACTIVE_INCIDENTS.find((i) => i.sev === 1);
  return (
    <div className="animate-enter">
      <PageHeader
        title="Visão geral"
        description={`${TODAY_LONG} · ${env === "prod" ? "Produção" : env === "staging" ? "Staging" : "Todos os ambientes"} · atualizado há 12 s`}
        actions={
          <>
            <Button onClick={() => toast({ title: "Link do resumo copiado", description: "Qualquer pessoa do workspace pode abrir.", tone: "ok" })}>
              <Share2 />
              Compartilhar
            </Button>
            <Button variant="primary" onClick={() => openCopilot("Resumo da operação para o standup")}>
              <Sparkles />
              Resumo do dia
            </Button>
          </>
        }
      />

      {sev1 && (
        <Link
          href={`/incidentes?id=${sev1.id}`}
          className="mb-8 flex items-center gap-3 rounded-[12px] border border-crit/30 bg-crit-soft px-4 py-3 transition-colors hover:border-crit/50"
        >
          <StatusDot status="crit" pulse />
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
            <span className="font-medium">{sev1.id} · SEV-1 em andamento</span>
            <span className="text-ink-2"> — {sev1.title}. {durationLabel(sev1.started)} de duração, responsável {PEOPLE[sev1.owner].name}.</span>
          </span>
          <span className="hidden shrink-0 items-center gap-1 text-[12.5px] text-ink-2 sm:inline-flex">
            Abrir incidente
            <ArrowRight className="size-3.5" />
          </span>
        </Link>
      )}

      <Section title="Resumo por domínio" description="Cada área com seus próprios indicadores.">
        <DomainSummary />
      </Section>

      <Section title="Precisa de atenção" description="Itens que pioraram ou estão fora da meta, com responsável definido.">
        <AttentionTable />
      </Section>

      <Section title="Tendências" description={`${RANGES[range].label} · mesma escala de tempo nos dois gráficos.`}>
        <div className="grid gap-4 @4xl:grid-cols-2">
          <DatabaseLatency />
          <AgentAccuracy />
        </div>
      </Section>

      <Section title="Projetos" description="Índice de saúde de 0 a 100 e o que pesa em cada projeto.">
        <Projects />
      </Section>
    </div>
  );
}
