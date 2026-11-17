import { AGENTS, TRACES, VERDICT_META, type Agent } from "@/lib/data/agents";
import { RESOURCES, resourceById, type Resource } from "@/lib/data/infra";
import { AI_COST_BY_PROJECT } from "@/lib/data/overview";
import { projectById } from "@/lib/data/projects";
import { FIELDS, parseNaturalQuery, runQuery } from "@/lib/data/explorer";
import { fmtBRL, fmtDec, fmtInt, fmtMs, fmtPct } from "@/lib/format";
import type { Status } from "@/lib/types";
import { normalize } from "@/lib/utils";

export type Block =
  | { t: "text"; text: string }
  | { t: "bullets"; items: string[] }
  | { t: "evidence"; items: { label: string; value: string; status: Status }[] }
  | { t: "links"; items: { label: string; href: string }[] }
  | { t: "actions"; items: { label: string; toast: string; primary?: boolean }[] }
  | { t: "results"; items: { label: string; sub: string; value: string; status?: Status; marker?: string; href: string }[] };

export type Answer = { steps: string[]; blocks: Block[]; suggestions?: string[] };

export const DEFAULT_SUGGESTIONS = [
  "Por que a precisão do Aurora caiu?",
  "O que está saturando o Postgres do Atlas?",
  "Por que o Atlas Resolve resolve tão pouco?",
  "Resumo da operação para o standup",
];

export const GREETING: Answer = {
  steps: [],
  blocks: [
    {
      t: "text",
      text: "Boa tarde, Ana. Analisei **41 fontes** nos últimos 15 minutos: **3 itens** pioraram desde ontem e **2** já têm causa provável identificada.",
    },
    {
      t: "results",
      items: [
        { label: "Postgres do Atlas", sub: "94% das conexões em uso · SEV-1", value: "472/500", status: "crit", href: "/infraestrutura?recurso=atlas-pg-primary" },
        { label: "Aurora", sub: "Precisão 11,2 pts abaixo da linha de base", value: "81,8%", status: "crit", href: "/agentes/aurora" },
        { label: "Checkout da Vega", sub: "Erros 5xx no provedor de pagamentos", value: "2,1%", status: "serious", href: "/incidentes?id=INC-2479" },
      ],
    },
  ],
  suggestions: DEFAULT_SUGGESTIONS,
};

const agentMetricFmt = (key: string, v: number) => {
  switch (key) {
    case "latency":
      return fmtMs(v);
    case "cost":
      return fmtBRL(v, v < 0.1 ? 3 : 2);
    case "csat":
      return fmtDec(v, 1);
    case "volume":
      return fmtInt(v);
    default:
      return fmtPct(v, 1);
  }
};

const infraMetricFmt = (key: string, r: Resource) => {
  switch (key) {
    case "cpu":
      return fmtPct(r.cpu, 0);
    case "memory":
      return fmtPct(r.memory, 0);
    case "errors":
      return fmtPct(r.errorRate, 2);
    case "cost":
      return `${fmtBRL(r.cost, 0)}/mês`;
    default:
      return r.latency !== undefined ? fmtMs(r.latency) : "—";
  }
};

function affectedAgents(): Answer {
  const rows = AGENTS.map((a) => ({
    a,
    bad: a.dependsOn.map((id) => resourceById(id)).filter((r): r is Resource => !!r && r.status !== "ok"),
  })).filter((x) => x.bad.length);
  return {
    steps: ["Cruzou dependências de 12 agentes com 28 recursos", "Filtrou recursos com status diferente de operacional"],
    blocks: [
      {
        t: "text",
        text: `**${rows.length} agentes** dependem de pelo menos um recurso com problema agora. O impacto maior está no Atlas, onde o Postgres e a API de tickets afetam o **Aurora** e o **Atlas Resolve**.`,
      },
      {
        t: "results",
        items: rows.map(({ a, bad }) => ({
          label: a.name,
          sub: bad.map((r) => r.id).join(" · "),
          value: `${bad.length} ${bad.length === 1 ? "recurso" : "recursos"}`,
          status: a.status,
          href: `/agentes/${a.id}`,
        })),
      },
    ],
    suggestions: ["O que está saturando o Postgres do Atlas?", "Resumo da operação para o standup"],
  };
}

