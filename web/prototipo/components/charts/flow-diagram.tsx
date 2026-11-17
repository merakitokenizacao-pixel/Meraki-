"use client";

import Link from "next/link";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BellRing,
  Bot,
  Building2,
  ChartColumn,
  CircleCheck,
  CircleDashed,
  CreditCard,
  Database,
  Hash,
  Headset,
  Mail,
  MessageCircle,
  MessageSquare,
  Network,
  Phone,
  Plug,
  Smartphone,
  Ticket,
  UserRound,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { projectHref } from "@/components/shell/nav";
import { AgentGlyph } from "@/components/ui/misc";
import { ResourceIcon } from "@/components/ui/resource-icon";
import { STATUS_META, StatusChip, StatusDot } from "@/components/ui/status";
import { AGENTS, agentById } from "@/lib/data/agents";
import type { Flow, FlowEdge, FlowIcon, FlowNode } from "@/lib/data/flows";
import { TYPE_META, categoryOf, resourceById, saturationOf, type Resource } from "@/lib/data/infra";
import { projectById } from "@/lib/data/projects";
import { fmtCompact, fmtMs, fmtPct } from "@/lib/format";
import { STATUS_RANK, worstStatus, type Status } from "@/lib/types";
import { plural, setSearchParam } from "@/lib/url";
import { cn } from "@/lib/utils";

const ICONS: Record<FlowIcon, LucideIcon> = {
  users: Users,
  headset: Headset,
  chat: MessageCircle,
  message: MessageSquare,
  app: Smartphone,
  phone: Phone,
  ticket: Ticket,
  api: Plug,
  slack: Hash,
  alert: BellRing,
  mail: Mail,
  network: Network,
  events: Workflow,
  database: Database,
  chart: ChartColumn,
  card: CreditCard,
  team: Building2,
  check: CircleCheck,
  human: UserRound,
  open: CircleDashed,
};

/** Indicador que resume o recurso quando ele está saudável. */
function keyMetric(r: Resource) {
  const cat = categoryOf(r);
  if (cat === "service" && r.latency !== undefined) return r.errorRate >= 1 ? `erros ${fmtPct(r.errorRate, 1)}` : `p95 ${fmtMs(r.latency)}`;
  if (cat === "messaging" && r.throughput !== undefined) return `${fmtCompact(r.throughput)} ${r.throughputUnit ?? ""}`.trim();
  const sat = saturationOf(r);
  return `${sat.label} ${fmtPct(sat.value, 0)}`;
}

const alerting = (s: Status) => s !== "ok" && s !== "maint";

/** Estado que colore a aresta: a chamada entra em um recurso (ou agente) com alerta. */
function edgeStatus(node: FlowNode | undefined): Status | null {
  if (node?.kind === "resource") {
    const r = resourceById(node.ref);
    return r && alerting(r.status) ? r.status : null;
  }
  if (node?.kind === "agent") {
    const a = agentById(node.ref);
    return a && alerting(a.status) ? a.status : null;
  }
  return null;
}

function nodeStatus(node: FlowNode): Status | null {
  if (node.kind === "resource") return resourceById(node.ref)?.status ?? null;
  if (node.kind === "agent") return agentById(node.ref)?.status ?? null;
  if (node.kind === "agents") return worstStatus(AGENTS.filter((a) => a.project === node.project).map((a) => a.status));
  return null;
}

type Box = { x: number; y: number; w: number; h: number };
type Geo = { w: number; h: number; nodes: Record<string, Box> };

const NODE =
  "relative z-10 flex w-full max-w-[248px] min-w-0 items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-left transition-[opacity,border-color,background-color] duration-200";

/** Título na primeira linha; o ponto de estado abre a segunda — a linha que explica o estado. */
function Body({ icon, title, mono, sub, status }: { icon: React.ReactNode; title: string; mono?: boolean; sub: string; status?: Status | null }) {
  return (
    <>
      {icon}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-ink", mono ? "font-mono text-[11.5px]" : "text-[12.5px] font-medium")} title={title}>
          {title}
        </span>
        <span className="mt-0.5 flex items-start gap-1.5">
          {status && <StatusDot status={status} className="mt-[5px] size-1.5" />}
          <span className="line-clamp-2 min-w-0 text-[11.5px] leading-snug text-ink-3">{sub}</span>
        </span>
      </span>
    </>
  );
}

