import { gen, type Phase } from "../series";
import { RANGES, type RangeKey } from "../time";
import type { ProjectId, Status } from "../types";

export type AgentMetricKey =
  | "accuracy"
  | "resolution"
  | "hallucination"
  | "groundedness"
  | "safety"
  | "csat"
  | "latency"
  | "cost"
  | "volume"
  | "escalation";

export type Agent = {
  id: string;
  name: string;
  role: string;
  project: ProjectId;
  model: string;
  version: string;
  channel: string;
  owner: string;
  status: Status;
  targets: { accuracy: number; resolution: number; latency: number };
  m: Record<AgentMetricKey, number>;
  /** variação vs. semana anterior — pontos para %, percentual para latência/volume/custo */
  d: { accuracy: number; resolution: number; hallucination: number; csat: number; latency: number; volume: number; cost: number };
  events?: Partial<Record<AgentMetricKey, Phase[]>>;
  versions: { version: string; at: number; note: string; accuracy: number }[];
  dependsOn: string[];
  summary: string;
  failureModes: { label: string; share: number; delta: number }[];
  evals: { suite: string; cases: number; pass: number; prev: number | null }[];
  lastEval: number;
};

export const AGENT_STATUS_LABEL: Record<Status, string> = {
  ok: "Na meta",
  warn: "Atenção",
  serious: "Abaixo da meta",
  crit: "Crítico",
  maint: "Pausado",
};

const GENERIC_FAILURES = [
  { label: "Resposta incompleta", share: 30, delta: -2 },
  { label: "Recuperação incorreta (RAG)", share: 22, delta: 1 },
  { label: "Não seguiu a política", share: 16, delta: 0 },
  { label: "Escalonamento tardio", share: 13, delta: 1 },
  { label: "Alucinação factual", share: 11, delta: -1 },
  { label: "Outros", share: 8, delta: 1 },
];

const D = 1440;

