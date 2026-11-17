import type { ProjectId, Status } from "../types";

export const HEALTH = {
  global: 84,
  delta: -5,
  parts: [
    { key: "infra", label: "Infraestrutura", value: 86, delta: -4 },
    { key: "agents", label: "Agentes de IA", value: 79, delta: -7 },
    { key: "data", label: "Dados e pipelines", value: 88, delta: -3 },
  ],
};

export type Kpi = {
  key: string;
  label: string;
  value: string;
  delta: number;
  deltaUnit: string;
  goodWhen: "up" | "down";
  decimals?: number;
  hint: string;
  spark: { now: number; start?: number; vol: number; phases?: { from: number; value: number }[]; daily?: number };
};

export const OVERVIEW_KPIS: Kpi[] = [
  {
    key: "uptime",
    label: "Disponibilidade",
    value: "99,94%",
    delta: -0.03,
    deltaUnit: " pts",
    decimals: 2,
    goodWhen: "up",
    hint: "Média ponderada de todos os recursos em produção",
    spark: { now: 99.94, start: 99.98, vol: 0.01 },
  },
  {
    key: "incidents",
    label: "Incidentes ativos",
    value: "7",
    delta: 3,
    deltaUnit: "",
    decimals: 0,
    goodWhen: "down",
    hint: "1 SEV-1 · 2 SEV-2 · 3 SEV-3 · 1 SEV-4",
    spark: { now: 7, vol: 0.4, phases: [{ from: Infinity, value: 4 }, { from: 104, value: 6 }, { from: 71, value: 7 }] },
  },
  {
    key: "accuracy",
    label: "Precisão média dos agentes",
    value: "90,9%",
    delta: -1.8,
    deltaUnit: " pts",
    goodWhen: "up",
    hint: "Média ponderada por volume, avaliação contínua",
    spark: { now: 90.9, vol: 0.3, phases: [{ from: Infinity, value: 92.7 }, { from: 4282, value: 90.9 }] },
  },
  {
    key: "resolution",
    label: "Taxa de resolução",
    value: "74,6%",
    delta: -2.1,
    deltaUnit: " pts",
    goodWhen: "up",
    hint: "Conversas encerradas sem intervenção humana",
    spark: { now: 74.6, start: 76.7, vol: 0.5 },
  },
  {
    key: "latency",
    label: "Latência p95 da infraestrutura",
    value: "238 ms",
    delta: 41,
    deltaUnit: "%",
    decimals: 0,
    goodWhen: "down",
    hint: "p95 das APIs e bancos em produção",
    spark: { now: 238, vol: 9, daily: 0.06, phases: [{ from: Infinity, value: 169 }, { from: 104, value: 238 }] },
  },
  {
    key: "cost",
    label: "Custo de IA (24 h)",
    value: "R$ 18.420",
    delta: 6.2,
    deltaUnit: "%",
    goodWhen: "down",
    hint: "Tokens, inferência própria e ferramentas",
    spark: { now: 18420, start: 17340, vol: 260 },
  },
];

export type AttentionItem = {
  id: string;
  sev: 1 | 2 | 3 | 4;
  kind: "infra" | "agent" | "incident";
  title: string;
  detail: string;
  project: ProjectId;
  entity: string;
  since: number;
  owner: string;
  href: string;
  metric: { label: string; value: string; meter?: number; tone: Status };
};

