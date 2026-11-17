"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import {
  Activity,
  BellRing,
  CircleCheck,
  MessageSquare,
  Radio,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Siren,
  Sparkles,
  UserCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Heatmap } from "@/components/charts/heatmap";
import { useShell } from "@/components/shell/provider";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, PageHeader, Section } from "@/components/ui/card";
import { Meter } from "@/components/ui/meter";
import { AgentGlyph, Avatar, EmptyState, Mono, PersonChip, ProjectTag } from "@/components/ui/misc";
import { ResourceIcon } from "@/components/ui/resource-icon";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat";
import { SevBadge, StatusDot } from "@/components/ui/status";
import { agentById } from "@/lib/data/agents";
import {
  ACTIVE_INCIDENTS,
  INCIDENTS,
  INCIDENT_STATUS_META,
  SEVERITY_META,
  incidentById,
  incidentHeatmap,
  incidentSummary,
  type Incident,
  type TimelineKind,
} from "@/lib/data/incidents";
import { resourceById } from "@/lib/data/infra";
import { PEOPLE } from "@/lib/data/people";
import { axisLabels, clockTime, durationLabel, relTime, when } from "@/lib/time";
import { plural, setSearchParam } from "@/lib/url";
import { cn, normalize } from "@/lib/utils";

const isOpen = (i: Incident) => i.status !== "resolved";
const sortQueue = (a: Incident, b: Incident) => a.sev - b.sev || a.started - b.started;

const STEPS = ["Aberto", "Investigando", "Mitigando", "Monitorando", "Resolvido"];

const KIND_ICON: Record<TimelineKind, LucideIcon> = {
  deploy: Rocket,
  alert: BellRing,
  ai: Sparkles,
  ack: UserCheck,
  action: Wrench,
  metric: Activity,
  resolve: CircleCheck,
  comment: MessageSquare,
};

function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-[22px] items-center rounded-full border border-line-2 bg-raised px-2 text-[11.5px] font-medium whitespace-nowrap text-ink-2", className)}>
      {children}
    </span>
  );
}

function durationOf(i: Incident) {
  return i.resolvedAt !== undefined ? durationLabel(i.started - i.resolvedAt) : durationLabel(i.started);
}

/* ─────────────────────── Fila ─────────────────────── */

function QueueItem({ i, active }: { i: Incident; active: boolean }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => setSearchParam("id", i.id, "replace")}
        aria-current={active}
        className={cn("relative block w-full px-4 py-3.5 text-left transition-colors", active ? "bg-raised" : "hover:bg-subtle")}
      >
        {active && <span className="absolute inset-y-2.5 left-0 w-[2px] rounded-full bg-ink-2" />}
        <span className="flex items-center gap-2">
          <SevBadge sev={i.sev} />
          <Mono className="text-[11.5px] text-ink-3">{i.id}</Mono>
          <span className="ml-auto text-[11.5px] text-ink-3 tnum">{durationOf(i)}</span>
        </span>
        <span className="mt-2 block truncate text-[13.5px] font-medium text-ink">{i.title}</span>
        <span className="mt-1.5 flex items-center gap-3 text-[12px] text-ink-3">
          <ProjectTag id={i.project} className="text-[12px] text-ink-3" />
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Avatar name={PEOPLE[i.owner].name} size={16} />
            <span className="truncate">{PEOPLE[i.owner].name.split(" ")[0]}</span>
          </span>
          <span className="ml-auto shrink-0">{INCIDENT_STATUS_META[i.status].label}</span>
        </span>
      </button>
    </li>
  );
}

/* ─────────────────────── Detalhe ─────────────────────── */