export const AGENTS: Agent[] = [
  {
    id: "aurora",
    name: "Aurora",
    role: "Atendimento ao cliente",
    project: "atlas",
    model: "Claude Sonnet 5.5",
    version: "v2.4.0",
    channel: "Chat web · WhatsApp",
    owner: "lucas",
    status: "crit",
    targets: { accuracy: 90, resolution: 75, latency: 2500 },
    m: { accuracy: 81.8, resolution: 71.4, hallucination: 6.9, groundedness: 84.2, safety: 99.2, csat: 3.9, latency: 2100, cost: 0.41, volume: 18420, escalation: 24.1 },
    d: { accuracy: -11.2, resolution: -6.3, hallucination: 4.1, csat: -0.5, latency: 8, volume: 3.2, cost: 12 },
    events: {
      accuracy: [
        { from: Infinity, value: 92.1 },
        { from: 14737, value: 93.0 },
        { from: 4282, value: 81.8 },
      ],
      resolution: [
        { from: Infinity, value: 77.7 },
        { from: 4282, value: 71.4 },
      ],
      hallucination: [
        { from: Infinity, value: 2.8 },
        { from: 4282, value: 6.9 },
      ],
    },
    versions: [
      { version: "v2.4.0", at: 4282, note: "Novo prompt de sistema e índice de conhecimento KB v14", accuracy: 81.8 },
      { version: "v2.3.2", at: 14737, note: "Few-shots de trocas e ajuste de tom", accuracy: 93.0 },
      { version: "v2.3.1", at: 21 * D + 300, note: "Correção no fluxo de escalonamento", accuracy: 92.1 },
      { version: "v2.3.0", at: 33 * D + 120, note: "Ferramenta de rastreio de pedidos", accuracy: 91.4 },
    ],
    dependsOn: ["atlas-llm-gateway", "atlas-qdrant-kb", "atlas-api-tickets", "atlas-redis-sessions"],
    summary:
      "Precisão caiu 11,2 pts após o deploy v2.4.0 (12/11, 16:20). 68% das respostas incorretas citam políticas que não estão mais no índice atlas-qdrant-kb.",
    failureModes: [
      { label: "Informação desatualizada", share: 41, delta: 29 },
      { label: "Recuperação incorreta (RAG)", share: 27, delta: 11 },
      { label: "Alucinação factual", share: 14, delta: 6 },
      { label: "Resposta incompleta", share: 9, delta: -3 },
      { label: "Escalonamento tardio", share: 6, delta: -1 },
      { label: "Outros", share: 3, delta: 0 },
    ],
    evals: [
      { suite: "Políticas de reembolso", cases: 412, pass: 71.1, prev: 94.2 },
      { suite: "Regressão v2.4", cases: 96, pass: 78.1, prev: null },
      { suite: "Escalonamento correto", cases: 180, pass: 84.4, prev: 88.9 },
      { suite: "Rastreamento de pedidos", cases: 268, pass: 89.6, prev: 90.3 },
      { suite: "Tom e empatia", cases: 150, pass: 96.0, prev: 95.3 },
      { suite: "Segurança e PII", cases: 220, pass: 99.5, prev: 99.5 },
    ],
    lastEval: 34,
  },
  {
    id: "atlas-resolve",
    name: "Atlas Resolve",
    role: "Resolução de chamados N1",
    project: "atlas",
    model: "Claude Haiku 5.5",
    version: "v1.9.2",
    channel: "Zendesk",
    owner: "lucas",
    status: "serious",
    targets: { accuracy: 90, resolution: 75, latency: 2000 },
    m: { accuracy: 89.3, resolution: 58.2, hallucination: 2.1, groundedness: 91.0, safety: 99.6, csat: 4.1, latency: 1400, cost: 0.09, volume: 9870, escalation: 38.4 },
    d: { accuracy: -0.8, resolution: -4.9, hallucination: 0.3, csat: -0.2, latency: 22, volume: -1.5, cost: 4 },
    events: {
      resolution: [
        { from: Infinity, value: 66.4 },
        { from: 8640, value: 60.1 },
        { from: 104, value: 58.2 },
      ],
      latency: [
        { from: Infinity, value: 1150 },
        { from: 104, value: 1400 },
      ],
    },
    versions: [
      { version: "v1.9.2", at: 9 * D + 200, note: "Nova ferramenta consultar_pedido", accuracy: 89.9 },
      { version: "v1.9.1", at: 20 * D + 500, note: "Prompt de diagnóstico N1", accuracy: 90.4 },
      { version: "v1.9.0", at: 29 * D + 60, note: "Integração com Zendesk Sunshine", accuracy: 89.7 },
    ],
    dependsOn: ["atlas-llm-gateway", "atlas-api-tickets", "atlas-pg-replica-1", "atlas-qdrant-kb"],
    summary:
      "Resolve 58,2% dos chamados (meta 75%). 41% dos não resolvidos dependem da ferramenta consultar_pedido, que falha por timeout em 17% das chamadas.",
    failureModes: [
      { label: "Ferramenta falhou / timeout", share: 38, delta: 21 },
      { label: "Escalonamento tardio", share: 22, delta: 4 },
      { label: "Resposta incompleta", share: 17, delta: -2 },
      { label: "Não seguiu a política", share: 11, delta: 0 },
      { label: "Recuperação incorreta (RAG)", share: 8, delta: 2 },
      { label: "Outros", share: 4, delta: -1 },
    ],
    evals: [
      { suite: "Uso de ferramentas", cases: 210, pass: 71.4, prev: 86.7 },
      { suite: "Encerramento de chamado", cases: 160, pass: 82.5, prev: 84.0 },
      { suite: "Diagnóstico N1", cases: 340, pass: 88.2, prev: 89.1 },
      { suite: "Segurança e PII", cases: 220, pass: 99.1, prev: 99.5 },
    ],
    lastEval: 70,
  },
  {
    id: "orion-analyst",
    name: "Orion Analyst",
    role: "Análise de crédito PJ",
    project: "orion",
    model: "Claude Opus 5.5",
    version: "v3.2.1",
    channel: "API interna",
    owner: "rafael",
    status: "ok",
    targets: { accuracy: 95, resolution: 85, latency: 9000 },
    m: { accuracy: 96.4, resolution: 92.1, hallucination: 0.4, groundedness: 97.8, safety: 99.9, csat: 4.7, latency: 6800, cost: 1.84, volume: 2140, escalation: 7.9 },
    d: { accuracy: 0.6, resolution: 1.1, hallucination: -0.1, csat: 0.1, latency: -4, volume: 6.8, cost: -2 },
    versions: [
      { version: "v3.2.1", at: 12 * D + 400, note: "Regras de exposição setorial", accuracy: 96.1 },
      { version: "v3.2.0", at: 27 * D + 90, note: "Leitura de balanços em PDF", accuracy: 95.7 },
    ],
    dependsOn: ["orion-api-score", "orion-mongo-docs", "orion-s3-docs"],
    summary: "Desempenho estável e acima da meta. O custo por análise caiu 2% com o cache de documentos.",
    failureModes: [
      { label: "Resposta incompleta", share: 34, delta: -4 },
      { label: "Recuperação incorreta (RAG)", share: 22, delta: 1 },
      { label: "Não seguiu a política", share: 18, delta: 0 },
      { label: "Alucinação factual", share: 9, delta: -1 },
      { label: "Escalonamento tardio", share: 9, delta: 1 },
      { label: "Outros", share: 8, delta: 0 },
    ],
    evals: [
      { suite: "Análise de balanços", cases: 180, pass: 96.7, prev: 96.1 },
      { suite: "Políticas de crédito", cases: 240, pass: 97.9, prev: 97.5 },
      { suite: "Casos de fraude", cases: 90, pass: 93.3, prev: 92.2 },
      { suite: "Segurança e PII", cases: 220, pass: 100, prev: 99.5 },
    ],
    lastEval: 125,
  },
  {
    id: "iris",
    name: "Íris",
    role: "Negociação de cobrança",
    project: "orion",
    model: "Claude Sonnet 5.5",
    version: "v1.4.0",
    channel: "WhatsApp",
    owner: "rafael",
    status: "ok",
    targets: { accuracy: 90, resolution: 60, latency: 2500 },
    m: { accuracy: 92.7, resolution: 64.8, hallucination: 1.2, groundedness: 94.1, safety: 99.4, csat: 4.3, latency: 1900, cost: 0.22, volume: 6310, escalation: 12.2 },
    d: { accuracy: 0.4, resolution: 2.6, hallucination: -0.2, csat: 0.1, latency: 3, volume: 11.4, cost: 1 },
    versions: [
      { version: "v1.4.0", at: 6 * D + 120, note: "Novas faixas de desconto", accuracy: 92.5 },
      { version: "v1.3.2", at: 19 * D + 300, note: "Linguagem regulatória (CDC)", accuracy: 92.0 },
    ],
    dependsOn: ["orion-api-score", "orion-pg-ledger", "orion-redis-cache"],
    summary: "Acordos fechados subiram 2,6 pts com as novas faixas de desconto. O cache do Orion em atenção pode elevar a latência.",
    failureModes: GENERIC_FAILURES,
    evals: [
      { suite: "Faixas de desconto", cases: 200, pass: 93.5, prev: 91.0 },
      { suite: "Linguagem regulatória (CDC)", cases: 160, pass: 97.5, prev: 97.5 },
      { suite: "Tom e empatia", cases: 150, pass: 94.7, prev: 94.0 },
      { suite: "Segurança e PII", cases: 220, pass: 99.5, prev: 99.5 },
    ],
    lastEval: 48,
  },
  {
    id: "nimbus-sql",
    name: "Nimbus SQL",
    role: "Copiloto de dados (text-to-SQL)",
    project: "nimbus",
    model: "GPT-4.1",
    version: "v0.9.3",
    channel: "Slack",
    owner: "diego",
    status: "warn",
    targets: { accuracy: 90, resolution: 80, latency: 5000 },
    m: { accuracy: 86.1, resolution: 79.5, hallucination: 4.4, groundedness: 88.0, safety: 99.8, csat: 4.0, latency: 3600, cost: 0.31, volume: 1180, escalation: 9.0 },
    d: { accuracy: -2.4, resolution: -1.8, hallucination: 1.6, csat: -0.2, latency: 12, volume: 4.0, cost: 3 },
    events: {
      accuracy: [
        { from: Infinity, value: 88.5 },
        { from: 7200, value: 86.1 },
      ],
      hallucination: [
        { from: Infinity, value: 2.8 },
        { from: 7200, value: 4.4 },
      ],
    },
    versions: [
      { version: "v0.9.3", at: 15 * D, note: "Validação de SQL antes da execução", accuracy: 88.6 },
      { version: "v0.9.2", at: 28 * D + 200, note: "Catálogo semântico via pgvector", accuracy: 87.9 },
    ],
    dependsOn: ["nimbus-clickhouse", "nimbus-pgvector-catalog"],
    summary:
      "Consultas com JOIN em 3 ou mais tabelas têm 61% de precisão. O esquema billing_v2 (criado em 10/11) ainda não está no catálogo semântico.",
    failureModes: [
      { label: "Alucinação factual", share: 31, delta: 12 },
      { label: "Recuperação incorreta (RAG)", share: 26, delta: 6 },
      { label: "Resposta incompleta", share: 18, delta: -4 },
      { label: "Não seguiu a política", share: 9, delta: -2 },
      { label: "Fora do escopo", share: 9, delta: 0 },
      { label: "Outros", share: 7, delta: -1 },
    ],
    evals: [
      { suite: "JOINs complexos", cases: 120, pass: 61.7, prev: 74.2 },
      { suite: "Métricas de negócio", cases: 140, pass: 87.1, prev: 90.0 },
      { suite: "Consultas simples", cases: 300, pass: 95.3, prev: 95.7 },
      { suite: "Segurança (PII em SQL)", cases: 80, pass: 100, prev: 100 },
    ],
    lastEval: 95,
  },
  {
    id: "vega-shopper",
    name: "Vega Shopper",
    role: "Assistente de compras",
    project: "vega",
    model: "Claude Haiku 5.5",
    version: "v2.1.0",
    channel: "Chat web · App",
    owner: "beatriz",
    status: "ok",
    targets: { accuracy: 92, resolution: 80, latency: 1500 },
    m: { accuracy: 94.2, resolution: 83.6, hallucination: 0.9, groundedness: 95.6, safety: 99.7, csat: 4.6, latency: 1100, cost: 0.05, volume: 31200, escalation: 5.1 },
    d: { accuracy: 0.3, resolution: 0.9, hallucination: -0.1, csat: 0, latency: -6, volume: 18.5, cost: -3 },
    versions: [
      { version: "v2.1.0", at: 8 * D + 600, note: "Comparador de produtos", accuracy: 94.0 },
      { version: "v2.0.4", at: 23 * D + 100, note: "Cálculo de frete por CEP", accuracy: 93.6 },
    ],
    dependsOn: ["vega-opensearch", "vega-redis-cart", "vega-api-checkout"],
    summary: "Volume +18,5% com a Black Friday antecipada. Os erros do checkout (INC-2479) afetam 3,1% das conversas que chegam ao pagamento.",
    failureModes: GENERIC_FAILURES,
    evals: [
      { suite: "Recomendação de produtos", cases: 260, pass: 93.8, prev: 93.1 },
      { suite: "Frete e prazos", cases: 180, pass: 95.0, prev: 94.4 },
      { suite: "Trocas e devoluções", cases: 140, pass: 92.9, prev: 92.9 },
      { suite: "Segurança e PII", cases: 220, pass: 99.5, prev: 99.1 },
    ],
    lastEval: 22,
  },
  {
    id: "echo",
    name: "Echo",
    role: "Atendimento por voz (URA)",
    project: "atlas",
    model: "Claude Haiku 5.5 + voz",
    version: "v1.2.0",
    channel: "Telefone",
    owner: "lucas",
    status: "warn",
    targets: { accuracy: 90, resolution: 70, latency: 1500 },
    m: { accuracy: 90.4, resolution: 68.9, hallucination: 1.8, groundedness: 92.3, safety: 99.5, csat: 3.8, latency: 2900, cost: 0.58, volume: 4900, escalation: 22.0 },
    d: { accuracy: -0.6, resolution: -1.2, hallucination: 0.2, csat: -0.3, latency: 38, volume: 2.1, cost: 5 },
    events: {
      latency: [
        { from: Infinity, value: 2100 },
        { from: 2880, value: 2900 },
      ],
    },
    versions: [
      { version: "v1.2.0", at: 2 * D + 30, note: "Nova voz neural (síntese em 2 etapas)", accuracy: 90.6 },
      { version: "v1.1.3", at: 17 * D, note: "Detecção de interrupção", accuracy: 91.0 },
    ],
    dependsOn: ["atlas-llm-gateway", "atlas-redis-sessions"],
    summary:
      "Latência p95 de 2,9 s (meta 1,5 s) desde a nova voz neural — clientes interrompem o agente em 14% das ligações.",
    failureModes: [
      { label: "Escalonamento tardio", share: 29, delta: 9 },
      { label: "Resposta incompleta", share: 24, delta: 2 },
      { label: "Fora do escopo", share: 17, delta: -1 },
      { label: "Recuperação incorreta (RAG)", share: 14, delta: 0 },
      { label: "Alucinação factual", share: 9, delta: 1 },
      { label: "Outros", share: 7, delta: -1 },
    ],
    evals: [
      { suite: "Fluxos de URA", cases: 150, pass: 88.7, prev: 89.3 },
      { suite: "Compreensão de fala", cases: 200, pass: 91.0, prev: 91.5 },
      { suite: "Tom e empatia", cases: 150, pass: 92.0, prev: 93.3 },
      { suite: "Segurança e PII", cases: 220, pass: 99.5, prev: 99.5 },
    ],
    lastEval: 160,
  },
  {
    id: "hermes",
    name: "Hermes",
    role: "Classificação e roteamento de tickets",
    project: "atlas",
    model: "Claude Haiku 5.5",
    version: "v4.0.2",
    channel: "API interna",
    owner: "lucas",
    status: "ok",
    targets: { accuracy: 95, resolution: 95, latency: 800 },
    m: { accuracy: 97.8, resolution: 97.1, hallucination: 0.1, groundedness: 99.0, safety: 100, csat: 4.5, latency: 380, cost: 0.004, volume: 42800, escalation: 1.2 },
    d: { accuracy: 0.2, resolution: 0.1, hallucination: 0, csat: 0, latency: -2, volume: 3.4, cost: 0 },
    versions: [
      { version: "v4.0.2", at: 11 * D, note: "Novas intenções de Black Friday", accuracy: 97.6 },
      { version: "v4.0.1", at: 26 * D, note: "Detecção de idioma", accuracy: 97.5 },
    ],
    dependsOn: ["atlas-llm-gateway", "atlas-rabbitmq"],
    summary: "Roteou 42,8 mil tickets nas últimas 24 h com 97,8% de acerto de fila e prioridade.",
    failureModes: GENERIC_FAILURES,
    evals: [
      { suite: "Classificação de intenção", cases: 500, pass: 98.2, prev: 98.0 },
      { suite: "Prioridade e SLA", cases: 300, pass: 97.0, prev: 96.7 },
      { suite: "Idioma e spam", cases: 120, pass: 99.2, prev: 99.2 },
    ],
    lastEval: 12,
  },
  {
    id: "sentinel",
    name: "Sentinel",
    role: "Triagem de alertas (SRE)",
    project: "lumen",
    model: "Claude Sonnet 5.5",
    version: "v1.1.0",
    channel: "Slack · PagerDuty",
    owner: "marina",
    status: "ok",
    targets: { accuracy: 90, resolution: 70, latency: 6000 },
    m: { accuracy: 91.6, resolution: 73.2, hallucination: 1.5, groundedness: 93.0, safety: 99.8, csat: 4.4, latency: 4200, cost: 0.27, volume: 860, escalation: 18.0 },
    d: { accuracy: 1.1, resolution: 2.0, hallucination: -0.3, csat: 0.1, latency: -5, volume: 9.0, cost: 2 },
    versions: [
      { version: "v1.1.0", at: 10 * D, note: "Correlação com deploys", accuracy: 91.2 },
      { version: "v1.0.4", at: 24 * D, note: "Runbooks no contexto", accuracy: 90.1 },
    ],
    dependsOn: ["lumen-k8s-tools"],
    summary: "Correlacionou 86% dos alertas de hoje com a causa provável em menos de 3 minutos.",
    failureModes: GENERIC_FAILURES,
    evals: [
      { suite: "Correlação de alertas", cases: 140, pass: 90.7, prev: 89.3 },
      { suite: "Runbooks corretos", cases: 90, pass: 92.2, prev: 91.1 },
      { suite: "Severidade", cases: 120, pass: 93.3, prev: 92.5 },
    ],
    lastEval: 205,
  },
  {
    id: "lumen-docs",
    name: "Lumen Docs",
    role: "Base de conhecimento interna",
    project: "lumen",
    model: "Llama 3.3 70B (self-hosted)",
    version: "v2.0.4",
    channel: "Slack",
    owner: "ana",
    status: "warn",
    targets: { accuracy: 90, resolution: 75, latency: 2000 },
    m: { accuracy: 88.9, resolution: 76.0, hallucination: 3.1, groundedness: 89.4, safety: 99.6, csat: 4.2, latency: 2600, cost: 0.02, volume: 3400, escalation: 11.0 },
    d: { accuracy: 1.2, resolution: 0.8, hallucination: -0.4, csat: 0.1, latency: 31, volume: 22.0, cost: 0 },
    events: {
      latency: [
        { from: Infinity, value: 1500 },
        { from: 180, value: 2600 },
      ],
    },
    versions: [
      { version: "v2.0.4", at: 5 * D, note: "Reranker multilíngue", accuracy: 88.4 },
      { version: "v2.0.3", at: 18 * D, note: "Citação obrigatória de fontes", accuracy: 87.6 },
    ],
    dependsOn: ["lumen-vllm-cluster", "lumen-pg-wiki"],
    summary: "Precisão 1,1 pt abaixo da meta, em recuperação. A latência subiu 31% com a fila no lumen-vllm-cluster.",
    failureModes: GENERIC_FAILURES,
    evals: [
      { suite: "Políticas internas", cases: 200, pass: 89.5, prev: 88.0 },
      { suite: "Processos de engenharia", cases: 160, pass: 87.5, prev: 86.9 },
      { suite: "Citação de fontes", cases: 120, pass: 90.0, prev: 89.2 },
      { suite: "Segurança e PII", cases: 220, pass: 99.1, prev: 99.1 },
    ],
    lastEval: 240,
  },
  {
    id: "pixel",
    name: "Pixel",
    role: "Moderação de avaliações",
    project: "vega",
    model: "Claude Haiku 5.5",
    version: "v3.3.0",
    channel: "API interna",
    owner: "beatriz",
    status: "ok",
    targets: { accuracy: 94, resolution: 90, latency: 1000 },
    m: { accuracy: 95.1, resolution: 94.0, hallucination: 0.3, groundedness: 97.0, safety: 99.9, csat: 4.4, latency: 620, cost: 0.003, volume: 128000, escalation: 2.4 },
    d: { accuracy: -0.2, resolution: 0.1, hallucination: 0, csat: 0, latency: 1, volume: 7.5, cost: 0 },
    versions: [
      { version: "v3.3.0", at: 7 * D, note: "Exemplos de gírias regionais", accuracy: 95.3 },
      { version: "v3.2.5", at: 21 * D, note: "Detecção de links externos", accuracy: 94.8 },
    ],
    dependsOn: ["vega-cdn-edge"],
    summary: "Moderou 128 mil avaliações. Falsos positivos em gírias regionais caíram 18% após o ajuste de exemplos.",
    failureModes: GENERIC_FAILURES,
    evals: [
      { suite: "Discurso de ódio", cases: 400, pass: 97.8, prev: 97.5 },
      { suite: "Spam e fraude", cases: 300, pass: 96.0, prev: 96.3 },
      { suite: "Gírias regionais", cases: 150, pass: 88.7, prev: 84.0 },
    ],
    lastEval: 58,
  },
  {
    id: "scout",
    name: "Scout",
    role: "Prospecção B2B (SDR) · beta",
    project: "vega",
    model: "Claude Sonnet 5.5",
    version: "v0.7.1",
    channel: "E-mail · LinkedIn",
    owner: "beatriz",
    status: "ok",
    targets: { accuracy: 85, resolution: 35, latency: 8000 },
    m: { accuracy: 87.5, resolution: 41.0, hallucination: 2.6, groundedness: 90.2, safety: 99.4, csat: 4.0, latency: 5100, cost: 0.64, volume: 1020, escalation: 15.0 },
    d: { accuracy: 2.1, resolution: 3.5, hallucination: -0.8, csat: 0.2, latency: -8, volume: 12.0, cost: -4 },
    versions: [
      { version: "v0.7.1", at: 4 * D, note: "Pesquisa de empresa antes do contato", accuracy: 86.9 },
      { version: "v0.7.0", at: 16 * D, note: "Sequências de follow-up", accuracy: 85.2 },
    ],
    dependsOn: ["vega-opensearch"],
    summary: "Beta: 41% das conversas qualificadas viraram reunião (meta 35%). Ainda sob avaliação humana amostral.",
    failureModes: GENERIC_FAILURES,
    evals: [
      { suite: "Qualificação de leads", cases: 120, pass: 88.3, prev: 85.8 },
      { suite: "Personalização", cases: 100, pass: 86.0, prev: 84.0 },
      { suite: "Conformidade LGPD", cases: 80, pass: 98.8, prev: 98.8 },
    ],
    lastEval: 300,
  },
];

