import { gen } from "../series";
import { RANGES, minutesAgoAt, type RangeKey } from "../time";
import { STATUS_RANK, type ProjectId, type Status } from "../types";

export type ResourceType =
  | "postgres"
  | "mysql"
  | "mongodb"
  | "vector"
  | "olap"
  | "redis"
  | "kafka"
  | "rabbitmq"
  | "service"
  | "gateway"
  | "cdn"
  | "k8s"
  | "gpu"
  | "storage"
  | "search"
  | "orchestrator";

export type Category = "db" | "cache" | "messaging" | "service" | "compute" | "storage" | "pipeline";

export const CATEGORY_META: Record<Category, { label: string; short: string }> = {
  db: { label: "Bancos de dados", short: "Bancos" },
  cache: { label: "Cache", short: "Cache" },
  messaging: { label: "Mensageria", short: "Mensageria" },
  service: { label: "Serviços e APIs", short: "Serviços" },
  compute: { label: "Compute", short: "Compute" },
  storage: { label: "Armazenamento e busca", short: "Armazenamento" },
  pipeline: { label: "Pipelines", short: "Pipelines" },
};

export const CATEGORY_ORDER: Category[] = ["db", "cache", "messaging", "service", "compute", "storage", "pipeline"];

export const TYPE_META: Record<ResourceType, { label: string; category: Category }> = {
  postgres: { label: "PostgreSQL", category: "db" },
  mysql: { label: "MySQL", category: "db" },
  mongodb: { label: "MongoDB", category: "db" },
  vector: { label: "Banco vetorial", category: "db" },
  olap: { label: "ClickHouse", category: "db" },
  redis: { label: "Redis", category: "cache" },
  kafka: { label: "Kafka", category: "messaging" },
  rabbitmq: { label: "RabbitMQ", category: "messaging" },
  service: { label: "Serviço", category: "service" },
  gateway: { label: "Gateway LLM", category: "service" },
  cdn: { label: "CDN", category: "service" },
  k8s: { label: "Kubernetes", category: "compute" },
  gpu: { label: "Cluster GPU", category: "compute" },
  storage: { label: "Object storage", category: "storage" },
  search: { label: "OpenSearch", category: "storage" },
  orchestrator: { label: "Airflow", category: "pipeline" },
};

export type ResourceMetric = "latency" | "cpu" | "memory" | "errors" | "connections" | "throughput";

export type Resource = {
  id: string;
  label: string;
  type: ResourceType;
  project: ProjectId;
  env: "prod" | "staging";
  region: string;
  status: Status;
  version: string;
  owner: string;
  cpu: number;
  memory: number;
  storage?: number;
  latency?: number;
  errorRate: number;
  throughput?: number;
  throughputUnit?: string;
  connections?: { used: number; max: number };
  uptime: number;
  cost: number;
  headline?: string;
  insight?: string;
  actions?: string[];
  extra?: { label: string; value: string; tone?: Status }[];
  /** minutos desde que o status atual começou */
  since?: number;
  /** valores de linha de base antes do evento atual */
  base?: Partial<Record<ResourceMetric, number>>;
  windows?: { start: number; end: number; status: Status; weight?: number }[];
};