const IconBox = ({ children, dashed }: { children: React.ReactNode; dashed?: boolean }) => (
  <span
    className={cn(
      "grid size-7 shrink-0 place-items-center rounded-[7px] border bg-subtle text-ink-2 [&_svg]:size-3.5",
      dashed ? "border-dashed border-line-2" : "border-line",
    )}
  >
    {children}
  </span>
);

function NodeView({
  node,
  dim,
  active,
  nodeRef,
  onHover,
}: {
  node: FlowNode;
  dim: boolean;
  active: boolean;
  nodeRef: (el: HTMLElement | null) => (() => void) | undefined;
  onHover: (id: string | null) => void;
}) {
  const hover = {
    onMouseEnter: () => onHover(node.id),
    onMouseLeave: () => onHover(null),
    onFocus: () => onHover(node.id),
    onBlur: () => onHover(null),
  };
  const solid = cn(NODE, "border-line-2 bg-raised", active ? "border-ink-4" : "hover:border-ink-4", dim && "opacity-40");

  if (node.kind === "resource") {
    const r = resourceById(node.ref);
    if (!r) return null;
    const label = `${r.id}, ${STATUS_META[r.status].label}${r.headline && r.status !== "ok" ? `: ${r.headline}` : ""}. Abrir detalhes.`;
    return (
      <button ref={nodeRef} data-node={node.id} type="button" aria-label={label} onClick={() => setSearchParam("recurso", r.id)} className={cn(solid, "cursor-pointer")} {...hover}>
        <Body
          icon={
            <IconBox>
              <ResourceIcon type={r.type} />
            </IconBox>
          }
          title={r.id}
          mono
          sub={r.status !== "ok" && r.headline ? r.headline : `${TYPE_META[r.type].label} · ${keyMetric(r)}`}
          status={r.status}
        />
      </button>
    );
  }

  if (node.kind === "agent") {
    const a = agentById(node.ref);
    if (!a) return null;
    return (
      <Link ref={nodeRef} data-node={node.id} href={`/agentes/${a.id}`} aria-label={`${a.name}. Abrir agente.`} className={solid} {...hover}>
        <Body
          icon={<AgentGlyph name={a.name} project={a.project} size={28} className="rounded-[7px]" />}
          title={a.name}
          sub={`Resolve ${fmtPct(a.m.resolution)} · ${fmtCompact(a.m.volume)}/dia`}
          status={a.status}
        />
      </Link>
    );
  }

  if (node.kind === "agents") {
    const list = AGENTS.filter((a) => a.project === node.project);
    const off = list.filter((a) => a.status !== "ok").length;
    const p = projectById(node.project);
    return (
      <Link ref={nodeRef} data-node={node.id} href={projectHref(node.project, "agentes")} aria-label={`Agentes do ${p?.name}. Abrir parte de agentes.`} className={solid} {...hover}>
        <Body
          icon={
            <IconBox>
              <Bot />
            </IconBox>
          }
          title={`Agentes do ${p?.name}`}
          sub={`${plural(list.length, "agente", "agentes")} · ${off ? `${off} fora da meta` : list.length > 1 ? "todos na meta" : "na meta"}`}
          status={nodeStatus(node)}
        />
      </Link>
    );
  }

  const Icon = ICONS[node.icon];
  if (node.kind === "external") {
    return (
      <div ref={nodeRef} data-node={node.id} className={cn(NODE, "border-dashed border-line-2 bg-surface", dim && "opacity-40")} {...hover}>
        <Body
          icon={
            <IconBox dashed>
              <Icon />
            </IconBox>
          }
          title={node.label}
          sub={node.sub}
        />
      </div>
    );
  }

  return (
    <div ref={nodeRef} data-node={node.id} title={`${node.label} — ${node.sub}`} className={cn(NODE, "border-line-2 bg-raised", dim && "opacity-40")} {...hover}>
      <Body
        icon={
          <IconBox>
            <Icon />
          </IconBox>
        }
        title={node.label}
        sub={`${fmtCompact(Math.round(node.value))} por dia · ${fmtPct(node.share * 100, 0)} do total`}
      />
    </div>
  );
}