export const agentById = (id: string) => AGENTS.find((a) => a.id === id);

export const MODELS = Array.from(new Set(AGENTS.map((a) => a.model)));

const PCT_METRICS: AgentMetricKey[] = ["accuracy", "resolution", "hallucination", "groundedness", "safety", "escalation"];

export function agentSeries(a: Agent, metric: AgentMetricKey, range: RangeKey) {
  const now = a.m[metric];
  const ev = a.events?.[metric];
  const scale = Math.min(1, (RANGES[range].points * RANGES[range].step) / (7 * 1440));
  let start = now;
  if (!ev) {
    if (metric === "accuracy" || metric === "resolution" || metric === "hallucination" || metric === "csat") {
      start = now - a.d[metric] * scale;
    } else if (metric === "latency" || metric === "volume" || metric === "cost") {
      start = now / (1 + (a.d[metric] / 100) * scale);
    }
  }
  const vol: Record<AgentMetricKey, number> = {
    accuracy: 0.6,
    resolution: 1.0,
    hallucination: 0.3,
    groundedness: 0.5,
    safety: 0.1,
    csat: 0.05,
    latency: now * 0.05,
    cost: now * 0.03,
    volume: now * 0.05,
    escalation: 0.8,
  };
  return gen(`${a.id}:${metric}`, range, {
    now,
    start: ev ? undefined : start,
    phases: ev,
    vol: vol[metric],
    min: 0,
    max: PCT_METRICS.includes(metric) ? 100 : metric === "csat" ? 5 : undefined,
    daily: metric === "volume" ? 0.4 : metric === "latency" ? 0.07 : 0,
    smooth: 0.3,
    decimals: 2,
  });
}

