import { rng } from "../series";
import type { ProjectId, Status } from "../types";
import { PROJECTS } from "./projects";

export type Severity = 1 | 2 | 3 | 4;
export type IncidentStatus = "investigating" | "mitigating" | "monitoring" | "open" | "resolved" | "maintenance";

export const SEVERITY_META: Record<Severity, { label: string; status: Status; description: string }> = {
  1: { label: "SEV-1", status: "crit", description: "Impacto severo em produção" },
  2: { label: "SEV-2", status: "serious", description: "Impacto relevante, com contorno" },
  3: { label: "SEV-3", status: "warn", description: "Impacto limitado" },
  4: { label: "SEV-4", status: "maint", description: "Baixo impacto" },
};

export const INCIDENT_STATUS_META: Record<IncidentStatus, { label: string; step: number }> = {
  open: { label: "Aberto", step: 0 },
  investigating: { label: "Investigando", step: 1 },
  mitigating: { label: "Mitigando", step: 2 },
  monitoring: { label: "Monitorando", step: 3 },
  resolved: { label: "Resolvido", step: 4 },
  maintenance: { label: "Manutenção", step: 2 },
};

export type TimelineKind = "deploy" | "alert" | "ai" | "ack" | "action" | "metric" | "resolve" | "comment";

export type Incident = {
  id: string;
  sev: Severity;
  title: string;
  status: IncidentStatus;
  project: ProjectId;
  started: number;
  resolvedAt?: number;
  owner: string;
  affected: string[];
  detectedBy: "Meraki" | "Alerta" | "Manual";
  summary: string;
  hypothesis?: { text: string; confidence: number };
  impact: { label: string; value: string }[];
  timeline: { at: number; kind: TimelineKind; title: string; actor?: string; detail?: string }[];
};

const D = 1440;

