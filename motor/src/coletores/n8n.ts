/**
 * Coletor n8n. Pela API (X-N8N-API-KEY) ou por uma pasta de exportação (n8n export:workflow --separate).
 * Guarda rascunho (nodes) e publicado (activeVersion): as relações saem do publicado; divergência vira atributo.
 * Credencial: só id, nome e tipo — nunca o conteúdo.
 *
 * Agentes de IA (fase 2): as conexões ai_* ficam no sub-node (connections[tool].ai_tool → [[{ node: agente }]]).
 * O agente vira objeto (n8n:agente:wf/nome) com o prompt como filho; modelo, fallback, memória, parser e tools
 * viram relações. Tipo de node é comparado pelo nome base (…postgres e …postgresTool → postgres), cada
 * $fromAI(...) vira argumento da tool, e a versão do agente é o hash do que muda o comportamento.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chave } from "../chaves.ts";
import { acessosDoSql, carregarParser, nomeQualificado, nomes, percorrer, tentarLerComandos } from "../sql/parser.ts";
import type { Certeza, Coletor, ContextoColeta, FonteConfig, Objeto, Observacao, Relacao, Snapshot } from "../tipos.ts";
import { jsonCanonico, sha256 } from "../util/hash.ts";

export interface NodeN8n {
  id?: string;
  name: string;
  type: string;
  typeVersion?: number;
  disabled?: boolean;
  notes?: string;
  position?: unknown;
  parameters?: Record<string, unknown>;
  credentials?: Record<string, { id?: string; name?: string }>;
}

export interface ConexaoN8n {
  node: string;
  type?: string;
  index?: number;
}

export type ConexoesN8n = Record<string, Record<string, (ConexaoN8n[] | null)[] | undefined> | undefined>;

export interface VersaoN8n {
  versionId?: string;
  nodes?: NodeN8n[];
  connections?: ConexoesN8n;
}

export interface WorkflowN8n extends VersaoN8n {
  id: string;
  name: string;
  active?: boolean;
  isArchived?: boolean;
  tags?: ({ id?: string; name: string } | string)[];
  settings?: { errorWorkflow?: string };
  updatedAt?: string;
  activeVersionId?: string | null;
  activeVersion?: VersaoN8n | null;
}

export interface ExecucaoN8n {
  workflowId: string;
  status: string;
  startedAt: string;
  stoppedAt?: string | null;
}

const ROTA_SUPABASE = /\/(rest|functions)\/v1\/(rpc\/)?([A-Za-z0-9_]+)/;
const EXPRESSAO = /\{\{[\s\S]*?\}\}/g;
const REF_NODE = /\$\(\s*['"]([^'"]+)['"]\s*\)|\$node\[\s*['"]([^'"]+)['"]\s*\]/g;
const FROM_AI = /\$fromAI\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1(?:\s*,\s*(['"`])((?:\\.|(?!\3)[^\\])*)\3)?(?:\s*,\s*(['"`])((?:\\.|(?!\5)[^\\])*)\5)?/g;
/** Nodes que dividem o fluxo: o $json que chega depois deles depende do ramo. */
const RAMIFICAM = new Set(["if", "switch", "filter", "merge", "compareDatasets", "splitInBatches", "wait"]);

export const coletorN8n: Coletor = {
  tipos: ["n8n"],

  async coletar(fonte: FonteConfig, ctx: ContextoColeta): Promise<Snapshot> {
    await carregarParser();
    const tag = fonte.config.tag as string | undefined;
    let workflows = await lerWorkflows(fonte, ctx);
    let execucoes = new Map<string, { total: number; erros: number }>();
    const url = fonte.config.url as string | undefined;
    const modo = fonte.config.exportacao ? "exportacao" : "api";
    if (!fonte.config.exportacao && url && fonte.segredo) execucoes = await contarErros(url, fonte.segredo, workflows, ctx.agora);
    if (tag) workflows = workflows.filter((w) => nomesDeTags(w).includes(tag));
    return montarSnapshot(workflows.filter((w) => !w.isArchived), execucoes, modo);
  },
};

/** Workflows da fonte, pela exportação ou pela API. */
export async function lerWorkflows(fonte: Pick<FonteConfig, "config" | "segredo">, ctx: Pick<ContextoColeta, "raiz">): Promise<WorkflowN8n[]> {
  const exportacao = fonte.config.exportacao as string | undefined;
  const url = fonte.config.url as string | undefined;
  if (exportacao) return lerExportacao(resolve(ctx.raiz, exportacao));
  if (url) {
    if (!fonte.segredo) throw new Error("fonte n8n sem chave de API: guarde a X-N8N-API-KEY no Vault");
    return listarViaApi(url, fonte.segredo, fonte.config.tag as string | undefined);
  }
  throw new Error("fonte n8n precisa de config.url (API) ou config.exportacao (pasta exportada)");
}

export function nomesDeTags(w: Pick<WorkflowN8n, "tags">): string[] {
  return (w.tags ?? []).map((t) => (typeof t === "string" ? t : t.name)).sort();
}