// ───────────────────────── Conversas avaliadas ─────────────────────────

export type Turn =
  | { role: "user"; text: string }
  | { role: "agent"; text: string; flag?: string }
  | { role: "tool"; name: string; args: string; result: string; ok: boolean; ms: number };

export type Trace = {
  id: string;
  title: string;
  channel: string;
  at: number;
  verdict: "correct" | "partial" | "incorrect";
  score: number;
  category?: string;
  latency: number;
  tokens: number;
  turns: Turn[];
  judge: { reasoning: string; expected?: string; severity?: "Alta" | "Média" | "Baixa" };
};

export const VERDICT_META = {
  correct: { label: "Correta", status: "ok" as Status },
  partial: { label: "Parcial", status: "warn" as Status },
  incorrect: { label: "Incorreta", status: "crit" as Status },
};

export const TRACES: Record<string, Trace[]> = {
  aurora: [
    {
      id: "CNV-88412",
      title: "Reembolso de fone com defeito após 12 dias",
      channel: "WhatsApp",
      at: 18,
      verdict: "incorrect",
      score: 0.12,
      category: "Informação desatualizada",
      latency: 2380,
      tokens: 3120,
      turns: [
        { role: "user", text: "Oi! Comprei um fone há 12 dias e ele parou de funcionar. Ainda consigo pedir reembolso?" },
        { role: "tool", name: "buscar_politica", args: 'tema: "reembolso", categoria: "eletrônicos"', result: "3 trechos · politica_trocas_v6.md (arquivada em 01/11)", ok: true, ms: 212 },
        {
          role: "agent",
          text: "Consegue sim! Você tem até 30 dias após a compra para pedir o reembolso de produtos com defeito. Já vou abrir a solicitação — pode me confirmar o número do pedido?",
          flag: "até 30 dias após a compra",
        },
      ],
      judge: {
        reasoning:
          "A política vigente (politica_trocas_v7, de 01/11) prevê reembolso direto em até 7 dias; depois disso, o caminho é a garantia via assistência técnica (90 dias). O agente citou a v6, arquivada — a v7 não foi recuperada porque está fora do índice atlas-qdrant-kb desde a reindexação de 12/11.",
        expected: "Orientar o acionamento da garantia (até 90 dias) e oferecer a troca via assistência técnica autorizada.",
        severity: "Alta",
      },
    },
    {
      id: "CNV-88407",
      title: "Alteração de endereço de entrega",
      channel: "Chat web",
      at: 22,
      verdict: "correct",
      score: 0.96,
      latency: 1640,
      tokens: 1880,
      turns: [
        { role: "user", text: "Preciso mudar o endereço de entrega do pedido 4471-22. Ainda dá tempo?" },
        { role: "tool", name: "consultar_pedido", args: 'id: "4471-22"', result: "status: em separação · transportadora: não coletado", ok: true, ms: 640 },
        { role: "agent", text: "Dá tempo, sim! Seu pedido ainda está em separação. Me passe o novo endereço completo com CEP que eu atualizo agora." },
      ],
      judge: { reasoning: "Verificou o status do pedido antes de responder e seguiu o procedimento correto de alteração de endereço." },
    },
    {
      id: "CNV-88399",
      title: "Cancelamento de assinatura anual",
      channel: "WhatsApp",
      at: 31,
      verdict: "partial",
      score: 0.58,
      category: "Resposta incompleta",
      latency: 2210,
      tokens: 2640,
      turns: [
        { role: "user", text: "Quero cancelar minha assinatura anual. Tenho direito a algum valor de volta?" },
        { role: "tool", name: "buscar_politica", args: 'tema: "cancelamento", plano: "anual"', result: "2 trechos · termos_assinatura_v3.md", ok: true, ms: 188 },
        { role: "agent", text: "Posso cancelar para você agora. Para planos anuais, o valor proporcional não é reembolsado.", flag: "o valor proporcional não é reembolsado" },
      ],
      judge: {
        reasoning:
          "Correto para cancelamentos após 7 dias, mas o agente não perguntou a data de contratação. Dentro de 7 dias (direito de arrependimento), o reembolso é integral.",
        expected: "Perguntar a data de contratação antes de informar a regra de reembolso.",
        severity: "Média",
      },
    },
    {
      id: "CNV-88385",
      title: "Cobrança duplicada no cartão",
      channel: "Chat web",
      at: 44,
      verdict: "correct",
      score: 0.91,
      latency: 1980,
      tokens: 2210,
      turns: [
        { role: "user", text: "Fui cobrado duas vezes no cartão pela mesma compra!" },
        { role: "tool", name: "consultar_pagamentos", args: 'pedido: "4402-87"', result: "2 autorizações · 1 capturada · 1 estorno automático em até 2 dias úteis", ok: true, ms: 702 },
        {
          role: "agent",
          text: "Entendo a preocupação! A segunda cobrança é só uma pré-autorização e será estornada automaticamente em até 2 dias úteis. Se não sumir até quarta, me chame que eu abro uma contestação.",
        },
      ],
      judge: { reasoning: "Diagnóstico correto com base nos dados de pagamento e prazo informado conforme a política." },
    },
  ],
  "atlas-resolve": [
    {
      id: "TKT-55120",
      title: "Pedido não entregue — rastreio parado",
      channel: "Zendesk",
      at: 26,
      verdict: "incorrect",
      score: 0.2,
      category: "Ferramenta falhou / timeout",
      latency: 9400,
      tokens: 2900,
      turns: [
        { role: "user", text: "Meu pedido 5582-10 deveria ter chegado ontem e o rastreio não atualiza." },
        { role: "tool", name: "consultar_pedido", args: 'id: "5582-10"', result: "timeout após 8.000 ms", ok: false, ms: 8000 },
        {
          role: "agent",
          text: "Não consegui acessar os dados do seu pedido agora. Vou transferir seu chamado para um especialista, que retornará em até 48 horas.",
          flag: "retornará em até 48 horas",
        },
      ],
      judge: {
        reasoning:
          "A ferramenta consultar_pedido expirou (timeout de 8 s — a API de tickets está degradada pelo INC-2481). O agente não tentou a ferramenta alternativa rastrear_envio, disponível no fluxo N1, e escalou com SLA de 48 h, acima do SLA de 24 h para atrasos.",
        expected: "Tentar rastrear_envio com o código da transportadora; se falhar, escalar com prioridade alta e SLA de 24 h.",
        severity: "Alta",
      },
    },
    {
      id: "TKT-55117",
      title: "Troca de tamanho de camiseta",
      channel: "Zendesk",
      at: 38,
      verdict: "correct",
      score: 0.94,
      latency: 1210,
      tokens: 1540,
      turns: [
        { role: "user", text: "Quero trocar uma camiseta M por G, ainda não usei." },
        { role: "tool", name: "verificar_elegibilidade", args: 'pedido: "5571-02", item: "camiseta"', result: "elegível · prazo até 29/11", ok: true, ms: 410 },
        { role: "agent", text: "Sua troca está liberada até 29/11! Gerei a etiqueta de postagem reversa e enviei para o seu e-mail." },
      ],
      judge: { reasoning: "Verificou a elegibilidade e concluiu a troca sem intervenção humana." },
    },
    {
      id: "TKT-55102",
      title: "Cupom não aplicado no checkout",
      channel: "Zendesk",
      at: 64,
      verdict: "partial",
      score: 0.55,
      category: "Escalonamento tardio",
      latency: 1330,
      tokens: 1290,
      turns: [
        { role: "user", text: "O cupom BLACK10 não funcionou na minha compra de ontem." },
        { role: "agent", text: "Os cupons podem ter regras específicas. Você pode tentar novamente na próxima compra?", flag: "tentar novamente na próxima compra" },
      ],
      judge: {
        reasoning: "Não consultou as regras do cupom nem o pedido. Cupom válido não aplicado dá direito ao reembolso da diferença, segundo a política comercial.",
        expected: "Consultar o pedido, validar as regras do BLACK10 e oferecer o reembolso da diferença.",
        severity: "Média",
      },
    },
  ],
  "orion-analyst": [
    {
      id: "CRD-90211",
      title: "Limite para distribuidora de alimentos",
      channel: "API interna",
      at: 52,
      verdict: "correct",
      score: 0.97,
      latency: 7120,
      tokens: 18400,
      turns: [
        { role: "user", text: "Analisar pedido de limite de R$ 2,4 mi para a Distribuidora Pampa Alimentos." },
        { role: "tool", name: "ler_balancos", args: 'empresa: "Pampa Alimentos", anos: "2024–2025"', result: "2 balanços · EBITDA 18,2% · dívida líquida/EBITDA 1,9×", ok: true, ms: 2410 },
        {
          role: "agent",
          text: "Recomendo aprovar R$ 2,1 mi (87% do solicitado), com garantia de recebíveis. Alavancagem saudável (1,9×), margem estável e exposição ao setor de alimentos dentro do limite da carteira.",
        },
      ],
      judge: { reasoning: "Recomendação consistente com a política de crédito PJ e com os indicadores extraídos dos balanços." },
    },
    {
      id: "CRD-90198",
      title: "Revisão de limite — construtora",
      channel: "API interna",
      at: 140,
      verdict: "partial",
      score: 0.62,
      category: "Resposta incompleta",
      latency: 6400,
      tokens: 12100,
      turns: [
        { role: "user", text: "Revisar o limite da Construtora Horizonte após atraso de 2 parcelas." },
        { role: "agent", text: "Sugiro reduzir o limite em 30% até a regularização das parcelas.", flag: "reduzir o limite em 30%" },
      ],
      judge: {
        reasoning: "Não considerou a renegociação aprovada em 05/11, registrada no ledger.",
        expected: "Consultar renegociações ativas antes de recomendar redução de limite.",
        severity: "Média",
      },
    },
  ],
  iris: [
    {
      id: "COB-33018",
      title: "Acordo de dívida em 6 parcelas",
      channel: "WhatsApp",
      at: 15,
      verdict: "correct",
      score: 0.95,
      latency: 1720,
      tokens: 2050,
      turns: [
        { role: "user", text: "Quero negociar minha dívida, mas só consigo pagar até R$ 300 por mês." },
        { role: "tool", name: "simular_acordo", args: "parcelas_max: 6, valor_max: 300", result: "6× R$ 287,40 · desconto de 22% sobre juros", ok: true, ms: 380 },
        { role: "agent", text: "Consegui uma condição que cabe no seu orçamento: 6 parcelas de R$ 287,40, com 22% de desconto nos juros. Posso gerar o primeiro boleto?" },
      ],
      judge: { reasoning: "Respeitou a capacidade de pagamento informada e a faixa de desconto vigente." },
    },
    {
      id: "COB-33002",
      title: "Contestação de valor",
      channel: "WhatsApp",
      at: 90,
      verdict: "partial",
      score: 0.6,
      category: "Não seguiu a política",
      latency: 1650,
      tokens: 1400,
      turns: [
        { role: "user", text: "Esse valor está errado, eu já paguei uma parte." },
        { role: "agent", text: "Entendo. O valor exibido já considera todos os pagamentos.", flag: "já considera todos os pagamentos" },
      ],
      judge: {
        reasoning: "Pela política, contestações geram protocolo e suspendem a cobrança por 5 dias úteis. O agente não abriu o protocolo.",
        expected: "Abrir protocolo de contestação e informar a suspensão temporária.",
        severity: "Média",
      },
    },
  ],
  "nimbus-sql": [
    {
      id: "SQL-7731",
      title: "MRR por plano usando billing_v2",
      channel: "Slack",
      at: 20,
      verdict: "incorrect",
      score: 0.18,
      category: "Alucinação factual",
      latency: 3900,
      tokens: 5200,
      turns: [
        { role: "user", text: "Qual o MRR por plano em outubro, usando a tabela nova de billing?" },
        { role: "tool", name: "buscar_esquema", args: 'termo: "billing mrr plano"', result: "billing.invoices, billing.plans (billing_v2 não encontrado)", ok: true, ms: 140 },
        {
          role: "agent",
          text: "Aqui está a consulta:\nSELECT p.name, SUM(i.amount) AS mrr\nFROM billing_v2.subscriptions s\nJOIN billing.plans p ON p.id = s.plan_id\nJOIN billing.invoices i ON i.sub_id = s.id\nWHERE i.month = '2026-10' GROUP BY 1;",
          flag: "billing_v2.subscriptions",
        },
      ],
      judge: {
        reasoning:
          "A tabela billing_v2.subscriptions não existe no catálogo — o agente inventou o nome a partir do pedido do usuário. O esquema billing_v2 foi criado em 10/11 e ainda não foi indexado no nimbus-pgvector-catalog.",
        expected: "Informar que o esquema billing_v2 não está catalogado e sugerir billing.subscriptions ou solicitar a indexação.",
        severity: "Alta",
      },
    },
    {
      id: "SQL-7728",
      title: "Pedidos por região ontem",
      channel: "Slack",
      at: 48,
      verdict: "correct",
      score: 0.93,
      latency: 2900,
      tokens: 3100,
      turns: [
        { role: "user", text: "Quantos pedidos por região tivemos ontem?" },
        { role: "tool", name: "executar_sql", args: "SELECT region, count(*) FROM orders WHERE …", result: "5 linhas · 182 ms", ok: true, ms: 182 },
        { role: "agent", text: "Ontem foram 48.210 pedidos: Sudeste 52%, Sul 19%, Nordeste 16%, Centro-Oeste 9% e Norte 4%." },
      ],
      judge: { reasoning: "Consulta correta e resposta fiel ao resultado." },
    },
  ],
  "vega-shopper": [
    {
      id: "LOJ-12088",
      title: "Tênis de corrida para iniciantes",
      channel: "App",
      at: 9,
      verdict: "correct",
      score: 0.95,
      latency: 980,
      tokens: 1700,
      turns: [
        { role: "user", text: "Quero um tênis para começar a correr, até R$ 400." },
        { role: "tool", name: "buscar_catalogo", args: 'categoria: "tênis corrida", preco_max: 400', result: "24 produtos · 3 com amortecimento alto", ok: true, ms: 96 },
        { role: "agent", text: "Separei 3 opções com bom amortecimento para quem está começando, todas abaixo de R$ 400. A mais bem avaliada é o Passo Leve 2 (4,7★, R$ 349,90)." },
      ],
      judge: { reasoning: "Recomendações dentro do orçamento e alinhadas à necessidade do cliente." },
    },
    {
      id: "LOJ-12071",
      title: "Prazo de entrega para Manaus",
      channel: "Chat web",
      at: 33,
      verdict: "partial",
      score: 0.64,
      category: "Resposta incompleta",
      latency: 870,
      tokens: 990,
      turns: [
        { role: "user", text: "Se eu comprar hoje, chega em Manaus antes do dia 20?" },
        { role: "agent", text: "O prazo padrão é de 5 a 8 dias úteis.", flag: "5 a 8 dias úteis" },
      ],
      judge: {
        reasoning: "Não consultou o CEP; para a região Norte o prazo é de 9 a 12 dias úteis.",
        expected: "Calcular o frete pelo CEP antes de informar o prazo.",
        severity: "Média",
      },
    },
  ],
  echo: [
    {
      id: "URA-44120",
      title: "Segunda via de boleto por voz",
      channel: "Telefone",
      at: 12,
      verdict: "correct",
      score: 0.9,
      latency: 3400,
      tokens: 1200,
      turns: [
        { role: "user", text: "(voz) Eu queria a segunda via do boleto deste mês." },
        { role: "tool", name: "gerar_boleto", args: 'cliente: "verificado por voz"', result: "boleto gerado · enviado por SMS", ok: true, ms: 1240 },
        { role: "agent", text: "(voz) Pronto! Enviei a segunda via por SMS para o número com final 4821. Posso ajudar em mais alguma coisa?" },
      ],
      judge: { reasoning: "Fluxo correto, mas a resposta levou 3,4 s — acima da meta de 1,5 s para voz." },
    },
    {
      id: "URA-44102",
      title: "Cliente interrompeu o agente",
      channel: "Telefone",
      at: 41,
      verdict: "partial",
      score: 0.5,
      category: "Escalonamento tardio",
      latency: 3800,
      tokens: 600,
      turns: [
        { role: "user", text: "(voz) Alô? Alô? Tem alguém aí?" },
        { role: "agent", text: "(voz) Desculpe a demora! Como posso ajudar?", flag: "Desculpe a demora!" },
      ],
      judge: {
        reasoning: "Silêncio de 3,8 s antes da primeira resposta (síntese de voz lenta). O cliente repetiu a pergunta duas vezes.",
        expected: "Primeira resposta em até 1,5 s ou mensagem de espera curta.",
        severity: "Média",
      },
    },
  ],
  hermes: [
    {
      id: "RTE-99821",
      title: "Ticket: cobrança indevida",
      channel: "API interna",
      at: 3,
      verdict: "correct",
      score: 0.99,
      latency: 340,
      tokens: 420,
      turns: [
        { role: "user", text: "Assunto: fui cobrado 2x — Pedido 4402-87 — urgente" },
        { role: "agent", text: "fila: financeiro · prioridade: alta · intenção: contestacao_cobranca · idioma: pt-BR" },
      ],
      judge: { reasoning: "Classificação, fila e prioridade corretas." },
    },
    {
      id: "RTE-99790",
      title: "Ticket ambíguo",
      channel: "API interna",
      at: 19,
      verdict: "correct",
      score: 0.88,
      latency: 310,
      tokens: 380,
      turns: [
        { role: "user", text: "Assunto: problema — não funciona" },
        { role: "agent", text: "fila: suporte_geral · prioridade: média · intenção: indefinida · solicitar_detalhes: sim" },
      ],
      judge: { reasoning: "Correto ao pedir mais detalhes em vez de adivinhar a intenção." },
    },
  ],
  sentinel: [
    {
      id: "ALR-1201",
      title: "Alerta: conexões do Postgres acima de 90%",
      channel: "Slack",
      at: 101,
      verdict: "correct",
      score: 0.94,
      latency: 3900,
      tokens: 6800,
      turns: [
        { role: "user", text: "@sentinel o que está acontecendo com o atlas-pg-primary?" },
        { role: "tool", name: "correlacionar_eventos", args: 'recurso: "atlas-pg-primary", janela: "30m"', result: "deploy atlas-api-tickets v2.18.0 há 17 min · 61% das conexões", ok: true, ms: 2100 },
        { role: "agent", text: "Causa provável: deploy do atlas-api-tickets v2.18.0 (13:41) — 61% das conexões vêm dele. Runbook sugerido: RB-014 (pool de conexões). Quer que eu abra o incidente?" },
      ],
      judge: { reasoning: "Correlação correta, com evidência e runbook adequado." },
    },
    {
      id: "ALR-1188",
      title: "Alerta: lag no Kafka",
      channel: "Slack",
      at: 355,
      verdict: "partial",
      score: 0.6,
      category: "Recuperação incorreta (RAG)",
      latency: 4100,
      tokens: 5300,
      turns: [
        { role: "user", text: "@sentinel por que o lag do events.raw subiu?" },
        { role: "agent", text: "O lag provavelmente foi causado por um pico de tráfego.", flag: "pico de tráfego" },
      ],
      judge: {
        reasoning: "O tráfego estava estável; a causa foi a perda de consumidores após o rebalanceamento.",
        expected: "Checar os consumidores ativos do grupo ch-ingest.",
        severity: "Baixa",
      },
    },
  ],
  "lumen-docs": [
    {
      id: "DOC-6610",
      title: "Política de home office",
      channel: "Slack",
      at: 27,
      verdict: "correct",
      score: 0.92,
      latency: 2500,
      tokens: 2900,
      turns: [
        { role: "user", text: "Quantos dias de home office posso fazer por semana?" },
        { role: "tool", name: "buscar_wiki", args: 'termo: "home office"', result: "politica_trabalho_hibrido.md (atualizada em 02/10)", ok: true, ms: 920 },
        { role: "agent", text: "Pela política de trabalho híbrido (atualizada em 02/10), são até 3 dias por semana, combinados com o seu gestor." },
      ],
      judge: { reasoning: "Resposta correta e com fonte citada." },
    },
    {
      id: "DOC-6598",
      title: "Deploy em sexta-feira",
      channel: "Slack",
      at: 75,
      verdict: "partial",
      score: 0.55,
      category: "Resposta incompleta",
      latency: 2700,
      tokens: 2100,
      turns: [
        { role: "user", text: "Posso fazer deploy na sexta?" },
        { role: "agent", text: "Deploys às sextas são proibidos.", flag: "são proibidos" },
      ],
      judge: {
        reasoning: "A política permite deploys até 14h às sextas, com aprovação do on-call.",
        expected: "Citar a exceção e a regra de aprovação.",
        severity: "Baixa",
      },
    },
  ],
  pixel: [
    {
      id: "MOD-202211",
      title: "Avaliação com gíria regional",
      channel: "API interna",
      at: 6,
      verdict: "correct",
      score: 0.93,
      latency: 590,
      tokens: 310,
      turns: [
        { role: "user", text: "Avaliação: “Produto massa demais, chegou rapidinho, bah!”" },
        { role: "agent", text: "decisão: aprovar · toxicidade: 0,02 · spam: 0,01" },
      ],
      judge: { reasoning: "Correto — gírias regionais não foram tratadas como ofensa." },
    },
    {
      id: "MOD-202190",
      title: "Avaliação com link externo",
      channel: "API interna",
      at: 22,
      verdict: "correct",
      score: 0.97,
      latency: 610,
      tokens: 290,
      turns: [
        { role: "user", text: "Avaliação: “Comprei mais barato em promo-ofertas.xyz, confiram!”" },
        { role: "agent", text: "decisão: rejeitar · motivo: spam com link externo" },
      ],
      judge: { reasoning: "Correto." },
    },
  ],
  scout: [
    {
      id: "SDR-3120",
      title: "Primeiro contato — rede de academias",
      channel: "E-mail",
      at: 58,
      verdict: "correct",
      score: 0.9,
      latency: 5400,
      tokens: 7300,
      turns: [
        { role: "user", text: "(contexto) Rede com 42 unidades e expansão para o Nordeste anunciada em outubro." },
        { role: "tool", name: "pesquisar_empresa", args: 'segmento: "academias", unidades: 42', result: "42 unidades · expansão NE · vaga aberta de Head de Compras", ok: true, ms: 3100 },
        {
          role: "agent",
          text: "Olá, Carla! Vi que a rede vai abrir unidades no Nordeste — ajudamos operações em expansão a padronizar a compra de equipamentos com entrega regional. Faz sentido conversarmos 20 min na quinta?",
        },
      ],
      judge: { reasoning: "Mensagem personalizada, factual e dentro do tom da marca." },
    },
    {
      id: "SDR-3104",
      title: "Follow-up com lead frio",
      channel: "E-mail",
      at: 200,
      verdict: "partial",
      score: 0.6,
      category: "Alucinação factual",
      latency: 4800,
      tokens: 5100,
      turns: [
        { role: "user", text: "(contexto) Lead sem resposta há 9 dias." },
        { role: "agent", text: "Como conversamos na feira de São Paulo, queria retomar nossa conversa sobre…", flag: "Como conversamos na feira de São Paulo" },
      ],
      judge: {
        reasoning: "Não há registro de contato anterior com esse lead no CRM.",
        expected: "Não presumir interações que não estão registradas.",
        severity: "Média",
      },
    },
  ],
};