export const INCIDENTS: Incident[] = [
  {
    id: "INC-2481",
    sev: 1,
    title: "Saturação de conexões no Postgres do Atlas",
    status: "investigating",
    project: "atlas",
    started: 104,
    owner: "marina",
    affected: ["atlas-pg-primary", "atlas-api-tickets", "aurora", "atlas-resolve"],
    detectedBy: "Meraki",
    summary: "O atlas-pg-primary opera com 94% das conexões em uso. A API de tickets responde com p95 de 486 ms e os agentes do Atlas sofrem timeouts em ferramentas.",
    hypothesis: {
      text: "O deploy atlas-api-tickets v2.18.0 (13:41) removeu o reuso de conexões no worker de SLA. 61% das conexões abertas vêm desse serviço.",
      confidence: 86,
    },
    impact: [
      { label: "Latência da API", value: "486 ms p95" },
      { label: "Conversas com timeout", value: "3,2%" },
      { label: "Clientes afetados", value: "≈ 2,1 mil" },
    ],
    timeline: [
      { at: 121, kind: "deploy", title: "Deploy atlas-api-tickets v2.18.0", actor: "diego" },
      { at: 104, kind: "alert", title: "Conexões acima de 90% no atlas-pg-primary", detail: "Regra: conexões > 90% por 3 min" },
      { at: 101, kind: "ai", title: "Meraki correlacionou o alerta ao deploy v2.18.0", detail: "Confiança de 86% · 61% das conexões vêm do worker de SLA" },
      { at: 99, kind: "ack", title: "Incidente reconhecido", actor: "marina" },
      { at: 82, kind: "action", title: "Limite do pool aumentado de 400 para 500 conexões", actor: "marina", detail: "Mitigação temporária" },
      { at: 30, kind: "deploy", title: "Hotfix v2.18.1 em canário (10% do tráfego)", actor: "marina" },
      { at: 11, kind: "metric", title: "Conexões estáveis em 94% — canário sem regressão", detail: "Aguardando promoção do hotfix" },
    ],
  },
  {
    id: "INC-2480",
    sev: 2,
    title: "Precisão do agente Aurora abaixo da meta",
    status: "mitigating",
    project: "atlas",
    started: 4177,
    owner: "lucas",
    affected: ["aurora", "atlas-qdrant-kb"],
    detectedBy: "Meraki",
    summary: "A precisão do Aurora caiu de 93,0% para 81,8% após o deploy v2.4.0. Respostas sobre trocas e reembolsos citam políticas arquivadas.",
    hypothesis: {
      text: "A reindexação do atlas-qdrant-kb (KB v14) perdeu 1.284 documentos da coleção “políticas”. Sem a versão vigente, o agente recupera a política arquivada v6.",
      confidence: 91,
    },
    impact: [
      { label: "Precisão", value: "81,8% (meta 90%)" },
      { label: "Respostas incorretas/dia", value: "≈ 3,4 mil" },
      { label: "CSAT", value: "3,9 (−0,5)" },
    ],
    timeline: [
      { at: 4282, kind: "deploy", title: "Deploy Aurora v2.4.0 — novo prompt e índice KB v14", actor: "lucas" },
      { at: 4177, kind: "ai", title: "Meraki detectou queda de 6 pts na avaliação contínua", detail: "Amostra de 1.200 conversas avaliadas por juiz automático" },
      { at: 4162, kind: "ack", title: "Incidente reconhecido", actor: "lucas" },
      { at: 3462, kind: "metric", title: "Suíte “Políticas de reembolso”: 71,1% (antes 94,2%)" },
      { at: 1812, kind: "action", title: "Rollback em canário (10%) para v2.3.2", actor: "lucas", detail: "Canário manteve 92,4% de precisão em 1.920 conversas" },
      { at: 282, kind: "comment", title: "Reindexação completa agendada para hoje às 18:00", actor: "ana" },
      { at: 11, kind: "ai", title: "Meraki recomendou reverter 100% do tráfego para v2.3.2" },
    ],
  },
  {
    id: "INC-2479",
    sev: 2,
    title: "Erros 5xx no checkout da Vega",
    status: "mitigating",
    project: "vega",
    started: 71,
    owner: "beatriz",
    affected: ["vega-api-checkout", "vega-shopper"],
    detectedBy: "Alerta",
    summary: "2,1% das requisições em /payments/authorize retornam 5xx. Conversas do Vega Shopper que chegam ao pagamento falham em 3,1% dos casos.",
    hypothesis: {
      text: "Timeouts no provedor de pagamentos externo — 92% dos erros são 504 e o circuit breaker está desligado para esse provedor.",
      confidence: 78,
    },
    impact: [
      { label: "Taxa de erro", value: "2,1%" },
      { label: "Pedidos afetados", value: "≈ 410" },
      { label: "Receita em risco", value: "R$ 96 mil" },
    ],
    timeline: [
      { at: 71, kind: "alert", title: "Taxa de 5xx acima de 1% em vega-api-checkout" },
      { at: 69, kind: "ai", title: "Meraki isolou os erros no provedor de pagamentos externo", detail: "92% dos erros são 504 em /payments/authorize" },
      { at: 64, kind: "ack", title: "Incidente reconhecido", actor: "beatriz" },
      { at: 40, kind: "action", title: "30% do tráfego roteado para o provedor secundário", actor: "beatriz" },
    ],
  },
  {
    id: "INC-2478",
    sev: 3,
    title: "Lag de consumo no Kafka (events.raw)",
    status: "investigating",
    project: "nimbus",
    started: 362,
    owner: "diego",
    affected: ["nimbus-kafka", "nimbus-clickhouse"],
    detectedBy: "Alerta",
    summary: "O consumer group ch-ingest acumula 1,2 mi mensagens de lag. Dashboards analíticos estão 42 min atrasados.",
    hypothesis: { text: "4 de 12 consumidores não voltaram após o rebalanceamento das 09:40.", confidence: 72 },
    impact: [
      { label: "Lag", value: "1,2 mi mensagens" },
      { label: "Atraso dos dados", value: "42 min" },
    ],
    timeline: [
      { at: 362, kind: "alert", title: "Lag acima de 500 mil mensagens" },
      { at: 350, kind: "ack", title: "Incidente reconhecido", actor: "diego" },
      { at: 300, kind: "ai", title: "Meraki apontou 4 consumidores inativos após rebalanceamento" },
    ],
  },
  {
    id: "INC-2477",
    sev: 3,
    title: "Taxa de resolução do Atlas Resolve abaixo da meta",
    status: "investigating",
    project: "atlas",
    started: 8640,
    owner: "lucas",
    affected: ["atlas-resolve", "atlas-api-tickets"],
    detectedBy: "Meraki",
    summary: "O agente resolve 58,2% dos chamados N1 (meta 75%). A ferramenta consultar_pedido falha por timeout em 17% das chamadas.",
    hypothesis: { text: "Timeouts na ferramenta consultar_pedido levam a escalonamentos desnecessários; o fallback rastrear_envio não está no prompt.", confidence: 83 },
    impact: [
      { label: "Resolução", value: "58,2% (meta 75%)" },
      { label: "Escalonamentos extras/dia", value: "≈ 1,6 mil" },
    ],
    timeline: [
      { at: 8640, kind: "ai", title: "Meraki detectou tendência de queda na taxa de resolução" },
      { at: 8500, kind: "ack", title: "Incidente reconhecido", actor: "lucas" },
      { at: 2900, kind: "metric", title: "Suíte “Uso de ferramentas”: 71,4% (antes 86,7%)" },
      { at: 104, kind: "metric", title: "Timeouts de ferramenta subiram com o INC-2481" },
    ],
  },
  {
    id: "INC-2476",
    sev: 3,
    title: "Memória do Redis do Orion acima de 85%",
    status: "monitoring",
    project: "orion",
    started: 50,
    owner: "rafael",
    affected: ["orion-redis-cache", "iris"],
    detectedBy: "Alerta",
    summary: "Memória em 89% com 1,2 mil evictions/min. O hit rate caiu de 98,7% para 91,4%.",
    hypothesis: { text: "Chaves de simulação de crédito (sim:*) sem TTL cresceram 3× desde a campanha de sexta-feira.", confidence: 88 },
    impact: [
      { label: "Hit rate", value: "91,4%" },
      { label: "Latência do cache", value: "2,8 ms" },
    ],
    timeline: [
      { at: 50, kind: "alert", title: "Memória acima de 85% no orion-redis-cache" },
      { at: 47, kind: "ai", title: "Meraki identificou chaves sim:* sem TTL" },
      { at: 25, kind: "action", title: "TTL de 6 h aplicado às novas chaves", actor: "rafael" },
    ],
  },
  {
    id: "INC-2475",
    sev: 4,
    title: "Latência elevada no agente de voz Echo",
    status: "open",
    project: "atlas",
    started: 2880,
    owner: "lucas",
    affected: ["echo", "atlas-llm-gateway"],
    detectedBy: "Meraki",
    summary: "Latência p95 de 2,9 s desde a nova voz neural (meta 1,5 s). 14% dos clientes interrompem o agente.",
    impact: [
      { label: "Latência p95", value: "2,9 s" },
      { label: "Interrupções", value: "14% das ligações" },
    ],
    timeline: [
      { at: 2910, kind: "deploy", title: "Deploy Echo v1.2.0 — nova voz neural", actor: "lucas" },
      { at: 2880, kind: "ai", title: "Meraki detectou aumento de 38% na latência" },
    ],
  },
  {
    id: "INC-2473",
    sev: 4,
    title: "Upgrade do PostgreSQL do Lumen",
    status: "maintenance",
    project: "lumen",
    started: 42,
    owner: "ana",
    affected: ["lumen-pg-wiki", "lumen-docs"],
    detectedBy: "Manual",
    summary: "Janela de manutenção programada para o upgrade do PostgreSQL 15 para 16. Wiki em modo somente leitura até 17:00.",
    impact: [{ label: "Janela", value: "15:00 – 17:00" }],
    timeline: [
      { at: 42, kind: "action", title: "Manutenção iniciada — wiki em modo somente leitura", actor: "ana" },
      { at: 20, kind: "metric", title: "pg_upgrade concluído em 64% das tabelas" },
    ],
  },
  {
    id: "INC-2474",
    sev: 2,
    title: "Falha em 3 DAGs do Airflow",
    status: "resolved",
    project: "nimbus",
    started: 470,
    resolvedAt: 398,
    owner: "diego",
    affected: ["nimbus-airflow"],
    detectedBy: "Alerta",
    summary: "Três DAGs de faturamento falharam após a rotação de credenciais do data lake.",
    impact: [{ label: "Duração", value: "1 h 12 min" }],
    timeline: [
      { at: 470, kind: "alert", title: "3 DAGs falharam consecutivamente" },
      { at: 455, kind: "ai", title: "Meraki associou a falha à rotação de credenciais" },
      { at: 420, kind: "action", title: "Credenciais atualizadas no Secret Manager", actor: "diego" },
      { at: 398, kind: "resolve", title: "DAGs reprocessadas com sucesso", actor: "diego" },
    ],
  },
  {
    id: "INC-2470",
    sev: 1,
    title: "Indisponibilidade parcial do gateway LLM",
    status: "resolved",
    project: "atlas",
    started: 4 * D + 380,
    resolvedAt: 4 * D + 357,
    owner: "ana",
    affected: ["atlas-llm-gateway", "aurora", "echo", "hermes"],
    detectedBy: "Meraki",
    summary: "O provedor primário de modelos ficou indisponível por 23 min; o fallback não foi acionado por limite de cota.",
    impact: [
      { label: "Duração", value: "23 min" },
      { label: "Conversas afetadas", value: "≈ 6,8 mil" },
    ],
    timeline: [
      { at: 4 * D + 380, kind: "alert", title: "Erros 503 do provedor primário" },
      { at: 4 * D + 376, kind: "ai", title: "Meraki recomendou ativar o fallback de modelos" },
      { at: 4 * D + 360, kind: "action", title: "Cota do fallback ampliada", actor: "ana" },
      { at: 4 * D + 357, kind: "resolve", title: "Tráfego normalizado", actor: "ana" },
    ],
  },
  {
    id: "INC-2468",
    sev: 3,
    title: "Alucinação em respostas sobre frete (Vega Shopper)",
    status: "resolved",
    project: "vega",
    started: 9 * D + 200,
    resolvedAt: 8 * D + 600,
    owner: "beatriz",
    affected: ["vega-shopper"],
    detectedBy: "Meraki",
    summary: "O agente informava prazos de frete sem consultar o CEP. Corrigido com a ferramenta de cálculo de frete.",
    impact: [{ label: "Duração", value: "18 h" }],
    timeline: [
      { at: 9 * D + 200, kind: "ai", title: "Meraki detectou respostas sem fonte sobre prazos" },
      { at: 8 * D + 600, kind: "resolve", title: "Deploy v2.1.0 com cálculo de frete por CEP", actor: "beatriz" },
    ],
  },
];

