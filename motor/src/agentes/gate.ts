/**
 * Gate de publicação de agente. Chamado pelo hook workflow.activate do n8n (via meraki servir) ou, no plano B,
 * pelo PreToolUse das tools do MCP que publicam. Decide em ordem:
 *   1. pacote agente na versão candidata — A02, A03 e A10 barram (só o que a versão introduz);
 *   2. rodada aprovada para o hash — sem rodada, nega e já pede uma; com rodada, AV1 e AV2 barram.
 * O gate não espera a rodada: quem tentou recebe o motivo e tenta de novo quando ela terminar.
 * Exceção ativa (excecoes, com motivo e validade) libera uma correção urgente e fica registrada.
 */
import { chave } from "../chaves.ts";
import type { VersaoN8n, WorkflowN8n } from "../coletores/n8n.ts";
import { contratoVazio } from "../contrato/esquema.ts";
import { plataforma, transacao } from "../plataforma/db.ts";
import { type Projeto, carregarGrafo, excecoesAtivas, projetoPorSlug } from "../plataforma/repositorio.ts";
import { carregarParser } from "../sql/parser.ts";
import { montarIntencao } from "../verificacao.ts";
import { agentesDaVersao, avaliarCandidata, comoPublicado, grafoCandidato } from "./candidata.ts";
import { carregarEstadoAgentes, ultimaRodada } from "./estado.ts";
import { registrarPublicacao } from "./publicacoes.ts";
import { pedirRodada } from "./rodadas.ts";

export interface PedidoDePublicacao {
  workflow: WorkflowN8n;
  /** Versão que vai ao ar. Sem ela, o rascunho (nodes e conexões) do workflow. */
  versao?: VersaoN8n;
  /**
   * O rascunho atual, quando quem chama leu (plano B lê pela API). Sem ele, vale o da última coleta: o hook do
   * n8n manda só a versão que vai ao ar (nodes do candidato já são os dela).
   */
  rascunho?: VersaoN8n;
  projeto?: string;
  origem: "n8n" | "claude-code";
  ferramenta: string;
  sessao?: string | null;
  modo?: "autonomo" | "pergunta";
}

export interface AgenteNaDecisao {
  chave: string;
  nome: string;
  hash: string;
  regras: string[];
  motivos: string[];
  rodada?: string;
}

export interface DecisaoDePublicacao {
  decisao: "permitiu" | "perguntou" | "negou";
  motivo: string | null;
  projeto: string | null;
  agentes: AgenteNaDecisao[];
  duracaoMs: number;
}

