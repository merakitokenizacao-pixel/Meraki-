import type { ProjectId } from "../types";
import { AGENTS, type Agent } from "./agents";

/**
 * Fluxos de cada projeto, em colunas da esquerda para a direita.
 *  - Sistemas: o caminho de uma solicitação (ou dos dados) pela infraestrutura.
 *  - Agentes: de onde chegam as conversas, qual agente atende e como terminam.
 * As arestas ligam apenas colunas vizinhas — o diagrama fica legível sem roteamento.
 */

export type FlowIcon =
  | "users"
  | "headset"
  | "chat"
  | "message"
  | "app"
  | "phone"
  | "ticket"
  | "api"
  | "slack"
  | "alert"
  | "mail"
  | "network"
  | "events"
  | "database"
  | "chart"
  | "card"
  | "team"
  | "check"
  | "human"
  | "open";

export type FlowNode =
  | { id: string; kind: "resource"; ref: string }
  | { id: string; kind: "agent"; ref: string }
  /** Grupo: todos os agentes do projeto (no fluxo de sistemas) */
  | { id: string; kind: "agents"; project: ProjectId }
  /** Ator ou sistema fora do Meraki */
  | { id: string; kind: "external"; label: string; sub: string; icon: FlowIcon }
  | { id: string; kind: "outcome"; label: string; sub: string; icon: FlowIcon; value: number; share: number };

export type FlowEdge = { from: string; to: string; label?: string };

export type Flow = {
  title: string;
  description: string;
  columns: { title: string; nodes: FlowNode[] }[];
  edges: FlowEdge[];
  /** Recursos de base que sustentam o fluxo inteiro (ex.: o cluster onde tudo roda). */
  base?: string[];
};

const res = (id: string): FlowNode => ({ id, kind: "resource", ref: id });
const ext = (id: string, label: string, sub: string, icon: FlowIcon): FlowNode => ({ id, kind: "external", label, sub, icon });
const agentsOf = (project: ProjectId): FlowNode => ({ id: `agentes-${project}`, kind: "agents", project });
const e = (from: string, to: string, label?: string): FlowEdge => ({ from, to, label });

const HINT = "Passe o mouse para ver as conexões · clique para abrir o detalhe";

/* ───────────────────────── Sistemas ───────────────────────── */