/** Visão agregada de modos de falha (ponderada pelo volume de falhas de cada agente). */
export function aggregateFailureModes() {
  const totals = new Map<string, number>();
  let sum = 0;
  for (const a of AGENTS) {
    const failures = a.m.volume * (1 - a.m.accuracy / 100);
    for (const f of a.failureModes) {
      const v = (failures * f.share) / 100;
      totals.set(f.label, (totals.get(f.label) ?? 0) + v);
      sum += v;
    }
  }
  return Array.from(totals.entries())
    .map(([label, v]) => ({ label, share: (v / sum) * 100, count: v }))
    .sort((a, b) => b.share - a.share);
}

/** Indicadores da frota — média simples por agente; custo ponderado pelo volume de conversas. */
export function fleetSummary(list: Agent[] = AGENTS) {
  const n = list.length || 1;
  const avg = (f: (a: Agent) => number) => list.reduce((s, a) => s + f(a), 0) / n;
  const volume = list.reduce((s, a) => s + a.m.volume, 0);
  const spend = list.reduce((s, a) => s + a.m.cost * a.m.volume, 0);
  const count = (s: Status) => list.filter((a) => a.status === s).length;
  return {
    total: list.length,
    offTarget: list.filter((a) => a.status !== "ok").length,
    counts: { crit: count("crit"), serious: count("serious"), warn: count("warn"), ok: count("ok") },
    accuracy: avg((a) => a.m.accuracy),
    accuracyDelta: avg((a) => a.d.accuracy),
    resolution: avg((a) => a.m.resolution),
    resolutionDelta: avg((a) => a.d.resolution),
    hallucination: avg((a) => a.m.hallucination),
    hallucinationDelta: avg((a) => a.d.hallucination),
    volume,
    spend,
    spendDelta: spend ? list.reduce((s, a) => s + a.m.cost * a.m.volume * a.d.cost, 0) / spend : 0,
    costPerConversation: volume ? spend / volume : 0,
  };
}
