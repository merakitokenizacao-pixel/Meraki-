"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, Check, FlaskConical, Scale, Sparkles, Wrench, X } from "lucide-react";
import { TimeSeriesChart } from "@/components/charts/time-series";
import { useShell } from "@/components/shell/provider";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, PageHeader, Section } from "@/components/ui/card";
import { Delta } from "@/components/ui/delta";
import { Meter } from "@/components/ui/meter";
import { AgentGlyph, Mono, PersonChip, ProjectTag } from "@/components/ui/misc";
import { ResourceIcon } from "@/components/ui/resource-icon";
import { Segmented } from "@/components/ui/segmented";
import { StatCard } from "@/components/ui/stat";
import { StatusChip, StatusDot } from "@/components/ui/status";
import {
  AGENT_STATUS_LABEL,
  TRACES,
  VERDICT_META,
  agentById,
  agentSeries,
  type Agent,
  type AgentMetricKey,
  type Trace,
} from "@/lib/data/agents";
import { TYPE_META, resourceById } from "@/lib/data/infra";
import { fmtBRL, fmtCompact, fmtDec, fmtInt, fmtMs, fmtPct } from "@/lib/format";
import { axisLabels, indexFor, relTime, shortDate, type RangeKey } from "@/lib/time";
import type { Status } from "@/lib/types";
import { cn } from "@/lib/utils";

/* ─────────────────────── Qualidade ao longo do tempo ─────────────────────── */

type ChartMetric = Extract<AgentMetricKey, "accuracy" | "resolution" | "hallucination" | "latency" | "cost" | "volume">;

const CHART_METRICS: { key: ChartMetric; label: string }[] = [
  { key: "accuracy", label: "Precisão" },
  { key: "resolution", label: "Resolução" },
  { key: "hallucination", label: "Alucinação" },
  { key: "latency", label: "Latência p95" },
  { key: "cost", label: "Custo/conversa" },
  { key: "volume", label: "Volume" },
];

function metricFormat(metric: ChartMetric) {
  switch (metric) {
    case "latency":
      return { value: (v: number) => fmtMs(v), axis: (v: number) => (v >= 1000 ? `${fmtDec(v / 1000, 1)} s` : fmtInt(v)) };
    case "cost":
      return { value: (v: number) => fmtBRL(v, v < 0.1 ? 3 : 2), axis: (v: number) => fmtDec(v, v < 0.1 ? 3 : 2) };
    case "volume":
      return { value: (v: number) => `${fmtInt(v)} conversas`, axis: (v: number) => fmtCompact(v) };
    default:
      return { value: (v: number) => fmtPct(v), axis: (v: number) => `${v}%` };
  }
}

function QualityChart({ a }: { a: Agent }) {
  const [metric, setMetric] = useState<ChartMetric>("accuracy");
  const [range, setRange] = useState<RangeKey>("30d");
  const labels = useMemo(() => axisLabels(range), [range]);
  const series = useMemo(
    () => [{ key: metric, name: CHART_METRICS.find((m) => m.key === metric)!.label, color: "var(--color-s1)", data: agentSeries(a, metric, range), area: true }],
    [a, metric, range],
  );
  const fmt = metricFormat(metric);
  const threshold =
    metric === "accuracy"
      ? { value: a.targets.accuracy, label: `Meta ${fmtPct(a.targets.accuracy, 0)}` }
      : metric === "resolution"
        ? { value: a.targets.resolution, label: `Meta ${fmtPct(a.targets.resolution, 0)}` }
        : metric === "latency"
          ? { value: a.targets.latency, label: `Meta ${fmtMs(a.targets.latency)}` }
          : undefined;
  const markers = a.versions.map((v) => ({ index: indexFor(range, v.at), label: v.version })).filter((m) => m.index >= 0);

  return (
    <Card className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-[18px] pb-4">
        <div className="-mx-1 max-w-full overflow-x-auto px-1 no-scrollbar">
          <Segmented size="sm" ariaLabel="Métrica" value={metric} onChange={setMetric} options={CHART_METRICS.map((m) => ({ value: m.key, label: m.label }))} />
        </div>
        <Segmented
          size="sm"
          ariaLabel="Período"
          value={range}
          onChange={setRange}
          options={[
            { value: "24h", label: "24 h" },
            { value: "7d", label: "7 d" },
            { value: "30d", label: "30 d" },
          ]}
        />
      </div>
      <div className="px-3 pb-5 sm:px-5">
        <TimeSeriesChart
          labels={labels}
          series={series}
          height={260}
          threshold={threshold}
          markers={markers}
          valueFormat={fmt.value}
          yFormat={fmt.axis}
          yWidth={48}
        />
      </div>
    </Card>
  );
}