export const SYSTEM_FLOWS: Record<ProjectId, Flow> = {
  atlas: {
    title: "Caminho de uma solicitação",
    description: `Do canal do cliente até os dados · ${HINT}`,
    columns: [
      { title: "Entrada", nodes: [ext("clientes", "Clientes", "Chat web · WhatsApp · Telefone", "users")] },
      { title: "Atendimento", nodes: [ext("atendentes", "Atendentes", "Zendesk · 186 pessoas", "headset"), agentsOf("atlas")] },
      { title: "Serviços", nodes: [res("atlas-api-tickets"), res("atlas-llm-gateway")] },
      {
        title: "Dados e mensageria",
        nodes: [res("atlas-pg-primary"), res("atlas-pg-replica-1"), res("atlas-rabbitmq"), res("atlas-qdrant-kb"), res("atlas-redis-sessions")],
      },
    ],
    edges: [
      e("clientes", "atendentes", "e-mail"),
      e("clientes", "agentes-atlas", "conversas"),
      e("atendentes", "atlas-api-tickets", "REST"),
      e("agentes-atlas", "atlas-api-tickets", "chamados"),
      e("agentes-atlas", "atlas-llm-gateway", "inferência"),
      e("atlas-api-tickets", "atlas-pg-primary", "escrita"),
      e("atlas-api-tickets", "atlas-pg-replica-1", "leitura"),
      e("atlas-api-tickets", "atlas-rabbitmq", "eventos"),
      e("atlas-llm-gateway", "atlas-qdrant-kb", "RAG"),
      e("atlas-llm-gateway", "atlas-redis-sessions", "sessão"),
    ],
    base: ["atlas-k8s-prod"],
  },
  orion: {
    title: "Caminho de uma solicitação",
    description: `Da negociação ou análise até o ledger · ${HINT}`,
    columns: [
      {
        title: "Entrada",
        nodes: [ext("clientes", "Clientes", "WhatsApp · Portal", "users"), ext("analistas", "Analistas de crédito", "Backoffice · 42 pessoas", "headset")],
      },
      { title: "Atendimento", nodes: [agentsOf("orion")] },
      { title: "Serviços", nodes: [res("orion-api-score")] },
      { title: "Dados", nodes: [res("orion-pg-ledger"), res("orion-redis-cache"), res("orion-mongo-docs"), res("orion-s3-docs")] },
    ],
    edges: [
      e("clientes", "agentes-orion", "negociação"),
      e("analistas", "agentes-orion", "análises"),
      e("agentes-orion", "orion-api-score", "score"),
      e("orion-api-score", "orion-pg-ledger", "contratos"),
      e("orion-api-score", "orion-redis-cache", "cache"),
      e("orion-api-score", "orion-mongo-docs", "dossiês"),
      e("orion-api-score", "orion-s3-docs", "documentos"),
    ],
  },
  nimbus: {
    title: "Caminho dos dados",
    description: `Da origem dos eventos até quem consulta · ${HINT}`,
    columns: [
      {
        title: "Origem",
        nodes: [ext("eventos", "Eventos dos produtos", "Atlas · Orion · Vega", "events"), ext("transacionais", "Bancos transacionais", "Extrações noturnas", "database")],
      },
      { title: "Ingestão", nodes: [res("nimbus-kafka"), res("nimbus-airflow")] },
      { title: "Armazenamento", nodes: [res("nimbus-clickhouse"), res("nimbus-s3-lake"), res("nimbus-pgvector-catalog")] },
      { title: "Consumo", nodes: [ext("bi", "Painéis de BI", "312 painéis · 540 usuários", "chart"), agentsOf("nimbus")] },
    ],
    edges: [
      e("eventos", "nimbus-kafka", "events.raw"),
      e("transacionais", "nimbus-airflow", "lotes"),
      e("nimbus-kafka", "nimbus-clickhouse", "streaming"),
      e("nimbus-kafka", "nimbus-s3-lake", "arquivo"),
      e("nimbus-airflow", "nimbus-s3-lake", "cargas"),
      e("nimbus-airflow", "nimbus-pgvector-catalog", "catálogo"),
      e("nimbus-clickhouse", "bi", "consultas"),
      e("nimbus-clickhouse", "agentes-nimbus", "SQL"),
      e("nimbus-pgvector-catalog", "agentes-nimbus", "esquemas"),
    ],
  },
  vega: {
    title: "Caminho de uma compra",
    description: `Da vitrine até a autorização do pagamento · ${HINT}`,
    columns: [
      { title: "Entrada", nodes: [ext("clientes", "Clientes", "Site · App", "users")] },
      { title: "Borda", nodes: [res("vega-cdn-edge"), agentsOf("vega")] },
      { title: "Serviços", nodes: [res("vega-opensearch"), res("vega-api-checkout")] },
      {
        title: "Dados e parceiros",
        nodes: [res("vega-redis-cart"), res("vega-mysql-orders"), ext("adquirente", "Adquirente", "Cartão e Pix", "card")],
      },
    ],
    edges: [
      e("clientes", "vega-cdn-edge", "páginas"),
      e("clientes", "agentes-vega", "assistente"),
      e("vega-cdn-edge", "vega-opensearch", "busca"),
      e("vega-cdn-edge", "vega-api-checkout", "checkout"),
      e("agentes-vega", "vega-opensearch", "catálogo"),
      e("agentes-vega", "vega-api-checkout", "pedido"),
      e("vega-api-checkout", "vega-redis-cart", "carrinho"),
      e("vega-api-checkout", "vega-mysql-orders", "pedidos"),
      e("vega-api-checkout", "adquirente", "autorização"),
    ],
  },
  lumen: {
    title: "Caminho de uma solicitação",
    description: `Das perguntas e alertas internos até a plataforma · ${HINT}`,
    columns: [
      {
        title: "Entrada",
        nodes: [ext("times", "Times internos", "Slack · 1,4 mil pessoas", "team"), ext("alertas", "Alertas de produção", "PagerDuty · Prometheus", "alert")],
      },
      { title: "Agentes", nodes: [agentsOf("lumen")] },
      { title: "Plataforma e dados", nodes: [res("lumen-vllm-cluster"), res("lumen-pg-wiki"), res("lumen-k8s-tools")] },
    ],
    edges: [
      e("times", "agentes-lumen", "perguntas"),
      e("alertas", "agentes-lumen", "triagem"),
      e("agentes-lumen", "lumen-vllm-cluster", "inferência"),
      e("agentes-lumen", "lumen-pg-wiki", "wiki"),
      e("agentes-lumen", "lumen-k8s-tools", "ações"),
    ],
  },
};