export async function lerExportacao(pasta: string): Promise<WorkflowN8n[]> {
  const arquivos = (await readdir(pasta)).filter((f) => f.endsWith(".json")).sort();
  const saida: WorkflowN8n[] = [];
  for (const f of arquivos) {
    const conteudo = JSON.parse(await readFile(join(pasta, f), "utf8"));
    for (const w of Array.isArray(conteudo) ? conteudo : [conteudo]) if (w?.id && Array.isArray(w.nodes)) saida.push(w);
  }
  return saida;
}

/** Chamada à API pública do n8n. A chave só existe dentro do motor (lida do Vault). */
export async function apiN8n<T>(base: string, chaveApi: string, caminho: string, init: { metodo?: string; corpo?: unknown; prazoMs?: number } = {}): Promise<T> {
  const resposta = await fetch(new URL(`/api/v1${caminho}`, base), {
    method: init.metodo ?? "GET",
    headers: { "X-N8N-API-KEY": chaveApi, accept: "application/json", ...(init.corpo !== undefined ? { "content-type": "application/json" } : {}) },
    body: init.corpo !== undefined ? JSON.stringify(init.corpo) : undefined,
    signal: AbortSignal.timeout(init.prazoMs ?? 20_000),
  });
  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => "");
    throw new Error(`n8n ${init.metodo ?? "GET"} ${caminho.split("?")[0]}: HTTP ${resposta.status}${corpo ? ` — ${corpo.slice(0, 200)}` : ""}`);
  }
  return (await resposta.json()) as T;
}

async function listarViaApi(base: string, chaveApi: string, tag?: string): Promise<WorkflowN8n[]> {
  const saida: WorkflowN8n[] = [];
  let cursor: string | undefined;
  do {
    const q = new URLSearchParams({ limit: "250" });
    if (tag) q.set("tags", tag);
    if (cursor) q.set("cursor", cursor);
    const pagina = await apiN8n<{ data: WorkflowN8n[]; nextCursor?: string | null }>(base, chaveApi, `/workflows?${q}`);
    saida.push(...pagina.data);
    cursor = pagina.nextCursor ?? undefined;
  } while (cursor);
  for (const w of saida) await completarPublicada(base, chaveApi, w);
  return saida;
}

/** No ar no n8n 2.x: `active` é obsoleto na API; vale `activeVersionId` não nulo (no 1.x, o `active`). */
export function estaNoAr(w: Pick<WorkflowN8n, "active" | "activeVersionId">): boolean {
  return w.activeVersionId !== undefined ? w.activeVersionId !== null : Boolean(w.active);
}

/** Uma versão do histórico do workflow (GET /workflows/{id}/versions/{versionId}). */
export async function lerVersaoViaApi(base: string, chaveApi: string, workflowId: string, versionId: string): Promise<VersaoN8n> {
  const v = await apiN8n<VersaoN8n>(base, chaveApi, `/workflows/${encodeURIComponent(workflowId)}/versions/${encodeURIComponent(versionId)}`);
  return { versionId: v.versionId ?? versionId, nodes: v.nodes ?? [], connections: v.connections ?? {} };
}

/** A API devolve activeVersion junto; se faltar e o publicado não for o próprio rascunho, busca no histórico. */
export async function completarPublicada(base: string, chaveApi: string, w: WorkflowN8n): Promise<WorkflowN8n> {
  if (w.activeVersionId && w.activeVersionId !== w.versionId && !w.activeVersion?.nodes) {
    w.activeVersion = await lerVersaoViaApi(base, chaveApi, w.id, w.activeVersionId);
  }
  return w;
}

async function contarErros(base: string, chaveApi: string, workflows: WorkflowN8n[], agora: Date) {
  const desde = agora.getTime() - 7 * 86_400_000;
  const mapa = new Map<string, { total: number; erros: number }>();
  for (const w of workflows.filter(estaNoAr)) {
    try {
      const r = await apiN8n<{ data: { status?: string; startedAt?: string }[] }>(base, chaveApi, `/executions?workflowId=${encodeURIComponent(w.id)}&limit=250`);
      const recentes = r.data.filter((e) => !e.startedAt || Date.parse(e.startedAt) >= desde);
      mapa.set(w.id, { total: recentes.length, erros: recentes.filter((e) => e.status === "error" || e.status === "crashed").length });
    } catch {
      // Contagem de erro é informativa: sem permissão de execuções, segue sem ela.
    }
  }
  return mapa;
}

/** Execuções de um workflow desde uma data (só status e horários: nenhum dado da execução). */
export async function listarExecucoes(
  fonte: Pick<FonteConfig, "config" | "segredo">,
  ctx: Pick<ContextoColeta, "raiz">,
  workflowId: string,
  desde: Date,
): Promise<ExecucaoN8n[]> {
  const arquivo = fonte.config.execucoes as string | undefined;
  if (fonte.config.exportacao) {
    // Exportação não traz execuções: em desenvolvimento elas vêm de um arquivo à parte (status e horários).
    if (!arquivo) return [];
    let lista: ExecucaoN8n[];
    try {
      lista = JSON.parse(await readFile(resolve(ctx.raiz, arquivo), "utf8")) as ExecucaoN8n[];
    } catch {
      return [];
    }
    return lista.filter((e) => e.workflowId === workflowId && Date.parse(e.startedAt) >= desde.getTime());
  }
  const url = fonte.config.url as string | undefined;
  if (!url || !fonte.segredo) return [];
  const saida: ExecucaoN8n[] = [];
  let cursor: string | undefined;
  for (let pagina = 0; pagina < 40; pagina++) {
    const q = new URLSearchParams({ workflowId, limit: "250", includeData: "false" });
    if (cursor) q.set("cursor", cursor);
    const r = await apiN8n<{ data: { status?: string; startedAt?: string; stoppedAt?: string | null; workflowId?: string }[]; nextCursor?: string | null }>(
      url, fonte.segredo, `/executions?${q}`,
    );
    let antigas = false;
    for (const e of r.data) {
      if (!e.startedAt) continue;
      if (Date.parse(e.startedAt) < desde.getTime()) {
        antigas = true;
        continue;
      }
      saida.push({ workflowId, status: e.status ?? "unknown", startedAt: e.startedAt, stoppedAt: e.stoppedAt ?? null });
    }
    cursor = r.nextCursor ?? undefined;
    if (!cursor || antigas) break;
  }
  return saida;
}