export const ATTENTION: AttentionItem[] = [
  {
    id: "a1",
    sev: 1,
    kind: "infra",
    title: "Postgres do Atlas com 94% das conexões em uso",
    detail: "Pool saturado após o deploy atlas-api-tickets v2.18.0. Agentes do Atlas sofrem timeouts.",
    project: "atlas",
    entity: "atlas-pg-primary",
    since: 104,
    owner: "marina",
    href: "/infraestrutura?recurso=atlas-pg-primary",
    metric: { label: "Conexões", value: "472 / 500", meter: 94, tone: "crit" },
  },
  {
    id: "a2",
    sev: 2,
    kind: "agent",
    title: "Aurora não está precisa nas respostas",
    detail: "Precisão 11,2 pts abaixo da linha de base desde o deploy v2.4.0 — cita políticas arquivadas.",
    project: "atlas",
    entity: "aurora",
    since: 4177,
    owner: "lucas",
    href: "/agentes/aurora",
    metric: { label: "Precisão", value: "81,8%", meter: 81.8, tone: "crit" },
  },
  {
    id: "a3",
    sev: 2,
    kind: "incident",
    title: "Erros 5xx no checkout da Vega",
    detail: "Timeouts no provedor de pagamentos externo. 30% do tráfego já foi roteado para o secundário.",
    project: "vega",
    entity: "vega-api-checkout",
    since: 71,
    owner: "beatriz",
    href: "/incidentes?id=INC-2479",
    metric: { label: "Erros", value: "2,1%", tone: "serious" },
  },
  {
    id: "a4",
    sev: 3,
    kind: "agent",
    title: "Atlas Resolve com nível de resolução baixo",
    detail: "Resolve 58,2% dos chamados N1 (meta 75%). Ferramenta consultar_pedido falha em 17% das chamadas.",
    project: "atlas",
    entity: "atlas-resolve",
    since: 8640,
    owner: "lucas",
    href: "/agentes/atlas-resolve",
    metric: { label: "Resolução", value: "58,2%", meter: 58.2, tone: "serious" },
  },
  {
    id: "a5",
    sev: 3,
    kind: "infra",
    title: "Lag de 1,2 mi mensagens no Kafka do Nimbus",
    detail: "4 de 12 consumidores inativos após rebalanceamento. Dados analíticos 42 min atrasados.",
    project: "nimbus",
    entity: "nimbus-kafka",
    since: 362,
    owner: "diego",
    href: "/infraestrutura?recurso=nimbus-kafka",
    metric: { label: "Lag", value: "1,2 mi", tone: "serious" },
  },
  {
    id: "a6",
    sev: 3,
    kind: "agent",
    title: "Nimbus SQL inventando tabelas inexistentes",
    detail: "Alucinação em 4,4% das consultas — esquema billing_v2 fora do catálogo semântico.",
    project: "nimbus",
    entity: "nimbus-sql",
    since: 7200,
    owner: "diego",
    href: "/agentes/nimbus-sql",
    metric: { label: "Alucinação", value: "4,4%", tone: "warn" },
  },
];

export type Activity = {
  id: string;
  at: number;
  kind: "ai" | "deploy" | "incident" | "eval" | "alert" | "resolve";
  title: string;
  detail?: string;
  actor?: string;
};

export const ACTIVITY: Activity[] = [
  { id: "e1", at: 11, kind: "ai", title: "Meraki recomendou reverter o Aurora para v2.3.2", detail: "Canário com v2.3.2 manteve 92,4% de precisão em 1.920 conversas" },
  { id: "e2", at: 30, kind: "deploy", title: "atlas-api-tickets v2.18.1 em canário (10%)", actor: "marina" },
  { id: "e3", at: 50, kind: "alert", title: "Redis do Orion com memória acima de 85%" },
  { id: "e4", at: 71, kind: "incident", title: "INC-2479 aberto — Erros 5xx no checkout", actor: "beatriz" },
  { id: "e5", at: 104, kind: "incident", title: "INC-2481 aberto automaticamente — Saturação de conexões", detail: "Detectado e correlacionado pelo Meraki em 3 min" },
  { id: "e6", at: 121, kind: "deploy", title: "atlas-api-tickets v2.18.0 em produção", actor: "diego" },
  { id: "e7", at: 180, kind: "eval", title: "Suíte “Políticas de reembolso” (Aurora): 71,1% de aprovação", detail: "412 casos · −23,1 pts vs. execução anterior" },
  { id: "e8", at: 362, kind: "alert", title: "Kafka: lag do consumidor acima de 500 mil mensagens" },
  { id: "e9", at: 398, kind: "resolve", title: "INC-2474 resolvido — DAGs do Airflow", actor: "diego" },
];

export const AI_COST_BY_PROJECT: { project: ProjectId; value: number }[] = [
  { project: "atlas", value: 9840 },
  { project: "vega", value: 3720 },
  { project: "orion", value: 2960 },
  { project: "lumen", value: 1240 },
  { project: "nimbus", value: 660 },
];

export const STATUS_SYSTEMS = [
  "atlas-pg-primary",
  "atlas-api-tickets",
  "atlas-llm-gateway",
  "vega-api-checkout",
  "nimbus-kafka",
  "orion-redis-cache",
  "lumen-vllm-cluster",
  "orion-api-score",
];