/** Projeto dono do workflow: pelo objeto coletado ou, se ainda não coletado, pela tag da fonte n8n. */
export async function projetoDoWorkflow(w: Pick<WorkflowN8n, "id" | "tags">): Promise<Projeto | null> {
  const porObjeto = (
    await plataforma().query(
      `select p.id, p.conta_id, p.slug, p.nome from public.objetos o join public.fontes f on f.id = o.fonte_id join public.projetos p on p.id = f.projeto_id
        where o.chave = $1 and o.removido_em is null and f.ativa limit 1`,
      [chave.workflow(w.id)],
    )
  ).rows[0];
  if (porObjeto) return porObjeto;
  const tags = (w.tags ?? []).map((t) => (typeof t === "string" ? t : t.name));
  if (!tags.length) return null;
  const porTag = (
    await plataforma().query(
      `select p.id, p.conta_id, p.slug, p.nome from public.fontes f join public.projetos p on p.id = f.projeto_id
        where f.tipo = 'n8n' and f.ativa and f.config ->> 'tag' = any($1) limit 1`,
      [tags],
    )
  ).rows[0];
  return porTag ?? null;
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

export async function decidirPublicacao(p: PedidoDePublicacao, agora = new Date()): Promise<DecisaoDePublicacao> {
  const t0 = performance.now();
  const fim = (d: Omit<DecisaoDePublicacao, "duracaoMs">): DecisaoDePublicacao => ({ ...d, duracaoMs: Math.round(performance.now() - t0) });
  const projeto = p.projeto ? await projetoPorSlug(p.projeto) : await projetoDoWorkflow(p.workflow);
  if (!projeto) return fim({ decisao: "permitiu", motivo: null, projeto: null, agentes: [] });

  // O hash da versão inclui os alvos das tools, que saem do SQL delas: sem o parser, o hash seria outro.
  await carregarParser();
  const grafo = await carregarGrafo(projeto.id);
  const fonteId =
    grafo.get(chave.workflow(p.workflow.id))?.fonteId ?? [...grafo.fontes.values()].find((f) => f.tipo === "n8n")?.id;
  if (!fonteId) return fim({ decisao: "permitiu", motivo: null, projeto: projeto.slug, agentes: [] });
  const { contrato, intencao } = await montarIntencao(projeto, grafo);
  const excecoes = await excecoesAtivas(projeto.id);
  const estado = await carregarEstadoAgentes(projeto.id);
  const cand = grafoCandidato(grafo, fonteId, comoPublicado(p.workflow, p.versao), estado, agora);
  const agentes = cand.agentes.filter((a) => !a.atributos.desativado);
  if (!agentes.length) return fim({ decisao: "permitiu", motivo: null, projeto: projeto.slug, agentes: [] });

  const achados = avaliarCandidata({ grafo, contrato: contrato?.conteudo ?? contratoVazio(projeto.slug), excecoes, estado }, cand, agora);
  // A avaliação do n8n roda o rascunho. Versão que vai ao ar pelo histórico (versionId diferente do rascunho) só
  // tem como rodar se o agente nela for igual ao do rascunho; senão a rodada pedida só daria erro.
  const doHistorico = Boolean(p.versao?.versionId && p.workflow.versionId && p.versao.versionId !== p.workflow.versionId);
  const lidosNoRascunho = new Map(p.rascunho ? agentesDaVersao(p.workflow, p.rascunho).map((x) => [chave.agente(p.workflow.id, x.config.node), x.hash]) : []);
  const hashNoRascunho = (k: string): string | null =>
    p.rascunho ? (lidosNoRascunho.get(k) ?? null) : ((grafo.get(k)?.atributos.rascunho_versao as string | null | undefined) ?? null);
  const decisoes: AgenteNaDecisao[] = [];
  for (const a of agentes) {
    const hash = String(a.atributos.versao);
    const d: AgenteNaDecisao = { chave: a.chave, nome: a.nome, hash, regras: [], motivos: [] };
    decisoes.push(d);
    for (const v of achados.bloqueantes.filter((x) => x.objeto === a.chave)) {
      d.regras.push(v.regra);
      d.motivos.push(`${v.regra}: ${v.titulo}.${v.detalhe ? ` ${v.detalhe}` : ""}`);
    }

    const declarado = intencao.agenteDe(a.chave);
    const publicada = (grafo.get(a.chave)?.atributos.versao as string | null) ?? null;
    // A versão que já está no ar de novo (o n8n chama o hook até numa mudança só de configurações): nada de
    // comportamento novo vai ao ar, então a rodada não barra. A dívida dela segue nos achados (AV1–AV3).
    if (publicada === hash) continue;
    const casos = estado.casos.filter((c) => c.agente === a.chave && c.ativo);
    if (!casos.length) continue; // sem casos não há o que rodar: a AV3 acusa depois da publicação
    const rodada = ultimaRodada(estado, a.chave, hash);
    if (!rodada) {
      const andando = estado.rodadas.find((r) => r.agente === a.chave && r.hash === hash && (r.status === "pedida" || r.status === "rodando"));
      if (!andando && doHistorico && hashNoRascunho(a.chave) !== hash) {
        d.regras.push("AV3");
        d.motivos.push(
          `a versão ${hash} vai ao ar pelo histórico (não é o rascunho) e nunca rodou contra os ${casos.length} casos de referência. A avaliação do n8n só roda o rascunho: restaure essa versão no rascunho e publique por ele (o gate pede a rodada).`,
        );
        continue;
      }
      const id = andando?.id ?? (await pedirRodada(projeto, a.chave, hash, "gate", `gate (${p.origem})`)).id;
      d.rodada = id;
      d.regras.push("AV3");
      d.motivos.push(
        `a versão ${hash} ainda não rodou contra os ${casos.length} casos de referência. A rodada ${id.slice(0, 8)} ${andando ? "já está na fila" : "foi pedida agora"}; publique de novo quando ela terminar (alguns minutos).`,
      );
      continue;
    }
    d.rodada = rodada.id;
    if (rodada.criticosFalhos.length && !intencao.excecao("AV1", [a.chave], agora)) {
      d.regras.push("AV1");
      d.motivos.push(`AV1: caso crítico falhou na versão ${hash}: ${rodada.criticosFalhos.slice(0, 4).join(", ")}${rodada.criticosFalhos.length > 4 ? "…" : ""}.`);
    }
    const minima = declarado?.config.metas.aprovacao_minima ?? 0.9;
    if (rodada.aprovacao !== null && rodada.aprovacao < minima && !intencao.excecao("AV2", [a.chave], agora)) {
      d.regras.push("AV2");
      d.motivos.push(`AV2: aprovação de ${pct(rodada.aprovacao)} abaixo da mínima do contrato (${pct(minima)}).`);
    }
    if (publicada && rodada.aprovacao !== null) {
      const rp = ultimaRodada(estado, a.chave, publicada);
      const limite = declarado?.config.metas.queda_maxima_pts ?? 5;
      if (rp?.aprovacao != null && (rp.aprovacao - rodada.aprovacao) * 100 > limite && !intencao.excecao("AV2", [a.chave], agora) && !d.regras.includes("AV2")) {
        d.regras.push("AV2");
        d.motivos.push(`AV2: aprovação caiu de ${pct(rp.aprovacao)} (versão ${publicada}) para ${pct(rodada.aprovacao)} (limite ${limite} pts).`);
      }
    }
  }

  const barrados = decisoes.filter((d) => d.motivos.length);
  const decisao = barrados.length ? (p.modo === "pergunta" ? "perguntou" : "negou") : "permitiu";
  const motivo = barrados.length
    ? `Meraki: publicação de "${p.workflow.name}" barrada. ${barrados
        .map((d) => `Agente "${d.nome}" (versão ${d.hash}): ${d.motivos.join(" ")}`)
        .join(" ")} Corrija na tela do agente ou peça exceção com motivo e validade.`
    : null;

  await transacao(async (c) => {
    if (decisao === "permitiu") {
      // O que vai ao ar: a versão pedida ou o rascunho (o activeVersionId do workflow ainda é o que está saindo).
      const versionId = p.versao?.versionId ?? p.workflow.versionId ?? null;
      for (const d of decisoes) await registrarPublicacao(c, projeto, d.chave, d.hash, agora, "hook", { versionId });
    }
    await c.query(
      `insert into public.gate_eventos (conta_id, projeto_id, criado_em, origem, sessao, ferramenta, modo, resumo, decisao, regras, motivo, duracao_ms)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        projeto.conta_id, projeto.id, agora, p.origem, p.sessao ?? null, p.ferramenta, p.modo ?? "autonomo",
        `publicar ${p.workflow.name} · ${decisoes.map((d) => `${d.nome} v${d.hash}`).join(", ")}`.slice(0, 500),
        decisao, [...new Set(decisoes.flatMap((d) => d.regras))], motivo, Math.round(performance.now() - t0),
      ],
    );
  });
  return fim({ decisao, motivo, projeto: projeto.slug, agentes: decisoes });
}
