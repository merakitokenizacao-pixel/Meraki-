"use client";

import { Suspense, useMemo, useState } from "react";
import { Download, Plus, ServerOff } from "lucide-react";
import { UptimeBars } from "@/components/charts/uptime-bars";
import { useShell } from "@/components/shell/provider";
import { Button } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/card";
import { Meter } from "@/components/ui/meter";
import { EmptyState, Mono, ProjectTag } from "@/components/ui/misc";
import { MultiSelectChip } from "@/components/ui/popover";
import { CATEGORY_ICONS, ResourceIcon } from "@/components/ui/resource-icon";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { Sparkline } from "@/components/ui/sparkline";
import { StatCard } from "@/components/ui/stat";
import { STATUS_META, StatusChip } from "@/components/ui/status";
import { ResourceDrawer } from "@/components/views/resource-drawer";
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  RESOURCES,
  SATURATION_LIMIT,
  TYPE_META,
  categoryOf,
  infraSummary,
  resourceSeries,
  saturationOf,
  statusBuckets,
  uptimeFor,
  type Category,
  type Resource,
} from "@/lib/data/infra";
import { PROJECTS } from "@/lib/data/projects";
import { downsample } from "@/lib/series";
import { fmtBRL, fmtMs, fmtPct } from "@/lib/format";
import { RANGES, axisLabels } from "@/lib/time";
import { STATUS_RANK, worstStatus, type Status } from "@/lib/types";
import { plural, setSearchParam } from "@/lib/url";
import { cn, normalize } from "@/lib/utils";

type CategoryFilter = "all" | Category;
type View = "list" | "uptime";

const STATUS_ORDER: Status[] = ["crit", "serious", "warn", "ok", "maint"];

/** Colunas: recurso · (projeto) · status · saturação · latência · erros · custo */
const LIST_COLS = {
  project: "@4xl:grid-cols-[minmax(0,1fr)_118px_136px_150px_64px_100px] @5xl:grid-cols-[minmax(0,1fr)_96px_118px_144px_160px_72px_104px]",
  plain: "@4xl:grid-cols-[minmax(0,1fr)_118px_136px_150px_64px_100px] @5xl:grid-cols-[minmax(0,1fr)_128px_168px_176px_80px_112px]",
};
const UPTIME_COLS = "@4xl:grid-cols-[minmax(0,300px)_minmax(0,1fr)_84px]";

const byStatus = (a: Resource, b: Resource) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || a.id.localeCompare(b.id);

function ResourceName({ r }: { r: Resource }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-[8px] border border-line bg-subtle text-ink-2">
        <ResourceIcon type={r.type} className="size-4" />
      </span>
      <span className="min-w-0">
        <Mono className="block truncate text-[12.5px] text-ink">{r.id}</Mono>
        <span className="block truncate text-[12px] text-ink-3">
          {TYPE_META[r.type].label} · {r.label}
        </span>
      </span>
    </span>
  );
}

function ListRow({ r, showProject }: { r: Resource; showProject: boolean }) {
  const { range } = useShell();
  const sat = saturationOf(r);
  const spark = useMemo(() => (r.latency !== undefined ? downsample(resourceSeries(r, "latency", range), 24) : null), [r, range]);
  return (
    <button
      type="button"
      onClick={() => setSearchParam("recurso", r.id)}
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-5 py-3 text-left transition-colors hover:bg-subtle",
        showProject ? LIST_COLS.project : LIST_COLS.plain,
      )}
    >
      <ResourceName r={r} />
      {showProject && (
        <span className="hidden @5xl:block">
          <ProjectTag id={r.project} />
        </span>
      )}
      <span>
        <StatusChip status={r.status} />
      </span>
      <span className="hidden @4xl:block">
        <span className="flex items-baseline justify-between text-[12px]">
          <span className="text-ink-3">{sat.label}</span>
          <span className="font-medium text-ink tnum">{fmtPct(sat.value, 0)}</span>
        </span>
        <Meter value={sat.value} className="mt-1.5" />
      </span>
      <span className="hidden items-center justify-end gap-3 @4xl:flex">
        {spark ? (
          <>
            <Sparkline data={spark} width={64} height={22} accent={r.status === "ok" || r.status === "maint" ? "var(--color-ink-2)" : STATUS_META[r.status].hex} />
            <span className="w-[58px] text-right text-[12.5px] text-ink tnum">{fmtMs(r.latency!)}</span>
          </>
        ) : (
          <span className="text-[12.5px] text-ink-4">—</span>
        )}
      </span>
      <span className="hidden text-right text-[12.5px] text-ink-2 tnum @4xl:block">{fmtPct(r.errorRate, 2)}</span>
      <span className="hidden text-right text-[12.5px] text-ink-2 tnum @4xl:block">{fmtBRL(r.cost, 0)}</span>
    </button>
  );
}

