import { normalize } from "../utils";
import { AGENTS, MODELS, type Agent } from "./agents";
import { CATEGORY_META, RESOURCES, TYPE_META, categoryOf, type Resource } from "./infra";
import { PROJECTS } from "./projects";

export type Source = "agents" | "infra";
export type Op = "is" | "is_not" | "gt" | "gte" | "lt" | "lte" | "contains";

export type FieldDef = {
  key: string;
  label: string;
  type: "enum" | "number" | "text";
  unit?: string;
  options?: { value: string; label: string }[];
  /** campo que pode virar série temporal e eixo do gráfico */
  metric?: boolean;
  /** quanto maior, melhor? (para colorir variações) */
  higherIsBetter?: boolean;
};

export type Condition = { id: string; field: string; op: Op; value: string | number | string[] };
export type Query = { source: Source; combinator: "and" | "or"; conditions: Condition[] };

export const OP_LABEL: Record<Op, string> = {
  is: "é",
  is_not: "não é",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  contains: "contém",
};

export const OPS_BY_TYPE: Record<FieldDef["type"], Op[]> = {
  enum: ["is", "is_not"],
  number: ["lt", "lte", "gt", "gte"],
  text: ["contains"],
};

const STATUS_OPTIONS_INFRA = [
  { value: "ok", label: "Operacional" },
  { value: "warn", label: "Atenção" },
  { value: "serious", label: "Degradado" },
  { value: "crit", label: "Crítico" },
  { value: "maint", label: "Manutenção" },
];

const STATUS_OPTIONS_AGENTS = [
  { value: "ok", label: "Na meta" },
  { value: "warn", label: "Atenção" },
  { value: "serious", label: "Abaixo da meta" },
  { value: "crit", label: "Crítico" },
];

const PROJECT_OPTIONS = PROJECTS.map((p) => ({ value: p.id, label: p.name }));

export const FIELDS: Record<Source, FieldDef[]> = {
  agents: [
    { key: "name", label: "Nome", type: "text" },
    { key: "project", label: "Projeto", type: "enum", options: PROJECT_OPTIONS },
    { key: "status", label: "Status", type: "enum", options: STATUS_OPTIONS_AGENTS },
    { key: "model", label: "Modelo", type: "enum", options: MODELS.map((m) => ({ value: m, label: m })) },
    {
      key: "channel",
      label: "Canal",
      type: "enum",
      options: Array.from(new Set(AGENTS.map((a) => a.channel))).map((c) => ({ value: c, label: c })),
    },
    { key: "accuracy", label: "Precisão", type: "number", unit: "%", metric: true, higherIsBetter: true },
    { key: "resolution", label: "Taxa de resolução", type: "number", unit: "%", metric: true, higherIsBetter: true },
    { key: "hallucination", label: "Alucinação", type: "number", unit: "%", metric: true, higherIsBetter: false },
    { key: "csat", label: "CSAT", type: "number", metric: true, higherIsBetter: true },
    { key: "latency", label: "Latência p95", type: "number", unit: "ms", metric: true, higherIsBetter: false },
    { key: "cost", label: "Custo por conversa", type: "number", unit: "R$", metric: true, higherIsBetter: false },
    { key: "volume", label: "Conversas/dia", type: "number", metric: true, higherIsBetter: true },
    { key: "escalation", label: "Escalonamento", type: "number", unit: "%", metric: true, higherIsBetter: false },
  ],
  infra: [
    { key: "name", label: "Nome", type: "text" },
    { key: "project", label: "Projeto", type: "enum", options: PROJECT_OPTIONS },
    { key: "status", label: "Status", type: "enum", options: STATUS_OPTIONS_INFRA },
    {
      key: "category",
      label: "Categoria",
      type: "enum",
      options: Object.entries(CATEGORY_META).map(([value, m]) => ({ value, label: m.label })),
    },
    {
      key: "type",
      label: "Tecnologia",
      type: "enum",
      options: Object.entries(TYPE_META).map(([value, m]) => ({ value, label: m.label })),
    },
    {
      key: "env",
      label: "Ambiente",
      type: "enum",
      options: [
        { value: "prod", label: "Produção" },
        { value: "staging", label: "Staging" },
      ],
    },
    {
      key: "region",
      label: "Região",
      type: "enum",
      options: Array.from(new Set(RESOURCES.map((r) => r.region))).map((r) => ({ value: r, label: r })),
    },
    { key: "latency", label: "Latência p95", type: "number", unit: "ms", metric: true, higherIsBetter: false },
    { key: "cpu", label: "CPU", type: "number", unit: "%", metric: true, higherIsBetter: false },
    { key: "memory", label: "Memória", type: "number", unit: "%", metric: true, higherIsBetter: false },
    { key: "errors", label: "Taxa de erro", type: "number", unit: "%", metric: true, higherIsBetter: false },
    { key: "cost", label: "Custo mensal", type: "number", unit: "R$", metric: true, higherIsBetter: false },
  ],
};

