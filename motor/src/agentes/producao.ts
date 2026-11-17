/**
 * Produção por agente, versão e dia. A consulta é gerada do mapeamento do contrato e roda no banco do cliente
 * com o leitor do projeto: volta só contagem e até 20 ids por dia, nunca texto de conversa.
 * Execuções (erro e latência) vêm do n8n, só status e horários.
 *
 * Cada resposta conta para a versão publicada naquele momento (linha do tempo de publicação). O que cai no
 * intervalo entre uma publicação e a coleta que a viu fica marcado como versão incerta e sai das comparações.
 */
import type pg from "pg";
import { listarExecucoes } from "../coletores/n8n.ts";
import type { AgenteDoContrato } from "../contrato/esquema.ts";
import type { Grafo } from "../grafo.ts";
import { plataforma, transacao } from "../plataforma/db.ts";
import { type Projeto, carregarGrafo, contratoAtual, iso, lerSegredo } from "../plataforma/repositorio.ts";
import { RAIZ } from "../util/raiz.ts";
import { normalizar } from "./checagens.ts";
import { chaveDoAgente, comLeitor, diaLocal, fonteDaTabela, fontePorId, ident, percentil, tabelaSql, temColuna } from "./comum.ts";

export interface Periodo {
  hash: string;
  inicio: string;
  fim: string | null;
  inicioMinimo: string | null;
}

interface Linha {
  hash: string;
  dia: string;
  conversas: number;
  repasses: number;
  conversoes: number;
  violacoes: number;
  exemplos: string[];
  execucoes: number;
  erros: number;
  latencias: number[];
  incerta: boolean;
}

export interface ResultadoProducao {
  agente: string;
  nome: string;
  dias: number;
  conversas: number;
  violacoes: number;
  execucoes: number;
  avisos: string[];
}

/** Versão no ar num instante e se o instante cai num intervalo incerto. Mesma lógica da consulta SQL. */
export function versaoEm(periodos: Periodo[], t: number): { hash: string | null; incerta: boolean } {
  const ordenados = [...periodos].sort((a, b) => Date.parse(b.inicio) - Date.parse(a.inicio));
  const dentro = ordenados.find((p) => t >= Date.parse(p.inicio) && (!p.fim || t < Date.parse(p.fim)));
  const janela = (p: Periodo) => p.inicioMinimo !== null && t >= Date.parse(p.inicioMinimo) && t < Date.parse(p.inicio);
  const incerta = ordenados.some(janela);
  return { hash: dentro?.hash ?? ordenados.find(janela)?.hash ?? null, incerta };
}

const escaparRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Letras acentuadas nas duas caixas (lower() em locale C não mexe nelas) e a letra sem acento de cada uma. */
const COM_ACENTO = "áàâãäåéèêëíìîïóòôõöúùûüçñýÿÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ";
const SEM_ACENTO = [...COM_ACENTO].map((l) => normalizar(l)).join("");

/**
 * Palavras proibidas no SQL com a mesma regra das checagens dos casos (checagens.ts): minúsculas, sem acento,
 * espaço único e termo inteiro. Assim a violação de produção e a do caso de referência contam a mesma coisa.
 */
export function condicaoDeProibidas(proibidas: string[], p: (v: unknown) => string): string | null {
  const termos = proibidas.map(normalizar).filter(Boolean);
  if (!termos.length) return null;
  const padroes = termos.map((t) => `(^|[^[:alnum:]])${escaparRegex(t)}($|[^[:alnum:]])`);
  return `regexp_replace(translate(lower(texto), ${p(COM_ACENTO)}, ${p(SEM_ACENTO)}), '\\s+', ' ', 'g') ~ any(${p(padroes)}::text[])`;
}

export interface ConsultaSql {
  sql: string;
  parametros: unknown[];
}