function genericAnswer(text: string): Answer {
  const parsed = parseNaturalQuery(text);
  if (!parsed.conditions.length) {
    return {
      steps: ["Interpretou a pergunta"],
      blocks: [
        {
          t: "text",
          text: "Ainda não sei responder isso neste protótipo. Posso explicar quedas de qualidade dos agentes, saturação da infraestrutura e responder filtros como “agentes com precisão abaixo de 90%” ou “bancos de produção com latência acima de 300 ms”.",
        },
      ],
      suggestions: DEFAULT_SUGGESTIONS,
    };
  }
  const rows = runQuery(parsed);
  const numeric = parsed.conditions.find((c) => typeof c.value === "number");
  const metricKey = numeric?.field ?? (parsed.source === "agents" ? "accuracy" : "latency");
  const metricLabel = FIELDS[parsed.source].find((f) => f.key === metricKey)?.label ?? "";
  const items = rows.slice(0, 6).map((row) => {
    if (parsed.source === "agents") {
      const a = row as Agent;
      return {
        label: a.name,
        sub: `${projectById(a.project)?.name} · ${a.role}`,
        value: agentMetricFmt(metricKey, a.m[metricKey as keyof Agent["m"]] ?? a.m.accuracy),
        status: a.status,
        href: `/agentes/${a.id}`,
      };
    }
    const r = row as Resource;
    return {
      label: r.id,
      sub: `${projectById(r.project)?.name} · ${r.label}`,
      value: infraMetricFmt(metricKey, r),
      status: r.status,
      href: `/infraestrutura?recurso=${r.id}`,
    };
  });
  const noun = parsed.source === "agents" ? (rows.length === 1 ? "agente" : "agentes") : rows.length === 1 ? "recurso" : "recursos";
  return {
    steps: [`Interpretou: ${parsed.understood.join(" · ")}`, `Consultou ${parsed.source === "agents" ? AGENTS.length + " agentes" : RESOURCES.length + " recursos"}`],
    blocks: [
      {
        t: "text",
        text: rows.length
          ? `Encontrei **${rows.length} ${noun}**${metricLabel ? ` — ordenados como no catálogo, com ${metricLabel.toLowerCase()} em destaque` : ""}.`
          : "Nenhum resultado corresponde a esses critérios agora — boa notícia.",
      },
      ...(items.length ? [{ t: "results" as const, items }] : []),
      { t: "links", items: [{ label: "Abrir no Explorar", href: `/explorar?q=${encodeURIComponent(text)}` }] },
    ],
  };
}

