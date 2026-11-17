"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { BookOpen, Sparkles, X } from "lucide-react";
import { TimeSeriesChart } from "@/components/charts/time-series";
import { UptimeBars } from "@/components/charts/uptime-bars";
import { useShell } from "@/components/shell/provider";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/ui/meter";
import { PersonChip, ProjectTag } from "@/components/ui/misc";
import { ResourceIcon } from "@/components/ui/resource-icon";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip, StatusDot } from "@/components/ui/status";
import {
  SATURATION_LIMIT,
  TYPE_META,
  resourceById,
  resourceSeries,
  statusBuckets,
  uptimeFor,
  type Resource,
  type ResourceMetric,
} from "@/lib/data/infra";
import { fmtBRL, fmtCompact, fmtDec, fmtInt, fmtMs, fmtPct } from "@/lib/format";
import { RANGES, axisLabels, clockTime, durationLabel, indexFor } from "@/lib/time";
import { setSearchParam } from "@/lib/url";

const METRIC_LABEL: Record<ResourceMetric, string> = {
  latency: "Latência p95",
  cpu: "CPU",
  memory: "Memória",
  errors: "Erros",
  connections: "Conexões",
  throughput: "Vazão",
};

function availableMetrics(r: Resource): ResourceMetric[] {
  const list: ResourceMetric[] = [];
  if (r.latency !== undefined) list.push("latency");
  list.push("cpu", "memory", "errors");
  if (r.connections) list.push("connections");
  if (r.throughput !== undefined) list.push("throughput");
  return list;
}

function defaultMetric(r: Resource): ResourceMetric {
  if (r.status !== "ok" && r.base) {
    if (r.base.latency !== undefined && r.latency !== undefined) return "latency";
    const first = Object.keys(r.base)[0] as ResourceMetric | undefined;
    if (first) return first;
  }
  return r.latency !== undefined ? "latency" : "cpu";
}

function formatter(r: Resource, metric: ResourceMetric) {
  switch (metric) {
    case "latency":
      return { value: (v: number) => fmtMs(v), axis: (v: number) => fmtInt(v) };
    case "errors":
      return { value: (v: number) => fmtPct(v, 2), axis: (v: number) => `${fmtDec(v, v < 1 ? 1 : 0)}%` };
    case "throughput":
      return { value: (v: number) => `${fmtCompact(v)} ${r.throughputUnit ?? ""}`.trim(), axis: (v: number) => fmtCompact(v) };
    default:
      return { value: (v: number) => fmtPct(v, 0), axis: (v: number) => `${v}%` };
  }
}

/** Painel de detalhes controlado por `?recurso=` — precisa estar dentro de <Suspense>. */
export function ResourceDrawer() {
  const params = useSearchParams();
  const id = params.get("recurso");
  const resource = id ? resourceById(id) : undefined;
  // Mantém o último recurso visível durante a animação de saída.
  const [shown, setShown] = useState(resource);
  if (resource && resource !== shown) setShown(resource);

  return (
    <Sheet open={!!resource} onClose={() => setSearchParam("recurso", null)} label={shown ? `Detalhes de ${shown.id}` : "Detalhes do recurso"} width={640}>
      {shown && <ResourceDetail key={shown.id} r={shown} />}
    </Sheet>
  );
}

function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-[13px] font-medium text-ink">{children}</h3>
      {aside}
    </div>
  );
}

