/**
 * Rodadas de avaliação: os casos ativos de um agente contra uma versão (hash). O motor pega as rodadas
 * pedidas (tela, gate ou publicação vista na coleta), roda no n8n e grava caso a caso.
 *
 * Executores:
 *   n8n      API pública de avaliação (POST /workflows/{id}/test-runs, depois test-runs/{id} e test-cases).
 *            Roda o RASCUNHO do workflow (o n8n lê o workflow salvo, não a versão publicada), então só a versão
 *            que está no rascunho dá para avaliar; a execução de cada caso diz a versão que rodou de fato.
 *            O workflow do agente tem Evaluation Trigger, Check If Evaluating e Set Outputs (caso, resposta, tools).
 *   simulado só desenvolvimento: fonte com config.ensaio aponta para a pasta com simulador.json.
 *
 * As checagens são do motor e determinísticas (checagens.ts). Nota de juiz vem do n8n e só informa.
 * Ensaio não toca o mundo real: quem garante é o workflow (Check If Evaluating) e o parâmetro de ensaio das
 * funções de escrita (A10). O motor nunca envia mensagem nem grava no banco do cliente.
 */
import { setTimeout as esperar } from "node:timers/promises";
import type { ConfigAgente, VersaoN8n, WorkflowN8n } from "../coletores/n8n.ts";
import { apiN8n, lerVersaoViaApi } from "../coletores/n8n.ts";
import type { Contrato } from "../contrato/esquema.ts";
import type { Grafo } from "../grafo.ts";
import { plataforma, transacao } from "../plataforma/db.ts";
import { type Projeto, carregarGrafo, contratoAtual } from "../plataforma/repositorio.ts";
import { carregarParser } from "../sql/parser.ts";
import { RAIZ } from "../util/raiz.ts";
import { agentesDaVersao } from "./candidata.ts";
import { type ChamadaDeTool, type Checagem, type EntradaDoCaso, type Espera, type Politicas, type SaidaDoCaso, checarCaso, normalizar } from "./checagens.ts";
import { agenteNoContrato, chaveDaTabela, fonteDoAgente, lerWorkflow, workflowENode } from "./comum.ts";
import { lerSimulador, simularCaso } from "./simulador.ts";

export interface CasoDaRodada {
  id: string;
  slug: string;
  criticidade: "critico" | "normal";
  hash: string;
  entrada: EntradaDoCaso;
  espera: Espera;
  rubrica: string | null;
}

export interface SaidaExecutada extends SaidaDoCaso {
  duracao_ms: number | null;
  juiz: Record<string, unknown> | null;
  /** O caso não chegou ao fim no executor (erro ou cancelado): falha sem checar a resposta. */
  erro?: string;
}

export interface ResultadoDaRodada {
  id: string;
  projetoId: string;
  agente: string;
  hash: string;
  status: "concluida" | "erro";
  executor: string | null;
  casos: number;
  passaram: number;
  aprovacao: number | null;
  criticosFalhos: string[];
  aprovada: boolean | null;
  erro?: string;
}

interface RodadaPedida {
  id: string;
  conta_id: string;
  projeto_id: string;
  agente: string;
  hash: string;
  motivo: string;
}

/** Pede rodada para um hash (idempotente: devolve a pedida/rodando que já existe). */
export async function pedirRodada(projeto: Pick<Projeto, "id" | "conta_id">, agente: string, hash: string, motivo: "gate" | "manual" | "publicacao", pedidaPor: string): Promise<{ id: string; nova: boolean }> {
  return transacao(async (c) => {
    await c.query("select pg_advisory_xact_lock(hashtext($1))", [`rodada:${projeto.id}:${agente}:${hash}`]);
    const pendente = async () =>
      (await c.query("select id from public.rodadas where projeto_id = $1 and agente = $2 and hash = $3 and status in ('pedida', 'rodando') limit 1", [projeto.id, agente, hash]))
        .rows[0] as { id: string } | undefined;
    const existente = await pendente();
    if (existente) return { id: existente.id, nova: false };
    // A coleta pede sem este lock: o índice único de rodada pendente desempata, e quem perde recebe a outra.
    const r = await c.query(
      `insert into public.rodadas (conta_id, projeto_id, agente, hash, motivo, status, pedida_por) values ($1, $2, $3, $4, $5, 'pedida', $6)
       on conflict (projeto_id, agente, hash) where status in ('pedida', 'rodando') do nothing returning id`,
      [projeto.conta_id, projeto.id, agente, hash, motivo, pedidaPor],
    );
    if (r.rows[0]) return { id: r.rows[0].id as string, nova: true };
    const outra = await pendente();
    if (!outra) throw new Error("rodada pendente sumiu durante o pedido; peça de novo");
    return { id: outra.id, nova: false };
  });
}