/* ─────────────────────── Leitura de nodes ─────────────────────── */

/** Nome base do tipo: @n8n/n8n-nodes-langchain.toolWorkflow → toolWorkflow, n8n-nodes-base.postgresTool → postgresTool. */
export function tipoBase(tipo: string): string {
  const i = tipo.lastIndexOf(".");
  return i >= 0 ? tipo.slice(i + 1) : tipo;
}

/** Variante "Tool" de um node comum vira o node comum: postgresTool → postgres, httpRequestTool → httpRequest. */
function baseDaTool(tipo: string): string {
  const b = tipoBase(tipo);
  if (/^tool[A-Z]/.test(b)) return b;
  return b.endsWith("Tool") ? b.slice(0, -4) : b;
}

export const ehAgente = (tipo: string) => tipoBase(tipo) === "agent";

function ehGatilho(tipo: string): boolean {
  return /trigger$/i.test(tipo) || /\.(webhook|cron|formTrigger)$/i.test(tipo);
}

function valorDe(v: unknown): string | undefined {
  if (typeof v === "string") return v.replace(/^=/, "");
  if (v && typeof v === "object" && "value" in v) return valorDe((v as { value: unknown }).value);
  return undefined;
}

function textos(v: unknown, saida: string[] = []): string[] {
  if (typeof v === "string") saida.push(v);
  else if (Array.isArray(v)) for (const x of v) textos(x, saida);
  else if (v && typeof v === "object") for (const x of Object.values(v)) textos(x, saida);
  return saida;
}

function desescapar(s: string | undefined): string {
  return (s ?? "").replace(/\\(.)/g, "$1");
}

export interface ArgumentoTool {
  nome: string;
  tipo: string;
  descricao: string;
}

/** Cada $fromAI('nome', 'descrição', 'tipo') dos parâmetros é um argumento que o modelo preenche. */
export function argumentosFromAi(parametros: unknown): ArgumentoTool[] {
  const vistos = new Map<string, ArgumentoTool>();
  for (const t of textos(parametros)) {
    for (const m of t.matchAll(FROM_AI)) {
      const nome = desescapar(m[2]).trim();
      if (!nome || vistos.has(nome)) continue;
      vistos.set(nome, { nome, descricao: desescapar(m[4]).trim(), tipo: desescapar(m[6]).trim() || "string" });
    }
  }
  return [...vistos.values()];
}

/** Argumentos das chamadas de função num SQL: nomeados (p_x => ...) e quantos posicionais. */
function argumentosDeChamadas(sql: string): Map<string, { nomeados: string[]; posicionais: number }> {
  const mapa = new Map<string, { nomeados: string[]; posicionais: number }>();
  for (const c of tentarLerComandos(sql) ?? []) {
    percorrer({ [c.tipo]: c.no }, (tipo, no) => {
      if (tipo !== "FuncCall") return;
      const partes = nomes(no.funcname);
      if (!partes.length || partes[0] === "pg_catalog") return;
      const nomeados: string[] = [];
      let posicionais = 0;
      for (const a of (no.args as Record<string, { name?: string }>[] | undefined) ?? []) {
        if (a?.NamedArgExpr?.name) nomeados.push(a.NamedArgExpr.name);
        else posicionais++;
      }
      const alvo = nomeQualificado(partes);
      const atual = mapa.get(alvo);
      if (!atual || nomeados.length + posicionais > atual.nomeados.length + atual.posicionais) mapa.set(alvo, { nomeados, posicionais });
    });
  }
  return mapa;
}

/** Chaves do corpo JSON de uma chamada HTTP (as expressões viram null para o JSON ser lido). */
function chavesDoCorpo(p: Record<string, unknown>): string[] {
  const saida = new Set<string>();
  const json = valorDe(p.jsonBody);
  if (json) {
    const limpo = json.replace(EXPRESSAO, "null").replace(/"null"/g, "null");
    try {
      const v = JSON.parse(limpo);
      if (v && typeof v === "object" && !Array.isArray(v)) for (const k of Object.keys(v)) saida.add(k);
    } catch {
      for (const m of json.matchAll(/"([A-Za-z_][\w]*)"\s*:/g)) saida.add(m[1]);
    }
  }
  for (const lista of [(p.bodyParameters as { parameters?: { name?: string }[] })?.parameters, (p.parametersBody as { values?: { name?: string }[] })?.values]) {
    for (const x of lista ?? []) if (x?.name) saida.add(x.name);
  }
  return [...saida];
}