function Stepper({ i }: { i: Incident }) {
  if (i.status === "maintenance") {
    return (
      <div className="flex items-center gap-2 rounded-[10px] border border-line px-3.5 py-2.5 text-[12.5px] text-ink-2">
        <RefreshCw className="size-3.5 text-ink-3" />
        Manutenção programada · sem impacto esperado para clientes
      </div>
    );
  }
  const step = INCIDENT_STATUS_META[i.status].step;
  return (
    <ol className="grid grid-cols-5 gap-1.5">
      {STEPS.map((label, s) => (
        <li key={label} className="min-w-0">
          <div className={cn("h-1 rounded-full", s <= step ? (s === step && step < 4 ? "bg-ink" : "bg-ink-3") : "bg-muted")} />
          <div className={cn("mt-2 truncate text-[11.5px]", s === step ? "font-medium text-ink" : s < step ? "text-ink-3" : "text-ink-4")}>{label}</div>
        </li>
      ))}
    </ol>
  );
}

function Affected({ ids }: { ids: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {ids.map((id) => {
        const r = resourceById(id);
        if (r) {
          return (
            <Link
              key={id}
              href={`/infraestrutura?recurso=${id}`}
              className="inline-flex h-7 items-center gap-2 rounded-[8px] border border-line-2 bg-raised px-2.5 text-[12px] text-ink-2 transition-colors hover:border-ink-4 hover:text-ink"
            >
              <ResourceIcon type={r.type} className="size-3.5 text-ink-3" />
              <Mono className="text-[11.5px] text-inherit">{id}</Mono>
              <StatusDot status={r.status} className="size-1.5" />
            </Link>
          );
        }
        const a = agentById(id);
        if (a) {
          return (
            <Link
              key={id}
              href={`/agentes/${id}`}
              className="inline-flex h-7 items-center gap-2 rounded-[8px] border border-line-2 bg-raised pr-2.5 pl-1 text-[12px] text-ink-2 transition-colors hover:border-ink-4 hover:text-ink"
            >
              <AgentGlyph name={a.name} project={a.project} size={20} />
              {a.name}
              <StatusDot status={a.status} className="size-1.5" />
            </Link>
          );
        }
        return null;
      })}
    </div>
  );
}

