"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { BookmarkPlus, ChevronDown, Download, Plus, SearchX, Sparkles, Trash2 } from "lucide-react";
import { BarList } from "@/components/charts/bar-list";
import { useShell } from "@/components/shell/provider";
import { Button } from "@/components/ui/button";
import { Card, CardFooter, CardHeader, PageHeader, Section } from "@/components/ui/card";
import { AgentGlyph, EmptyState, Mono, ProjectTag } from "@/components/ui/misc";
import { MultiSelectChip } from "@/components/ui/popover";
import { ResourceIcon } from "@/components/ui/resource-icon";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_META, StatusChip } from "@/components/ui/status";
import { AGENT_STATUS_LABEL, type Agent } from "@/lib/data/agents";
import {
  FIELDS,
  NL_EXAMPLES,
  OPS_BY_TYPE,
  OP_LABEL,
  SAVED_VIEWS,
  fieldValue,
  newId,
  parseNaturalQuery,
  runQuery,
  type Condition,
  type FieldDef,
  type Query,
  type Source,
} from "@/lib/data/explorer";
import { CATEGORY_META, TYPE_META, categoryOf, type Resource } from "@/lib/data/infra";
import { projectById } from "@/lib/data/projects";
import { fmtBRL, fmtDec, fmtInt, fmtMs, fmtPct } from "@/lib/format";
import { setSearchParam } from "@/lib/url";
import { cn } from "@/lib/utils";

/* ─────────────────────── Utilidades ─────────────────────── */

const SOURCE_LABEL: Record<Source, string> = { agents: "Agentes de IA", infra: "Sistemas" };
const SQL_TABLE: Record<Source, string> = { agents: "agents", infra: "resources" };

const GROUPS: Record<Source, { value: string; label: string }[]> = {
  agents: [
    { value: "none", label: "Item" },
    { value: "project", label: "Projeto" },
    { value: "status", label: "Status" },
    { value: "model", label: "Modelo" },
  ],
  infra: [
    { value: "none", label: "Item" },
    { value: "project", label: "Projeto" },
    { value: "status", label: "Status" },
    { value: "category", label: "Categoria" },
  ],
};

function formatMetric(def: FieldDef | undefined, v: number) {
  if (!def) return fmtDec(v, 1);
  if (def.unit === "%") return fmtPct(v);
  if (def.unit === "ms") return fmtMs(v);
  if (def.unit === "R$") return fmtBRL(v, v < 1 ? 3 : 0);
  if (def.key === "volume") return fmtInt(v);
  return fmtDec(v, 1);
}

function sqlValue(def: FieldDef | undefined, c: Condition) {
  if (Array.isArray(c.value)) return `(${c.value.map((v) => `'${v}'`).join(", ")})`;
  if (def?.type === "text") return `'%${c.value}%'`;
  return String(c.value);
}

const SQL_OP: Record<string, string> = { is: "IN", is_not: "NOT IN", gt: ">", gte: ">=", lt: "<", lte: "<=", contains: "ILIKE" };

function toSql(q: Query, metric: string) {
  const defs = FIELDS[q.source];
  const active = q.conditions.filter((c) => !(Array.isArray(c.value) && !c.value.length) && c.value !== "");
  const cols = q.source === "agents" ? ["name", "project", "status", metric] : ["id", "project", "status", metric];
  const lines = [`SELECT ${Array.from(new Set(cols)).join(", ")}`, `FROM ${SQL_TABLE[q.source]}`];
  active.forEach((c, i) => {
    const def = defs.find((f) => f.key === c.field);
    lines.push(`${i === 0 ? "WHERE" : `  ${q.combinator === "and" ? "AND" : "OR"}`} ${c.field} ${SQL_OP[c.op]} ${sqlValue(def, c)}`);
  });
  lines.push(`ORDER BY ${metric} ${defs.find((f) => f.key === metric)?.higherIsBetter ? "ASC" : "DESC"};`);
  return lines.join("\n");
}

function labelOf(source: Source, row: Agent | Resource) {
  return source === "agents" ? (row as Agent).name : (row as Resource).id;
}