/**
 * Diagrama de fluxo em colunas. Os nós são HTML (texto nítido, focáveis); as
 * conexões são curvas em SVG medidas a partir dos nós. Conexões que entram em
 * um recurso ou agente com alerta ganham a cor do estado e um tracejado em
 * movimento; passar o mouse num nó destaca as conexões dele e mostra os rótulos.
 */
export function FlowDiagram({ flow }: { flow: Flow }) {
  const wrap = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const [geo, setGeo] = useState<Geo | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const byId = useMemo(() => new Map(flow.columns.flatMap((c) => c.nodes.map((n) => [n.id, n] as const))), [flow]);

  const measure = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const nodes: Record<string, Box> = {};
    els.current.forEach((n, id) => {
      const r = n.getBoundingClientRect();
      nodes[id] = { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height };
    });
    setGeo({ w: box.width, h: box.height, nodes });
  }, []);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    els.current.forEach((n) => ro.observe(n));
    return () => ro.disconnect();
  }, [measure, flow]);

  /** Registra cada nó pelo `data-node`; a limpeza do ref (React 19) remove o nó ao desmontar. */
  const register = useCallback((el: HTMLElement | null) => {
    const id = el?.dataset.node;
    if (!el || !id) return;
    els.current.set(id, el);
    return () => {
      els.current.delete(id);
    };
  }, []);

  const paths = useMemo(() => {
    if (!geo) return [];
    const out = new Map<string, FlowEdge[]>();
    const inc = new Map<string, FlowEdge[]>();
    for (const ed of flow.edges) {
      out.set(ed.from, [...(out.get(ed.from) ?? []), ed]);
      inc.set(ed.to, [...(inc.get(ed.to) ?? []), ed]);
    }
    const cy = (id: string) => (geo.nodes[id] ? geo.nodes[id].y + geo.nodes[id].h / 2 : 0);
    // Distribui as pontas de várias conexões ao longo da altura do nó, na ordem vertical da outra ponta.
    const port = (id: string, list: FlowEdge[], ed: FlowEdge, other: (e: FlowEdge) => string) => {
      const n = geo.nodes[id];
      const sorted = [...list].sort((a, b) => cy(other(a)) - cy(other(b)));
      const k = sorted.length;
      if (k === 1) return n.y + n.h / 2;
      const span = Math.min(n.h - 20, (k - 1) * 7);
      return n.y + n.h / 2 - span / 2 + (sorted.indexOf(ed) * span) / (k - 1);
    };
    return flow.edges.flatMap((ed) => {
      const a = geo.nodes[ed.from];
      const b = geo.nodes[ed.to];
      if (!a || !b) return [];
      const x1 = a.x + a.w;
      const x2 = b.x;
      const y1 = port(ed.from, out.get(ed.from)!, ed, (e) => e.to);
      const y2 = port(ed.to, inc.get(ed.to)!, ed, (e) => e.from);
      const dx = Math.max(20, (x2 - x1) * 0.5);
      return [{ ed, d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`, a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, status: edgeStatus(byId.get(ed.to)) }];
    });
  }, [geo, flow.edges, byId]);

  const neighbors = useMemo(() => {
    if (!hover) return null;
    const s = new Set([hover]);
    for (const ed of flow.edges) {
      if (ed.from === hover) s.add(ed.to);
      if (ed.to === hover) s.add(ed.from);
    }
    return s;
  }, [hover, flow.edges]);

  const n = flow.columns.length;
  const cols = { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` };
  const touches = (ed: FlowEdge) => hover !== null && (ed.from === hover || ed.to === hover);

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <div style={{ minWidth: n * 176 + (n - 1) * 48 }}>
        <div className="mb-3 grid gap-x-12 @5xl:gap-x-16" style={cols}>
          {flow.columns.map((c) => (
            <div key={c.title} className="text-center text-[11.5px] font-medium text-ink-3">
              {c.title}
            </div>
          ))}
        </div>
        <div ref={wrap} role="group" aria-label={flow.title} className="relative grid gap-x-12 @5xl:gap-x-16" style={cols}>
          {geo && (
            <svg aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-visible" width={geo.w} height={geo.h}>
              {paths.map(({ ed, d, a, b, status }) => {
                const on = touches(ed);
                const dim = hover !== null && !on;
                const color = status ? STATUS_META[status].hex : on ? "var(--color-ink-3)" : "var(--color-ink-4)";
                return (
                  <g key={`${ed.from}>${ed.to}`} style={{ opacity: dim ? 0.16 : 1, transition: "opacity 200ms" }}>
                    {status ? (
                      <>
                        <path d={d} fill="none" stroke={color} strokeOpacity={0.3} strokeWidth={1.5} />
                        <path d={d} fill="none" stroke={color} strokeWidth={1.75} strokeDasharray="4 10" strokeLinecap="round" className="motion-safe:animate-flow" />
                      </>
                    ) : (
                      <path d={d} fill="none" stroke={color} strokeWidth={on ? 1.5 : 1.25} />
                    )}
                    <circle cx={a.x} cy={a.y} r={2.25} fill={color} />
                    <circle cx={b.x} cy={b.y} r={2.25} fill={color} />
                  </g>
                );
              })}
            </svg>
          )}

          {flow.columns.map((c) => (
            <div key={c.title} className="flex min-w-0 flex-col items-center justify-center gap-3">
              {c.nodes.map((node) => (
                <NodeView
                  key={node.id}
                  node={node}
                  dim={neighbors !== null && !neighbors.has(node.id)}
                  active={hover === node.id}
                  nodeRef={register}
                  onHover={setHover}
                />
              ))}
            </div>
          ))}

          {paths
            .filter((p) => p.ed.label && touches(p.ed))
            .map((p) => (
              <span
                key={`label:${p.ed.from}>${p.ed.to}`}
                className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2 animate-fade rounded-full border border-line-2 bg-canvas px-2 py-0.5 text-[11px] whitespace-nowrap text-ink-2 tnum"
                style={{ left: (p.a.x + p.b.x) / 2, top: (p.a.y + p.b.y) / 2 }}
              >
                {p.ed.label}
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}

/** Estados presentes no fluxo, do mais grave para o mais leve — base da legenda. */
export function flowStatuses(flow: Flow): Status[] {
  const set = new Set<Status>();
  for (const c of flow.columns) for (const node of c.nodes) {
    const s = nodeStatus(node);
    if (s) set.add(s);
  }
  return Array.from(set).sort((a, b) => STATUS_RANK[b] - STATUS_RANK[a]);
}

export function FlowLegend({ flow, labels }: { flow: Flow; labels?: Partial<Record<Status, string>> }) {
  const statuses = flowStatuses(flow);
  const hasExternal = flow.columns.some((c) => c.nodes.some((n) => n.kind === "external"));
  const hot = statuses.some(alerting);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-ink-3">
      {statuses.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <StatusDot status={s} className="size-1.5" />
          {labels?.[s] ?? STATUS_META[s].label}
        </span>
      ))}
      {hot && (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <svg width="18" height="6" aria-hidden>
            <line x1="1" y1="3" x2="17" y2="3" stroke="var(--color-ink-3)" strokeWidth="1.75" strokeDasharray="4 4" strokeLinecap="round" />
          </svg>
          Conexão afetada
        </span>
      )}
      {hasExternal && (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="size-3 rounded-[3px] border border-dashed border-ink-4" />
          Fora do Meraki
        </span>
      )}
    </div>
  );
}

/** Recursos de base do fluxo (ex.: cluster onde tudo roda). */
export function FlowBase({ ids }: { ids: string[] }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12px] text-ink-3">
      <span>Executa em</span>
      {ids.map((id) => {
        const r = resourceById(id);
        if (!r) return null;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setSearchParam("recurso", id)}
            className="inline-flex items-center gap-2 rounded-[7px] border border-line-2 bg-raised py-1 pr-1.5 pl-2 text-ink-2 transition-colors hover:border-ink-4 hover:text-ink"
          >
            <ResourceIcon type={r.type} className="size-3.5" />
            <span className="font-mono text-[11.5px]">{r.id}</span>
            <StatusChip status={r.status} className="h-[18px] px-1.5 text-[11px]" />
          </button>
        );
      })}
    </div>
  );
}