export const incidentById = (id: string) => INCIDENTS.find((i) => i.id === id);

export const ACTIVE_INCIDENTS = INCIDENTS.filter((i) => i.status !== "resolved" && i.status !== "maintenance");

/** Incidentes por projeto nos últimos 30 dias — base do mapa de calor. */
export function incidentHeatmap() {
  return PROJECTS.map((p) => {
    const r = rng(`heat:${p.id}`);
    const hot = p.id === "atlas" ? 3.2 : p.id === "nimbus" ? 1.4 : p.id === "vega" ? 1.2 : 0.7;
    const days = Array.from({ length: 30 }, (_, i) => {
      const recency = i >= 26 && p.id === "atlas" ? 2.5 : 0;
      const v = Math.floor(Math.pow(r(), 2.2) * hot + recency * r());
      return Math.max(0, v);
    });
    return { project: p, days };
  });
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Indicadores de resposta a incidentes (medianas — robustas a um incidente fora da curva). */
export function incidentSummary() {
  const ackTimes = INCIDENTS.flatMap((i) => {
    const ack = i.timeline.find((t) => t.kind === "ack");
    return ack ? [i.started - ack.at] : [];
  });
  const resolveTimes = INCIDENTS.flatMap((i) => (i.resolvedAt !== undefined ? [i.started - i.resolvedAt] : []));
  const bySev = (s: Severity) => ACTIVE_INCIDENTS.filter((i) => i.sev === s).length;
  return {
    active: ACTIVE_INCIDENTS.length,
    sev: { 1: bySev(1), 2: bySev(2), 3: bySev(3), 4: bySev(4) } as Record<Severity, number>,
    mtta: median(ackTimes),
    mttaDelta: -12,
    mttr: median(resolveTimes),
    mttrDelta: 8,
    byMeraki: ACTIVE_INCIDENTS.filter((i) => i.detectedBy === "Meraki").length,
    resolved: INCIDENTS.filter((i) => i.status === "resolved").length,
    maintenance: INCIDENTS.filter((i) => i.status === "maintenance").length,
  };
}