function groupLabel(source: Source, group: string, key: string) {
  if (group === "project") return projectById(key)?.name ?? key;
  if (group === "status") return source === "agents" ? AGENT_STATUS_LABEL[key as keyof typeof AGENT_STATUS_LABEL] : STATUS_META[key as keyof typeof STATUS_META].label;
  if (group === "category") return CATEGORY_META[key as keyof typeof CATEGORY_META]?.label ?? key;
  return key;
}

function groupKey(source: Source, row: Agent | Resource, group: string) {
  if (group === "category") return categoryOf(row as Resource);
  return String(fieldValue(source, row, group) ?? "—");
}

/* ─────────────────────── Controles ─────────────────────── */

function Select({ value, onChange, options, className, ariaLabel }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string; ariaLabel: string }) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full cursor-pointer appearance-none rounded-[8px] border border-line-2 bg-sunken pr-7 pl-2.5 text-[13px] text-ink outline-none transition-colors hover:border-ink-4 focus:border-ink-4"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-ink-3" />
    </span>
  );
}

function ConditionRow({ source, c, onChange, onRemove }: { source: Source; c: Condition; onChange: (c: Condition) => void; onRemove: () => void }) {
  const defs = FIELDS[source];
  const def = defs.find((f) => f.key === c.field) ?? defs[0];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_76px_minmax(0,1fr)_32px] items-center gap-2">
      <Select
        ariaLabel="Campo"
        value={def.key}
        onChange={(field) => {
          const next = defs.find((f) => f.key === field)!;
          onChange({ ...c, field, op: OPS_BY_TYPE[next.type][0], value: next.type === "enum" ? [] : "" });
        }}
        options={defs.map((f) => ({ value: f.key, label: f.label }))}
      />
      <Select ariaLabel="Operador" value={c.op} onChange={(op) => onChange({ ...c, op: op as Condition["op"] })} options={OPS_BY_TYPE[def.type].map((op) => ({ value: op, label: OP_LABEL[op] }))} />
      {def.type === "enum" ? (
        <div className="min-w-0 [&>div]:w-full [&_button]:w-full [&_button]:justify-between">
          <MultiSelectChip label="Valores" value={Array.isArray(c.value) ? c.value : []} onChange={(value) => onChange({ ...c, value })} options={def.options ?? []} />
        </div>
      ) : (
        <label className="flex h-8 min-w-0 items-center gap-1.5 rounded-[8px] border border-line-2 bg-sunken px-2.5 text-[13px] focus-within:border-ink-4">
          <input
            aria-label="Valor"
            type={def.type === "number" ? "number" : "text"}
            inputMode={def.type === "number" ? "decimal" : undefined}
            value={Array.isArray(c.value) ? "" : c.value}
            onChange={(e) => onChange({ ...c, value: def.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value })}
            placeholder={def.type === "number" ? "0" : "texto"}
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-4 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
          />
          {def.unit && <span className="shrink-0 text-[12px] text-ink-3">{def.unit}</span>}
        </label>
      )}
      <button
        type="button"
        aria-label="Remover condição"
        onClick={onRemove}
        className="grid size-8 place-items-center rounded-[8px] text-ink-3 transition-colors hover:bg-raised hover:text-ink"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

/* ─────────────────────── Área de trabalho ─────────────────────── */

function initialState(q: string | null) {
  if (q) {
    const parsed = parseNaturalQuery(q);
    return { text: q, query: { source: parsed.source, combinator: parsed.combinator, conditions: parsed.conditions } as Query, understood: parsed.understood, group: "project", metric: FIELDS[parsed.source].find((f) => f.metric)!.key };
  }
  const v = SAVED_VIEWS[0];
  return { text: "", query: v.query, understood: [] as string[], group: v.groupBy, metric: v.metric };
}