export const RESOURCES: Resource[] = [
  // ───────────────────────────── Atlas ─────────────────────────────
  {
    id: "atlas-pg-primary",
    label: "Banco principal de tickets e conversas",
    type: "postgres",
    project: "atlas",
    env: "prod",
    region: "sa-east-1",
    status: "crit",
    version: "PostgreSQL 16.4",
    owner: "marina",
    cpu: 87,
    memory: 78,
    storage: 71,
    latency: 412,
    errorRate: 0.9,
    throughput: 3840,
    throughputUnit: "q/s",
    connections: { used: 472, max: 500 },
    uptime: 99.91,
    cost: 18400,
    since: 104,
    base: { latency: 82, cpu: 46, errors: 0.05, connections: 52, memory: 71 },
    headline: "Conexões em 94% do limite",
    insight:
      "Pool de conexões saturado desde 13:58. 61% das conexões vêm do serviço atlas-api-tickets, logo após o deploy v2.18.0, que removeu o reuso de conexões no worker de SLA.",
    actions: [
      "Habilitar PgBouncer em modo transaction",
      "Reverter atlas-api-tickets para v2.17.4",
      "Criar índice em tickets(status, updated_at)",
    ],
    extra: [
      { label: "Queries lentas", value: "3,4× acima do normal", tone: "crit" },
      { label: "Lag da réplica", value: "2,8 s", tone: "warn" },
      { label: "Deadlocks (1 h)", value: "12", tone: "warn" },
    ],
    windows: [
      { start: 104, end: 0, status: "crit" },
      { start: 2 * 1440 + 300, end: 2 * 1440 + 230, status: "warn" },
      { start: 11 * 1440 + 600, end: 11 * 1440 + 560, status: "serious" },
    ],
  },
  {
    id: "atlas-pg-replica-1",
    label: "Réplica de leitura para relatórios e agentes",
    type: "postgres",
    project: "atlas",
    env: "prod",
    region: "sa-east-1",
    status: "warn",
    version: "PostgreSQL 16.4 · réplica",
    owner: "marina",
    cpu: 61,
    memory: 70,
    storage: 71,
    latency: 140,
    errorRate: 0.02,
    throughput: 2210,
    throughputUnit: "q/s",
    connections: { used: 180, max: 500 },
    uptime: 99.98,
    cost: 9200,
    since: 95,
    base: { latency: 68, cpu: 38 },
    headline: "Lag de replicação de 2,8 s",
    insight: "O lag acompanha a carga de escrita do primário. Consultas do Atlas Resolve podem ler dados com até 3 s de atraso.",
    windows: [{ start: 95, end: 0, status: "warn" }],
  },
  {
    id: "atlas-redis-sessions",
    label: "Sessões e contexto de conversa",
    type: "redis",
    project: "atlas",
    env: "prod",
    region: "sa-east-1",
    status: "ok",
    version: "Redis 7.2",
    owner: "marina",
    cpu: 22,
    memory: 58,
    latency: 1.2,
    errorRate: 0,
    throughput: 18200,
    throughputUnit: "ops/s",
    uptime: 100,
    cost: 3100,
  },
  {
    id: "atlas-qdrant-kb",
    label: "Base de conhecimento vetorial (RAG)",
    type: "vector",
    project: "atlas",
    env: "prod",
    region: "sa-east-1",
    status: "warn",
    version: "Qdrant 1.12 · KB v14",
    owner: "lucas",
    cpu: 34,
    memory: 66,
    storage: 48,
    latency: 38,
    errorRate: 0.01,
    throughput: 640,
    throughputUnit: "q/s",
    uptime: 99.99,
    cost: 4600,
    since: 4282,
    base: { latency: 24 },
    headline: "Índice com 14% menos documentos",
    insight:
      "A reindexação de 12/11 (KB v14) concluiu com 7.912 de 9.196 documentos. 1.284 documentos da coleção “políticas” falharam por limite de tamanho de payload — o agente Aurora passou a recuperar versões arquivadas.",
    actions: ["Reindexar coleção “políticas” com chunking de 2 KB", "Adicionar verificação de contagem ao pipeline de ingestão"],
    extra: [
      { label: "Documentos indexados", value: "7.912 de 9.196", tone: "warn" },
      { label: "Recall@5 (avaliação)", value: "0,71 · antes 0,93", tone: "crit" },
    ],
    windows: [{ start: 4282, end: 0, status: "warn" }],
  },
  {
    id: "atlas-api-tickets",
    label: "API de tickets, SLA e histórico",
    type: "service",
    project: "atlas",
    env: "prod",
    region: "sa-east-1",
    status: "serious",
    version: "Node.js 22 · v2.18.1",
    owner: "diego",
    cpu: 72,
    memory: 64,
    latency: 486,
    errorRate: 1.4,
    throughput: 920,
    throughputUnit: "req/s",
    uptime: 99.93,
    cost: 6800,
    since: 104,
    base: { latency: 138, errors: 0.08, cpu: 44 },
    headline: "Latência 3,5× acima da linha de base",
    insight: "A latência acompanha a espera por conexões no atlas-pg-primary. O hotfix v2.18.1 está em canário com 10% do tráfego.",
    actions: ["Promover v2.18.1 para 50%", "Reverter para v2.17.4"],
    windows: [{ start: 104, end: 0, status: "serious" }],
  },
  {
    id: "atlas-llm-gateway",
    label: "Roteamento de modelos, cache semântico e cotas",
    type: "gateway",
    project: "atlas",
    env: "prod",
    region: "sa-east-1",
    status: "ok",
    version: "Gateway LLM v3.2",
    owner: "ana",
    cpu: 38,
    memory: 44,
    latency: 1880,
    errorRate: 0.3,
    throughput: 21,
    throughputUnit: "req/s",
    uptime: 99.95,
    cost: 2400,
    extra: [
      { label: "Cache semântico", value: "31% de acerto" },
      { label: "Tokens (24 h)", value: "412 mi" },
    ],
    windows: [{ start: 4 * 1440 + 380, end: 4 * 1440 + 357, status: "crit", weight: 0.6 }],
  },
  {
    id: "atlas-rabbitmq",
    label: "Fila de eventos de atendimento",
    type: "rabbitmq",
    project: "atlas",
    env: "prod",
    region: "sa-east-1",
    status: "ok",
    version: "RabbitMQ 3.13",
    owner: "marina",
    cpu: 19,
    memory: 41,
    latency: 4,
    errorRate: 0,
    throughput: 2600,
    throughputUnit: "msg/s",
    uptime: 100,
    cost: 1900,
  },
  {
    id: "atlas-k8s-prod",
    label: "Cluster de produção do Atlas",
    type: "k8s",
    project: "atlas",
    env: "prod",
    region: "sa-east-1",
    status: "ok",
    version: "EKS 1.31 · 42 nós",
    owner: "ana",
    cpu: 63,
    memory: 71,
    errorRate: 0,
    uptime: 99.99,
    cost: 42800,
    extra: [
      { label: "Nós", value: "42 de 50" },
      { label: "Pods", value: "1.284" },
    ],
  },
  {
    id: "atlas-pg-staging",
    label: "Banco de homologação",
    type: "postgres",
    project: "atlas",
    env: "staging",
    region: "sa-east-1",
    status: "ok",
    version: "PostgreSQL 16.4",
    owner: "marina",
    cpu: 12,
    memory: 30,
    storage: 22,
    latency: 45,
    errorRate: 0,
    throughput: 120,
    throughputUnit: "q/s",
    connections: { used: 34, max: 200 },
    uptime: 99.7,
    cost: 1200,
  },

  // ───────────────────────────── Orion ─────────────────────────────
  {
    id: "orion-pg-ledger",
    label: "Ledger de contratos e parcelas",
    type: "postgres",
    project: "orion",
    env: "prod",
    region: "sa-east-1",
    status: "ok",
    version: "PostgreSQL 15.8",
    owner: "rafael",
    cpu: 41,
    memory: 62,
    storage: 58,
    latency: 22,
    errorRate: 0.01,
    throughput: 5120,
    throughputUnit: "q/s",
    connections: { used: 210, max: 800 },
    uptime: 99.99,
    cost: 21600,
  },
  {
    id: "orion-redis-cache",
    label: "Cache de scores e limites",
    type: "redis",
    project: "orion",
    env: "prod",
    region: "sa-east-1",
    status: "warn",
    version: "Redis 7.2",
    owner: "rafael",
    cpu: 44,
    memory: 89,
    latency: 2.8,
    errorRate: 0,
    throughput: 41000,
    throughputUnit: "ops/s",
    uptime: 100,
    cost: 4200,
    since: 50,
    base: { memory: 71, latency: 1.0 },
    headline: "Memória em 89% · 1,2 mil evictions/min",
    insight: "Chaves de simulação de crédito sem TTL cresceram 3× desde o lançamento da campanha de sexta-feira.",
    actions: ["Aplicar TTL de 6 h em sim:*", "Escalar para cache.r7g.xlarge"],
    extra: [
      { label: "Evictions", value: "1,2 mil/min", tone: "warn" },
      { label: "Hit rate", value: "91,4% · antes 98,7%", tone: "warn" },
    ],
    windows: [{ start: 50, end: 0, status: "warn" }],
  },
  {
    id: "orion-api-score",
    label: "API de score e decisão de crédito",
    type: "service",
    project: "orion",
    env: "prod",
    region: "sa-east-1",
    status: "ok",
    version: "Go 1.23 · v5.4.0",
    owner: "rafael",
    cpu: 36,
    memory: 40,
    latency: 118,
    errorRate: 0.04,
    throughput: 1480,
    throughputUnit: "req/s",
    uptime: 99.99,
    cost: 5200,
  },
  {
    id: "orion-mongo-docs",
    label: "Documentos e evidências de análise",
    type: "mongodb",
    project: "orion",
    env: "prod",
    region: "sa-east-1",
    status: "ok",
    version: "MongoDB 7.0",
    owner: "rafael",
    cpu: 28,
    memory: 55,
    storage: 63,
    latency: 18,
    errorRate: 0,
    throughput: 860,
    throughputUnit: "ops/s",
    uptime: 99.98,
    cost: 7900,
  },
  {
    id: "orion-s3-docs",
    label: "Contratos e comprovantes",
    type: "storage",
    project: "orion",
    env: "prod",
    region: "sa-east-1",
    status: "ok",
    version: "S3 · 38 TB",
    owner: "rafael",
    cpu: 0,
    memory: 0,
    latency: 42,
    errorRate: 0,
    throughput: 310,
    throughputUnit: "req/s",
    uptime: 100,
    cost: 2100,
  },

  // ───────────────────────────── Nimbus ─────────────────────────────
  {
    id: "nimbus-kafka",
    label: "Barramento de eventos da plataforma",
    type: "kafka",
    project: "nimbus",
    env: "prod",
    region: "us-east-1",
    status: "serious",
    version: "MSK · Kafka 3.7",
    owner: "diego",
    cpu: 79,
    memory: 68,
    storage: 74,
    latency: 95,
    errorRate: 0.2,
    throughput: 48200,
    throughputUnit: "msg/s",
    uptime: 99.97,
    cost: 16900,
    since: 362,
    base: { latency: 12, cpu: 52 },
    headline: "Lag de 1,2 mi mensagens em events.raw",
    insight: "O consumer group ch-ingest perdeu 4 de 12 consumidores após o rebalanceamento das 09:40. A ingestão no ClickHouse está 42 min atrasada.",
    actions: ["Reiniciar consumer group ch-ingest", "Aumentar partições de events.raw para 48"],
    extra: [
      { label: "Lag do consumidor", value: "1,2 mi mensagens", tone: "serious" },
      { label: "Consumidores ativos", value: "8 de 12", tone: "warn" },
    ],
    windows: [{ start: 362, end: 0, status: "serious" }],
  },
  {
    id: "nimbus-clickhouse",
    label: "Data warehouse analítico",
    type: "olap",
    project: "nimbus",
    env: "prod",
    region: "us-east-1",
    status: "warn",
    version: "ClickHouse 24.8",
    owner: "diego",
    cpu: 58,
    memory: 73,
    storage: 66,
    latency: 640,
    errorRate: 0.1,
    throughput: 120,
    throughputUnit: "q/s",
    uptime: 99.98,
    cost: 24300,
    since: 340,
    base: { latency: 590 },
    headline: "Ingestão 42 min atrasada",
    extra: [{ label: "Atraso de ingestão", value: "42 min", tone: "warn" }],
    windows: [{ start: 340, end: 0, status: "warn" }],
  },
  {
    id: "nimbus-airflow",
    label: "Orquestração de pipelines",
    type: "orchestrator",
    project: "nimbus",
    env: "prod",
    region: "us-east-1",
    status: "ok",
    version: "Airflow 2.10",
    owner: "diego",
    cpu: 33,
    memory: 48,
    errorRate: 0.4,
    uptime: 99.9,
    cost: 3600,
    extra: [
      { label: "DAGs ativas", value: "184" },
      { label: "Falhas (24 h)", value: "3", tone: "warn" },
    ],
    windows: [{ start: 470, end: 398, status: "serious" }],
  },
  {
    id: "nimbus-pgvector-catalog",
    label: "Catálogo semântico de tabelas",
    type: "vector",
    project: "nimbus",
    env: "prod",
    region: "us-east-1",
    status: "ok",
    version: "PostgreSQL 16 + pgvector",
    owner: "diego",
    cpu: 26,
    memory: 51,
    storage: 39,
    latency: 31,
    errorRate: 0,
    throughput: 240,
    throughputUnit: "q/s",
    uptime: 99.99,
    cost: 3900,
  },
  {
    id: "nimbus-s3-lake",
    label: "Data lake bruto e curado",
    type: "storage",
    project: "nimbus",
    env: "prod",
    region: "us-east-1",
    status: "ok",
    version: "S3 · 182 TB",
    owner: "diego",
    cpu: 0,
    memory: 0,
    latency: 55,
    errorRate: 0,
    throughput: 1900,
    throughputUnit: "req/s",
    uptime: 100,
    cost: 9800,
  },

  // ───────────────────────────── Vega ─────────────────────────────
  {
    id: "vega-api-checkout",
    label: "Checkout e autorização de pagamentos",
    type: "service",
    project: "vega",
    env: "prod",
    region: "sa-east-1",
    status: "serious",
    version: "Node.js 22 · v7.3.2",
    owner: "beatriz",
    cpu: 55,
    memory: 60,
    latency: 890,
    errorRate: 2.1,
    throughput: 340,
    throughputUnit: "req/s",
    uptime: 99.86,
    cost: 7400,
    since: 71,
    base: { latency: 212, errors: 0.06 },
    headline: "2,1% de erros 5xx em /payments/authorize",
    insight: "92% dos erros são 504 vindos do provedor de pagamentos externo. O circuit breaker está desligado para esse provedor.",
    actions: ["Ativar circuit breaker do provedor", "Rotear 50% para o provedor secundário"],
    windows: [{ start: 71, end: 0, status: "serious" }],
  },
  {
    id: "vega-mysql-orders",
    label: "Pedidos, pagamentos e estoque",
    type: "mysql",
    project: "vega",
    env: "prod",
    region: "sa-east-1",
    status: "ok",
    version: "MySQL 8.0",
    owner: "beatriz",
    cpu: 47,
    memory: 66,
    storage: 61,
    latency: 19,
    errorRate: 0.02,
    throughput: 2900,
    throughputUnit: "q/s",
    connections: { used: 310, max: 1000 },
    uptime: 99.99,
    cost: 12100,
  },
  {
    id: "vega-redis-cart",
    label: "Carrinhos e sessões da loja",
    type: "redis",
    project: "vega",
    env: "prod",
    region: "sa-east-1",
    status: "ok",
    version: "Redis 7.2",
    owner: "beatriz",
    cpu: 18,
    memory: 47,
    latency: 0.9,
    errorRate: 0,
    throughput: 22400,
    throughputUnit: "ops/s",
    uptime: 100,
    cost: 2600,
  },
  {
    id: "vega-opensearch",
    label: "Busca de catálogo",
    type: "search",
    project: "vega",
    env: "prod",
    region: "sa-east-1",
    status: "ok",
    version: "OpenSearch 2.15",
    owner: "beatriz",
    cpu: 49,
    memory: 69,
    storage: 52,
    latency: 74,
    errorRate: 0.01,
    throughput: 1650,
    throughputUnit: "q/s",
    uptime: 99.98,
    cost: 11300,
  },
  {
    id: "vega-cdn-edge",
    label: "Entrega de assets e páginas",
    type: "cdn",
    project: "vega",
    env: "prod",
    region: "global",
    status: "ok",
    version: "CloudFront",
    owner: "beatriz",
    cpu: 0,
    memory: 0,
    latency: 28,
    errorRate: 0.01,
    throughput: 18900,
    throughputUnit: "req/s",
    uptime: 100,
    cost: 6200,
  },
  {
    id: "vega-api-checkout-stg",
    label: "Checkout em homologação",
    type: "service",
    project: "vega",
    env: "staging",
    region: "sa-east-1",
    status: "ok",
    version: "Node.js 22 · v7.4.0-rc.2",
    owner: "beatriz",
    cpu: 9,
    memory: 22,
    latency: 230,
    errorRate: 0.3,
    throughput: 4,
    throughputUnit: "req/s",
    uptime: 99.6,
    cost: 600,
  },

  // ───────────────────────────── Lumen ─────────────────────────────
  {
    id: "lumen-pg-wiki",
    label: "Wiki interna e documentos",
    type: "postgres",
    project: "lumen",
    env: "prod",
    region: "sa-east-1",
    status: "maint",
    version: "PostgreSQL 15 → 16",
    owner: "ana",
    cpu: 8,
    memory: 20,
    storage: 34,
    errorRate: 0,
    uptime: 99.9,
    cost: 1800,
    since: 42,
    headline: "Upgrade para PostgreSQL 16 em andamento (até 17:00)",
    windows: [{ start: 42, end: 0, status: "maint" }],
  },
  {
    id: "lumen-vllm-cluster",
    label: "Inferência própria (Llama) para agentes internos",
    type: "gpu",
    project: "lumen",
    env: "prod",
    region: "sa-east-1",
    status: "warn",
    version: "vLLM 0.6 · 8× H100",
    owner: "ana",
    cpu: 64,
    memory: 81,
    latency: 2600,
    errorRate: 0.4,
    throughput: 5400,
    throughputUnit: "tok/s",
    uptime: 99.94,
    cost: 96400,
    since: 180,
    base: { latency: 1150, cpu: 48 },
    headline: "GPU em 96% · fila de 1,8 s",
    insight: "A fila cresceu com o pico de uso do Lumen Docs após o all-hands. Dois nós estão sem batching contínuo habilitado.",
    actions: ["Habilitar continuous batching nos nós 7 e 8", "Adicionar 2 réplicas sob demanda"],
    extra: [
      { label: "Utilização de GPU", value: "96%", tone: "warn" },
      { label: "Tempo em fila p95", value: "1,8 s", tone: "warn" },
    ],
    windows: [{ start: 180, end: 0, status: "warn" }],
  },
  {
    id: "lumen-k8s-tools",
    label: "Cluster de ferramentas internas",
    type: "k8s",
    project: "lumen",
    env: "prod",
    region: "southamerica-east1",
    status: "ok",
    version: "GKE 1.30 · 12 nós",
    owner: "ana",
    cpu: 41,
    memory: 57,
    errorRate: 0,
    uptime: 99.99,
    cost: 8900,
    extra: [
      { label: "Nós", value: "12 de 16" },
      { label: "Pods", value: "318" },
    ],
  },
];