async function casosAtivos(projetoId: string, agente: string): Promise<CasoDaRodada[]> {
  const r = await plataforma().query(
    `select c.id, c.slug, c.criticidade, v.hash, v.entrada, v.espera, v.rubrica
       from public.casos c join public.caso_versoes v on v.caso_id = c.id and v.hash = c.hash_atual
      where c.projeto_id = $1 and c.agente = $2 and c.ativo
      order by c.slug`,
    [projetoId, agente],
  );
  return r.rows.map((x) => ({ id: x.id, slug: x.slug, criticidade: x.criticidade, hash: x.hash, entrada: x.entrada, espera: x.espera ?? {}, rubrica: x.rubrica }));
}

/** Tools que registram o repasse: escrevem (direto ou por função) na tabela do evento repasse do contrato. */
export function toolsDeRepasse(config: ConfigAgente, grafo: Grafo, tabela?: string): Set<string> {
  const alvoTabela = tabela ? chaveDaTabela(tabela) : null;
  const escreveNaTabela = (k: string, vistos = new Set<string>()): boolean => {
    if (!alvoTabela || vistos.has(k)) return false;
    vistos.add(k);
    if (k === alvoTabela) return true;
    if (grafo.saindo(k, "escreve").some((r) => r.destino === alvoTabela)) return true;
    return grafo.saindo(k, "chama").some((r) => escreveNaTabela(r.destino, vistos));
  };
  const resolver = (alvo: string) => (alvo.endsWith("(*)") ? [...grafo.objetos.keys()].filter((k) => k.startsWith(alvo.slice(0, -2))) : [alvo]);
  const nomes = new Set<string>();
  for (const t of config.tools) {
    if (t.desativada) continue;
    const pelaTabela = t.alvos.flatMap(resolver).some((k) => escreveNaTabela(k));
    const peloNome = !alvoTabela && /repass|transfer|humano|atendente/i.test(t.nome);
    if (pelaTabela || peloNome) nomes.add(normalizar(t.nome));
  }
  return nomes;
}

interface VersaoDaRodada {
  config: ConfigAgente;
  /** versionId do n8n onde o hash foi achado. */
  versionId: string | null;
  /** O hash está no rascunho: é o que a avaliação do n8n roda. */
  noRascunho: boolean;
}

/** A versão pedida, procurada no rascunho (o que a avaliação do n8n roda) e no publicado. */
function versaoPedida(w: WorkflowN8n, node: string, hash: string): VersaoDaRodada | null {
  const versoes: (VersaoN8n & { noRascunho: boolean })[] = [{ versionId: w.versionId, nodes: w.nodes ?? [], connections: w.connections ?? {}, noRascunho: true }];
  if (w.activeVersion?.nodes) versoes.push({ ...w.activeVersion, versionId: w.activeVersion.versionId ?? w.activeVersionId ?? undefined, noRascunho: false });
  for (const v of versoes) {
    const a = agentesDaVersao(w, v).find((x) => x.config.node === node);
    if (a?.hash === hash) return { config: a.config, versionId: v.versionId ?? null, noRascunho: v.noRascunho };
  }
  return null;
}

/** Hash do agente numa versão do n8n (para conferir o que a avaliação rodou de fato). */
function hashNaVersao(w: WorkflowN8n, v: VersaoN8n, node: string): string | null {
  return agentesDaVersao(w, v).find((x) => x.config.node === node)?.hash ?? null;
}

/* ─────────────────────── Executores ─────────────────────── */