function Workspace() {
  const params = useSearchParams();
  const { toast } = useShell();
  const [init] = useState(() => initialState(params.get("q")));
  const [text, setText] = useState(init.text);
  const [query, setQuery] = useState<Query>(init.query);
  const [understood, setUnderstood] = useState<string[]>(init.understood);
  const [group, setGroup] = useState(init.group);
  const [metric, setMetric] = useState(init.metric);
  const [viewId, setViewId] = useState<string | null>(init.text ? null : SAVED_VIEWS[0].id);

  const defs = FIELDS[query.source];
  const metricDef = defs.find((f) => f.key === metric) ?? defs.find((f) => f.metric)!;
  const rows = useMemo(() => runQuery(query), [query]);
  const sql = toSql(query, metricDef.key);

  // Poucas dezenas de linhas: recalcular a cada render é mais barato que memoizar à mão.
  const values = rows.map((r) => ({ row: r, v: Number(fieldValue(query.source, r, metricDef.key)) })).filter((x) => Number.isFinite(x.v));
  const mean = values.length ? values.reduce((s, x) => s + x.v, 0) / values.length : 0;
  const sorted = [...values].sort((a, b) => (metricDef.higherIsBetter ? b.v - a.v : a.v - b.v));
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  const bars = (() => {
    if (group === "none") {
      return [...values]
        .sort((a, b) => b.v - a.v)
        .slice(0, 8)
        .map((x) => ({ key: labelOf(query.source, x.row), label: labelOf(query.source, x.row), value: x.v }));
    }
    const map = new Map<string, number[]>();
    for (const x of values) {
      const k = groupKey(query.source, x.row, group);
      map.set(k, [...(map.get(k) ?? []), x.v]);
    }
    return Array.from(map.entries())
      .map(([k, vs]) => ({
        key: k,
        label: groupLabel(query.source, group, k),
        value: vs.reduce((s, v) => s + v, 0) / vs.length,
        sub: `${vs.length} ${vs.length === 1 ? "item" : "itens"}`,
        color: group === "project" ? projectById(k)?.color : undefined,
      }))
      .sort((a, b) => b.value - a.value);
  })();

  const apply = (q: Query, opts?: { group?: string; metric?: string }) => {
    setQuery(q);
    const nextDefs = FIELDS[q.source];
    if (opts?.metric) setMetric(opts.metric);
    else if (!nextDefs.some((f) => f.key === metric)) setMetric(nextDefs.find((f) => f.metric)!.key);
    const groups = GROUPS[q.source].map((g) => g.value);
    if (opts?.group) setGroup(groups.includes(opts.group) ? opts.group : "none");
    else if (!groups.includes(group)) setGroup("project");
  };

  const interpret = (t: string) => {
    const value = t.trim();
    setText(value);
    if (!value) return;
    const parsed = parseNaturalQuery(value);
    setUnderstood(parsed.understood);
    setViewId(null);
    apply({ source: parsed.source, combinator: parsed.combinator, conditions: parsed.conditions });
    setSearchParam("q", value, "replace");
  };

  const updateCondition = (c: Condition) => {
    setViewId(null);
    setQuery((q) => ({ ...q, conditions: q.conditions.map((x) => (x.id === c.id ? c : x)) }));
  };

  return (
    <>
      <Card className="p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            interpret(text);
          }}
          className="flex flex-col gap-3 sm:flex-row"
        >
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border border-line-2 bg-sunken px-3 transition-colors focus-within:border-ink-4">
            <Sparkles className="size-4 shrink-0 text-accent-ink" />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Pergunte em português — ex.: agentes do Atlas com precisão abaixo de 90%"
              aria-label="Consulta em linguagem natural"
              className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-4"
            />
          </label>
          <Button type="submit" variant="primary" size="lg">
            Interpretar
          </Button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {understood.length ? (
            <>
              <span className="text-[12px] text-ink-3">Entendi:</span>
              {understood.map((u) => (
                <span key={u} className="inline-flex h-6 items-center rounded-full border border-accent/30 bg-accent-soft px-2.5 text-[12px] text-accent-ink">
                  {u}
                </span>
              ))}
            </>
          ) : (
            <>
              <span className="text-[12px] text-ink-3">Exemplos:</span>
              {NL_EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => interpret(ex)}
                  className="inline-flex h-6 items-center rounded-full border border-line-2 px-2.5 text-[12px] text-ink-2 transition-colors hover:border-ink-4 hover:text-ink"
                >
                  {ex}
                </button>
              ))}
            </>
          )}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 @4xl:grid-cols-2">
        <Card className="flex min-w-0 flex-col">
          <CardHeader
            title="Filtros"
            description="Combine condições sobre qualquer campo da fonte."
            actions={
              <Segmented
                size="sm"
                ariaLabel="Fonte"
                value={query.source}
                onChange={(source) => {
                  setViewId(null);
                  setUnderstood([]);
                  apply({ source, combinator: "and", conditions: [] });
                }}
                options={[
                  { value: "agents", label: "Agentes" },
                  { value: "infra", label: "Sistemas" },
                ]}
              />
            }
          />
          <div className="flex-1 space-y-2.5 px-5 pb-5">
            <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
              Mostrar itens que atendem
              <Segmented
                size="sm"
                ariaLabel="Combinação"
                value={query.combinator}
                onChange={(combinator) => setQuery((q) => ({ ...q, combinator }))}
                options={[
                  { value: "and", label: "todas" },
                  { value: "or", label: "qualquer" },
                ]}
              />
              das condições
            </div>
            {query.conditions.map((c) => (
              <ConditionRow
                key={c.id}
                source={query.source}
                c={c}
                onChange={updateCondition}
                onRemove={() => {
                  setViewId(null);
                  setQuery((q) => ({ ...q, conditions: q.conditions.filter((x) => x.id !== c.id) }));
                }}
              />
            ))}
            {!query.conditions.length && <div className="rounded-[10px] border border-dashed border-line-2 px-4 py-5 text-center text-[12.5px] text-ink-3">Sem condições — todos os itens da fonte.</div>}
          </div>
          <CardFooter>
            <Button
              size="sm"
              onClick={() => {
                const first = defs.find((f) => f.metric)!;
                setViewId(null);
                setQuery((q) => ({ ...q, conditions: [...q.conditions, { id: newId(), field: first.key, op: OPS_BY_TYPE.number[0], value: "" }] }));
              }}
            >
              <Plus />
              Adicionar condição
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setViewId(null);
                setUnderstood([]);
                setQuery((q) => ({ ...q, conditions: [] }));
              }}
            >
              Limpar
            </Button>
          </CardFooter>
        </Card>

        <Card className="flex min-w-0 flex-col">
          <CardHeader
            title="Consulta gerada"
            description={`Fonte: ${SOURCE_LABEL[query.source]} · executada sobre os dados coletados`}
            actions={
              <Button size="sm" onClick={() => toast({ title: "Visão salva", description: "Disponível para todo o workspace em “Visões salvas”.", tone: "ok" })}>
                <BookmarkPlus />
                Salvar
              </Button>
            }
          />
          <div className="px-5">
            <pre className="overflow-x-auto rounded-[10px] border border-line bg-sunken px-4 py-3 font-mono text-[12px] leading-relaxed text-ink-2 scrollbar-thin">
              {sql.split("\n").map((line, i) => (
                <div key={i}>
                  {line.split(/(\bSELECT\b|\bFROM\b|\bWHERE\b|\bAND\b|\bOR\b|\bORDER BY\b|\bASC\b|\bDESC\b|\bNOT IN\b|\bIN\b|\bILIKE\b)/).map((part, k) =>
                    /^(SELECT|FROM|WHERE|AND|OR|ORDER BY|ASC|DESC|NOT IN|IN|ILIKE)$/.test(part) ? (
                      <span key={k} className="text-accent-ink">
                        {part}
                      </span>
                    ) : (
                      <span key={k}>{part}</span>
                    ),
                  )}
                </div>
              ))}
            </pre>
          </div>
          <div className="mt-5 flex-1 border-t border-line">
            <div className="px-5 pt-3.5 pb-1.5 text-[12px] font-medium text-ink-3">Visões salvas</div>
            <ul className="pb-2">
              {SAVED_VIEWS.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setViewId(v.id);
                      setUnderstood([]);
                      setText("");
                      apply(v.query, { group: v.groupBy, metric: v.metric });
                    }}
                    className={cn("flex w-full items-center gap-3 px-5 py-2 text-left transition-colors", viewId === v.id ? "bg-raised" : "hover:bg-subtle")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">{v.name}</span>
                      <span className="block truncate text-[12px] text-ink-3">{v.description}</span>
                    </span>
                    <span className="shrink-0 text-[11.5px] text-ink-3">{SOURCE_LABEL[v.query.source]}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <Section
        title={`${rows.length} ${rows.length === 1 ? "resultado" : "resultados"}`}
        description={`${SOURCE_LABEL[query.source]} · ordenado por ${metricDef.label.toLowerCase()}`}
        actions={
          <>
            <Select ariaLabel="Métrica" value={metricDef.key} onChange={setMetric} options={defs.filter((f) => f.metric).map((f) => ({ value: f.key, label: f.label }))} className="w-[180px]" />
            <Button onClick={() => toast({ title: "Exportação iniciada", description: `${rows.length} linhas em CSV.`, tone: "info" })}>
              <Download />
              CSV
            </Button>
          </>
        }
      >
        {rows.length ? (
          <>
            <div className="grid gap-4 @4xl:grid-cols-2">
              <Card className="flex min-w-0 flex-col">
                <CardHeader
                  title={`${metricDef.label} por ${GROUPS[query.source].find((g) => g.value === group)?.label.toLowerCase()}`}
                  description={group === "none" ? "Oito maiores valores" : "Média de cada grupo"}
                  actions={<Segmented size="sm" ariaLabel="Agrupar por" value={group} onChange={setGroup} options={GROUPS[query.source]} />}
                />
                <div className="flex-1 px-5 pb-5">
                  <BarList items={bars} format={(v) => formatMetric(metricDef, v)} />
                </div>
              </Card>
              <Card className="grid min-w-0 grid-cols-2">
                {[
                  { label: "Itens na seleção", value: fmtInt(rows.length), sub: `de ${query.source === "agents" ? 12 : 28} na fonte` },
                  { label: `Média de ${metricDef.label.toLowerCase()}`, value: formatMetric(metricDef, mean), sub: metricDef.higherIsBetter === false ? "quanto menor, melhor" : "quanto maior, melhor" },
                  { label: "Melhor", value: best ? formatMetric(metricDef, best.v) : "—", sub: best ? labelOf(query.source, best.row) : "" },
                  { label: "Pior", value: worst ? formatMetric(metricDef, worst.v) : "—", sub: worst ? labelOf(query.source, worst.row) : "" },
                ].map((s, i) => (
                  <div key={s.label} className={cn("flex min-w-0 flex-col justify-center p-5", i % 2 === 0 && "border-r border-line", i < 2 && "border-b border-line")}>
                    <div className="truncate text-[12.5px] text-ink-3">{s.label}</div>
                    <div className="mt-2.5 truncate text-[24px] leading-none font-semibold tracking-[-0.03em] text-ink tnum">{s.value}</div>
                    <div className="mt-2 truncate text-[12px] text-ink-3">{s.sub}</div>
                  </div>
                ))}
              </Card>
            </div>
            <Results source={query.source} rows={rows} />
          </>
        ) : (
          <Card>
            <EmptyState icon={<SearchX className="size-5" />} title="Nenhum item atende às condições" description="Remova uma condição ou troque “todas” por “qualquer”." />
          </Card>
        )}
      </Section>
    </>
  );
}

