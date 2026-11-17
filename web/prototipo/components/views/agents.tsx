"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BotOff, FlaskConical, Plus } from "lucide-react";
import { BarList } from "@/components/charts/bar-list";
import { QuadrantScatter, type QuadrantPoint } from "@/components/charts/quadrant";
import { useShell } from "@/components/shell/provider";
import { Button } from "@/components/ui/button";
import { Card, CardFooter, CardHeader, PageHeader, Section } from "@/components/ui/card";
import { AgentGlyph, Avatar, EmptyState, ProjectTag } from "@/components/ui/misc";
import { MultiSelectChip } from "@/components/ui/popover";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { StatCard } from "@/components/ui/stat";
import { STATUS_META, StatusChip } from "@/components/ui/status";
import { AGENTS, AGENT_STATUS_LABEL, MODELS, aggregateFailureModes, fleetSummary, type Agent } from "@/lib/data/agents";
import { PEOPLE } from "@/lib/data/people";
import { PROJECTS } from "@/lib/data/projects";
import { fmtBRL, fmtCompact, fmtMs, fmtPct } from "@/lib/format";
import { STATUS_RANK, worstStatus, type Status } from "@/lib/types";
import { plural } from "@/lib/url";
import { cn, normalize } from "@/lib/utils";

const STATUS_ORDER: Status[] = ["crit", "serious", "warn", "ok"];
export const byStatus = (a: Agent, b: Agent) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || a.name.localeCompare(b.name);

/** Tom do indicador de meta não atingida — segue a severidade do agente. */
const missTone = (a: Agent): Status => (a.status === "ok" || a.status === "maint" ? "warn" : a.status);

function targetCells(a: Agent) {
  return [
    { key: "accuracy", label: "Precisão", value: fmtPct(a.m.accuracy), target: `meta ${fmtPct(a.targets.accuracy, 0)}`, miss: a.m.accuracy < a.targets.accuracy },
    { key: "resolution", label: "Resolução", value: fmtPct(a.m.resolution), target: `meta ${fmtPct(a.targets.resolution, 0)}`, miss: a.m.resolution < a.targets.resolution },
    { key: "latency", label: "Latência p95", value: fmtMs(a.m.latency), target: `meta ${fmtMs(a.targets.latency)}`, miss: a.m.latency > a.targets.latency },
  ];
}

function MissDot({ a, miss }: { a: Agent; miss: boolean }) {
  if (!miss) return null;
  return <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_META[missTone(a)].dot)} aria-label="fora da meta" />;
}

