/**
 * Coleta → normalização → diff → gravação.
 * Hash por objeto: só o que mudou gera versão. Coleta sem mudança grava uma linha em coletas e nada mais.
 */
import type pg from "pg";
import { coletorPara } from "./coletores/index.ts";
import { plataforma, transacao } from "./plataforma/db.ts";
import { type Fonte, type Projeto, fontesDoProjeto, lerSegredo } from "./plataforma/repositorio.ts";
import type { Objeto, Relacao, Snapshot } from "./tipos.ts";
import { hashAtributos } from "./util/hash.ts";
import { RAIZ, VERSAO_MOTOR } from "./util/raiz.ts";

export interface ResultadoGravacao {
  total: number;
  novos: number;
  alterados: number;
  removidos: number;
}

export interface ResultadoFonte extends Partial<ResultadoGravacao> {
  fonteId: string;
  fonte: string;
  tipo: string;
  coletaId: string;
  status: "ok" | "erro";
  modo?: string;
  erro?: string;
  avisos: string[];
  ms: number;
}

function dedupeObjetos(objetos: Objeto[]): Objeto[] {
  const m = new Map<string, Objeto>();
  for (const o of objetos) m.set(o.chave, o);
  return [...m.values()];
}

export async function gravarSnapshot(c: pg.PoolClient, fonte: Fonte, coletaId: string, snap: Snapshot, agora: Date): Promise<ResultadoGravacao> {
  const objetos = dedupeObjetos(snap.objetos);
  const existentes = (await c.query("select id, chave, hash, removido_em from public.objetos where fonte_id = $1", [fonte.id])).rows;
  const porChave = new Map(existentes.map((r) => [r.chave as string, r]));

  type Linha = { tipo: string; chave: string; nome: string; pai: string | null; atributos: Record<string, unknown>; hash: string };
  const novos: Linha[] = [];
  const recriados: Linha[] = [];
  const alterados: Linha[] = [];
  const vistos = new Set<string>();
  for (const o of objetos) {
    vistos.add(o.chave);
    const linha: Linha = { tipo: o.tipo, chave: o.chave, nome: o.nome, pai: o.pai ?? null, atributos: o.atributos, hash: hashAtributos(o.atributos) };
    const ex = porChave.get(o.chave);
    if (!ex) novos.push(linha);
    else if (ex.removido_em) recriados.push(linha);
    else if (ex.hash !== linha.hash) alterados.push(linha);
  }
  const sumiram = existentes.filter((r) => !r.removido_em && !vistos.has(r.chave));

  const versoes: { objeto_id: string; hash: string; atributos: unknown; mudanca: string }[] = [];
  const colunas = "x(tipo text, chave text, nome text, pai text, atributos jsonb, hash text)";
  if (novos.length) {
    const r = await c.query(
      `insert into public.objetos (conta_id, fonte_id, tipo, chave, nome, pai_chave, atributos, hash, visto_desde)
       select $1, $2, x.tipo, x.chave, x.nome, x.pai, x.atributos, x.hash, $3 from jsonb_to_recordset($4::jsonb) as ${colunas}
       returning id, hash, atributos`,
      [fonte.conta_id, fonte.id, agora, JSON.stringify(novos)],
    );
    versoes.push(...r.rows.map((x) => ({ objeto_id: x.id, hash: x.hash, atributos: x.atributos, mudanca: "novo" })));
  }
  for (const [lista, mudanca] of [[recriados, "recriado"], [alterados, "alterado"]] as const) {
    if (!lista.length) continue;
    const r = await c.query(
      `update public.objetos o set tipo = x.tipo, nome = x.nome, pai_chave = x.pai, atributos = x.atributos, hash = x.hash,
              alterado_em = $2, removido_em = null
         from jsonb_to_recordset($3::jsonb) as ${colunas}
        where o.fonte_id = $1 and o.chave = x.chave
        returning o.id, o.hash, o.atributos`,
      [fonte.id, agora, JSON.stringify(lista)],
    );
    versoes.push(...r.rows.map((x) => ({ objeto_id: x.id, hash: x.hash, atributos: x.atributos, mudanca })));
  }
  if (sumiram.length) {
    await c.query("update public.objetos set removido_em = $2 where id = any($1)", [sumiram.map((r) => r.id), agora]);
    versoes.push(...sumiram.map((r) => ({ objeto_id: r.id, hash: r.hash, atributos: null, mudanca: "removido" })));
  }
  if (versoes.length) {
    await c.query(
      `insert into public.objeto_versoes (conta_id, objeto_id, coleta_id, hash, atributos, mudanca, criado_em)
       select $1, x.objeto_id, $2, x.hash, x.atributos, x.mudanca, $3
         from jsonb_to_recordset($4::jsonb) as x(objeto_id uuid, hash text, atributos jsonb, mudanca text)`,
      [fonte.conta_id, coletaId, agora, JSON.stringify(versoes)],
    );
  }

  await gravarRelacoes(c, fonte, snap.relacoes, agora);
  await gravarUso(c, fonte, snap, agora);

  return { total: objetos.length, novos: novos.length + recriados.length, alterados: alterados.length, removidos: sumiram.length };
}