/* ─────────────────────── Tabela de resultados ─────────────────────── */

const AGENT_COLS = "grid-cols-[minmax(0,1fr)_auto] @4xl:grid-cols-[minmax(0,1fr)_96px_132px_88px_88px_88px_96px_104px]";
const INFRA_COLS = "grid-cols-[minmax(0,1fr)_auto] @4xl:grid-cols-[minmax(0,1fr)_96px_118px_96px_72px_80px_72px_104px]";

function Results({ source, rows }: { source: Source; rows: (Agent | Resource)[] }) {
  const cols = source === "agents" ? AGENT_COLS : INFRA_COLS;
  const head =
    source === "agents"
      ? ["Agente", "Projeto", "Status", "Precisão", "Resolução", "Alucinação", "Latência p95", "Custo/conversa"]
      : ["Recurso", "Projeto", "Status", "Latência p95", "CPU", "Memória", "Erros", "Custo/mês"];
  return (
    <Card className="mt-4 overflow-hidden">
      <div className={cn("hidden gap-x-4 border-b border-line px-5 py-2.5 text-[11.5px] font-medium text-ink-3 @4xl:grid", cols)}>
        {head.map((h, i) => (
          <span key={h} className={cn(i >= 3 && "text-right")}>
            {h}
          </span>
        ))}
      </div>
      <ul className="divide-y divide-line">
        {rows.map((row) => {
          if (source === "agents") {
            const a = row as Agent;
            return (
              <li key={a.id}>
                <Link href={`/agentes/${a.id}`} className={cn("grid items-center gap-x-4 px-5 py-3 transition-colors hover:bg-subtle", cols)}>
                  <span className="flex min-w-0 items-center gap-3">
                    <AgentGlyph name={a.name} project={a.project} size={28} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-ink">{a.name}</span>
                      <span className="block truncate text-[12px] text-ink-3">{a.role}</span>
                    </span>
                  </span>
                  <span className="hidden @4xl:block">
                    <ProjectTag id={a.project} />
                  </span>
                  <span>
                    <StatusChip status={a.status} label={AGENT_STATUS_LABEL[a.status]} />
                  </span>
                  {[fmtPct(a.m.accuracy), fmtPct(a.m.resolution), fmtPct(a.m.hallucination), fmtMs(a.m.latency), fmtBRL(a.m.cost, a.m.cost < 0.1 ? 3 : 2)].map((v, i) => (
                    <span key={i} className="hidden text-right text-[13px] text-ink-2 tnum @4xl:block">
                      {v}
                    </span>
                  ))}
                </Link>
              </li>
            );
          }
          const r = row as Resource;
          return (
            <li key={r.id}>
              <Link href={`/infraestrutura?recurso=${r.id}`} className={cn("grid items-center gap-x-4 px-5 py-3 transition-colors hover:bg-subtle", cols)}>
                <span className="flex min-w-0 items-center gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-[7px] border border-line bg-subtle text-ink-2">
                    <ResourceIcon type={r.type} className="size-3.5" />
                  </span>
                  <span className="min-w-0">
                    <Mono className="block truncate text-[12.5px] text-ink">{r.id}</Mono>
                    <span className="block truncate text-[12px] text-ink-3">{TYPE_META[r.type].label}</span>
                  </span>
                </span>
                <span className="hidden @4xl:block">
                  <ProjectTag id={r.project} />
                </span>
                <span>
                  <StatusChip status={r.status} />
                </span>
                {[r.latency !== undefined ? fmtMs(r.latency) : "—", fmtPct(r.cpu, 0), fmtPct(r.memory, 0), fmtPct(r.errorRate, 2), fmtBRL(r.cost, 0)].map((v, i) => (
                  <span key={i} className="hidden text-right text-[13px] text-ink-2 tnum @4xl:block">
                    {v}
                  </span>
                ))}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-[92px] w-full rounded-[12px]" />
      <div className="grid gap-4 @4xl:grid-cols-2">
        <Skeleton className="h-[320px] w-full rounded-[12px]" />
        <Skeleton className="h-[320px] w-full rounded-[12px]" />
      </div>
    </div>
  );
}

export function ExplorerView() {
  return (
    <div className="animate-enter">
      <PageHeader title="Explorar" description="Filtre agentes e infraestrutura por qualquer campo — ou descreva em português o que procura." />
      <Suspense fallback={<WorkspaceSkeleton />}>
        <Workspace />
      </Suspense>
    </div>
  );
}