/** Lista de recursos agrupada por categoria — usada em Sistemas e na página de cada projeto. */
export function ResourceTable({ list, showProject = true }: { list: Resource[]; showProject?: boolean }) {
  const groups = CATEGORY_ORDER.map((c) => ({ category: c, list: list.filter((r) => categoryOf(r) === c).sort(byStatus) })).filter((g) => g.list.length);
  return (
    <Card className="overflow-hidden">
      <div
        className={cn(
          "hidden gap-x-4 border-b border-line px-5 py-2.5 text-[11.5px] font-medium text-ink-3 @4xl:grid",
          showProject ? LIST_COLS.project : LIST_COLS.plain,
        )}
      >
        <span>Recurso</span>
        {showProject && <span className="hidden @5xl:block">Projeto</span>}
        <span>Status</span>
        <span>Saturação</span>
        <span className="text-right">Latência p95</span>
        <span className="text-right">Erros</span>
        <span className="text-right">Custo/mês</span>
      </div>
      {groups.length ? (
        groups.map((g) => (
          <div key={g.category}>
            <GroupHeader category={g.category} list={g.list} />
            <div className="divide-y divide-line">
              {g.list.map((r) => (
                <ListRow key={r.id} r={r} showProject={showProject} />
              ))}
            </div>
          </div>
        ))
      ) : (
        <EmptyState icon={<ServerOff className="size-5" />} title="Nenhum recurso encontrado" description="Ajuste a busca ou remova filtros para ver mais recursos." />
      )}
    </Card>
  );
}

function UptimeRow({ r, labels }: { r: Resource; labels: string[] }) {
  const { range } = useShell();
  const buckets = useMemo(() => statusBuckets(r, range), [r, range]);
  return (
    <div className={cn("grid grid-cols-1 items-center gap-x-6 gap-y-2.5 px-5 py-3 transition-colors hover:bg-subtle", UPTIME_COLS)}>
      <button type="button" onClick={() => setSearchParam("recurso", r.id)} className="min-w-0 text-left">
        <ResourceName r={r} />
      </button>
      <UptimeBars buckets={buckets} labels={labels} />
      <span className="text-right text-[12.5px] font-medium text-ink tnum">{fmtPct(uptimeFor(r, range), 2)}</span>
    </div>
  );
}

function GroupHeader({ category, list }: { category: Category; list: Resource[] }) {
  const Icon = CATEGORY_ICONS[category];
  const alerting = list.filter((r) => r.status !== "ok" && r.status !== "maint");
  return (
    <div className="flex items-center gap-2.5 border-y border-line bg-sunken px-5 py-2 text-[12px] first:border-t-0">
      <Icon className="size-3.5 text-ink-3" strokeWidth={1.75} />
      <span className="font-medium text-ink-2">{CATEGORY_META[category].label}</span>
      <span className="text-ink-4 tnum">{list.length}</span>
      {alerting.length > 0 && (
        <span className="ml-auto inline-flex items-center gap-1.5 text-ink-3">
          <span className={cn("size-1.5 rounded-full", STATUS_META[worstStatus(alerting.map((r) => r.status))].dot)} />
          {plural(alerting.length, "com alerta", "com alerta")}
        </span>
      )}
    </div>
  );
}

