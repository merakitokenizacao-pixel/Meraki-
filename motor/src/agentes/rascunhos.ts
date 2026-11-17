/**
 * Rascunho que já é outra versão: salvar rascunho não muda o que está no ar, então só avisa.
 * A cada coleta o pacote agente roda na versão do editor e o resultado fica em agente_rascunhos para a tela.
 * O hook PostToolUse (meraki gate-rascunho) faz o mesmo na hora em que o agente de código salva o workflow.
 */
import { contratoVazio } from "../contrato/esquema.ts";
import type { WorkflowN8n } from "../coletores/n8n.ts";
import { plataforma } from "../plataforma/db.ts";
import { type Projeto, carregarGrafo, excecoesAtivas, lerSegredo } from "../plataforma/repositorio.ts";
import { regraPorCodigo } from "../regras/index.ts";
import { chaveDedupe } from "../tipos.ts";
import { RAIZ } from "../util/raiz.ts";
import { carregarParser } from "../sql/parser.ts";
import { montarIntencao } from "../verificacao.ts";
import { avaliarCandidata, comoPublicado, grafoCandidato } from "./candidata.ts";
import { fontePorId, lerWorkflow } from "./comum.ts";
import { carregarEstadoAgentes } from "./estado.ts";

export interface AchadoDoRascunho {
  regra: string;
  severidade: string;
  titulo: string;
  detalhe: string | null;
  /** Não existe na versão publicada. */
  novo: boolean;
  /** Barraria a publicação (regra que barra e novo). */
  bloqueia: boolean;
}

export interface AvaliacaoDeRascunho {
  agente: string;
  nome: string;
  hash: string;
  achados: AchadoDoRascunho[];
}

/** Pacote agente na versão do editor de um workflow (rascunho). */
export async function avaliarRascunho(projeto: Projeto, w: WorkflowN8n, agora = new Date()): Promise<AvaliacaoDeRascunho[]> {
  await carregarParser();
  const grafo = await carregarGrafo(projeto.id);
  const fonteId = grafo.get(`n8n:workflow:${w.id}`)?.fonteId ?? [...grafo.fontes.values()].find((f) => f.tipo === "n8n")?.id;
  if (!fonteId) return [];
  const { contrato } = await montarIntencao(projeto, grafo);
  const estado = await carregarEstadoAgentes(projeto.id);
  const cand = grafoCandidato(grafo, fonteId, comoPublicado(w), estado, agora);
  const r = avaliarCandidata({ grafo, contrato: contrato?.conteudo ?? contratoVazio(projeto.slug), excecoes: await excecoesAtivas(projeto.id), estado }, cand, agora);
  const novos = new Set(r.novos.map(chaveDedupe));
  const bloqueantes = new Set(r.bloqueantes.map(chaveDedupe));
  return cand.agentes.map((a) => ({
    agente: a.chave,
    nome: a.nome,
    hash: String(a.atributos.versao),
    achados: r.todos
      .filter((x) => x.objeto === a.chave)
      .map((x) => ({
        regra: x.regra, severidade: x.severidade, titulo: x.titulo, detalhe: x.detalhe ?? null,
        novo: novos.has(chaveDedupe(x)), bloqueia: bloqueantes.has(chaveDedupe(x)) && Boolean(regraPorCodigo(x.regra)?.bloqueia),
      })),
  }));
}

/** Depois da coleta: avalia os rascunhos divergentes e limpa os que voltaram a ser iguais ao publicado. */
export async function atualizarRascunhos(projeto: Projeto, agora = new Date()): Promise<{ agentes: number; achados: number }> {
  const grafo = await carregarGrafo(projeto.id);
  const divergentes = grafo.porTipo("agente").filter((a) => a.atributos.rascunho_divergente && a.atributos.rascunho_versao);
  await plataforma().query("delete from public.agente_rascunhos where projeto_id = $1 and not (agente = any($2))", [projeto.id, divergentes.map((a) => a.chave)]);
  let achados = 0;
  const porWorkflow = new Map<string, typeof divergentes>();
  for (const a of divergentes) porWorkflow.set(String(a.atributos.workflow), [...(porWorkflow.get(String(a.atributos.workflow)) ?? []), a]);
  for (const [workflowId, lista] of porWorkflow) {
    const fonte = await fontePorId(projeto.id, lista[0].fonteId);
    const segredo = fonte.segredo_id ? await lerSegredo(fonte.segredo_id) : null;
    const w = await lerWorkflow(fonte, segredo, RAIZ, workflowId);
    for (const av of await avaliarRascunho(projeto, w, agora)) {
      if (!lista.some((a) => a.chave === av.agente)) continue;
      achados += av.achados.length;
      await plataforma().query(
        `insert into public.agente_rascunhos (conta_id, projeto_id, agente, hash, achados, avaliado_em) values ($1, $2, $3, $4, $5, $6)
         on conflict (projeto_id, agente) do update set hash = excluded.hash, achados = excluded.achados, avaliado_em = excluded.avaliado_em`,
        [projeto.conta_id, projeto.id, av.agente, av.hash, JSON.stringify(av.achados), agora],
      );
    }
  }
  return { agentes: divergentes.length, achados };
}