async function gravarRelacoes(c: pg.PoolClient, fonte: Fonte, relacoes: Relacao[], agora: Date) {
  const id = (r: { origem: string; destino: string; tipo: string }) => `${r.origem}→${r.destino}:${r.tipo}`;
  const existentes = (await c.query("select id, origem_chave as origem, destino_chave as destino, tipo, certeza, removido_em from public.relacoes where fonte_id = $1", [fonte.id])).rows;
  const porId = new Map(existentes.map((r) => [id(r), r]));
  const unicas = new Map(relacoes.map((r) => [id(r), r]));
  const inserir: Relacao[] = [];
  const reativar: { id: string; evidencia: unknown; certeza: string }[] = [];
  for (const [k, r] of unicas) {
    const ex = porId.get(k);
    if (!ex) inserir.push(r);
    else if (ex.removido_em || ex.certeza !== r.certeza) reativar.push({ id: ex.id, evidencia: r.evidencia, certeza: r.certeza });
  }
  const sumiram = existentes.filter((r) => !r.removido_em && !unicas.has(id(r))).map((r) => r.id);
  if (inserir.length) {
    await c.query(
      `insert into public.relacoes (conta_id, fonte_id, origem_chave, destino_chave, tipo, evidencia, certeza, visto_desde)
       select $1, $2, x.origem, x.destino, x.tipo, coalesce(x.evidencia, '{}'), x.certeza, $3
         from jsonb_to_recordset($4::jsonb) as x(origem text, destino text, tipo text, evidencia jsonb, certeza text)`,
      [fonte.conta_id, fonte.id, agora, JSON.stringify(inserir)],
    );
  }
  if (reativar.length) {
    await c.query(
      `update public.relacoes r set removido_em = null, evidencia = x.evidencia, certeza = x.certeza
         from jsonb_to_recordset($1::jsonb) as x(id uuid, evidencia jsonb, certeza text) where r.id = x.id`,
      [JSON.stringify(reativar)],
    );
  }
  if (sumiram.length) await c.query("update public.relacoes set removido_em = $2 where id = any($1)", [sumiram, agora]);
}