export function answerFor(raw: string): Answer {
  const t = normalize(raw);

  // Comparações explícitas (“precisão abaixo de 90%”) viram consulta estruturada.
  if (parseNaturalQuery(raw).conditions.some((c) => typeof c.value === "number")) return genericAnswer(raw);

  if (/conversas?.{0,14}(afetad|incorret|errad)|mostre conversas|exemplos? de (conversa|resposta)/.test(t)) {
    const traces = (TRACES.aurora ?? []).filter((x) => x.verdict !== "correct");
    return {
      steps: ["Buscou conversas avaliadas do Aurora nas últimas 24 h", "Ordenou por severidade do juiz"],
      blocks: [
        { t: "text", text: "Estas são as conversas mais recentes que o juiz automático marcou como incorretas ou parciais:" },
        {
          t: "results",
          items: traces.map((x) => ({
            label: x.title,
            sub: `${x.id} · ${x.category ?? "Sem categoria"}`,
            value: VERDICT_META[x.verdict].label,
            status: VERDICT_META[x.verdict].status,
            href: "/agentes/aurora#conversas",
          })),
        },
        {
          t: "text",
          text: "Padrão em comum: o trecho recuperado vem de **politica_trocas_v6.md**, arquivada em 01/11. Estimo ≈ **3,4 mil** respostas incorretas por dia com esse padrão.",
        },
      ],
      suggestions: ["Outros agentes usam esse índice?", "Por que a precisão do Aurora caiu?"],
    };
  }

  if (/indice|qdrant|base de conhecimento|usam (esse|o|a) /.test(t)) {
    const users = AGENTS.filter((a) => a.dependsOn.includes("atlas-qdrant-kb"));
    return {
      steps: ["Consultou o grafo de dependências do atlas-qdrant-kb"],
      blocks: [
        {
          t: "text",
          text: `Sim — **${users.length} agentes** recuperam documentos do **atlas-qdrant-kb**. O Atlas Resolve usa só a coleção “procedimentos”, que foi indexada por completo, então o impacto nele é baixo.`,
        },
        {
          t: "results",
          items: users.map((a) => ({
            label: a.name,
            sub: a.role,
            value: fmtPct(a.m.accuracy, 1),
            status: a.status,
            href: `/agentes/${a.id}`,
          })),
        },
        { t: "links", items: [{ label: "atlas-qdrant-kb", href: "/infraestrutura?recurso=atlas-qdrant-kb" }] },
      ],
    };
  }

  if (/afetad|impacto|impactad/.test(t)) return affectedAgents();

  if (/aurora|precis/.test(t)) {
    return {
      steps: [
        "Consultou a avaliação contínua do Aurora · 1.200 conversas",
        "Comparou as versões v2.3.2 e v2.4.0",
        "Cruzou a queda com mudanças no atlas-qdrant-kb",
      ],
      blocks: [
        {
          t: "text",
          text: "A precisão do **Aurora** caiu de **93,0%** para **81,8%** logo após o deploy **v2.4.0** (12/11, 16:20), que trocou o prompt de sistema e passou a usar o índice **KB v14**.",
        },
        {
          t: "evidence",
          items: [
            { label: "Precisão", value: "81,8% · meta 90%", status: "crit" },
            { label: "Informação desatualizada", value: "41% das falhas · +29 pts", status: "serious" },
            { label: "Recall@5 do índice", value: "0,71 · antes 0,93", status: "crit" },
          ],
        },
        {
          t: "text",
          text: "Causa provável (confiança de **91%**): a reindexação do **atlas-qdrant-kb** deixou 1.284 documentos da coleção “políticas” de fora. Sem a versão vigente, o agente recupera a política de trocas **v6**, arquivada — por isso promete reembolso em 30 dias.",
        },
        {
          t: "text",
          text: "O canário com a v2.3.2 manteve **92,4%** de precisão em 1.920 conversas. Recomendo reverter 100% do tráfego e reindexar a coleção antes de reativar a v2.4.0.",
        },
        {
          t: "actions",
          items: [
            { label: "Reverter para v2.3.2", toast: "Rollback do Aurora para v2.3.2 iniciado", primary: true },
            { label: "Reindexar “políticas”", toast: "Reindexação agendada com chunking de 2 KB" },
          ],
        },
        {
          t: "links",
          items: [
            { label: "Abrir Aurora", href: "/agentes/aurora" },
            { label: "INC-2480", href: "/incidentes?id=INC-2480" },
            { label: "atlas-qdrant-kb", href: "/infraestrutura?recurso=atlas-qdrant-kb" },
          ],
        },
      ],
      suggestions: ["Mostre conversas afetadas", "Outros agentes usam esse índice?"],
    };
  }

  if (/postgres|banco|conex|atlas-pg|saturad/.test(t)) {
    return {
      steps: ["Leu métricas do atlas-pg-primary · últimas 3 h", "Agrupou conexões por serviço de origem", "Correlacionou com deploys recentes"],
      blocks: [
        {
          t: "text",
          text: "O **atlas-pg-primary** está com **472 de 500** conexões (94%) desde as **13:58**. A latência p95 subiu de 82 ms para **412 ms**.",
        },
        {
          t: "evidence",
          items: [
            { label: "Conexões em uso", value: "94% · 472 de 500", status: "crit" },
            { label: "Latência p95", value: "412 ms · base 82 ms", status: "crit" },
            { label: "Origem: atlas-api-tickets", value: "61% das conexões", status: "serious" },
          ],
        },
        {
          t: "text",
          text: "O aumento começou 17 min depois do deploy **atlas-api-tickets v2.18.0**, que removeu o reuso de conexões no worker de SLA. O hotfix **v2.18.1** está em canário com 10% do tráfego, sem regressão.",
        },
        {
          t: "bullets",
          items: [
            "Promover o hotfix v2.18.1 para 50% e, sem regressão, para 100%",
            "Habilitar PgBouncer em modo transaction para absorver picos",
            "Criar índice em tickets(status, updated_at) — reduz 38% do tempo das queries lentas",
          ],
        },
        {
          t: "actions",
          items: [
            { label: "Promover v2.18.1 para 50%", toast: "Canário do v2.18.1 promovido para 50%", primary: true },
            { label: "Habilitar PgBouncer", toast: "Mudança de configuração enviada para aprovação" },
          ],
        },
        {
          t: "links",
          items: [
            { label: "atlas-pg-primary", href: "/infraestrutura?recurso=atlas-pg-primary" },
            { label: "INC-2481", href: "/incidentes?id=INC-2481" },
          ],
        },
      ],
      suggestions: ["Quais agentes são afetados?", "Resumo da operação para o standup"],
    };
  }

  if (/resolu|resolve|chamado/.test(t)) {
    return {
      steps: ["Analisou 9.870 chamados do Atlas Resolve · 24 h", "Rastreou chamadas de ferramentas com falha"],
      blocks: [
        {
          t: "text",
          text: "O **Atlas Resolve** resolve **58,2%** dos chamados N1 — a meta é 75%. A queda começou há 6 dias e piorou com o INC-2481.",
        },
        {
          t: "evidence",
          items: [
            { label: "Taxa de resolução", value: "58,2% · meta 75%", status: "serious" },
            { label: "Timeouts em consultar_pedido", value: "17% das chamadas", status: "crit" },
            { label: "Escalonamento", value: "38,4% · +4,9 pts", status: "serious" },
          ],
        },
        {
          t: "text",
          text: "Quando **consultar_pedido** expira, o agente escala o chamado em vez de usar **rastrear_envio**, que não está descrita no prompt. Isso gera ≈ **1,6 mil** escalonamentos extras por dia.",
        },
        {
          t: "bullets",
          items: [
            "Adicionar rastrear_envio como fallback no prompt",
            "Aumentar o timeout de consultar_pedido para 8 s enquanto o INC-2481 estiver aberto",
            "Ler da réplica atlas-pg-replica-1 — o lag atual de 2,8 s é aceitável",
          ],
        },
        { t: "actions", items: [{ label: "Abrir PR com o fallback", toast: "PR #482 aberto no repositório atlas-agents", primary: true }] },
        {
          t: "links",
          items: [
            { label: "Abrir Atlas Resolve", href: "/agentes/atlas-resolve" },
            { label: "INC-2477", href: "/incidentes?id=INC-2477" },
          ],
        },
      ],
      suggestions: ["Quais agentes são afetados?", "Por que a precisão do Aurora caiu?"],
    };
  }

  if (/standup|resum|hoje|aconteceu|status geral|panorama/.test(t)) {
    return {
      steps: ["Reuniu 7 incidentes ativos e 9 recursos com alerta", "Comparou com as 24 h anteriores"],
      blocks: [
        { t: "text", text: "Resumo das últimas 24 horas — saúde geral **84** (−5 pts vs. ontem):" },
        {
          t: "bullets",
          items: [
            "**SEV-1 · Atlas:** Postgres com 94% das conexões após o deploy da API de tickets. Hotfix em canário.",
            "**SEV-2 · Aurora:** precisão em 81,8% (meta 90%) por documentos faltando no índice. Rollback recomendado.",
            "**SEV-2 · Vega:** 2,1% de erros no checkout por timeouts no provedor de pagamentos; 30% do tráfego já no secundário.",
            "**SEV-3:** lag de 1,2 mi mensagens no Kafka do Nimbus, Redis do Orion com 89% de memória e Atlas Resolve abaixo da meta.",
            "**Boas notícias:** Vega Shopper com +18,5% de volume e precisão estável; Orion Analyst em 96,4%.",
          ],
        },
        {
          t: "actions",
          items: [
            { label: "Copiar resumo", toast: "Resumo copiado", primary: true },
            { label: "Enviar no Slack", toast: "Envio para o Slack disponível na versão conectada" },
          ],
        },
      ],
      suggestions: ["Quais agentes são afetados?", "Quanto gastamos com IA hoje?"],
    };
  }

  if (/custo|gasto|gastamos|token|caro/.test(t)) {
    const total = AI_COST_BY_PROJECT.reduce((s, x) => s + x.value, 0);
    return {
      steps: ["Somou tokens, inferência própria e ferramentas · 24 h"],
      blocks: [
        {
          t: "text",
          text: `O custo de IA nas últimas 24 h foi **${fmtBRL(total, 0)}** (+6,2%). O Atlas responde por **${fmtDec((AI_COST_BY_PROJECT[0].value / total) * 100, 0)}%** do total.`,
        },
        {
          t: "results",
          items: AI_COST_BY_PROJECT.map((x) => {
            const p = projectById(x.project)!;
            return {
              label: p.name,
              sub: `${p.area} · ${fmtDec((x.value / total) * 100, 0)}% do total`,
              value: fmtBRL(x.value, 0),
              marker: p.color,
              href: `/projetos/${p.id}`,
            };
          }),
        },
        {
          t: "text",
          text: "O maior aumento vem do **Aurora** (+12% por conversa): o prompt da v2.4.0 é 38% mais longo. Reverter para a v2.3.2 também economiza ≈ R$ 1,1 mil por dia.",
        },
      ],
    };
  }

  return genericAnswer(raw);
}