/**
 * SQL de produção a partir do mapeamento. Identificadores vêm do contrato (validados e entre aspas);
 * valores entram como parâmetro. Duas consultas: conversas (volume, repasse, conversão) e violações.
 * Nas duas, $1..$4 são os períodos de publicação e $5/$6 a janela (preenchidos por `preencher`).
 */
export function consultasDeProducao(config: AgenteDoContrato, grafo?: Grafo): { conversas: ConsultaSql; violacoes: ConsultaSql } | null {
  const m = config.conversas;
  if (!m) return null;
  const montar = (parte: "conversas" | "violacoes"): ConsultaSql => {
    const parametros: unknown[] = [];
    const p = (v: unknown) => {
      parametros.push(v);
      return `$${parametros.length}`;
    };
    const periodos = `unnest(${p([])}::text[], ${p([])}::timestamptz[], ${p([])}::timestamptz[], ${p([])}::timestamptz[]) as p(hash, inicio, fim, inicio_minimo)`;
    const desde = p(null);
    const ate = p(null);
    const escopo = (alias: string, tabela: string) => {
      if (!config.escopo) return "";
      if (grafo && !temColuna(grafo, tabela, config.escopo.coluna)) return "";
      return ` and ${alias}.${ident(config.escopo.coluna)}::text = ${p(String(config.escopo.valor))}::text`;
    };
    const base = `
    with periodos as (select * from ${periodos}),
    r as (
      select m.${ident(m.id)}::text as id, m.${ident(m.contato)}::text as contato, m.${ident(m.momento)} as momento,
             regexp_replace(coalesce(m.${ident(m.texto)}::text, ''), 'https?://\\S+', '', 'g') as texto
        from ${tabelaSql(m.tabela)} m
       where m.${ident(m.autor.coluna)}::text = ${p(String(m.autor.agente))}::text
         and m.${ident(m.momento)} >= ${desde}::timestamptz and m.${ident(m.momento)} < ${ate}::timestamptz${escopo("m", m.tabela)}
    ),
    v as (
      select r.*,
             coalesce(
               (select x.hash from periodos x where r.momento >= x.inicio and (x.fim is null or r.momento < x.fim) order by x.inicio desc limit 1),
               (select x.hash from periodos x where x.inicio_minimo is not null and r.momento >= x.inicio_minimo and r.momento < x.inicio order by x.inicio desc limit 1)
             ) as hash,
             exists (select 1 from periodos x where x.inicio_minimo is not null and r.momento >= x.inicio_minimo and r.momento < x.inicio) as incerta
        from r
    )`;

    if (parte === "conversas") {
      const evento = (e: { tabela: string; contato: string; momento: string } | undefined, condicao: (col: string) => string) =>
        e
          ? `exists (select 1 from ${tabelaSql(e.tabela)} e where e.${ident(e.contato)}::text = c.contato and ${condicao(`e.${ident(e.momento)}`)}${escopo("e", e.tabela)})`
          : "false";
      const repasse = evento(config.eventos.repasse, (col) => `${col} >= c.dia::timestamptz and ${col} < (c.dia + 1)::timestamptz`);
      const conversao = evento(
        config.eventos.conversao,
        (col) => `${col} >= c.primeira and ${col} < c.primeira + make_interval(days => ${p(config.eventos.conversao?.janela_dias ?? 7)}::int)`,
      );
      return {
        parametros,
        sql: `${base},
    c as (
      select hash, momento::date as dia, contato, min(momento) as primeira, bool_or(incerta) as incerta
        from v where hash is not null group by 1, 2, 3
    )
    select c.hash, c.dia::text as dia, count(*)::int as conversas,
           count(*) filter (where ${repasse})::int as repasses,
           count(*) filter (where ${conversao})::int as conversoes,
           bool_or(c.incerta) as incerta
      from c group by 1, 2 order by 2, 1`,
      };
    }

    const pol = config.politicas;
    const condicoes: string[] = [];
    const proibidas = condicaoDeProibidas(pol.proibidas, p);
    if (proibidas) condicoes.push(proibidas);
    if (pol.max_caracteres) condicoes.push(`length(btrim(texto)) > ${p(pol.max_caracteres)}::int`);
    if (pol.max_perguntas !== undefined) condicoes.push(`length(texto) - length(replace(texto, '?', '')) > ${p(pol.max_perguntas)}::int`);
    return {
      parametros,
      sql: `${base}
    select hash, momento::date::text as dia, count(*)::int as violacoes,
           (array_agg(id order by momento desc))[1:20] as exemplos, bool_or(incerta) as incerta
      from v
     where hash is not null and (${condicoes.length ? condicoes.join(" or ") : "false"})
     group by 1, 2 order by 2, 1`,
    };
  };
  return { conversas: montar("conversas"), violacoes: montar("violacoes") };
}