export function fieldValue(source: Source, row: Agent | Resource, key: string): string | number | undefined {
  if (source === "agents") {
    const a = row as Agent;
    switch (key) {
      case "name":
        return a.name;
      case "project":
        return a.project;
      case "status":
        return a.status;
      case "model":
        return a.model;
      case "channel":
        return a.channel;
      default:
        return a.m[key as keyof Agent["m"]];
    }
  }
  const r = row as Resource;
  switch (key) {
    case "name":
      return `${r.id} ${r.label}`;
    case "project":
      return r.project;
    case "status":
      return r.status;
    case "category":
      return categoryOf(r);
    case "type":
      return r.type;
    case "env":
      return r.env;
    case "region":
      return r.region;
    case "latency":
      return r.latency;
    case "cpu":
      return r.cpu;
    case "memory":
      return r.memory;
    case "errors":
      return r.errorRate;
    case "cost":
      return r.cost;
  }
  return undefined;
}

function test(c: Condition, v: string | number | undefined) {
  if (v === undefined) return false;
  const values = Array.isArray(c.value) ? c.value : [c.value];
  switch (c.op) {
    case "is":
      return values.length === 0 || values.map(String).includes(String(v));
    case "is_not":
      return !values.map(String).includes(String(v));
    case "contains":
      return normalize(String(v)).includes(normalize(String(c.value)));
    case "gt":
      return Number(v) > Number(c.value);
    case "gte":
      return Number(v) >= Number(c.value);
    case "lt":
      return Number(v) < Number(c.value);
    case "lte":
      return Number(v) <= Number(c.value);
  }
}

export function runQuery(q: Query): (Agent | Resource)[] {
  const rows: (Agent | Resource)[] = q.source === "agents" ? AGENTS : RESOURCES;
  const active = q.conditions.filter((c) => !(Array.isArray(c.value) && c.value.length === 0) && c.value !== "");
  if (!active.length) return rows;
  return rows.filter((row) => {
    const results = active.map((c) => test(c, fieldValue(q.source, row, c.field)));
    return q.combinator === "and" ? results.every(Boolean) : results.some(Boolean);
  });
}

// ───────────────────────── Linguagem natural → filtros ─────────────────────────

let uid = 0;
export const newId = () => `c${++uid}`;

const METRIC_WORDS: { re: RegExp; agents?: string; infra?: string }[] = [
  { re: /precis/, agents: "accuracy" },
  { re: /resolu/, agents: "resolution" },
  { re: /alucina/, agents: "hallucination" },
  { re: /csat|satisfa/, agents: "csat" },
  { re: /escalon/, agents: "escalation" },
  { re: /volume|conversas/, agents: "volume" },
  { re: /latencia|tempo de resposta/, agents: "latency", infra: "latency" },
  { re: /custo/, agents: "cost", infra: "cost" },
  { re: /cpu|processador/, infra: "cpu" },
  { re: /memoria/, infra: "memory" },
  { re: /erro/, infra: "errors" },
];