async function executarSimulado(pasta: string, config: ConfigAgente, casos: CasoDaRodada[]): Promise<Map<string, SaidaExecutada>> {
  const sim = await lerSimulador(RAIZ, pasta);
  const saida = new Map<string, SaidaExecutada>();
  for (const c of casos) {
    const s = simularCaso(sim, config, c.slug);
    saida.set(c.slug, { resposta: s.resposta, tools: s.tools, repasse: null, duracao_ms: s.duracao_ms, juiz: null });
  }
  return saida;
}

const PRAZO_RODADA_MS = () => Number(process.env.MERAKI_RODADA_PRAZO_MS ?? 15 * 60_000);

function lerTools(v: unknown): ChamadaDeTool[] {
  let lista = v;
  if (typeof v === "string") {
    try {
      lista = JSON.parse(v);
    } catch {
      lista = v.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(lista)) return [];
  return lista.flatMap((t): ChamadaDeTool[] => {
    if (typeof t === "string") return [{ nome: t, argumentos: {} }];
    if (t && typeof t === "object") {
      const o = t as Record<string, unknown>;
      const nome = String(o.nome ?? o.name ?? o.tool ?? "");
      const args = (o.argumentos ?? o.args ?? o.input ?? o.toolInput ?? {}) as Record<string, unknown>;
      return nome ? [{ nome, argumentos: typeof args === "object" && args ? args : {} }] : [];
    }
    return [];
  });
}

/** Status HTTP de um erro da API do n8n (apiN8n escreve "HTTP nnn" na mensagem). */
const statusDoErro = (e: unknown) => Number(/HTTP (\d{3})/.exec(e instanceof Error ? e.message : String(e))?.[1] ?? 0);

/** Fim de uma rodada na API pública do n8n (new e running ainda andam). */
const TERMINAIS = new Set(["completed", "error", "cancelled"]);

/**
 * Confere pelas execuções dos casos que o n8n avaliou a versão pedida: o rascunho pode mudar entre a leitura e o
 * disparo. Outra versionId com o mesmo hash do agente vale (mudou só o que não é do agente). Execução já apagada
 * pela retenção do n8n não dá para conferir e fica de fora.
 */
async function conferirVersao(base: string, segredo: string, w: WorkflowN8n, node: string, pedida: VersaoDaRodada, hash: string, casos: Record<string, unknown>[]) {
  const execucoes = [...new Set(casos.map((c) => c.executionId).filter((x) => x !== null && x !== undefined).map(String))].slice(0, 3);
  const versoes = new Set<string>();
  for (const id of execucoes) {
    const e = await apiN8n<{ workflowVersionId?: string | null }>(base, segredo, `/executions/${encodeURIComponent(id)}`).catch(() => null);
    if (e?.workflowVersionId) versoes.add(e.workflowVersionId);
  }
  for (const v of versoes) {
    if (v === pedida.versionId) continue;
    const versao = await lerVersaoViaApi(base, segredo, w.id, v).catch((e: unknown) => {
      throw new Error(`não deu para conferir a versão que o n8n avaliou (versionId ${v}): ${e instanceof Error ? e.message : String(e)}`);
    });
    const rodou = hashNaVersao(w, versao, node);
    if (rodou !== hash) {
      throw new Error(`o n8n avaliou a versão ${rodou ?? "sem esse agente"} (versionId ${v}), não a ${hash} pedida: o rascunho mudou durante a rodada. Peça de novo`);
    }
  }
}

/**
 * Rodada no n8n pela API pública de avaliação (POST /workflows/{id}/test-runs). O n8n roda o rascunho do
 * workflow, então só a versão que está no rascunho dá para avaliar. Se a fonte tem config.casos_webhook (workflow
 * utilitário que grava a Data Table), os casos são publicados antes. Cada caso leva a sessão de memória própria
 * (ensaio:<caso>:<rodada>).
 */
async function executarNoN8n(
  rodada: RodadaPedida,
  fonte: { config: Record<string, unknown> },
  segredo: string,
  w: WorkflowN8n,
  node: string,
  pedida: VersaoDaRodada,
  casos: CasoDaRodada[],
): Promise<{ saidas: Map<string, SaidaExecutada>; n8nId: string }> {
  const base = String(fonte.config.url);
  const workflowId = w.id;
  if (!pedida.noRascunho) {
    throw new Error(
      `a avaliação do n8n roda o rascunho, e o rascunho de "${w.name}" já é outra versão; a ${rodada.hash} só existe publicada. Peça a rodada do rascunho atual ou restaure essa versão no rascunho`,
    );
  }
  const webhook = fonte.config.casos_webhook as string | undefined;
  if (webhook) {
    const resposta = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workflow: workflowId,
        rodada: rodada.id,
        casos: casos.map((c) => ({ caso: c.slug, sessao: `ensaio:${c.slug}:${rodada.id.slice(0, 8)}`, ensaio: true, ...c.entrada })),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resposta.ok) throw new Error(`workflow utilitário dos casos respondeu HTTP ${resposta.status}`);
  }
  const caminho = `/workflows/${encodeURIComponent(workflowId)}/test-runs`;
  let disparo: { id?: string; data?: { id?: string } };
  try {
    disparo = await apiN8n<{ id?: string; data?: { id?: string } }>(base, segredo, caminho, { metodo: "POST" });
  } catch (e) {
    const s = statusDoErro(e);
    if (s === 402) throw new Error("a licença do n8n não libera mais avaliações (HTTP 402): veja o limite de workflows com avaliação no plano");
    if (s === 409) throw new Error("o n8n já tem uma avaliação rodando neste workflow (HTTP 409): peça a rodada de novo quando ela terminar");
    if (s === 403) {
      throw new Error("a chave da API do n8n não pode disparar avaliação (HTTP 403): ela precisa dos escopos testRun:create, testRun:read e testRun:cancel e de permissão de executar no projeto do workflow");
    }
    throw e;
  }
  const n8nId = String(disparo.id ?? disparo.data?.id ?? "");
  if (!n8nId) throw new Error("o n8n não devolveu o id da rodada (POST test-runs)");
  await plataforma().query("update public.rodadas set n8n_id = $2 where id = $1", [rodada.id, n8nId]);

  const rodadaNoN8n = `${caminho}/${encodeURIComponent(n8nId)}`;
  const limite = Date.now() + PRAZO_RODADA_MS();
  let status = "";
  let codigo: string | null = null;
  while (Date.now() < limite) {
    const r = await apiN8n<{ status?: string; errorCode?: string | null; data?: { status?: string; errorCode?: string | null } }>(base, segredo, rodadaNoN8n);
    status = String(r.status ?? r.data?.status ?? "");
    codigo = r.errorCode ?? r.data?.errorCode ?? null;
    if (TERMINAIS.has(status)) break;
    await esperar(5_000);
  }
  if (!TERMINAIS.has(status)) {
    // Prazo esgotado: cancela no n8n para a avaliação não seguir sozinha.
    await apiN8n(base, segredo, `${rodadaNoN8n}/cancel`, { metodo: "POST" }).catch(() => undefined);
    throw new Error(`rodada ${n8nId} no n8n não terminou no prazo (status ${status || "desconhecido"}) e foi cancelada`);
  }
  if (status !== "completed") throw new Error(`rodada ${n8nId} no n8n terminou como "${status}"${codigo ? ` (${codigo})` : ""}`);

  // Casos da rodada, de página em página (até 250 por vez).
  const lista: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  do {
    const q = new URLSearchParams({ limit: "250" });
    if (cursor) q.set("cursor", cursor);
    const r = await apiN8n<unknown>(base, segredo, `${rodadaNoN8n}/test-cases?${q}`);
    lista.push(...((Array.isArray(r) ? r : ((r as { data?: unknown[] }).data ?? [])) as Record<string, unknown>[]));
    cursor = Array.isArray(r) ? null : ((r as { nextCursor?: string | null }).nextCursor ?? null);
  } while (cursor);
  await conferirVersao(base, segredo, w, node, pedida, rodada.hash, lista);

  const saidas = new Map<string, SaidaExecutada>();
  for (const tc of lista) {
    const outputs = (tc.outputs ?? tc.output ?? {}) as Record<string, unknown>;
    const inputs = (tc.inputs ?? tc.input ?? {}) as Record<string, unknown>;
    const slug = String(outputs.caso ?? inputs.caso ?? "");
    if (!slug) continue;
    const metricas = (tc.metrics ?? {}) as Record<string, unknown>;
    const juiz = Object.fromEntries(Object.entries(metricas).filter(([k]) => /correct|helpful|juiz/i.test(k)));
    const inicio = Date.parse(String(tc.runAt ?? tc.createdAt ?? ""));
    const fim = Date.parse(String(tc.completedAt ?? tc.updatedAt ?? ""));
    const estado = String(tc.status ?? "");
    saidas.set(slug, {
      resposta: String(outputs.resposta ?? outputs.output ?? ""),
      tools: lerTools(outputs.tools ?? metricas.toolsUsed),
      repasse: typeof outputs.repasse === "boolean" ? outputs.repasse : null,
      duracao_ms: Number.isFinite(inicio) && Number.isFinite(fim) ? fim - inicio : null,
      juiz: Object.keys(juiz).length ? juiz : null,
      ...((estado === "error" || estado === "cancelled") && {
        erro: `o caso ${estado === "error" ? "deu erro" : "foi cancelado"} no n8n${tc.errorCode ? ` (${String(tc.errorCode)})` : ""}`,
      }),
    });
  }
  return { saidas, n8nId };
}