/** Cartão de agente — usado em Agentes de IA e na parte Agentes de cada projeto. */
export function AgentCard({ a }: { a: Agent }) {
  const owner = PEOPLE[a.owner];
  return (
    <Link href={`/agentes/${a.id}`} className="group block min-w-0">
      <Card className="flex h-full flex-col transition-colors group-hover:border-line-2 group-hover:bg-subtle">
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="flex min-w-0 items-center gap-3">
            <AgentGlyph name={a.name} project={a.project} size={36} />
            <div className="min-w-0">
              <div className="truncate text-[14px] font-medium text-ink">{a.name}</div>
              <div className="truncate text-[12.5px] text-ink-3">{a.role}</div>
            </div>
          </div>
          <StatusChip status={a.status} label={AGENT_STATUS_LABEL[a.status]} />
        </div>
        <div className="mx-5 mt-5 grid grid-cols-3 divide-x divide-line rounded-[10px] border border-line bg-sunken/60">
          {targetCells(a).map((c) => (
            <div key={c.key} className="min-w-0 px-3 py-3">
              <div className="truncate text-[11.5px] text-ink-3">{c.label}</div>
              <div className="mt-1.5 text-[16px] font-medium tracking-[-0.01em] text-ink tnum">{c.value}</div>
              <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ink-3 tnum">
                <MissDot a={a} miss={c.miss} />
                <span className="truncate">{c.target}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-[12px] text-ink-3">
          <span className="min-w-0 truncate">
            {a.model} · {a.version}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-ink-2">
            <Avatar name={owner.name} size={18} />
            {owner.name.split(" ")[0]}
          </span>
        </div>
      </Card>
    </Link>
  );
}

const TABLE_COLS = "grid-cols-[minmax(0,1fr)_auto] @4xl:grid-cols-[minmax(0,1fr)_96px_132px_88px_88px_88px_96px_96px_96px]";

function AgentTable({ list }: { list: Agent[] }) {
  return (
    <Card className="overflow-hidden">
      <div className={cn("hidden gap-x-4 border-b border-line px-5 py-2.5 text-[11.5px] font-medium text-ink-3 @4xl:grid", TABLE_COLS)}>
        <span>Agente</span>
        <span>Projeto</span>
        <span>Status</span>
        <span className="text-right">Precisão</span>
        <span className="text-right">Resolução</span>
        <span className="text-right">Alucinação</span>
        <span className="text-right">Latência p95</span>
        <span className="text-right">Conversas/dia</span>
        <span className="text-right">Custo/conversa</span>
      </div>
      <ul className="divide-y divide-line">
        {list.map((a) => {
          const [acc, res, lat] = targetCells(a);
          return (
            <li key={a.id}>
              <Link href={`/agentes/${a.id}`} className={cn("grid items-center gap-x-4 px-5 py-3 transition-colors hover:bg-subtle", TABLE_COLS)}>
                <span className="flex min-w-0 items-center gap-3">
                  <AgentGlyph name={a.name} project={a.project} size={30} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-medium text-ink">{a.name}</span>
                    <span className="block truncate text-[12px] text-ink-3">{a.role}</span>
                  </span>
                </span>
                <span className="hidden @4xl:block">
                  <ProjectTag id={a.project} />
                </span>
                <span>
                  <StatusChip status={a.status} label={AGENT_STATUS_LABEL[a.status]} />
                </span>
                {[acc, res].map((c) => (
                  <span key={c.key} className="hidden items-center justify-end gap-1.5 text-[13px] text-ink tnum @4xl:flex">
                    <MissDot a={a} miss={c.miss} />
                    {c.value}
                  </span>
                ))}
                <span className="hidden text-right text-[13px] text-ink-2 tnum @4xl:block">{fmtPct(a.m.hallucination)}</span>
                <span className="hidden items-center justify-end gap-1.5 text-[13px] text-ink tnum @4xl:flex">
                  <MissDot a={a} miss={lat.miss} />
                  {lat.value}
                </span>
                <span className="hidden text-right text-[13px] text-ink-2 tnum @4xl:block">{fmtCompact(a.m.volume)}</span>
                <span className="hidden text-right text-[13px] text-ink-2 tnum @4xl:block">{fmtBRL(a.m.cost, a.m.cost < 0.1 ? 3 : 2)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function AgentsView() {
  const { toast } = useShell();
  const [view, setView] = useState<"cards" | "table">("cards");
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);

  const fleet = fleetSummary();
  const failures = useMemo(() => aggregateFailureModes().slice(0, 6), []);
  const points = useMemo<QuadrantPoint[]>(
    () =>
      AGENTS.map((a) => ({
        id: a.id,
        name: a.name,
        x: (a.m.accuracy / a.targets.accuracy) * 100,
        y: (a.m.resolution / a.targets.resolution) * 100,
        status: a.status,
        label: a.status !== "ok",
        detail: { accuracy: `${fmtPct(a.m.accuracy)} (meta ${fmtPct(a.targets.accuracy, 0)})`, resolution: `${fmtPct(a.m.resolution)} (meta ${fmtPct(a.targets.resolution, 0)})` },
      })),
    [],
  );

  const list = useMemo(() => {
    const q = normalize(query.trim());
    return AGENTS.filter(
      (a) =>
        (!projects.length || projects.includes(a.project)) &&
        (!statuses.length || statuses.includes(a.status)) &&
        (!models.length || models.includes(a.model)) &&
        (!q || normalize(`${a.name} ${a.role} ${a.model} ${a.channel}`).includes(q)),
    ).sort(byStatus);
  }, [query, projects, statuses, models]);
  const filtersOn = query || projects.length || statuses.length || models.length;
  const c = fleet.counts;

  return (
    <div className="animate-enter">
      <PageHeader
        title="Agentes de IA"
        description={`${plural(fleet.total, "agente", "agentes")} em produção · ${fmtCompact(fleet.volume)} conversas por dia`}
        actions={
          <>
            <Button onClick={() => toast({ title: "Avaliação agendada", description: "Todas as suítes rodam hoje às 18:00 em staging.", tone: "info" })}>
              <FlaskConical />
              Rodar avaliações
            </Button>
            <Button variant="primary" onClick={() => toast({ title: "Registrar agente", description: "Conecte via SDK, OpenTelemetry ou gateway LLM.", tone: "info" })}>
              <Plus />
              Registrar agente
            </Button>
          </>
        }
      />

      <div className="grid gap-4 @2xl:grid-cols-2 @4xl:grid-cols-4">
        <StatCard
          label="Agentes fora da meta"
          value={fleet.offTarget}
          unit={`de ${fleet.total}`}
          status={worstStatus(AGENTS.map((a) => a.status))}
          foot={[c.crit && plural(c.crit, "crítico", "críticos"), c.serious && `${c.serious} abaixo da meta`, c.warn && `${c.warn} em atenção`].filter(Boolean).join(" · ")}
        />
        <StatCard label="Precisão média" value={fmtPct(fleet.accuracy)} delta={fleet.accuracyDelta} deltaUnit=" pts" foot="vs. semana anterior" />
        <StatCard label="Taxa de resolução" value={fmtPct(fleet.resolution)} delta={fleet.resolutionDelta} deltaUnit=" pts" foot="vs. semana anterior" />
        <StatCard label="Taxa de alucinação" value={fmtPct(fleet.hallucination)} delta={fleet.hallucinationDelta} deltaUnit=" pts" goodWhen="down" foot="vs. semana anterior" />
      </div>

      <Section title="Qualidade da frota" description="Onde cada agente está em relação às próprias metas, e por que as respostas falham.">
        <div className="grid gap-4 @4xl:grid-cols-2">
          <Card className="flex min-w-0 flex-col">
            <CardHeader title="Precisão × resolução" description="Relativo às metas de cada agente (100% = meta) · clique em um ponto para abrir" />
            <div className="px-3 sm:px-5">
              <QuadrantScatter points={points} height={300} />
            </div>
            <CardFooter className="justify-start gap-x-4 text-[12px] text-ink-3">
              {STATUS_ORDER.map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className={cn("size-1.5 rounded-full", STATUS_META[s].dot)} />
                  {AGENT_STATUS_LABEL[s]}
                  <span className="text-ink-4 tnum">{AGENTS.filter((a) => a.status === s).length}</span>
                </span>
              ))}
            </CardFooter>
          </Card>
          <Card className="flex min-w-0 flex-col">
            <CardHeader title="Modos de falha" description="Distribuição das respostas incorretas · todos os agentes" />
            <div className="flex-1 px-5 pb-5">
              <BarList
                items={failures.map((f) => ({ key: f.label, label: f.label, value: f.share, sub: `${fmtCompact(f.count)}/dia` }))}
                format={(v) => fmtPct(v)}
              />
            </div>
            <CardFooter className="text-[12px] text-ink-3">
              <span>Ponderado pelo volume de falhas de cada agente</span>
              <Link href="/agentes/aurora#conversas" className="text-ink-2 transition-colors hover:text-ink">
                Ver conversas avaliadas
              </Link>
            </CardFooter>
          </Card>
        </div>
      </Section>

      <Section title="Agentes" description="Ordenados por severidade. A meta de cada indicador é definida por agente.">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SearchInput value={query} onChange={setQuery} placeholder="Buscar por nome, função ou modelo" className="w-full sm:w-[280px]" />
          <MultiSelectChip
            label="Projeto"
            value={projects}
            onChange={setProjects}
            options={PROJECTS.map((p) => ({ value: p.id, label: p.name, marker: p.color, count: AGENTS.filter((a) => a.project === p.id).length }))}
          />
          <MultiSelectChip
            label="Status"
            value={statuses}
            onChange={setStatuses}
            options={STATUS_ORDER.map((s) => ({ value: s, label: AGENT_STATUS_LABEL[s], marker: STATUS_META[s].hex, count: AGENTS.filter((a) => a.status === s).length }))}
          />
          <MultiSelectChip
            label="Modelo"
            value={models}
            onChange={setModels}
            options={MODELS.map((m) => ({ value: m, label: m, count: AGENTS.filter((a) => a.model === m).length }))}
          />
          {filtersOn ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQuery("");
                setProjects([]);
                setStatuses([]);
                setModels([]);
              }}
            >
              Limpar filtros
            </Button>
          ) : null}
          <div className="ml-auto flex items-center gap-3">
            <span className="text-[12px] text-ink-3 tnum">
              {list.length} de {AGENTS.length}
            </span>
            <Segmented
              size="sm"
              ariaLabel="Visualização"
              value={view}
              onChange={setView}
              options={[
                { value: "cards", label: "Cartões" },
                { value: "table", label: "Tabela" },
              ]}
            />
          </div>
        </div>

        {!list.length ? (
          <Card>
            <EmptyState icon={<BotOff className="size-5" />} title="Nenhum agente encontrado" description="Ajuste a busca ou remova filtros." />
          </Card>
        ) : view === "cards" ? (
          <div className="grid gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
            {list.map((a) => (
              <AgentCard key={a.id} a={a} />
            ))}
          </div>
        ) : (
          <AgentTable list={list} />
        )}
      </Section>
    </div>
  );
}