function colunasDe(p: Record<string, unknown>): { escritas: string[]; lidas: string[] } {
  const escritas = new Set<string>();
  const lidas = new Set<string>();
  const valores = (p.columns as { value?: Record<string, unknown> } | undefined)?.value;
  if (valores && typeof valores === "object") for (const k of Object.keys(valores)) escritas.add(k);
  for (const f of (p.fieldsUi as { fieldValues?: { fieldId?: string }[] } | undefined)?.fieldValues ?? []) if (f?.fieldId) escritas.add(f.fieldId);
  for (const w of (p.where as { values?: { column?: string }[] } | undefined)?.values ?? []) if (w?.column) lidas.add(valorDe(w.column) ?? w.column);
  for (const w of (p.filters as { conditions?: { keyName?: string }[] } | undefined)?.conditions ?? []) if (w?.keyName) lidas.add(w.keyName);
  return { escritas: [...escritas].filter(Boolean), lidas: [...lidas].filter(Boolean) };
}

interface Leitura {
  atributos: Record<string, unknown>;
  relacoes: Relacao[];
  avisos: string[];
  /** O motor sabe o que o node toca (tabela, função, rota, workflow). */
  reconhecido: boolean;
}

/** Alvos de um node (ou de uma tool, já com o tipo base): tabelas, colunas, funções, rotas e workflows. */
function lerNode(n: NodeN8n, base: string, w: WorkflowN8n, origem: string, certeza: Certeza, emTool: boolean): Leitura {
  const kw = chave.workflow(w.id);
  const p = n.parameters ?? {};
  const ev = { workflow: w.name, node: n.name };
  const atributos: Record<string, unknown> = {};
  const relacoes: Relacao[] = [];
  const avisos: string[] = [];
  const tabela = (schema: string | undefined, t: string, tipo: "le" | "escreve", extra: Record<string, unknown> = {}) =>
    relacoes.push({ origem, destino: chave.tabela(schema || "public", t), tipo, evidencia: { ...ev, ...extra }, certeza });
  const coluna = (schema: string | undefined, t: string, c: string, tipo: "le" | "escreve") =>
    relacoes.push({ origem, destino: chave.coluna(schema || "public", t, c), tipo, evidencia: ev, certeza });

  if (base === "postgres") {
    const op = String(p.operation ?? "executeQuery");
    atributos.operacao = op;
    if (op === "executeQuery" && typeof p.query === "string") {
      const sql = p.query.replace(/^=/, "").replace(EXPRESSAO, "NULL");
      atributos.consulta = sql.slice(0, 500);
      const acessos = acessosDoSql(sql);
      if (!acessos) avisos.push(`SQL do node "${n.name}" (${w.name}) não pôde ser lido`);
      const argumentos = acessos?.some((a) => a.tipo === "chama") ? argumentosDeChamadas(sql) : new Map();
      for (const a of acessos ?? []) {
        if (a.tipo === "chama") {
          const args = argumentos.get(a.alvo);
          relacoes.push({
            origem, destino: chave.funcaoPorNome(...dividirRef(a.alvo)), tipo: "chama",
            evidencia: { ...ev, query: sql.slice(0, 300), ...(args ? { nomeados: args.nomeados, posicionais: args.posicionais } : {}) }, certeza,
          });
        } else relacoes.push({ origem, destino: chave.tabela(...dividirRef(a.alvo)), tipo: a.tipo, evidencia: { ...ev, query: sql.slice(0, 300) }, certeza });
      }
    } else {
      const t = valorDe(p.table);
      const schema = valorDe(p.schema);
      const leitura = ["select", "get", "getAll"].includes(op);
      if (t) {
        tabela(schema, t, leitura ? "le" : "escreve");
        const cols = colunasDe(p);
        for (const c of cols.lidas) coluna(schema, t, c, "le");
        if (!leitura && op !== "deleteTable") for (const c of cols.escritas) coluna(schema, t, c, "escreve");
      }
      atributos.alvo = t ?? null;
    }
    return { atributos, relacoes, avisos, reconhecido: true };
  }

  if (base === "supabase") {
    const op = String(p.operation ?? "getAll");
    const t = valorDe(p.tableId);
    atributos.operacao = op;
    atributos.alvo = t ?? null;
    if (t) {
      const leitura = ["get", "getAll"].includes(op);
      tabela(undefined, t, leitura ? "le" : "escreve");
      const cols = colunasDe(p);
      for (const c of cols.lidas) coluna(undefined, t, c, "le");
      if (!leitura && op !== "delete") for (const c of cols.escritas) coluna(undefined, t, c, "escreve");
    }
    return { atributos, relacoes, avisos, reconhecido: true };
  }

  if (base === "httpRequest" || base === "toolHttpRequest") {
    const url = valorDe(p.url) ?? "";
    const metodo = String(p.method ?? "GET").toUpperCase();
    atributos.metodo = metodo;
    atributos.alvo = url.replace(EXPRESSAO, "{…}").slice(0, 300);
    const m = ROTA_SUPABASE.exec(url);
    if (m) {
      const [, area, rpc, nome] = m;
      if (area === "functions") relacoes.push({ origem, destino: chave.edge(nome), tipo: "chama", evidencia: { ...ev, trecho: url }, certeza });
      else if (rpc) {
        relacoes.push({ origem, destino: chave.funcaoPorNome("public", nome), tipo: "chama", evidencia: { ...ev, trecho: url, nomeados: chavesDoCorpo(p), posicionais: 0 }, certeza });
      } else relacoes.push({ origem, destino: chave.tabela("public", nome), tipo: metodo === "GET" ? "le" : "escreve", evidencia: { ...ev, trecho: url }, certeza });
    }
    return { atributos, relacoes, avisos, reconhecido: Boolean(m) || !emTool };
  }

  if (base === "executeWorkflow" || base === "toolWorkflow") {
    const alvo = valorDe(p.workflowId);
    atributos.alvo = alvo ?? null;
    // Node comum: o workflow executa o outro (fase 1). Tool: é a tool que executa, para o agente enxergar o alvo.
    if (alvo) relacoes.push({ origem: emTool ? origem : kw, destino: chave.workflow(alvo), tipo: "executa", evidencia: ev, certeza });
    return { atributos, relacoes, avisos, reconhecido: Boolean(alvo) };
  }

  return { atributos, relacoes, avisos, reconhecido: false };
}