/* ─────────────────────── Falhas e avaliações ─────────────────────── */

function FailureModes({ a }: { a: Agent }) {
  const top = Math.max(...a.failureModes.map((f) => f.share));
  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader title="Modos de falha" description="Classificação das respostas incorretas · variação vs. semana anterior" />
      <ul className="flex-1 space-y-3.5 px-5 pb-5">
        {a.failureModes.map((f) => (
          <li key={f.label}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[12.5px]">
              <span className="min-w-0 truncate text-ink-2">{f.label}</span>
              <span className="flex shrink-0 items-center gap-3">
                <Delta value={f.delta} unit=" pts" goodWhen="down" decimals={0} />
                <span className="w-10 text-right font-medium text-ink tnum">{fmtPct(f.share, 0)}</span>
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted">
              <div className="h-full rounded-full bg-s1" style={{ width: `${(f.share / top) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Evals({ a }: { a: Agent }) {
  const { toast } = useShell();
  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader
        title="Avaliações"
        description={`Suítes automáticas · última execução ${relTime(a.lastEval)}`}
        actions={
          <Button size="sm" onClick={() => toast({ title: "Avaliação iniciada", description: `${a.name} · ${a.evals.length} suítes · ~6 min`, tone: "info" })}>
            <FlaskConical />
            Rodar
          </Button>
        }
      />
      <div className="flex-1 px-5 pb-3">
        <div className="grid grid-cols-[minmax(0,1fr)_56px_112px_64px] gap-x-3 border-b border-line pb-2 text-[11.5px] font-medium text-ink-3">
          <span>Suíte</span>
          <span className="text-right">Casos</span>
          <span>Aprovação</span>
          <span className="text-right">Variação</span>
        </div>
        <ul className="divide-y divide-line">
          {a.evals.map((e) => (
            <li key={e.suite} className="grid grid-cols-[minmax(0,1fr)_56px_112px_64px] items-center gap-x-3 py-2.5 text-[12.5px]">
              <span className="truncate text-ink-2">{e.suite}</span>
              <span className="text-right text-ink-3 tnum">{fmtInt(e.cases)}</span>
              <span className="flex items-center gap-2">
                <span className="w-11 font-medium text-ink tnum">{fmtPct(e.pass)}</span>
                <Meter value={e.pass} tone={e.pass < 85 ? "crit" : e.pass < 90 ? "warn" : "neutral"} className="flex-1" />
              </span>
              <span className="text-right">
                {e.prev === null ? <span className="text-[11.5px] text-ink-3">nova</span> : <Delta value={e.pass - e.prev} unit=" pts" />}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

/* ─────────────────────── Conversas avaliadas ─────────────────────── */

function Highlight({ text, flag }: { text: string; flag?: string }) {
  if (!flag || !text.includes(flag)) return <>{text}</>;
  const [before, ...rest] = text.split(flag);
  return (
    <>
      {before}
      <mark className="rounded-[3px] bg-crit-soft px-0.5 text-ink underline decoration-crit/70 underline-offset-[3px]">{flag}</mark>
      {rest.join(flag)}
    </>
  );
}

function TraceDetail({ t }: { t: Trace }) {
  const v = VERDICT_META[t.verdict];
  return (
    <div className="min-w-0 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-ink">{t.title}</div>
          <div className="mt-1 text-[12px] text-ink-3 tnum">
            <Mono className="text-[11.5px] text-ink-3">{t.id}</Mono> · {t.channel} · {relTime(t.at)} · {fmtMs(t.latency)} · {fmtInt(t.tokens)} tokens
          </div>
        </div>
        <span className="flex items-center gap-2">
          <StatusChip status={v.status} label={v.label} />
          <span className="text-[12px] text-ink-3 tnum">nota {fmtDec(t.score, 2)}</span>
        </span>
      </div>

      <div className="mt-5 space-y-3">
        {t.turns.map((turn, i) =>
          turn.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[82%] rounded-[12px] rounded-br-[4px] bg-raised px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">{turn.text}</div>
            </div>
          ) : turn.role === "tool" ? (
            <div key={i} className="flex items-center gap-2.5 rounded-[8px] border border-line bg-sunken px-3 py-2 text-[12px]">
              <Wrench className="size-3.5 shrink-0 text-ink-3" />
              <Mono className="shrink-0 text-[11.5px] text-ink">{turn.name}</Mono>
              <span className="min-w-0 flex-1 truncate text-ink-3">{turn.result}</span>
              <span className="shrink-0 text-ink-4 tnum">{fmtMs(turn.ms)}</span>
              {turn.ok ? <Check className="size-3.5 shrink-0 text-ok-ink" /> : <X className="size-3.5 shrink-0 text-crit-ink" />}
            </div>
          ) : (
            <div key={i} className="flex">
              <div className="max-w-[82%] rounded-[12px] rounded-bl-[4px] border border-line bg-subtle px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-2">
                <Highlight text={turn.text} flag={turn.flag} />
              </div>
            </div>
          ),
        )}
      </div>

      <div className="mt-5 rounded-[10px] border border-line-2 bg-subtle p-4">
        <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
          <Scale className="size-3.5 text-ink-3" />
          Avaliação do juiz
          {t.judge.severity && <span className="ml-auto text-[12px] font-normal text-ink-3">Severidade {t.judge.severity.toLowerCase()}</span>}
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{t.judge.reasoning}</p>
        {t.judge.expected && (
          <div className="mt-3 border-t border-line pt-3 text-[13px] leading-relaxed">
            <span className="text-ink-3">Resposta esperada: </span>
            <span className="text-ink-2">{t.judge.expected}</span>
          </div>
        )}
      </div>
    </div>
  );
}

type VerdictFilter = "all" | Trace["verdict"];

function Conversations({ a }: { a: Agent }) {
  const traces = TRACES[a.id] ?? [];
  const [verdict, setVerdict] = useState<VerdictFilter>("all");
  const [selected, setSelected] = useState(traces[0]?.id);
  const list = verdict === "all" ? traces : traces.filter((t) => t.verdict === verdict);
  const current = list.find((t) => t.id === selected) ?? list[0];
  const count = (v: Trace["verdict"]) => traces.filter((t) => t.verdict === v).length;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <Segmented
          size="sm"
          ariaLabel="Veredito"
          value={verdict}
          onChange={setVerdict}
          options={[
            { value: "all", label: "Todas", count: traces.length },
            { value: "incorrect", label: "Incorretas", count: count("incorrect") },
            { value: "partial", label: "Parciais", count: count("partial") },
            { value: "correct", label: "Corretas", count: count("correct") },
          ]}
        />
        <span className="text-[12px] text-ink-3">Avaliadas por LLM-juiz · amostra de 5% das conversas</span>
      </div>
      {current ? (
        <div className="grid @4xl:grid-cols-[320px_minmax(0,1fr)]">
          <ul className="divide-y divide-line border-b border-line @4xl:border-r @4xl:border-b-0">
            {list.map((t) => {
              const v = VERDICT_META[t.verdict];
              const active = t.id === current.id;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(t.id)}
                    aria-current={active}
                    className={cn("relative block w-full px-5 py-3 text-left transition-colors", active ? "bg-raised" : "hover:bg-subtle")}
                  >
                    {active && <span className="absolute inset-y-2 left-0 w-[2px] rounded-full bg-ink-2" />}
                    <span className="flex items-center gap-2 text-[11.5px] text-ink-3 tnum">
                      <StatusDot status={v.status} className="size-1.5" />
                      {v.label}
                      <span className="ml-auto">{relTime(t.at)}</span>
                    </span>
                    <span className="mt-1 block truncate text-[13px] font-medium text-ink">{t.title}</span>
                    <span className="mt-0.5 block truncate text-[12px] text-ink-3">
                      <Mono className="text-[11.5px] text-ink-3">{t.id}</Mono>
                      {t.category ? ` · ${t.category}` : ` · ${t.channel}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <TraceDetail t={current} />
        </div>
      ) : (
        <div className="px-5 py-12 text-center text-[13px] text-ink-3">Nenhuma conversa com esse veredito.</div>
      )}
    </Card>
  );
}

/* ─────────────────────── Versões e dependências ─────────────────────── */

function Versions({ a }: { a: Agent }) {
  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader title="Histórico de versões" description="Precisão medida após cada deploy" />
      <ol className="flex-1 px-5 pb-4">
        {a.versions.map((v, i) => {
          const prev = a.versions[i + 1];
          return (
            <li key={v.version} className="relative flex gap-4 pb-5 last:pb-1">
              {i < a.versions.length - 1 && <span className="absolute top-3 bottom-0 left-[4.5px] w-px bg-line-2" />}
              <span className={cn("relative mt-[5px] size-2.5 shrink-0 rounded-full border-2 border-surface", i === 0 ? "bg-ink" : "bg-ink-4")} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <Mono className="text-[12.5px] text-ink">{v.version}</Mono>
                    {i === 0 && <span className="rounded-full border border-line-2 px-1.5 text-[10.5px] text-ink-3">atual</span>}
                  </span>
                  <span className="text-[12px] text-ink-3 tnum">{shortDate(v.at)}</span>
                </div>
                <p className="mt-0.5 text-[12.5px] text-ink-2">{v.note}</p>
                <div className="mt-1 flex items-center gap-2 text-[12px] text-ink-3 tnum">
                  Precisão {fmtPct(v.accuracy)}
                  {prev && <Delta value={v.accuracy - prev.accuracy} unit=" pts" />}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function Dependencies({ a }: { a: Agent }) {
  const deps = a.dependsOn.map((id) => resourceById(id)).filter((r) => r !== undefined);
  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader title="Dependências" description="Infraestrutura usada pelo agente em produção" />
      <ul className="flex-1 divide-y divide-line border-t border-line">
        {deps.map((r) => (
          <li key={r.id}>
            <Link href={`/infraestrutura?recurso=${r.id}`} className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-subtle">
              <span className="grid size-8 shrink-0 place-items-center rounded-[8px] border border-line bg-subtle text-ink-2">
                <ResourceIcon type={r.type} className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <Mono className="block truncate text-[12.5px] text-ink">{r.id}</Mono>
                <span className="block truncate text-[12px] text-ink-3">{r.headline ?? `${TYPE_META[r.type].label} · ${r.region}`}</span>
              </span>
              <StatusChip status={r.status} />
              <ArrowUpRight className="size-3.5 shrink-0 text-ink-4 transition-colors group-hover:text-ink-2" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ─────────────────────── Página ─────────────────────── */

export function AgentDetailView({ id }: { id: string }) {
  const a = agentById(id)!;
  const { openCopilot, toast } = useShell();
  const tone: Status = a.status === "ok" ? "warn" : a.status;
  const missAcc = a.m.accuracy < a.targets.accuracy;
  const missRes = a.m.resolution < a.targets.resolution;
  const missLat = a.m.latency > a.targets.latency;

  return (
    <div className="animate-enter">
      <PageHeader
        leading={<AgentGlyph name={a.name} project={a.project} size={44} />}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {a.name}
            <StatusChip status={a.status} label={AGENT_STATUS_LABEL[a.status]} pulse={a.status === "crit"} />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{a.role}</span>
            <span className="text-ink-4">·</span>
            <span>
              {a.model} · {a.version}
            </span>
            <span className="text-ink-4">·</span>
            <ProjectTag id={a.project} className="text-[13.5px] text-ink-3" />
            <span className="text-ink-4">·</span>
            <PersonChip id={a.owner} className="text-[13.5px] text-ink-3" />
          </span>
        }
        actions={
          <>
            <Button onClick={() => toast({ title: "Avaliação iniciada", description: `${a.name} · ${a.evals.length} suítes · ~6 min`, tone: "info" })}>
              <FlaskConical />
              Rodar avaliação
            </Button>
            <Button variant="primary" onClick={() => openCopilot(`Por que a precisão do ${a.name} caiu?`)}>
              <Sparkles />
              Investigar com Copilot
            </Button>
          </>
        }
      />

      {a.status !== "ok" && (
        <div className="mb-8 flex items-start gap-3 rounded-[12px] border border-line-2 bg-subtle px-4 py-3">
          <StatusDot status={a.status} pulse={a.status === "crit"} className="mt-[5px]" />
          <p className="min-w-0 text-[13px] leading-relaxed text-ink-2">
            <span className="font-medium text-ink">{AGENT_STATUS_LABEL[a.status]}. </span>
            {a.summary}
          </p>
        </div>
      )}

      <div className="grid gap-4 @2xl:grid-cols-2 @4xl:grid-cols-4">
        <StatCard
          label="Precisão"
          value={fmtPct(a.m.accuracy)}
          delta={a.d.accuracy}
          deltaUnit=" pts"
          foot={`meta ${fmtPct(a.targets.accuracy, 0)}`}
          status={missAcc ? tone : undefined}
        />
        <StatCard
          label="Taxa de resolução"
          value={fmtPct(a.m.resolution)}
          delta={a.d.resolution}
          deltaUnit=" pts"
          foot={`meta ${fmtPct(a.targets.resolution, 0)}`}
          status={missRes ? tone : undefined}
        />
        <StatCard label="Taxa de alucinação" value={fmtPct(a.m.hallucination)} delta={a.d.hallucination} deltaUnit=" pts" goodWhen="down" foot="vs. semana anterior" />
        <StatCard
          label="Latência p95"
          value={fmtMs(a.m.latency)}
          delta={a.d.latency}
          goodWhen="down"
          decimals={0}
          foot={`meta ${fmtMs(a.targets.latency)}`}
          status={missLat ? tone : undefined}
        />
      </div>

      <Section title="Qualidade ao longo do tempo" description="Marcadores indicam deploys de novas versões do agente.">
        <QualityChart a={a} />
      </Section>

      <Section title="Diagnóstico" description="O que está falhando e como as suítes de avaliação estão se comportando.">
        <div className="grid gap-4 @4xl:grid-cols-2">
          <FailureModes a={a} />
          <Evals a={a} />
        </div>
      </Section>

      <Section title="Conversas avaliadas" description="Amostra recente com o veredito do juiz e a resposta esperada.">
        <div id="conversas" className="scroll-mt-6">
          <Conversations a={a} />
        </div>
      </Section>

      <Section title="Versões e dependências">
        <div className="grid gap-4 @4xl:grid-cols-2">
          <Versions a={a} />
          <Dependencies a={a} />
        </div>
      </Section>

      <p className="mt-8 text-center text-[12px] text-ink-4">
        {fmtCompact(a.m.volume)} conversas por dia · custo médio de {fmtBRL(a.m.cost, a.m.cost < 0.1 ? 3 : 2)} por conversa · CSAT {fmtDec(a.m.csat, 1)}
      </p>
    </div>
  );
}