function ResourceDetail({ r }: { r: Resource }) {
  const { range, toast, openCopilot } = useShell();
  const metrics = availableMetrics(r);
  const [metric, setMetric] = useState<ResourceMetric>(() => defaultMetric(r));
  const labels = useMemo(() => axisLabels(range), [range]);
  const series = useMemo(() => [{ key: metric, name: METRIC_LABEL[metric], color: "var(--color-s1)", data: resourceSeries(r, metric, range), area: true }], [r, metric, range]);
  const buckets = useMemo(() => statusBuckets(r, range), [r, range]);
  const fmt = formatter(r, metric);
  const capped = metric === "cpu" || metric === "memory" || metric === "connections";
  const base = r.base?.[metric];
  const alerting = r.status !== "ok" && r.status !== "maint";
  const threshold =
    alerting && base !== undefined
      ? { value: base, label: `Linha de base ${fmt.value(base)}` }
      : capped
        ? { value: SATURATION_LIMIT, label: `Alerta ${SATURATION_LIMIT}%` }
        : undefined;
  const sinceIndex = alerting && r.since !== undefined ? indexFor(range, r.since) : -1;

  const usage = [
    { label: "CPU", value: r.cpu, detail: fmtPct(r.cpu, 0) },
    { label: "Memória", value: r.memory, detail: fmtPct(r.memory, 0) },
    ...(r.connections
      ? [{ label: "Conexões", value: (r.connections.used / r.connections.max) * 100, detail: `${fmtInt(r.connections.used)} / ${fmtInt(r.connections.max)}` }]
      : []),
    ...(r.storage !== undefined ? [{ label: "Disco", value: r.storage, detail: fmtPct(r.storage, 0) }] : []),
  ];

  const meta: { label: string; value: React.ReactNode }[] = [
    { label: "Tipo", value: TYPE_META[r.type].label },
    { label: "Projeto", value: <ProjectTag id={r.project} className="text-[13px] text-ink" /> },
    { label: "Ambiente", value: r.env === "prod" ? "Produção" : "Staging" },
    { label: "Região", value: r.region },
    { label: "Versão", value: r.version },
    { label: "Responsável", value: <PersonChip id={r.owner} className="text-[13px] text-ink" /> },
    { label: "Custo mensal", value: fmtBRL(r.cost, 0) },
    { label: "Uptime 30 dias", value: fmtPct(r.uptime, 2) },
  ];

  return (
    <>
      <header className="flex items-start gap-3 border-b border-line px-6 py-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-line-2 bg-muted text-ink-2">
          <ResourceIcon type={r.type} className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-mono text-[15px] font-medium text-ink">{r.id}</h2>
            <StatusChip status={r.status} pulse={r.status === "crit"} />
          </div>
          <p className="mt-0.5 truncate text-[13px] text-ink-3">{r.label}</p>
        </div>
        <button
          type="button"
          aria-label="Fechar painel"
          onClick={() => setSearchParam("recurso", null)}
          className="-mr-1.5 grid size-8 shrink-0 place-items-center rounded-[8px] text-ink-3 hover:bg-raised hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-5 scrollbar-thin">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {meta.map((m) => (
            <div key={m.label} className="min-w-0">
              <dt className="text-[11.5px] text-ink-3">{m.label}</dt>
              <dd className="mt-1 truncate text-[13px] text-ink">{m.value}</dd>
            </div>
          ))}
        </dl>

        {r.headline && (
          <div className="rounded-[10px] border border-line-2 bg-subtle p-4">
            <div className="flex items-center gap-2.5">
              <StatusDot status={r.status} />
              <span className="min-w-0 flex-1 text-[13.5px] font-medium text-ink">{r.headline}</span>
              {r.since !== undefined && <span className="shrink-0 text-[12px] text-ink-3">há {durationLabel(r.since)}</span>}
            </div>
            {r.insight && <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{r.insight}</p>}
            {r.actions && r.actions.length > 0 && (
              <div className="mt-4 border-t border-line pt-3">
                <div className="mb-1.5 text-[12px] text-ink-3">Ações sugeridas</div>
                <ul>
                  {r.actions.map((a) => (
                    <li key={a} className="flex items-center justify-between gap-3 py-1.5 text-[13px] text-ink-2">
                      <span className="min-w-0">{a}</span>
                      <Button size="xs" onClick={() => toast({ title: "Ação enviada para aprovação", description: a, tone: "info" })}>
                        Executar
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <section>
          <SectionTitle aside={<span className="text-[12px] text-ink-3">{RANGES[range].label}</span>}>Métricas</SectionTitle>
          <div className="-mx-1 mb-3 overflow-x-auto px-1 no-scrollbar">
            <Segmented size="sm" ariaLabel="Métrica" value={metric} onChange={setMetric} options={metrics.map((m) => ({ value: m, label: METRIC_LABEL[m] }))} />
          </div>
          <TimeSeriesChart
            labels={labels}
            series={series}
            height={200}
            yDomain={capped ? [0, 100] : ["auto", "auto"]}
            threshold={threshold}
            markers={sinceIndex >= 0 ? [{ index: sinceIndex, label: `alerta · ${clockTime(r.since!)}` }] : []}
            valueFormat={fmt.value}
            yFormat={fmt.axis}
            yWidth={44}
          />
        </section>

        <section>
          <SectionTitle>Uso de recursos</SectionTitle>
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {usage.map((u) => (
              <div key={u.label}>
                <div className="mb-1.5 flex items-baseline justify-between text-[12.5px]">
                  <span className="text-ink-2">{u.label}</span>
                  <span className="font-medium text-ink tnum">{u.detail}</span>
                </div>
                <Meter value={u.value} thick />
              </div>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle aside={<span className="text-[12.5px] font-medium text-ink tnum">{fmtPct(uptimeFor(r, range), 2)}</span>}>
            Disponibilidade · {RANGES[range].window}
          </SectionTitle>
          <UptimeBars buckets={buckets} labels={labels} />
          <div className="mt-2 flex justify-between text-[11.5px] text-ink-4 tnum">
            <span>{labels[0]}</span>
            <span>agora</span>
          </div>
        </section>

        {r.extra && r.extra.length > 0 && (
          <section>
            <SectionTitle>Sinais adicionais</SectionTitle>
            <dl className="divide-y divide-line rounded-[10px] border border-line">
              {r.extra.map((e) => (
                <div key={e.label} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                  <dt className="flex items-center gap-2 text-ink-2">
                    {e.tone && <StatusDot status={e.tone} className="size-1.5" />}
                    {e.label}
                  </dt>
                  <dd className="font-medium text-ink tnum">{e.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-line px-6 py-3">
        <Button onClick={() => toast({ title: "Runbook aberto", description: `Procedimentos de ${TYPE_META[r.type].label} · ${r.id}`, tone: "info" })}>
          <BookOpen />
          Runbook
        </Button>
        <Button variant="primary" onClick={() => openCopilot(`Diagnosticar ${r.id} (${TYPE_META[r.type].label})`)}>
          <Sparkles />
          Diagnosticar com Copilot
        </Button>
      </footer>
    </>
  );
}