/* ─────────────────────── Rodar ─────────────────────── */

function politicasDe(contrato: Contrato | undefined, agente: string): Politicas | undefined {
  const d = agenteNoContrato(contrato, agente);
  return d ? { proibidas: d.config.politicas.proibidas, max_caracteres: d.config.politicas.max_caracteres, max_perguntas: d.config.politicas.max_perguntas } : undefined;
}

async function executarRodada(r: RodadaPedida): Promise<ResultadoDaRodada> {
  const contrato = (await contratoAtual(r.projeto_id))?.conteudo;
  const declarado = agenteNoContrato(contrato, r.agente);
  const casos = await casosAtivos(r.projeto_id, r.agente);
  if (!casos.length) throw new Error("o agente não tem casos ativos");
  const { fonte, segredo } = await fonteDoAgente(r.projeto_id, r.agente);
  const { workflow, node } = workflowENode(r.agente);
  const w = await lerWorkflow(fonte, segredo, RAIZ, workflow);
  await carregarParser();
  const pedida = versaoPedida(w, node, r.hash);
  if (!pedida) {
    throw new Error(
      `a versão ${r.hash} não está no rascunho nem no ar em "${w.name}". A avaliação roda o rascunho: restaure essa versão no rascunho ou peça a rodada da versão atual`,
    );
  }

  let saidas: Map<string, SaidaExecutada>;
  let executor: string;
  if (fonte.config.ensaio) {
    saidas = await executarSimulado(String(fonte.config.ensaio), pedida.config, casos);
    executor = "simulado";
  } else if (fonte.config.url && segredo) {
    ({ saidas } = await executarNoN8n(r, fonte, segredo, w, node, pedida, casos));
    executor = "n8n";
  } else {
    throw new Error("a fonte n8n não tem API (config.url + chave) nem ensaio local configurado");
  }

  const grafo = await carregarGrafo(r.projeto_id);
  const repasse = toolsDeRepasse(pedida.config, grafo, declarado?.config.eventos.repasse?.tabela);
  const politicas = politicasDe(contrato, r.agente);
  const linhas = casos.map((c) => {
    const s = saidas.get(c.slug);
    const saida: SaidaDoCaso = s
      ? { resposta: s.resposta, tools: s.tools, repasse: s.repasse ?? s.tools.some((t) => repasse.has(normalizar(t.nome))) }
      : { resposta: "", tools: [], repasse: false };
    const checagens: Checagem[] = !s
      ? [{ nome: "execução", passou: false, detalhe: "o caso não voltou da rodada" }]
      : s.erro
        ? [{ nome: "execução", passou: false, detalhe: s.erro }]
        : checarCaso(c.espera, saida, politicas);
    return { caso: c, saida, checagens, passou: checagens.every((x) => x.passou), duracao: s?.duracao_ms ?? null, juiz: s?.juiz ?? null };
  });
  const passaram = linhas.filter((l) => l.passou).length;
  const aprovacao = Math.round((passaram / linhas.length) * 10_000) / 10_000;
  const criticosFalhos = linhas.filter((l) => !l.passou && l.caso.criticidade === "critico").map((l) => l.caso.slug);
  const minima = declarado?.config.metas.aprovacao_minima ?? 0.9;
  const aprovada = !criticosFalhos.length && aprovacao >= minima;

  await transacao(async (c) => {
    await c.query("delete from public.rodada_casos where rodada_id = $1", [r.id]);
    await c.query(
      `insert into public.rodada_casos (conta_id, rodada_id, caso_id, slug, criticidade, caso_hash, passou, checagens, tools_chamadas, resposta, repasse, juiz, duracao_ms)
       select $1, $2, x.caso_id, x.slug, x.criticidade, x.caso_hash, x.passou, x.checagens, x.tools, x.resposta, x.repasse, x.juiz, x.duracao_ms
         from jsonb_to_recordset($3::jsonb) as x(caso_id uuid, slug text, criticidade text, caso_hash text, passou boolean, checagens jsonb, tools jsonb,
                                                 resposta text, repasse boolean, juiz jsonb, duracao_ms int)`,
      [
        r.conta_id, r.id,
        JSON.stringify(linhas.map((l) => ({
          caso_id: l.caso.id, slug: l.caso.slug, criticidade: l.caso.criticidade, caso_hash: l.caso.hash, passou: l.passou, checagens: l.checagens,
          tools: l.saida.tools, resposta: l.saida.resposta.slice(0, 4_000), repasse: l.saida.repasse, juiz: l.juiz, duracao_ms: l.duracao,
        }))),
      ],
    );
    await c.query(
      `update public.rodadas set status = 'concluida', aprovacao = $2, casos = $3, passaram = $4, criticos_falhos = $5, aprovada = $6,
              executor = $7, erro = null, concluida_em = now() where id = $1`,
      [r.id, aprovacao, linhas.length, passaram, criticosFalhos, aprovada, executor],
    );
  });
  return { id: r.id, projetoId: r.projeto_id, agente: r.agente, hash: r.hash, status: "concluida", executor, casos: linhas.length, passaram, aprovacao, criticosFalhos, aprovada };
}

