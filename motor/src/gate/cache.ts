/**
 * Cache offline do gate em .meraki/cache/<projeto>.json: último snapshot, contrato, propostas e exceções.
 * O gate decide com ele, sem rede. Sem cache, pergunta.
 */
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";
import type { Contrato } from "../contrato/esquema.ts";
import type { ExcecaoAtiva } from "../contrato/intencao.ts";
import type { FonteDoGrafo, NoGrafo } from "../grafo.ts";
import { comPrazo } from "../plataforma/db.ts";
import type { Relacao, Severidade } from "../tipos.ts";

export interface PropostaEmCache {
  id: string;
  status: "aberta" | "aprovada" | "recusada";
  objetos: string[];
  justificativa: string;
  decisao_motivo: string | null;
  decidido_em: string | null;
}

export interface CacheProjeto {
  versao: 1;
  gerado_em: string;
  projeto: { id: string; conta_id: string; slug: string; nome: string };
  contrato_versao: number | null;
  contrato: Contrato;
  fontes: FonteDoGrafo[];
  objetos: NoGrafo[];
  relacoes: Relacao[];
  propostas: PropostaEmCache[];
  excecoes: ExcecaoAtiva[];
  abertos: Record<Severidade, number>;
}

export function pastaMeraki(diretorio: string): string {
  return join(diretorio, ".meraki");
}

function arquivoCache(diretorio: string, slug: string): string {
  return join(pastaMeraki(diretorio), "cache", `${slug}.json`);
}

/** O contrato já entra validado em montarCache: aqui não carrega zod/yaml (o gate tem menos de 1 s). */
export async function lerCache(diretorio: string, slug: string): Promise<CacheProjeto | null> {
  try {
    const c = JSON.parse(await readFile(arquivoCache(diretorio, slug), "utf8")) as CacheProjeto;
    const valido = c.versao === 1 && c.projeto?.slug === slug && Array.isArray(c.objetos) && Array.isArray(c.fontes) && Boolean(c.contrato?.objetos);
    return valido ? c : null;
  } catch {
    return null;
  }
}

export async function salvarCache(diretorio: string, cache: CacheProjeto): Promise<void> {
  const destino = arquivoCache(diretorio, cache.projeto.slug);
  await mkdir(join(pastaMeraki(diretorio), "cache"), { recursive: true });
  const tmp = `${destino}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(cache));
  await rename(tmp, destino);
}

export async function montarCache(c: Pick<pg.Client, "query">, slug: string): Promise<CacheProjeto> {
  const { contratoVazio, validarContrato } = await import("../contrato/esquema.ts");
  const p = (await c.query("select id, conta_id, slug, nome from public.projetos where slug = $1", [slug])).rows[0];
  if (!p) throw new Error(`projeto ${slug} não existe na plataforma`);
  const contrato = (await c.query("select versao, conteudo from public.contratos where projeto_id = $1 order by versao desc limit 1", [p.id])).rows[0];
  const fontes = (await c.query("select id, tipo, nome, config from public.fontes where projeto_id = $1 and ativa", [p.id])).rows as FonteDoGrafo[];
  const ids = fontes.map((f) => f.id);
  const tipo = new Map(fontes.map((f) => [f.id, f.tipo]));
  const objetos = (
    await c.query(
      "select fonte_id, tipo, chave, nome, pai_chave, atributos, visto_desde, alterado_em from public.objetos where fonte_id = any($1) and removido_em is null",
      [ids],
    )
  ).rows.map((o) => ({
    tipo: o.tipo, chave: o.chave, nome: o.nome, pai: o.pai_chave, atributos: o.atributos, fonteId: o.fonte_id, fonteTipo: tipo.get(o.fonte_id)!,
    vistoDesde: new Date(o.visto_desde).toISOString(), alteradoEm: o.alterado_em ? new Date(o.alterado_em).toISOString() : null,
  })) as NoGrafo[];
  const relacoes = (
    await c.query(
      "select origem_chave as origem, destino_chave as destino, tipo, evidencia, certeza from public.relacoes where fonte_id = any($1) and removido_em is null",
      [ids],
    )
  ).rows as Relacao[];
  const propostas = (
    await c.query(
      `select id, status, coalesce(array(select jsonb_array_elements_text(payload -> 'objetos')), '{}') as objetos, justificativa, decisao_motivo,
              decidido_em from public.propostas where projeto_id = $1 order by criado_em desc limit 200`,
      [p.id],
    )
  ).rows.map((x) => ({ ...x, decidido_em: x.decidido_em ? new Date(x.decidido_em).toISOString() : null })) as PropostaEmCache[];
  const excecoes = (
    await c.query(
      `select regra, objeto_chave as objeto, motivo, valida_ate::text as ate, autor from public.excecoes
        where projeto_id = $1 and revogada_em is null and valida_ate >= current_date`,
      [p.id],
    )
  ).rows.map((e) => ({ ...e, origem: "tela" as const }));
  const abertos = { critico: 0, alto: 0, medio: 0, baixo: 0 } as Record<Severidade, number>;
  for (const r of (await c.query("select severidade, count(*)::int as n from public.achados where projeto_id = $1 and status = 'aberto' group by 1", [p.id])).rows) {
    abertos[r.severidade as Severidade] = r.n;
  }
  return {
    versao: 1, gerado_em: new Date().toISOString(), projeto: p, contrato_versao: contrato?.versao ?? null,
    contrato: contrato ? validarContrato({ ...contrato.conteudo, versao: contrato.versao }) : contratoVazio(slug),
    fontes, objetos, relacoes, propostas, excecoes, abertos,
  };
}

/** Baixa o estado da plataforma com prazo. Lança se não conseguir. */
export async function baixarCache(slug: string, prazoMs: number): Promise<CacheProjeto> {
  return comPrazo(prazoMs, (c) => montarCache(c, slug));
}

export async function anotarPendente(diretorio: string, evento: Record<string, unknown>): Promise<void> {
  await mkdir(join(pastaMeraki(diretorio), "cache"), { recursive: true });
  await appendFile(join(pastaMeraki(diretorio), "cache", "eventos-pendentes.jsonl"), `${JSON.stringify(evento)}\n`);
}