function Timeline({ i }: { i: Incident }) {
  const items = [...i.timeline].sort((a, b) => b.at - a.at);
  return (
    <ol>
      {items.map((t, k) => {
        const Icon = KIND_ICON[t.kind];
        const ai = t.kind === "ai";
        return (
          <li key={k} className="relative flex gap-3.5 pb-5 last:pb-0">
            {k < items.length - 1 && <span className="absolute top-8 bottom-1 left-[13.5px] w-px bg-line-2" />}
            <span
              className={cn(
                "relative grid size-7 shrink-0 place-items-center rounded-full border [&_svg]:size-3.5",
                ai ? "border-accent/30 bg-accent-soft text-accent-ink" : "border-line-2 bg-raised text-ink-3",
              )}
            >
              <Icon />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="text-[13px] text-ink">{t.title}</span>
                <span className="shrink-0 text-[11.5px] text-ink-3 tnum" title={when(t.at)}>
                  {t.at < 1440 ? clockTime(t.at) : when(t.at)}
                </span>
              </div>
              {(t.detail || t.actor) && (
                <div className="mt-0.5 text-[12px] text-ink-3">
                  {t.actor && <span>{PEOPLE[t.actor]?.name}</span>}
                  {t.actor && t.detail && " · "}
                  {t.detail}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function IncidentDetail({ i }: { i: Incident }) {
  const { toast, openCopilot } = useShell();
  const sev = SEVERITY_META[i.sev];
  return (
    <div className="flex min-w-0 flex-col">
      <div className="border-b border-line p-5">
        <div className="flex flex-wrap items-center gap-2">
          <SevBadge sev={i.sev} />
          <Pill>{INCIDENT_STATUS_META[i.status].label}</Pill>
          <Mono className="text-[12px] text-ink-3">{i.id}</Mono>
          <span className="ml-auto text-[12px] text-ink-3 tnum">
            {i.resolvedAt !== undefined ? `Resolvido ${relTime(i.resolvedAt)} · durou ${durationOf(i)}` : `Aberto ${relTime(i.started)}`}
          </span>
        </div>
        <h2 className="mt-3 text-[18px] leading-snug font-semibold tracking-[-0.01em] text-ink">{i.title}</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{i.summary}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-ink-3">
          <ProjectTag id={i.project} />
          <PersonChip id={i.owner} />
          <span>Detectado por {i.detectedBy === "Meraki" ? "Meraki" : i.detectedBy === "Alerta" ? "regra de alerta" : "abertura manual"}</span>
          <span>{sev.description}</span>
        </div>
        <div className="mt-5">
          <Stepper i={i} />
        </div>
      </div>

      <div className="grid grid-cols-1 divide-y divide-line border-b border-line @2xl:grid-cols-3 @2xl:divide-x @2xl:divide-y-0">
        {i.impact.map((m) => (
          <div key={m.label} className="min-w-0 px-5 py-4">
            <div className="truncate text-[11.5px] text-ink-3">{m.label}</div>
            <div className="mt-1.5 truncate text-[16px] font-medium tracking-[-0.01em] text-ink tnum">{m.value}</div>
          </div>
        ))}
      </div>

      <div className="space-y-6 p-5">
        {i.hypothesis && (
          <div className="rounded-[10px] border border-line-2 bg-subtle p-4">
            <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
              <Sparkles className="size-3.5 text-accent-ink" />
              Causa provável
              <span className="ml-auto flex items-center gap-2 text-[12px] font-normal text-ink-3 tnum">
                confiança {i.hypothesis.confidence}%
                <Meter value={i.hypothesis.confidence} tone="accent" className="w-16" />
              </span>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{i.hypothesis.text}</p>
          </div>
        )}

        <div>
          <div className="mb-2.5 text-[12.5px] font-medium text-ink">Afetados</div>
          <Affected ids={i.affected} />
        </div>

        <div>
          <div className="mb-3 text-[12.5px] font-medium text-ink">Linha do tempo</div>
          <Timeline i={i} />
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
        {isOpen(i) && (
          <>
            <Button onClick={() => toast({ title: "Sala de guerra aberta", description: `Canal #inc-${i.id.slice(4)} criado com ${PEOPLE[i.owner].name}.`, tone: "info" })}>
              <Radio />
              Sala de guerra
            </Button>
            <Button onClick={() => toast({ title: "Status atualizado", description: `${i.id} → próxima etapa registrada na linha do tempo.`, tone: "ok" })}>
              <ShieldCheck />
              Atualizar status
            </Button>
          </>
        )}
        <Button variant="primary" onClick={() => openCopilot(`Resumo do ${i.id}: ${i.title}`)}>
          <Sparkles />
          Resumir com Copilot
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────── Área de trabalho (fila + detalhe) ─────────────────────── */

type QueueTab = "open" | "resolved" | "all";

function Workspace() {
  const params = useSearchParams();
  const [tab, setTab] = useState<QueueTab>("open");
  const [query, setQuery] = useState("");

  const list = useMemo(() => {
    const q = normalize(query.trim());
    const base = tab === "open" ? INCIDENTS.filter(isOpen) : tab === "resolved" ? INCIDENTS.filter((i) => !isOpen(i)) : INCIDENTS;
    return base.filter((i) => !q || normalize(`${i.id} ${i.title} ${i.summary}`).includes(q)).sort(sortQueue);
  }, [tab, query]);

  const fromUrl = incidentById(params.get("id") ?? "");
  const current = fromUrl ?? list[0];

  return (
    <Card className="overflow-hidden">
      <div className="grid @5xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col border-b border-line @5xl:border-r @5xl:border-b-0">
          <div className="space-y-2.5 border-b border-line p-4">
            <Segmented
              size="sm"
              ariaLabel="Situação"
              value={tab}
              onChange={setTab}
              className="w-full [&>button]:flex-1 [&>button]:justify-center"
              options={[
                { value: "open", label: "Abertos", count: INCIDENTS.filter(isOpen).length },
                { value: "resolved", label: "Resolvidos", count: INCIDENTS.filter((i) => !isOpen(i)).length },
                { value: "all", label: "Todos", count: INCIDENTS.length },
              ]}
            />
            <SearchInput value={query} onChange={setQuery} placeholder="Buscar incidente" className="w-full" />
          </div>
          {list.length ? (
            <ul className="divide-y divide-line">
              {list.map((i) => (
                <QueueItem key={i.id} i={i} active={i.id === current?.id} />
              ))}
            </ul>
          ) : (
            <div className="px-4 py-10 text-center text-[13px] text-ink-3">Nenhum incidente encontrado.</div>
          )}
        </div>
        {current ? (
          <IncidentDetail key={current.id} i={current} />
        ) : (
          <EmptyState icon={<Siren className="size-5" />} title="Nenhum incidente selecionado" description="Escolha um item da fila para ver detalhes." />
        )}
      </div>
    </Card>
  );
}

function WorkspaceSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="grid @5xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-3 border-b border-line p-4 @5xl:border-r @5xl:border-b-0">
          {Array.from({ length: 6 }, (_, k) => (
            <Skeleton key={k} className="h-16 w-full" />
          ))}
        </div>
        <div className="space-y-4 p-5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-[280px] w-full" />
        </div>
      </div>
    </Card>
  );
}

/* ─────────────────────── Página ─────────────────────── */

export function IncidentsView() {
  const { toast } = useShell();
  const s = incidentSummary();
  const heat = useMemo(() => incidentHeatmap(), []);
  const days = useMemo(() => axisLabels("30d"), []);
  const total30 = heat.reduce((acc, row) => acc + row.days.reduce((a, b) => a + b, 0), 0);

  return (
    <div className="animate-enter">
      <PageHeader
        title="Incidentes"
        description={`${plural(s.active, "incidente ativo", "incidentes ativos")} · ${plural(s.maintenance, "manutenção programada", "manutenções programadas")}`}
        actions={
          <>
            <Button onClick={() => toast({ title: "Escala de plantão", description: "Plantão de hoje: Marina Costa (infra) e Lucas Prado (IA).", tone: "info" })}>
              <UserCheck />
              Plantão
            </Button>
            <Button variant="primary" onClick={() => toast({ title: "Declarar incidente", description: "Formulário de abertura — severidade, projeto e responsável.", tone: "info" })}>
              <Siren />
              Declarar incidente
            </Button>
          </>
        }
      />

      <div className="grid gap-4 @2xl:grid-cols-2 @4xl:grid-cols-4">
        <StatCard
          label="Incidentes ativos"
          value={s.active}
          status={s.sev[1] ? "crit" : s.sev[2] ? "serious" : "warn"}
          foot={([1, 2, 3, 4] as const)
            .filter((k) => s.sev[k])
            .map((k) => `${s.sev[k]} SEV-${k}`)
            .join(" · ")}
        />
        <StatCard label="Tempo até reconhecer" value={durationLabel(s.mtta)} delta={s.mttaDelta} goodWhen="down" decimals={0} foot="mediana · 30 dias" />
        <StatCard label="Tempo até resolver" value={durationLabel(s.mttr)} delta={s.mttrDelta} goodWhen="down" decimals={0} foot="mediana · 30 dias" />
        <StatCard label="Detectados pelo Meraki" value={s.byMeraki} unit={`de ${s.active}`} foot="antes de qualquer regra de alerta" />
      </div>

      <Section title="Fila" description="Ordenada por severidade e tempo em aberto. O detalhe fica no link — compartilhe a URL.">
        <Suspense fallback={<WorkspaceSkeleton />}>
          <Workspace />
        </Suspense>
      </Section>

      <Section title="Histórico" description="Incidentes abertos por projeto nos últimos 30 dias.">
        <Card>
          <CardHeader
            title="Incidentes por dia"
            description={`${total30} incidentes em 30 dias · ${ACTIVE_INCIDENTS.filter((i) => i.project === "atlas").length} ativos no Atlas`}
          />
          <div className="px-5 pb-5">
            <Heatmap rows={heat.map((h) => ({ key: h.project.id, label: <ProjectTag id={h.project.id} />, values: h.days }))} columns={days} unit="incidentes" />
          </div>
        </Card>
      </Section>
    </div>
  );
}
