/** Leituras e escritas do motor no banco da plataforma. Nenhuma linha aqui conhece um projeto específico. */
import type pg from "pg";
import { validarContrato, type Contrato } from "../contrato/esquema.ts";
import type { ExcecaoAtiva } from "../contrato/intencao.ts";
import { Grafo, type FonteDoGrafo, type NoGrafo, type UsoDoDia } from "../grafo.ts";
import type { Relacao, TipoFonte } from "../tipos.ts";
import { plataforma } from "./db.ts";

type Exec = Pick<pg.Pool, "query"> | Pick<pg.PoolClient, "query"> | Pick<pg.Client, "query">;

export interface Projeto {
  id: string;
  conta_id: string;
  slug: string;
  nome: string;
}

export interface Fonte {
  id: string;
  conta_id: string;
  projeto_id: string;
  tipo: TipoFonte;
  nome: string;
  config: Record<string, unknown>;
  segredo_id: string | null;
  ativa: boolean;
}

export async function listarProjetos(slug?: string, db: Exec = plataforma()): Promise<Projeto[]> {
  const r = await db.query<Projeto>(
    "select id, conta_id, slug, nome from public.projetos where ($1::text is null or slug = $1) order by slug",
    [slug ?? null],
  );
  return r.rows;
}

export async function projetoPorSlug(slug: string, db: Exec = plataforma()): Promise<Projeto> {
  const [p] = await listarProjetos(slug, db);
  if (!p) throw new Error(`projeto ${slug} não existe na plataforma`);
  return p;
}

export async function fontesDoProjeto(projetoId: string, db: Exec = plataforma()): Promise<Fonte[]> {
  const r = await db.query<Fonte>(
    "select id, conta_id, projeto_id, tipo, nome, config, segredo_id, ativa from public.fontes where projeto_id = $1 order by tipo, nome",
    [projetoId],
  );
  return r.rows;
}

/** Só o motor chama isto. A web não tem acesso ao schema vault. */
export async function lerSegredo(segredoId: string, db: Exec = plataforma()): Promise<string> {
  const r = await db.query<{ v: string }>("select decrypted_secret as v from vault.decrypted_secrets where id = $1", [segredoId]);
  if (!r.rows[0]) throw new Error("segredo da fonte não encontrado no Vault");
  return r.rows[0].v;
}

export async function contratoAtual(projetoId: string, db: Exec = plataforma()): Promise<{ versao: number; conteudo: Contrato; autor: string; criado_em: string } | null> {
  const r = await db.query("select versao, conteudo, autor, criado_em from public.contratos where projeto_id = $1 order by versao desc limit 1", [projetoId]);
  const linha = r.rows[0];
  if (!linha) return null;
  return { versao: linha.versao, conteudo: validarContrato({ ...linha.conteudo, versao: linha.versao }), autor: linha.autor, criado_em: linha.criado_em };
}

export async function gravarContrato(projeto: Projeto, conteudo: Contrato, autor: string, motivo: string, db: Exec = plataforma()): Promise<number> {
  const r = await db.query<{ versao: number }>(
    `insert into public.contratos (conta_id, projeto_id, versao, conteudo, autor, motivo)
     select $1, $2, coalesce(max(versao) + 1, 0), $3::jsonb || jsonb_build_object('versao', coalesce(max(versao) + 1, 0)), $4, $5
       from public.contratos where projeto_id = $2
     returning versao`,
    [projeto.conta_id, projeto.id, JSON.stringify(conteudo), autor, motivo],
  );
  return r.rows[0].versao;
}

export async function excecoesAtivas(projetoId: string, db: Exec = plataforma()): Promise<ExcecaoAtiva[]> {
  const r = await db.query(
    `select regra, objeto_chave as objeto, motivo, valida_ate::text as ate, autor from public.excecoes
      where projeto_id = $1 and revogada_em is null and valida_ate >= current_date`,
    [projetoId],
  );
  return r.rows.map((e) => ({ ...e, origem: "tela" as const }));
}

/** Grafo do projeto a partir do que está gravado (última coleta de cada fonte). */
export async function carregarGrafo(projetoId: string, db: Exec = plataforma(), diasDeUso = 60): Promise<Grafo> {
  const fontes = await db.query<FonteDoGrafo & { modo: string | null }>(
    `select f.id, f.tipo, f.nome, f.config,
            (select c.modo from public.coletas c where c.fonte_id = f.id and c.status = 'ok' order by c.inicio desc limit 1) as modo
       from public.fontes f where f.projeto_id = $1 and f.ativa`,
    [projetoId],
  );
  const ids = fontes.rows.map((f) => f.id);
  const tipoDaFonte = new Map(fontes.rows.map((f) => [f.id, f.tipo]));
  const objetos = await db.query(
    `select id, fonte_id, tipo, chave, nome, pai_chave, atributos, visto_desde, alterado_em
       from public.objetos where fonte_id = any($1) and removido_em is null`,
    [ids],
  );
  const relacoes = await db.query(
    `select origem_chave as origem, destino_chave as destino, tipo, evidencia, certeza
       from public.relacoes where fonte_id = any($1) and removido_em is null`,
    [ids],
  );
  const uso = await db.query(
    `select o.chave, u.dia, u.origem, u.leituras, u.escritas, u.linhas, u.vazia
       from public.uso_diario u join public.objetos o on o.id = u.objeto_id
      where o.fonte_id = any($1) and u.dia > current_date - $2::int
      order by o.chave, u.origem, u.dia`,
    [ids, diasDeUso],
  );
  const mapaUso = new Map<string, UsoDoDia[]>();
  for (const u of uso.rows) {
    const l = mapaUso.get(u.chave) ?? [];
    l.push({ dia: u.dia, origem: u.origem, leituras: u.leituras, escritas: u.escritas, linhas: u.linhas, vazia: u.vazia });
    mapaUso.set(u.chave, l);
  }
  const nos: NoGrafo[] = objetos.rows.map((o) => ({
    tipo: o.tipo, chave: o.chave, nome: o.nome, pai: o.pai_chave, atributos: o.atributos,
    fonteId: o.fonte_id, fonteTipo: tipoDaFonte.get(o.fonte_id)!, vistoDesde: iso(o.visto_desde), alteradoEm: o.alterado_em ? iso(o.alterado_em) : null,
  }));
  return new Grafo(nos, relacoes.rows as Relacao[], fontes.rows, mapaUso);
}

/** Fim da primeira coleta com sucesso de cada fonte: a linha de base da dívida herdada. */
export async function linhasDeBase(projetoId: string, db: Exec = plataforma()): Promise<Map<string, string>> {
  const r = await db.query(
    `select f.id, min(c.fim) as base from public.fontes f join public.coletas c on c.fonte_id = f.id and c.status = 'ok'
      where f.projeto_id = $1 group by f.id`,
    [projetoId],
  );
  return new Map(r.rows.map((x) => [x.id, iso(x.base)]));
}

export function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}