/* ─────────────────────── Agentes ─────────────────────── */

export interface ModeloDoAgente {
  node: string;
  tipo: string;
  nome: string | null;
  parametros: Record<string, unknown>;
}

export interface ToolDoAgente {
  /** Nome que o modelo recebe (o nome do node normalizado). */
  nome: string;
  node: string;
  tipo: string;
  descricao: string | null;
  argumentos: ArgumentoTool[];
  /** Chaves dos alvos: tabelas, colunas, funções, rotas e workflows que a tool toca. */
  alvos: string[];
  /** toolCode, MCP e afins: o Meraki não vê o que ela toca. */
  opaca: boolean;
  desativada: boolean;
}

export interface ConfigAgente {
  node: string;
  tipo: string;
  desativado: boolean;
  prompt: { sistema: string; entrada: string };
  modelo: ModeloDoAgente | null;
  fallback: ModeloDoAgente | null;
  memoria: { node: string; tipo: string; parametros: Record<string, unknown> } | null;
  parser: { node: string; tipo: string; parametros_hash: string } | null;
  tools: ToolDoAgente[];
  opcoes: Record<string, unknown>;
  gatilhos: string[];
  entrada_ramificada: boolean;
}

export interface AgenteLido {
  config: ConfigAgente;
  hash: string;
  relacoes: Relacao[];
  avisos: string[];
}