export const resourceById = (id: string) => RESOURCES.find((r) => r.id === id);

export const categoryOf = (r: Resource) => TYPE_META[r.type].category;

export function currentValue(r: Resource, metric: ResourceMetric) {
  switch (metric) {
    case "latency":
      return r.latency ?? 0;
    case "cpu":
      return r.cpu;
    case "memory":
      return r.memory;
    case "errors":
      return r.errorRate;
    case "connections":
      return r.connections ? (r.connections.used / r.connections.max) * 100 : 0;
    case "throughput":
      return r.throughput ?? 0;
  }
}

export function resourceSeries(r: Resource, metric: ResourceMetric, range: RangeKey) {
  const cur = currentValue(r, metric);
  const base = r.base?.[metric];
  const phases =
    r.since !== undefined && base !== undefined
      ? [
          { from: Infinity, value: base },
          { from: r.since, value: cur },
        ]
      : undefined;
  const vol: Record<ResourceMetric, number> = {
    latency: Math.max(0.15, cur * 0.06),
    cpu: 2.6,
    memory: 1,
    errors: Math.max(0.01, cur * 0.1),
    connections: 1.6,
    throughput: cur * 0.04,
  };
  const capped = metric === "cpu" || metric === "memory" || metric === "connections";
  return gen(`${r.id}:${metric}`, range, {
    now: cur,
    phases,
    vol: vol[metric],
    min: 0,
    max: capped ? 100 : undefined,
    daily: metric === "throughput" || metric === "cpu" ? 0.16 : metric === "latency" ? 0.05 : 0,
    smooth: 0.35,
    decimals: metric === "errors" ? 2 : 1,
  });
}