/** Interpreta frases como “agentes do Atlas com precisão abaixo de 90%”. Determinístico, sem LLM. */
export function parseNaturalQuery(text: string): Query & { understood: string[] } {
  const t = normalize(text);
  const understood: string[] = [];
  const infraHints = /(banco|bancos|database|postgres|mysql|mongo|redis|cache|kafka|fila|servico|servicos|api|infra|cluster|recurso|recursos|kubernetes|gpu)/;
  const source: Source = /agente|agentes|bot|copiloto|assistente/.test(t) || !infraHints.test(t) ? "agents" : "infra";
  understood.push(source === "agents" ? "Fonte: agentes de IA" : "Fonte: infraestrutura");

  const conditions: Condition[] = [];

  const projects = PROJECTS.filter((p) => t.includes(normalize(p.name)));
  if (projects.length) {
    conditions.push({ id: newId(), field: "project", op: "is", value: projects.map((p) => p.id) });
    understood.push(`Projeto: ${projects.map((p) => p.name).join(", ")}`);
  }

  if (source === "infra") {
    if (/producao|prod\b/.test(t)) {
      conditions.push({ id: newId(), field: "env", op: "is", value: ["prod"] });
      understood.push("Ambiente: produção");
    } else if (/staging|homologa/.test(t)) {
      conditions.push({ id: newId(), field: "env", op: "is", value: ["staging"] });
      understood.push("Ambiente: staging");
    }
    const cats: string[] = [];
    if (/banco|database|postgres|mysql|mongo/.test(t)) cats.push("db");
    if (/cache|redis/.test(t)) cats.push("cache");
    if (/kafka|fila|mensageria|rabbit/.test(t)) cats.push("messaging");
    if (/servico|api\b|apis/.test(t)) cats.push("service");
    if (cats.length) {
      conditions.push({ id: newId(), field: "category", op: "is", value: cats });
      understood.push(`Categoria: ${cats.map((c) => CATEGORY_META[c as keyof typeof CATEGORY_META].label).join(", ")}`);
    }
  }

  const statuses: string[] = [];
  if (/critic/.test(t)) statuses.push("crit");
  if (/degradad|abaixo da meta/.test(t) && !/precis|resolu/.test(t)) statuses.push("serious");
  if (/atencao/.test(t)) statuses.push("warn");
  if (statuses.length) {
    conditions.push({ id: newId(), field: "status", op: "is", value: statuses });
    understood.push(`Status: ${statuses.length} selecionado(s)`);
  }

  const cmp = /(precisao|resolucao|alucinacao|csat|satisfacao|escalonamento|volume|conversas|latencia|tempo de resposta|custo(?: por conversa| mensal)?|cpu|memoria|erros?|taxa de erro)\D{0,24}?(abaixo de|menor que|menos de|inferior a|<=|<|acima de|maior que|mais de|superior a|>=|>)\s*(r\$\s*)?(\d+(?:[.,]\d+)?)\s*(%|ms|s\b|segundos?)?/g;
  let m: RegExpExecArray | null;
  while ((m = cmp.exec(t))) {
    const word = m[1];
    const metric = METRIC_WORDS.find((w) => w.re.test(word));
    const field = metric?.[source];
    if (!field) continue;
    const opWord = m[2];
    const op: Op = /abaixo|menor|menos|inferior|</.test(opWord) ? (opWord === "<=" ? "lte" : "lt") : opWord === ">=" ? "gte" : "gt";
    let value = Number(m[4].replace(",", "."));
    if (field === "latency" && m[5] && /^s/.test(m[5])) value *= 1000;
    conditions.push({ id: newId(), field, op, value });
    const def = FIELDS[source].find((f) => f.key === field)!;
    understood.push(`${def.label} ${OP_LABEL[op]} ${m[4]}${m[5] ?? (def.unit === "%" ? "%" : "")}`);
  }

  return { source, combinator: "and", conditions, understood };
}

export const SAVED_VIEWS: { id: string; name: string; description: string; query: Query; groupBy: string; metric: string }[] = [
  {
    id: "v1",
    name: "Agentes abaixo da meta",
    description: "Precisão < 90% ou resolução < 70%",
    query: {
      source: "agents",
      combinator: "or",
      conditions: [
        { id: "s1", field: "accuracy", op: "lt", value: 90 },
        { id: "s2", field: "resolution", op: "lt", value: 70 },
      ],
    },
    groupBy: "project",
    metric: "accuracy",
  },
  {
    id: "v2",
    name: "Bancos críticos em produção",
    description: "Categoria banco de dados, status crítico ou degradado",
    query: {
      source: "infra",
      combinator: "and",
      conditions: [
        { id: "s3", field: "category", op: "is", value: ["db"] },
        { id: "s4", field: "env", op: "is", value: ["prod"] },
        { id: "s5", field: "status", op: "is_not", value: ["ok"] },
      ],
    },
    groupBy: "project",
    metric: "latency",
  },
  {
    id: "v3",
    name: "Custo de IA por modelo",
    description: "Todos os agentes, agrupados por modelo",
    query: { source: "agents", combinator: "and", conditions: [] },
    groupBy: "model",
    metric: "cost",
  },
  {
    id: "v4",
    name: "Latência de agentes do Atlas",
    description: "Projeto Atlas, latência p95 > 1 s",
    query: {
      source: "agents",
      combinator: "and",
      conditions: [
        { id: "s6", field: "project", op: "is", value: ["atlas"] },
        { id: "s7", field: "latency", op: "gt", value: 1000 },
      ],
    },
    groupBy: "none",
    metric: "latency",
  },
];

export const NL_EXAMPLES = [
  "Agentes com precisão abaixo de 90%",
  "Bancos de dados de produção com latência acima de 300 ms",
  "Recursos críticos do projeto Atlas",
  "Agentes do Atlas com custo por conversa acima de R$ 0,30",
];