/** Nome da tool como o modelo recebe: o nome do node com pontuação e espaço trocados por "_". */
export function nomeDeTool(n: NodeN8n): string {
  const b = tipoBase(n.type);
  const proprio = /^tool(Code|Workflow|HttpRequest)$/.test(b) && typeof n.parameters?.name === "string" ? String(n.parameters.name).trim() : "";
  return (proprio || n.name).replace(/[\s.?!=+#@&*()[\]{}:;,<>/\\'"^%$|~`]+/g, "_").replace(/^_+|_+$/g, "");
}

function descricaoDeTool(n: NodeN8n): string | null {
  const p = n.parameters ?? {};
  for (const k of ["toolDescription", "description"]) {
    const v = p[k];
    if (typeof v === "string" && v.replace(/^=/, "").trim()) return v.replace(/^=/, "").trim();
  }
  return null;
}

function modeloDe(n: NodeN8n): ModeloDoAgente {
  const p = n.parameters ?? {};
  const nome = valorDe(p.model) ?? valorDe(p.modelName) ?? valorDe((p.options as Record<string, unknown> | undefined)?.model) ?? null;
  return { node: n.name, tipo: n.type, nome, parametros: { ...((p.options as Record<string, unknown>) ?? {}) } };
}

/** Versão do agente: só o que muda o comportamento. Posição no canvas, notas e id do node ficam fora. */
export function hashDoAgente(c: ConfigAgente): string {
  const modelo = (m: ModeloDoAgente | null) => m && { tipo: m.tipo, nome: m.nome, parametros: m.parametros };
  return sha256(
    jsonCanonico({
      prompt: c.prompt,
      opcoes: c.opcoes,
      modelo: modelo(c.modelo),
      fallback: modelo(c.fallback),
      memoria: c.memoria && { tipo: c.memoria.tipo, parametros: c.memoria.parametros },
      parser: c.parser && { tipo: c.parser.tipo, parametros_hash: c.parser.parametros_hash },
      tools: c.tools
        .filter((t) => !t.desativada)
        .map((t) => ({ nome: t.nome, descricao: t.descricao, argumentos: t.argumentos, alvos: [...t.alvos].sort() }))
        .sort((a, b) => a.nome.localeCompare(b.nome)),
    }),
  ).slice(0, 12);
}

/** Lê os agentes de uma versão do workflow (publicada ou rascunho). */
export function lerAgentes(w: WorkflowN8n, versao: VersaoN8n, certeza: Certeza): AgenteLido[] {
  const nodes = versao.nodes ?? [];
  const porNome = new Map(nodes.map((n) => [n.name, n]));
  const subnodes = new Map<string, { conexao: string; node: string; index: number }[]>();
  const entradas = new Map<string, string[]>();
  for (const [origem, saidas] of Object.entries(versao.connections ?? {})) {
    for (const [conexao, ramos] of Object.entries(saidas ?? {})) {
      for (const ramo of ramos ?? []) {
        for (const d of ramo ?? []) {
          if (!d?.node) continue;
          if (conexao === "main") entradas.set(d.node, [...(entradas.get(d.node) ?? []), origem]);
          else if (conexao.startsWith("ai_")) subnodes.set(d.node, [...(subnodes.get(d.node) ?? []), { conexao, node: origem, index: d.index ?? 0 }]);
        }
      }
    }
  }

  const saida: AgenteLido[] = [];
  for (const a of nodes.filter((n) => ehAgente(n.type))) {
    const ka = chave.agente(w.id, a.name);
    const p = a.parameters ?? {};
    const opcoesBrutas = { ...((p.options as Record<string, unknown>) ?? {}) };
    const sistema = typeof opcoesBrutas.systemMessage === "string" ? opcoesBrutas.systemMessage.replace(/^=/, "") : "";
    delete opcoesBrutas.systemMessage;
    const entrada = p.promptType === "define" || typeof p.text === "string" ? (valorDe(p.text) ?? "") : "{{ $json.chatInput }}";
    const relacoes: Relacao[] = [];
    const avisos: string[] = [];
    const ev = { workflow: w.name, node: a.name };
    const ligados = subnodes.get(a.name) ?? [];
    const subnode = (conexao: string) => ligados.filter((s) => s.conexao === conexao).map((s) => ({ ...s, n: porNome.get(s.node) })).filter((s) => s.n && !s.n.disabled);

    const modelos = subnode("ai_languageModel").sort((x, y) => x.index - y.index);
    const modelo = modelos.find((m) => m.index === 0) ?? modelos[0];
    const fallback = p.needsFallback === false ? undefined : modelos.find((m) => m !== modelo && m.index >= 1);
    for (const [m, papel] of [[modelo, "principal"], [fallback, "fallback"]] as const) {
      if (!m?.n) continue;
      relacoes.push({ origem: ka, destino: chave.node(w.id, m.node), tipo: "usa_modelo", evidencia: { ...ev, papel, modelo: modeloDe(m.n).nome }, certeza });
    }

    const memoriaNode = subnode("ai_memory")[0]?.n;
    let memoria: ConfigAgente["memoria"] = null;
    if (memoriaNode) {
      const pm = memoriaNode.parameters ?? {};
      memoria = { node: memoriaNode.name, tipo: memoriaNode.type, parametros: Object.fromEntries(Object.entries(pm).filter(([k]) => k !== "credentials")) };
      relacoes.push({ origem: ka, destino: chave.node(w.id, memoriaNode.name), tipo: "usa_memoria", evidencia: ev, certeza });
      if (tipoBase(memoriaNode.type) === "memoryPostgresChat") {
        const t = valorDe(pm.tableName) || "n8n_chat_histories";
        for (const tipo of ["le", "escreve"] as const) {
          relacoes.push({ origem: chave.node(w.id, memoriaNode.name), destino: chave.tabela("public", t), tipo, evidencia: { workflow: w.name, node: memoriaNode.name, trecho: `memória em ${t}` }, certeza: "inferida" });
        }
      }
    }

    const parserNode = subnode("ai_outputParser")[0]?.n;
    const parser = parserNode ? { node: parserNode.name, tipo: parserNode.type, parametros_hash: sha256(jsonCanonico(parserNode.parameters ?? {})).slice(0, 16) } : null;
    if (parserNode) relacoes.push({ origem: ka, destino: chave.node(w.id, parserNode.name), tipo: "usa_parser", evidencia: ev, certeza });

    const tools: ToolDoAgente[] = [];
    for (const s of ligados.filter((x) => x.conexao === "ai_tool")) {
      const t = porNome.get(s.node);
      if (!t) continue;
      const kt = chave.node(w.id, t.name);
      const base = baseDaTool(t.type);
      const leitura = lerNode(t, base, w, kt, certeza, true);
      const opaca = !leitura.reconhecido;
      if (opaca && !t.disabled) avisos.push(`tool "${t.name}" (${w.name}) é opaca: o Meraki não vê o que ela toca`);
      const ferramenta: ToolDoAgente = {
        nome: nomeDeTool(t), node: t.name, tipo: t.type, descricao: descricaoDeTool(t),
        argumentos: argumentosFromAi(t.parameters), alvos: [...new Set(leitura.relacoes.map((r) => r.destino))].sort(), opaca, desativada: Boolean(t.disabled),
      };
      tools.push(ferramenta);
      if (!t.disabled) relacoes.push({ origem: ka, destino: kt, tipo: "usa_tool", evidencia: { ...ev, tool: ferramenta.nome }, certeza });
    }
    tools.sort((x, y) => x.nome.localeCompare(y.nome));

    // Gatilhos alcançáveis voltando pelo fluxo principal; entrada ramificada quando chega por mais de um caminho ou depois de um IF/Switch.
    const gatilhos = new Set<string>();
    const vistos = new Set<string>([a.name]);
    const fila = [...(entradas.get(a.name) ?? [])];
    while (fila.length) {
      const atual = fila.shift()!;
      if (vistos.has(atual)) continue;
      vistos.add(atual);
      const no = porNome.get(atual);
      if (no && ehGatilho(no.type) && tipoBase(no.type) !== "evaluationTrigger") gatilhos.add(atual);
      fila.push(...(entradas.get(atual) ?? []));
    }
    const diretos = entradas.get(a.name) ?? [];
    const entradaRamificada = diretos.length > 1 || diretos.some((d) => RAMIFICAM.has(tipoBase(porNome.get(d)?.type ?? "")));

    const config: ConfigAgente = {
      node: a.name, tipo: a.type, desativado: Boolean(a.disabled), prompt: { sistema, entrada },
      modelo: modelo?.n ? modeloDe(modelo.n) : null, fallback: fallback?.n ? modeloDe(fallback.n) : null,
      memoria, parser, tools, opcoes: opcoesBrutas, gatilhos: [...gatilhos].sort(), entrada_ramificada: entradaRamificada,
    };
    saida.push({ config, hash: hashDoAgente(config), relacoes, avisos });
  }
  return saida;
}

/**
 * Contagem de exemplos literais no prompt (heurística): blocos marcados como exemplo ou, sem marca, falas de
 * cliente. "Exemplo 1:" seguido de "Cliente:" é um exemplo só (vale o maior dos dois jeitos de contar).
 */
export function exemplosNoPrompt(texto: string): number {
  const contar = (re: RegExp) => [...texto.matchAll(re)].length;
  const marcados = contar(/^\s*(?:[-*]\s*)?(?:exemplo\s*\d*\s*[:.)–-]|ex\.?\s*:|<exemplo>)/gim);
  const falas = contar(/^\s*(?:[-*]\s*)?(?:cliente|usu[aá]rio|user)\s*:/gim);
  return Math.max(marcados, falas);
}

/** O prompt lê $json direto (sem $('Node')): vem do item que chegou, que muda conforme o ramo. */
export const leJsonDireto = (texto: string) => /\$json\b/.test(texto);

function hashVersao(v: VersaoN8n): string {
  return sha256(jsonCanonico({ nodes: (v.nodes ?? []).map((n) => ({ ...n, position: undefined, id: undefined })), connections: v.connections ?? {} })).slice(0, 16);
}

export function montarSnapshot(workflows: WorkflowN8n[], execucoes: Map<string, { total: number; erros: number }>, modo: string): Snapshot {
  const objetos = new Map<string, Objeto>();
  const relacoes: Relacao[] = [];
  const observacoes: Observacao[] = [];
  const avisos: string[] = [];

  for (const w of [...workflows].sort((a, b) => a.id.localeCompare(b.id))) {
    const kw = chave.workflow(w.id);
    const rascunho: VersaoN8n = { nodes: w.nodes ?? [], connections: w.connections ?? {} };
    const publicado: VersaoN8n | null = w.activeVersion?.nodes ? w.activeVersion : estaNoAr(w) ? rascunho : null;
    if (estaNoAr(w) && !w.activeVersion?.nodes && w.activeVersionId && w.versionId && w.activeVersionId !== w.versionId) {
      avisos.push(`workflow "${w.name}": a versão publicada (${w.activeVersionId}) não veio na leitura; o rascunho foi usado no lugar dela`);
    }
    const divergente = Boolean(w.activeVersion?.nodes) && hashVersao(rascunho) !== hashVersao(w.activeVersion!);
    const base = publicado ?? rascunho;
    const certeza: Certeza = publicado ? "exata" : "inferida";
    const nodes = base.nodes ?? [];

    objetos.set(kw, {
      tipo: "workflow", chave: kw, nome: w.name, pai: null,
      atributos: {
        nome: w.name, ativo: estaNoAr(w), publicado: Boolean(publicado), tags: nomesDeTags(w),
        gatilhos: nodes.filter((n) => ehGatilho(n.type)).map((n) => n.name).sort(),
        trata_erros: nodes.some((n) => tipoBase(n.type) === "errorTrigger"),
        error_workflow: w.settings?.errorWorkflow ?? null, nodes: nodes.length,
        versao_publicada: w.activeVersionId ?? null, divergente,
        rascunho_editado_em: divergente ? (w.updatedAt ?? null) : null,
        rascunho_hash: hashVersao(rascunho), publicado_hash: publicado ? hashVersao(publicado) : null,
      },
    });
    const erros = execucoes.get(w.id);
    if (erros) observacoes.push({ chave: kw, origem: "n8n_execucoes", leituras: erros.total, escritas: erros.erros, absoluto: true });

    // Agentes: lidos no publicado (relações) e no rascunho (só a versão, para a tela mostrar a divergência).
    const agentes = lerAgentes(w, base, certeza);
    const doRascunho = new Map((publicado ? lerAgentes(w, rascunho, "inferida") : agentes).map((x) => [x.config.node, x]));
    const tools = new Map<string, { agente: string; tool: ToolDoAgente }>();
    for (const ag of agentes) {
      const c = ag.config;
      const ka = chave.agente(w.id, c.node);
      const r = doRascunho.get(c.node);
      const sistema = c.prompt.sistema;
      objetos.set(ka, {
        tipo: "agente", chave: ka, nome: c.node, pai: kw,
        atributos: {
          workflow: w.id, node: c.node, tipo: c.tipo, desativado: c.desativado,
          versao: publicado ? ag.hash : null, rascunho_versao: r?.hash ?? null,
          rascunho_divergente: Boolean(publicado) && Boolean(r) && r!.hash !== ag.hash,
          publicado: Boolean(publicado), version_id: w.activeVersionId ?? null,
          modelo: c.modelo, fallback: c.fallback, memoria: c.memoria, parser: c.parser, opcoes: c.opcoes,
          tools: c.tools.map((t) => ({ nome: t.nome, node: t.node, tipo: t.tipo, descricao: t.descricao, argumentos: t.argumentos, alvos: t.alvos, opaca: t.opaca, desativada: t.desativada })),
          gatilhos: c.gatilhos, entrada_ramificada: c.entrada_ramificada,
          avaliacao_nativa: nodes.some((n) => tipoBase(n.type) === "evaluationTrigger"),
          desvia_ensaio: nodes.some((n) => tipoBase(n.type) === "evaluation" && n.parameters?.operation === "checkIfEvaluating"),
          prompt_tamanho: sistema.length,
        },
      });
      const kp = chave.prompt(w.id, c.node);
      objetos.set(kp, {
        tipo: "prompt", chave: kp, nome: `Prompt de ${c.node}`, pai: ka,
        atributos: {
          agente: ka, sistema: sistema.slice(0, 20_000), entrada: c.prompt.entrada.slice(0, 2_000), tamanho: sistema.length,
          hash: sha256(jsonCanonico(c.prompt)).slice(0, 16), le_json: leJsonDireto(sistema) || leJsonDireto(c.prompt.entrada),
          exemplos: exemplosNoPrompt(sistema),
        },
      });
      relacoes.push(...ag.relacoes);
      avisos.push(...ag.avisos);
      for (const t of c.tools) tools.set(t.node, { agente: ka, tool: t });
    }

    for (const n of nodes) {
      const kn = chave.node(w.id, n.name);
      const p = n.parameters ?? {};
      const credenciais = Object.entries(n.credentials ?? {}).filter(([, c]) => c?.id);
      const ev = { workflow: w.name, node: n.name };
      const atributos: Record<string, unknown> = {
        workflow: w.id, tipo: n.type, versao: n.typeVersion ?? 1, desativado: Boolean(n.disabled), gatilho: ehGatilho(n.type),
        credenciais: credenciais.map(([, c]) => c.id!).sort(), parametros_hash: sha256(jsonCanonico(p)).slice(0, 16),
      };
      if (ehAgente(n.type)) {
        atributos.ia = true;
        atributos.agente = chave.agente(w.id, n.name);
      }

      for (const [tipoCred, c] of credenciais) {
        const kc = chave.credencial(c.id!);
        if (!objetos.has(kc)) objetos.set(kc, { tipo: "credencial", chave: kc, nome: c.name ?? c.id!, pai: null, atributos: { nome: c.name ?? null, tipo: tipoCred } });
        relacoes.push({ origem: kn, destino: kc, tipo: "usa_credencial", evidencia: ev, certeza: "exata" });
      }

      const tool = tools.get(n.name);
      if (tool) {
        // Tool de agente: o tipo base é o node comum (postgresTool → postgres) e os argumentos vêm do $fromAI.
        const leitura = lerNode(n, baseDaTool(n.type), w, kn, certeza, true);
        Object.assign(atributos, leitura.atributos, {
          tool: { nome: tool.tool.nome, agente: tool.agente, descricao: tool.tool.descricao, argumentos: tool.tool.argumentos, opaca: tool.tool.opaca },
        });
        if (!n.disabled) relacoes.push(...leitura.relacoes);
        avisos.push(...leitura.avisos);
      } else {
        const leitura = lerNode(n, tipoBase(n.type), w, kn, certeza, false);
        Object.assign(atributos, leitura.atributos);
        relacoes.push(...leitura.relacoes);
        avisos.push(...leitura.avisos);
      }

      for (const t of textos(p)) {
        for (const m of t.matchAll(REF_NODE)) {
          const alvo = m[1] ?? m[2];
          if (alvo && alvo !== n.name) relacoes.push({ origem: kn, destino: chave.node(w.id, alvo), tipo: "usa_saida", evidencia: ev, certeza: "exata" });
        }
      }
      objetos.set(kn, { tipo: "node", chave: kn, nome: n.name, pai: kw, atributos });
    }

    // Fluxo entre nodes (conexões principais do publicado; as conexões ai_* viraram relações do agente)
    for (const [origem, saidas] of Object.entries(base.connections ?? {})) {
      for (const ramo of saidas?.main ?? []) {
        for (const destino of ramo ?? []) {
          relacoes.push({ origem: chave.node(w.id, origem), destino: chave.node(w.id, destino.node), tipo: "segue", evidencia: { workflow: w.name }, certeza: "exata" });
        }
      }
    }
  }

  const unicas = new Map<string, Relacao>();
  for (const r of relacoes) unicas.set(`${r.origem}→${r.destino}:${r.tipo}`, r);
  return { objetos: [...objetos.values()], relacoes: [...unicas.values()], observacoes, modo, avisos: [...new Set(avisos)] };
}

function dividirRef(ref: string): [string, string] {
  const i = ref.indexOf(".");
  return i < 0 ? ["public", ref] : [ref.slice(0, i), ref.slice(i + 1)];
}