/** Contadores brutos viram delta do dia; delta negativo é reset de estatística (conta o valor atual). */
async function gravarUso(c: pg.PoolClient, fonte: Fonte, snap: Snapshot, _agora: Date) {
  if (!snap.observacoes.length) return;
  const ids = new Map(
    (await c.query("select id, chave from public.objetos where fonte_id = $1 and removido_em is null", [fonte.id])).rows.map((r) => [r.chave as string, r.id as string]),
  );
  const hoje = (await c.query("select current_date::text as d")).rows[0].d as string;
  const ultimos = new Map(
    (
      await c.query(
        `select distinct on (objeto_id, origem) objeto_id, origem, dia::text as dia, leituras, escritas, linhas, vazia, base_leituras, base_escritas
           from public.uso_diario where objeto_id = any($1) order by objeto_id, origem, dia desc`,
        [[...ids.values()]],
      )
    ).rows.map((r) => [`${r.objeto_id}|${r.origem}`, r]),
  );
  const delta = (atual: number | undefined, base: number | null | undefined) => {
    if (atual === undefined || base === null || base === undefined) return 0;
    const d = atual - base;
    return d < 0 ? atual : d;
  };
  const linhas: Record<string, unknown>[] = [];
  for (const o of snap.observacoes) {
    const objetoId = ids.get(o.chave);
    if (!objetoId) continue;
    const ultimo = ultimos.get(`${objetoId}|${o.origem}`);
    const mesmoDia = ultimo?.dia === hoje;
    let leituras: number;
    let escritas: number;
    if (o.absoluto) {
      leituras = o.leituras ?? 0;
      escritas = o.escritas ?? 0;
    } else {
      leituras = (mesmoDia ? Number(ultimo.leituras) : 0) + delta(o.leituras, ultimo?.base_leituras);
      escritas = (mesmoDia ? Number(ultimo.escritas) : 0) + delta(o.escritas, ultimo?.base_escritas);
    }
    const linha = {
      objeto_id: objetoId, origem: o.origem, leituras, escritas,
      linhas: o.linhas !== undefined ? o.linhas : mesmoDia ? ultimo.linhas : null,
      vazia: o.vazia !== undefined ? o.vazia : mesmoDia ? ultimo.vazia : null,
      base_leituras: o.absoluto ? null : (o.leituras ?? null),
      base_escritas: o.absoluto ? null : (o.escritas ?? null),
    };
    const igual = mesmoDia && Number(ultimo.leituras) === leituras && Number(ultimo.escritas) === escritas && ultimo.linhas === linha.linhas
      && ultimo.vazia === linha.vazia && ultimo.base_leituras === linha.base_leituras && ultimo.base_escritas === linha.base_escritas;
    if (!igual) linhas.push(linha);
  }
  if (!linhas.length) return;
  await c.query(
    `insert into public.uso_diario (conta_id, objeto_id, dia, origem, leituras, escritas, linhas, vazia, base_leituras, base_escritas, atualizado_em)
     select $1, x.objeto_id, current_date, x.origem, x.leituras, x.escritas, x.linhas, x.vazia, x.base_leituras, x.base_escritas, now()
       from jsonb_to_recordset($2::jsonb) as x(objeto_id uuid, origem text, leituras bigint, escritas bigint, linhas bigint, vazia boolean, base_leituras bigint, base_escritas bigint)
     on conflict (objeto_id, dia, origem) do update set leituras = excluded.leituras, escritas = excluded.escritas, linhas = excluded.linhas,
        vazia = excluded.vazia, base_leituras = excluded.base_leituras, base_escritas = excluded.base_escritas, atualizado_em = now()`,
    [fonte.conta_id, JSON.stringify(linhas)],
  );
}

/** Coleta todas as fontes ativas do projeto, uma por vez. Falha numa fonte não derruba as outras. */
export async function coletarFontes(projeto: Projeto, log: (s: string) => void = () => undefined): Promise<ResultadoFonte[]> {
  const resultados: ResultadoFonte[] = [];
  for (const fonte of (await fontesDoProjeto(projeto.id)).filter((f) => f.ativa)) {
    const t0 = performance.now();
    const agora = new Date();
    const { rows } = await plataforma().query(
      "insert into public.coletas (conta_id, fonte_id, versao_motor, status, inicio) values ($1, $2, $3, 'rodando', $4) returning id",
      [fonte.conta_id, fonte.id, VERSAO_MOTOR, agora],
    );
    const coletaId = rows[0].id as string;
    try {
      const segredo = fonte.segredo_id ? await lerSegredo(fonte.segredo_id) : null;
      const snap = await coletorPara(fonte.tipo).coletar(
        { id: fonte.id, projetoId: projeto.id, projetoSlug: projeto.slug, tipo: fonte.tipo, nome: fonte.nome, config: fonte.config, segredo },
        { raiz: RAIZ, agora },
      );
      const r = await transacao((c) => gravarSnapshot(c, fonte, coletaId, snap, agora));
      await plataforma().query(
        `update public.coletas set status = 'ok', fim = now(), modo = $2, total = $3, novos = $4, alterados = $5, removidos = $6, avisos = $7 where id = $1`,
        [coletaId, snap.modo, r.total, r.novos, r.alterados, r.removidos, snap.avisos.slice(0, 50)],
      );
      resultados.push({ fonteId: fonte.id, fonte: fonte.nome, tipo: fonte.tipo, coletaId, status: "ok", modo: snap.modo, avisos: snap.avisos, ms: Math.round(performance.now() - t0), ...r });
      log(`  ${fonte.nome} (${fonte.tipo}) · ${r.total} objetos · +${r.novos} ~${r.alterados} −${r.removidos} · ${snap.modo}`);
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      await plataforma().query("update public.coletas set status = 'erro', fim = now(), erro = $2 where id = $1", [coletaId, erro.slice(0, 2000)]);
      resultados.push({ fonteId: fonte.id, fonte: fonte.nome, tipo: fonte.tipo, coletaId, status: "erro", erro, avisos: [], ms: Math.round(performance.now() - t0) });
      log(`  ${fonte.nome} (${fonte.tipo}) · ERRO: ${erro}`);
    }
  }
  return resultados;
}