/** Pega as rodadas pedidas (uma por vez, sem duas instâncias pegarem a mesma) e roda. */
export async function processarRodadas(opcoes: { projetoId?: string; limite?: number; log?: (s: string) => void } = {}): Promise<ResultadoDaRodada[]> {
  const saida: ResultadoDaRodada[] = [];
  const limite = opcoes.limite ?? 20;
  while (saida.length < limite) {
    const pega = (
      await plataforma().query(
        `update public.rodadas r set status = 'rodando', iniciada_em = now()
          where r.id = (select id from public.rodadas where status = 'pedida' and ($1::uuid is null or projeto_id = $1)
                         order by criado_em limit 1 for update skip locked)
          returning r.id, r.conta_id, r.projeto_id, r.agente, r.hash, r.motivo`,
        [opcoes.projetoId ?? null],
      )
    ).rows[0] as RodadaPedida | undefined;
    if (!pega) break;
    try {
      const r = await executarRodada(pega);
      opcoes.log?.(`  rodada ${pega.id.slice(0, 8)} · ${workflowENode(pega.agente).node} v${pega.hash} · ${r.passaram}/${r.casos} (${Math.round((r.aprovacao ?? 0) * 1000) / 10}%)${r.criticosFalhos.length ? ` · críticos falhando: ${r.criticosFalhos.join(", ")}` : ""} · ${r.aprovada ? "aprovada" : "reprovada"}`);
      saida.push(r);
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      await plataforma().query("update public.rodadas set status = 'erro', erro = $2, concluida_em = now() where id = $1", [pega.id, erro.slice(0, 2_000)]);
      opcoes.log?.(`  rodada ${pega.id.slice(0, 8)} · ERRO: ${erro}`);
      saida.push({ id: pega.id, projetoId: pega.projeto_id, agente: pega.agente, hash: pega.hash, status: "erro", executor: null, casos: 0, passaram: 0, aprovacao: null, criticosFalhos: [], aprovada: null, erro });
    }
  }
  return saida;
}