export function InfraView() {
  const { env, range, toast } = useShell();
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [view, setView] = useState<View>("list");
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);

  const scoped = useMemo(() => (env === "all" ? RESOURCES : RESOURCES.filter((r) => r.env === env)), [env]);
  const summary = infraSummary(scoped, range);
  const labels = useMemo(() => axisLabels(range), [range]);

  // Filtros de dimensão (sem categoria) — usados para as contagens do seletor de categoria.
  const dimFiltered = useMemo(() => {
    const q = normalize(query.trim());
    return scoped.filter(
      (r) =>
        (!projects.length || projects.includes(r.project)) &&
        (!statuses.length || statuses.includes(r.status)) &&
        (!regions.length || regions.includes(r.region)) &&
        (!q || normalize(`${r.id} ${r.label} ${TYPE_META[r.type].label} ${r.version}`).includes(q)),
    );
  }, [scoped, query, projects, statuses, regions]);

  const visible = category === "all" ? dimFiltered : dimFiltered.filter((r) => categoryOf(r) === category);
  const groups = CATEGORY_ORDER.map((c) => ({ category: c, list: visible.filter((r) => categoryOf(r) === c).sort(byStatus) })).filter((g) => g.list.length);
  const regionsAll = Array.from(new Set(scoped.map((r) => r.region)));
  const filtersOn = query || projects.length || statuses.length || regions.length;

  const c = summary.counts;
  return (
    <div className="animate-enter">
      <PageHeader
        title="Sistemas"
        description={`Infraestrutura de todos os projetos · ${plural(summary.total, "recurso", "recursos")} · ${env === "prod" ? "Produção" : env === "staging" ? "Staging" : "Todos os ambientes"}`}
        actions={
          <>
            <Button onClick={() => toast({ title: "Exportação iniciada", description: "CSV com os recursos filtrados será baixado em instantes.", tone: "info" })}>
              <Download />
              Exportar
            </Button>
            <Button variant="primary" onClick={() => toast({ title: "Conectar nova fonte", description: "Integrações disponíveis: AWS, GCP, Datadog, Prometheus.", tone: "info" })}>
              <Plus />
              Adicionar recurso
            </Button>
          </>
        }
      />

      <div className="grid gap-4 @2xl:grid-cols-2 @4xl:grid-cols-4">
        <StatCard
          label="Recursos com alerta"
          value={summary.alerting}
          unit={`de ${summary.total}`}
          status={summary.alerting ? worstStatus(scoped.map((r) => r.status)) : "ok"}
          foot={[c.crit && plural(c.crit, "crítico", "críticos"), c.serious && plural(c.serious, "degradado", "degradados"), c.warn && `${c.warn} em atenção`].filter(Boolean).join(" · ")}
        />
        <StatCard label={`Disponibilidade · ${RANGES[range].window}`} value={fmtPct(summary.uptime, 2)} foot="Meta de 99,90%" />
        <StatCard label={`Uso acima de ${SATURATION_LIMIT}%`} value={summary.saturated} unit={`de ${summary.total}`} foot="CPU, memória, conexões ou disco" />
        <StatCard label="Custo mensal" value={`${fmtBRL(summary.cost / 1000, 0)} mil`} delta={summary.costDelta} goodWhen="down" foot="vs. mês anterior" />
      </div>

      <div className="mt-9 mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="-mx-1 max-w-full overflow-x-auto px-1 no-scrollbar">
          <Segmented
            ariaLabel="Categoria"
            value={category}
            onChange={setCategory}
            options={[
              { value: "all", label: "Todos", count: dimFiltered.length },
              ...CATEGORY_ORDER.map((cat) => ({ value: cat, label: CATEGORY_META[cat].short, count: dimFiltered.filter((r) => categoryOf(r) === cat).length })),
            ]}
          />
        </div>
        <Segmented
          ariaLabel="Visualização"
          value={view}
          onChange={setView}
          options={[
            { value: "list", label: "Lista" },
            { value: "uptime", label: "Disponibilidade" },
          ]}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={query} onChange={setQuery} placeholder="Buscar por nome, tipo ou versão" className="w-full sm:w-[280px]" />
        <MultiSelectChip
          label="Projeto"
          value={projects}
          onChange={setProjects}
          options={PROJECTS.map((p) => ({ value: p.id, label: p.name, marker: p.color, count: scoped.filter((r) => r.project === p.id).length }))}
        />
        <MultiSelectChip
          label="Status"
          value={statuses}
          onChange={setStatuses}
          options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_META[s].label, marker: STATUS_META[s].hex, count: scoped.filter((r) => r.status === s).length }))}
        />
        <MultiSelectChip
          label="Região"
          value={regions}
          onChange={setRegions}
          options={regionsAll.map((g) => ({ value: g, label: g, count: scoped.filter((r) => r.region === g).length }))}
        />
        {filtersOn ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery("");
              setProjects([]);
              setStatuses([]);
              setRegions([]);
            }}
          >
            Limpar filtros
          </Button>
        ) : null}
        <span className="ml-auto text-[12px] text-ink-3 tnum">
          {visible.length} de {scoped.length}
        </span>
      </div>

      {view === "list" ? (
        <ResourceTable list={visible} />
      ) : (
        <Card className="overflow-hidden">
          <div className={cn("hidden gap-x-6 border-b border-line px-5 py-2.5 text-[11.5px] font-medium text-ink-3 @4xl:grid", UPTIME_COLS)}>
            <span>Recurso</span>
            <span className="flex justify-between">
              <span>{labels[0]}</span>
              <span>agora</span>
            </span>
            <span className="text-right">Uptime</span>
          </div>
          {groups.length ? (
            groups.map((g) => (
              <div key={g.category}>
                <GroupHeader category={g.category} list={g.list} />
                <div className="divide-y divide-line">
                  {g.list.map((r) => (
                    <UptimeRow key={r.id} r={r} labels={labels} />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <EmptyState icon={<ServerOff className="size-5" />} title="Nenhum recurso encontrado" description="Ajuste a busca ou remova filtros para ver mais recursos." />
          )}
        </Card>
      )}

      <Suspense fallback={null}>
        <ResourceDrawer />
      </Suspense>
    </div>
  );
}