/* ───────────────────────── Agentes ───────────────────────── */

const CHANNEL_ICON: Record<string, FlowIcon> = {
  "Chat web": "chat",
  WhatsApp: "message",
  App: "app",
  Telefone: "phone",
  Zendesk: "ticket",
  "API interna": "api",
  Slack: "slack",
  PagerDuty: "alert",
  "E-mail": "mail",
  LinkedIn: "network",
};

/** Divisão fixa do volume quando o agente atende por mais de um canal. */
const CHANNEL_SPLIT = [[1], [0.62, 0.38], [0.5, 0.3, 0.2]];

const channelsOf = (a: Agent) => a.channel.split(" · ").map((c) => c.trim());
const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");

const SEVERITY = { crit: 0, serious: 1, warn: 2, maint: 3, ok: 4 } as const;

/** Fluxo das conversas de um projeto — derivado dos canais, volumes e taxas de cada agente. */
export function agentFlow(project: ProjectId): Flow {
  const agents = AGENTS.filter((a) => a.project === project).sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || b.m.volume - a.m.volume);

  // Canais na ordem do primeiro agente que os usa — reduz cruzamentos.
  const channelVolume = new Map<string, number>();
  const edges: FlowEdge[] = [];
  for (const a of agents) {
    const chs = channelsOf(a);
    const split = CHANNEL_SPLIT[chs.length - 1] ?? chs.map(() => 1 / chs.length);
    chs.forEach((c, i) => {
      const v = a.m.volume * split[i];
      channelVolume.set(c, (channelVolume.get(c) ?? 0) + v);
      edges.push({ from: `canal-${slug(c)}`, to: a.id, label: `${fmtThousands(v)}/dia` });
    });
  }

  const total = agents.reduce((s, a) => s + a.m.volume, 0);
  const resolved = agents.reduce((s, a) => s + (a.m.volume * a.m.resolution) / 100, 0);
  const escalated = agents.reduce((s, a) => s + (a.m.volume * a.m.escalation) / 100, 0);
  const open = Math.max(0, total - resolved - escalated);

  for (const a of agents) {
    const rest = 100 - a.m.resolution - a.m.escalation;
    edges.push({ from: a.id, to: "resolvido", label: pct(a.m.resolution) });
    edges.push({ from: a.id, to: "escalado", label: pct(a.m.escalation) });
    if (rest >= 0.5) edges.push({ from: a.id, to: "sem-desfecho", label: pct(rest) });
  }

  const outcomes: FlowNode[] = [
    { id: "resolvido", kind: "outcome", label: "Resolvido pelo agente", sub: "sem intervenção humana", icon: "check", value: resolved, share: resolved / total },
    { id: "escalado", kind: "outcome", label: "Escalado para humano", sub: "transferido para a equipe", icon: "human", value: escalated, share: escalated / total },
  ];
  if (open >= 1) outcomes.push({ id: "sem-desfecho", kind: "outcome", label: "Sem desfecho", sub: "abandono ou sem resposta", icon: "open", value: open, share: open / total });

  return {
    title: "Fluxo das conversas",
    description: `De onde chegam as conversas, qual agente atende e como terminam · ${HINT}`,
    columns: [
      {
        title: "Canais",
        nodes: Array.from(channelVolume.entries()).map(([c, v]) => ext(`canal-${slug(c)}`, c, `${fmtThousands(v)} por dia`, CHANNEL_ICON[c] ?? "chat")),
      },
      { title: "Agentes", nodes: agents.map((a) => ({ id: a.id, kind: "agent" as const, ref: a.id })) },
      { title: "Desfechos", nodes: outcomes },
    ],
    edges,
  };
}

const pct = (n: number) => `${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

function fmtThousands(n: number) {
  if (n >= 1000) return `${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return Math.round(n).toLocaleString("pt-BR");
}