function preencher(parametros: unknown[], periodos: Periodo[], desde: Date, ate: Date): unknown[] {
  const v = [...parametros];
  v[0] = periodos.map((x) => x.hash);
  v[1] = periodos.map((x) => x.inicio);
  v[2] = periodos.map((x) => x.fim);
  v[3] = periodos.map((x) => x.inicioMinimo);
  v[4] = desde;
  v[5] = ate;
  return v;
}

async function periodosDe(projetoId: string, agente: string): Promise<Periodo[]> {
  return (
    await plataforma().query("select hash, inicio, fim, inicio_minimo from public.agente_publicacoes where projeto_id = $1 and agente = $2 order by inicio", [projetoId, agente])
  ).rows.map((r) => ({ hash: r.hash, inicio: iso(r.inicio), fim: r.fim ? iso(r.fim) : null, inicioMinimo: r.inicio_minimo ? iso(r.inicio_minimo) : null }));
}

const vazia = (hash: string, dia: string): Linha => ({ hash, dia, conversas: 0, repasses: 0, conversoes: 0, violacoes: 0, exemplos: [], execucoes: 0, erros: 0, latencias: [], incerta: false });

/** Recalcula os últimos `dias` de produção de cada agente declarado no contrato. */
export async function atualizarProducao(projeto: Projeto, opcoes: { dias?: number; agora?: Date } = {}): Promise<ResultadoProducao[]> {
  const agora = opcoes.agora ?? new Date();
  const dias = opcoes.dias ?? 30;
  const contrato = (await contratoAtual(projeto.id))?.conteudo;
  const declarados = Object.entries(contrato?.agentes ?? {});
  if (!declarados.length) return [];
  const grafo = await carregarGrafo(projeto.id);
  const desdeDia = diaLocal(new Date(agora.getTime() - (dias - 1) * 86_400_000));
  const desde = new Date(agora.getTime() - dias * 86_400_000);
  const saida: ResultadoProducao[] = [];

  for (const [nome, config] of declarados) {
    const agente = chaveDoAgente(config);
    const avisos: string[] = [];
    const no = grafo.get(agente);
    if (!no) {
      saida.push({ agente, nome, dias: 0, conversas: 0, violacoes: 0, execucoes: 0, avisos: [`o agente ${agente} do contrato não existe no último estado do n8n`] });
      continue;
    }
    const periodos = await periodosDe(projeto.id, agente);
    const linhas = new Map<string, Linha>();
    const linha = (hash: string, dia: string) => {
      const k = `${hash}|${dia}`;
      let l = linhas.get(k);
      if (!l) linhas.set(k, (l = vazia(hash, dia)));
      return l;
    };

    // Banco do cliente: agregados e ids.
    const consultas = consultasDeProducao(config, grafo);
    if (consultas && periodos.length) {
      try {
        const fonte = await fonteDaTabela(projeto.id, grafo, config.conversas!.tabela);
        const [conv, viol] = await comLeitor(fonte, async (c) => [
          (await c.query(consultas.conversas.sql, preencher(consultas.conversas.parametros, periodos, desde, agora))).rows,
          (await c.query(consultas.violacoes.sql, preencher(consultas.violacoes.parametros, periodos, desde, agora))).rows,
        ]);
        for (const r of conv) {
          const l = linha(r.hash, r.dia);
          Object.assign(l, { conversas: r.conversas, repasses: r.repasses, conversoes: r.conversoes, incerta: l.incerta || r.incerta });
        }
        for (const r of viol) {
          const l = linha(r.hash, r.dia);
          l.violacoes = r.violacoes;
          l.exemplos = (r.exemplos ?? []).slice(0, 20);
          l.incerta ||= r.incerta;
        }
      } catch (e) {
        avisos.push(`conversas: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (!consultas) {
      avisos.push("sem mapeamento de conversas no contrato: produção só com execuções do n8n");
    }

    // Execuções do n8n: erro e latência.
    try {
      const fonteN8n = await fontePorId(projeto.id, no.fonteId);
      const segredo = fonteN8n.segredo_id ? await lerSegredo(fonteN8n.segredo_id) : null;
      const execucoes = await listarExecucoes({ config: fonteN8n.config, segredo }, { raiz: RAIZ }, String(no.atributos.workflow), desde);
      for (const e of execucoes) {
        const t = Date.parse(e.startedAt);
        if (!(t < agora.getTime())) continue;
        const v = versaoEm(periodos, t);
        if (!v.hash) continue;
        const l = linha(v.hash, diaLocal(new Date(t)));
        l.execucoes++;
        if (e.status === "error" || e.status === "crashed") l.erros++;
        if (e.stoppedAt) l.latencias.push(Math.max(0, Date.parse(e.stoppedAt) - t));
        l.incerta ||= v.incerta;
      }
    } catch (e) {
      avisos.push(`execuções: ${e instanceof Error ? e.message : String(e)}`);
    }

    const lista = [...linhas.values()].filter((l) => l.dia >= desdeDia);
    await gravarLinhas(projeto, agente, desdeDia, lista);
    saida.push({
      agente, nome, dias: new Set(lista.map((l) => l.dia)).size, avisos,
      conversas: lista.reduce((s, l) => s + l.conversas, 0),
      violacoes: lista.reduce((s, l) => s + l.violacoes, 0),
      execucoes: lista.reduce((s, l) => s + l.execucoes, 0),
    });
  }
  return saida;
}

async function gravarLinhas(projeto: Projeto, agente: string, desdeDia: string, linhas: Linha[]) {
  await transacao(async (c: pg.PoolClient) => {
    await c.query("delete from public.agente_metricas_diarias where projeto_id = $1 and agente = $2 and dia >= $3::date", [projeto.id, agente, desdeDia]);
    if (!linhas.length) return;
    const dados = linhas.map((l) => ({
      hash: l.hash, dia: l.dia, conversas: l.conversas, repasses: l.repasses, conversoes: l.conversoes, violacoes: l.violacoes, exemplos: l.exemplos,
      execucoes: l.execucoes, erros: l.erros, p50: percentil(l.latencias, 50), p95: percentil(l.latencias, 95), incerta: l.incerta,
    }));
    await c.query(
      `insert into public.agente_metricas_diarias (conta_id, projeto_id, agente, hash, dia, conversas, repasses, conversoes, violacoes, violacoes_exemplos,
              execucoes, erros, latencia_p50_ms, latencia_p95_ms, versao_incerta, atualizado_em)
       select $1, $2, $3, x.hash, x.dia::date, x.conversas, x.repasses, x.conversoes, x.violacoes, coalesce(x.exemplos, '{}'), x.execucoes, x.erros, x.p50, x.p95, x.incerta, now()
         from jsonb_to_recordset($4::jsonb) as x(hash text, dia text, conversas int, repasses int, conversoes int, violacoes int, exemplos text[],
                                                 execucoes int, erros int, p50 int, p95 int, incerta boolean)`,
      [projeto.conta_id, projeto.id, agente, JSON.stringify(dados)],
    );
  });
}
