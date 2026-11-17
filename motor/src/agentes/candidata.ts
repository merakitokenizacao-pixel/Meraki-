/**
 * Versão candidata de um agente: o grafo do projeto com um workflow trocado pela versão que vai ao ar
 * (o rascunho do editor ou o que o hook do n8n mandou). O resto do projeto fica como está, então as tools
 * continuam sendo conferidas contra o banco de verdade (A03, A04, A10).
 */
import { partes } from "../chaves.ts";
import { type AgenteLido, type VersaoN8n, type WorkflowN8n, lerAgentes, montarSnapshot } from "../coletores/n8n.ts";
import type { Contrato } from "../contrato/esquema.ts";
import { type ExcecaoAtiva, Intencao } from "../contrato/intencao.ts";
import { Grafo, type NoGrafo } from "../grafo.ts";
import { avaliarRegras, regraPorCodigo } from "../regras/index.ts";
import { type AchadoBruto, chaveDedupe } from "../tipos.ts";
import type { EstadoAgentes } from "./estado.ts";

/** O workflow como se `versao` estivesse publicada. Sem `versao`, publica o rascunho (nodes e conexões). */
export function comoPublicado(w: WorkflowN8n, versao?: VersaoN8n): WorkflowN8n {
  const v: VersaoN8n = versao ?? { versionId: w.versionId, nodes: w.nodes ?? [], connections: w.connections ?? {} };
  return {
    ...w,
    nodes: v.nodes ?? [],
    connections: v.connections ?? {},
    active: true,
    activeVersionId: v.versionId ?? w.versionId ?? null,
    activeVersion: { versionId: v.versionId ?? w.versionId, nodes: v.nodes ?? [], connections: v.connections ?? {} },
  };
}

/** Agentes de uma versão do workflow: o hash de cada um é a versão que a rodada e o gate usam. */
export function agentesDaVersao(w: WorkflowN8n, versao?: VersaoN8n): AgenteLido[] {
  return lerAgentes(w, versao ?? { nodes: w.nodes ?? [], connections: w.connections ?? {} }, "exata");
}

const doWorkflow = (k: string, workflowId: string) => {
  const p = partes(k);
  if (p.ns !== "n8n") return false;
  if (p.tipo === "workflow") return p.ref === workflowId;
  return (p.tipo === "node" || p.tipo === "agente" || p.tipo === "prompt") && p.ref.startsWith(`${workflowId}/`);
};

export interface Candidata {
  grafo: Grafo;
  /** Objetos agente da versão candidata (chave → nó). */
  agentes: NoGrafo[];
  /** Histórico de prompts com o prompt candidato no fim (para a A07 comparar com o publicado). */
  estado: EstadoAgentes;
}

/** Grafo com o workflow `w` publicado na versão dele (use comoPublicado antes, se for o rascunho). */
export function grafoCandidato(grafo: Grafo, fonteId: string, w: WorkflowN8n, estado: EstadoAgentes, agora: Date): Candidata {
  const snap = montarSnapshot([w], new Map(), "candidata");
  const objetos = new Map<string, NoGrafo>();
  for (const o of grafo.objetos.values()) if (!(o.fonteId === fonteId && doWorkflow(o.chave, w.id))) objetos.set(o.chave, o);
  for (const o of snap.objetos) {
    const antes = grafo.get(o.chave);
    if (objetos.has(o.chave)) continue; // credencial compartilhada com outro workflow
    objetos.set(o.chave, { ...o, fonteId, fonteTipo: "n8n", vistoDesde: antes?.vistoDesde ?? agora.toISOString(), alteradoEm: agora.toISOString() });
  }
  const relacoes = [...grafo.relacoes.filter((r) => !(grafo.get(r.origem)?.fonteId === fonteId && doWorkflow(r.origem, w.id))), ...snap.relacoes];
  const novo = new Grafo([...objetos.values()], relacoes, [...grafo.fontes.values()], grafo.uso);

  const prompts = new Map(estado.prompts);
  for (const p of novo.porTipo("prompt").filter((x) => doWorkflow(x.chave, w.id))) {
    const lista = [...(prompts.get(p.chave) ?? [])];
    if (lista.at(-1)?.hash !== p.atributos.hash) lista.push({ tamanho: Number(p.atributos.tamanho ?? 0), hash: String(p.atributos.hash ?? ""), criadoEm: agora.toISOString() });
    prompts.set(p.chave, lista);
  }
  return {
    grafo: novo,
    agentes: novo.porTipo("agente").filter((a) => doWorkflow(a.chave, w.id)),
    estado: { ...estado, prompts },
  };
}

export interface AchadosDaVersao {
  /** Achados do pacote agente na versão candidata, por agente. */
  todos: AchadoBruto[];
  /** Os que não existiam na versão publicada (dívida herdada não barra, como no gate da fase 1). */
  novos: AchadoBruto[];
  /** Novos, que barram e sem exceção ativa. */
  bloqueantes: AchadoBruto[];
}

/** Roda o pacote agente na versão candidata e separa o que ela introduz. */
export function avaliarCandidata(
  atual: { grafo: Grafo; contrato: Contrato; excecoes: ExcecaoAtiva[]; estado: EstadoAgentes },
  cand: Candidata,
  agora: Date,
): AchadosDaVersao {
  const doPacote = (a: AchadoBruto) => regraPorCodigo(a.regra)?.pacote === "agente";
  const chaves = new Set(cand.agentes.map((a) => a.chave));
  const intencaoCand = new Intencao(atual.contrato, cand.grafo, atual.excecoes);
  const todos = avaliarRegras(cand.grafo, intencaoCand, { agora, agentes: cand.estado }).filter((a) => doPacote(a) && chaves.has(a.objeto));
  const antes = new Set(
    avaliarRegras(atual.grafo, new Intencao(atual.contrato, atual.grafo, atual.excecoes), { agora, agentes: atual.estado })
      .filter((a) => doPacote(a) && chaves.has(a.objeto))
      .map(chaveDedupe),
  );
  const novos = todos.filter((a) => !antes.has(chaveDedupe(a)));
  const bloqueantes = novos.filter((a) => regraPorCodigo(a.regra)?.bloqueia && !intencaoCand.excecao(a.regra, [a.objeto, a.par], agora));
  return { todos, novos, bloqueantes };
}
