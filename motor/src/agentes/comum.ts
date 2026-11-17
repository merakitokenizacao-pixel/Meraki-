/**
 * Peças comuns dos módulos de agente: o agente no contrato, a fonte de cada coisa e o leitor do banco do cliente.
 * O leitor é o mesmo da coleta (segredo no Vault, transação read only, prazo curto): nada aqui escreve na fonte.
 */
import { resolve } from "node:path";
import pg from "pg";
import { partes } from "../chaves.ts";
import { type VersaoN8n, type WorkflowN8n, apiN8n, completarPublicada, lerExportacao, lerVersaoViaApi } from "../coletores/n8n.ts";
import type { AgenteDoContrato, Contrato } from "../contrato/esquema.ts";
import type { Grafo } from "../grafo.ts";
import { ignorarQueda, plataforma } from "../plataforma/db.ts";
import { type Fonte, fontesDoProjeto, lerSegredo } from "../plataforma/repositorio.ts";

export interface AgenteDeclarado {
  nome: string;
  config: AgenteDoContrato;
}

export function chaveDoAgente(config: Pick<AgenteDoContrato, "workflow" | "node">): string {
  return `n8n:agente:${config.workflow.replace(/^n8n:workflow:/, "")}/${config.node}`;
}

export function agenteNoContrato(contrato: Contrato | null | undefined, k: string): AgenteDeclarado | undefined {
  for (const [nome, config] of Object.entries(contrato?.agentes ?? {})) if (chaveDoAgente(config) === k) return { nome, config };
  return undefined;
}

/** Workflow e node de uma chave de agente (n8n:agente:wf/node). */
export function workflowENode(k: string): { workflow: string; node: string } {
  const ref = partes(k).ref;
  const i = ref.indexOf("/");
  return { workflow: ref.slice(0, i), node: ref.slice(i + 1) };
}

/** schema.tabela → chave pg:tabela (sem schema, public). */
export function chaveDaTabela(ref: string): string {
  return `pg:tabela:${ref.includes(".") ? ref : `public.${ref}`}`;
}

/** Identificador SQL entre aspas. O contrato já restringe a letras, números e "_"; aqui é a segunda barreira. */
export function ident(nome: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nome)) throw new Error(`identificador inválido no mapeamento: ${nome}`);
  return `"${nome}"`;
}

export function tabelaSql(ref: string): string {
  const [schema, tabela] = ref.includes(".") ? ref.split(".") : ["public", ref];
  return `${ident(schema)}.${ident(tabela)}`;
}

export async function fontePorId(projetoId: string, fonteId: string): Promise<Fonte> {
  const f = (await fontesDoProjeto(projetoId)).find((x) => x.id === fonteId);
  if (!f) throw new Error("fonte não encontrada no projeto");
  return f;
}

/** Fonte de banco que coleta a tabela (pela chave no grafo). */
export async function fonteDaTabela(projetoId: string, grafo: Grafo, ref: string): Promise<Fonte> {
  const no = grafo.get(chaveDaTabela(ref));
  if (!no) throw new Error(`a tabela ${ref} do mapeamento não existe no último estado do banco`);
  return fontePorId(projetoId, no.fonteId);
}

/** A tabela tem a coluna? (pelo último estado coletado) */
export function temColuna(grafo: Grafo, ref: string, coluna: string): boolean {
  const k = chaveDaTabela(ref).replace("pg:tabela:", "pg:coluna:");
  return grafo.tem(`${k}.${coluna}`);
}

export function fusoDoMotor(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Dia (AAAA-MM-DD) no fuso do motor — o mesmo usado nas consultas ao banco do cliente. */
export function diaLocal(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: fusoDoMotor() });
}

/**
 * Consulta no banco do cliente com o leitor do projeto. Transação read only, fuso do motor, prazo curto.
 * O que volta são agregados e ids (produção) ou a conversa que alguém abriu (tela, sem gravar).
 */
export async function comLeitor<T>(fonte: Fonte, fn: (c: pg.Client) => Promise<T>, prazoMs = 15_000): Promise<T> {
  if (!fonte.segredo_id) throw new Error(`a fonte ${fonte.nome} não tem conexão guardada no Vault`);
  const url = await lerSegredo(fonte.segredo_id);
  const cliente = new pg.Client({ connectionString: url, statement_timeout: prazoMs, connectionTimeoutMillis: 5_000, application_name: "meraki-motor" });
  cliente.on("error", ignorarQueda);
  await cliente.connect();
  try {
    await cliente.query("begin transaction read only");
    await cliente.query("select set_config('timezone', $1, true)", [fusoDoMotor()]);
    const r = await fn(cliente);
    await cliente.query("commit");
    return r;
  } finally {
    await cliente.end().catch(() => undefined);
  }
}

/** Fonte n8n dona do agente e o segredo dela (só existe dentro do motor). */
export async function fonteDoAgente(projetoId: string, agente: string): Promise<{ fonte: Fonte; segredo: string | null; atributos: Record<string, unknown> }> {
  const r = await plataforma().query(
    `select o.fonte_id, o.atributos from public.objetos o join public.fontes f on f.id = o.fonte_id
      where f.projeto_id = $1 and o.chave = $2 and o.tipo = 'agente' and o.removido_em is null limit 1`,
    [projetoId, agente],
  );
  if (!r.rows[0]) throw new Error(`agente ${agente} não existe no último estado do projeto`);
  const fonte = await fontePorId(projetoId, r.rows[0].fonte_id);
  const segredo = fonte.segredo_id ? await lerSegredo(fonte.segredo_id) : null;
  return { fonte, segredo, atributos: r.rows[0].atributos };
}

/** Um workflow da fonte n8n: da pasta exportada (desenvolvimento) ou da API (rascunho e publicado). */
export async function lerWorkflow(fonte: Pick<Fonte, "config">, segredo: string | null, raiz: string, id: string): Promise<WorkflowN8n> {
  const exportacao = fonte.config.exportacao as string | undefined;
  if (exportacao) {
    const w = (await lerExportacao(resolve(raiz, exportacao))).find((x) => x.id === id);
    if (!w) throw new Error(`workflow ${id} não está na exportação ${exportacao}`);
    return w;
  }
  const url = fonte.config.url as string | undefined;
  if (!url || !segredo) throw new Error("fonte n8n sem API (config.url e chave no Vault)");
  return completarPublicada(url, segredo, await apiN8n<WorkflowN8n>(url, segredo, `/workflows/${encodeURIComponent(id)}`));
}

/**
 * Uma versão do workflow pelo versionId: o rascunho, o publicado ou, pela API, qualquer uma do histórico
 * (o publish_workflow do MCP pode publicar uma versão antiga).
 */
export async function lerVersao(fonte: Pick<Fonte, "config">, segredo: string | null, w: WorkflowN8n, versionId: string): Promise<VersaoN8n> {
  if (versionId === w.versionId) return { versionId, nodes: w.nodes ?? [], connections: w.connections ?? {} };
  if (versionId === w.activeVersionId && w.activeVersion?.nodes) return { ...w.activeVersion, versionId };
  const url = fonte.config.url as string | undefined;
  if (fonte.config.exportacao || !url || !segredo) {
    throw new Error(`a versão ${versionId} de "${w.name}" não é o rascunho nem a publicada, e a fonte não tem API para ler o histórico`);
  }
  return lerVersaoViaApi(url, segredo, w.id, versionId);
}

export function percentil(valores: number[], p: number): number | null {
  if (!valores.length) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  return Math.round(ordenados[Math.min(ordenados.length - 1, Math.max(0, Math.ceil((p / 100) * ordenados.length) - 1))]);
}