const worse = (a: Status, b: Status) => (STATUS_RANK[b] > STATUS_RANK[a] ? b : a);

export function statusBuckets(r: Resource, range: RangeKey): Status[] {
  const R = RANGES[range];
  return Array.from({ length: R.points }, (_, i) => {
    const end = minutesAgoAt(range, i);
    const start = end + R.step;
    let s: Status = "ok";
    for (const w of r.windows ?? []) if (w.start > end && w.end < start) s = worse(s, w.status);
    return s;
  });
}

export function uptimeFor(r: Resource, range: RangeKey) {
  const R = RANGES[range];
  const total = R.points * R.step;
  let down = 0;
  for (const w of r.windows ?? []) {
    const a = Math.max(w.end, 0);
    const b = Math.min(w.start, total);
    const weight = w.weight ?? (w.status === "crit" ? 0.03 : w.status === "serious" ? 0.012 : 0);
    if (b > a) down += (b - a) * weight;
  }
  return Math.max(0, 100 - (down / total) * 100);
}

/** Métrica de uso mais pressionada do recurso (CPU, memória, conexões ou disco). */
export function saturationOf(r: Resource): { label: string; value: number } {
  const candidates = [
    { label: "CPU", value: r.cpu },
    { label: "Memória", value: r.memory },
  ];
  if (r.connections) candidates.push({ label: "Conexões", value: (r.connections.used / r.connections.max) * 100 });
  if (r.storage !== undefined) candidates.push({ label: "Disco", value: r.storage });
  return candidates.reduce((a, b) => (b.value > a.value ? b : a));
}

export const SATURATION_LIMIT = 80;

/** Indicadores agregados de infraestrutura — usados na Visão geral e na página de Infraestrutura. */
export function infraSummary(list: Resource[], range: RangeKey) {
  const alerting = list.filter((r) => r.status !== "ok" && r.status !== "maint");
  const count = (s: Status) => list.filter((r) => r.status === s).length;
  const uptime = list.length ? list.reduce((s, r) => s + uptimeFor(r, range), 0) / list.length : 100;
  return {
    total: list.length,
    alerting: alerting.length,
    counts: { crit: count("crit"), serious: count("serious"), warn: count("warn"), ok: count("ok"), maint: count("maint") },
    uptime,
    saturated: list.filter((r) => saturationOf(r).value >= SATURATION_LIMIT).length,
    cost: list.reduce((s, r) => s + r.cost, 0),
    costDelta: 2.4,
  };
}
