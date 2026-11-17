/**
 * Regras → achados → métricas. Achado se resolve sozinho quando a coleta para de ver; nada fecha na mão.
 * A primeira coleta é a linha de base: o que já existia é dívida herdada, o resto é dívida nova.
 */
import type pg from "pg";
import { carregarEstadoAgentes } from "./agentes/estado.ts";
import { contratoVazio } from "./contrato/esquema.ts";
import { Intencao } from "./contrato/intencao.ts";
import { gerarRascunho } from "./contrato/rascunho.ts";
import type { Grafo } from "./grafo.ts";
import { plataforma, transacao } from "./plataforma/db.ts";
import {
  type Projeto,
  carregarGrafo,
  contratoAtual,
  excecoesAtivas,
  gravarContrato,
  linhasDeBase,
} from "./plataforma/repositorio.ts";
import { REGRAS, VERSAO_REGRAS, avaliarRegras } from "./regras/index.ts";
import { type AchadoBruto, type Severidade, chaveDedupe } from "./tipos.ts";

export interface Contagem {
  critico: number;
  alto: number;
  medio: number;
  baixo: number;
}

/** Índice de saúde = max(0, 100 − (10C + 4A + 1,5M + 0,3B) / (N/100)). Achados com exceção ativa ficam fora. */
export function indiceDeSaude(c: Contagem, objetos: number): number {
  if (objetos <= 0) return 100;
  const peso = 10 * c.critico + 4 * c.alto + 1.5 * c.medio + 0.3 * c.baixo;
  return Math.max(0, Math.round((100 - peso / (objetos / 100)) * 10) / 10);
}

/** Cobertura do contrato: tabelas e funções do escopo que estão declaradas. */
export function cobertura(grafo: Grafo, intencao: Intencao) {
  const avaliados = [...grafo.objetos.values()].filter((o) => (o.tipo === "tabela" || o.tipo === "funcao") && !intencao.ignorado(o.chave));
  const declarados = avaliados.filter((o) => intencao.declarado(o.chave)).length;
  return { avaliados: avaliados.length, declarados, pct: avaliados.length ? Math.round((declarados / avaliados.length) * 10000) / 100 : 100 };
}

export interface ResultadoVerificacao {
  contratoVersao: number | null;
  brutos: AchadoBruto[];
  novos: number;
  resolvidos: number;
  reabertos: number;
  abertos: Contagem;
  saude: number;
  cobertura: number;
  contratoCriado: boolean;
  /** chave_dedupe dos achados cobertos por exceção ativa (contam fora do índice). */
  emExcecao: string[];
}

export async function montarIntencao(projeto: Projeto, grafo: Grafo) {
  const contrato = await contratoAtual(projeto.id);
  const intencao = new Intencao(contrato?.conteudo ?? contratoVazio(projeto.slug), grafo, await excecoesAtivas(projeto.id));
  return { contrato, intencao };
}

/** Roda as regras sobre o último estado gravado. Com `gravar`, reconcilia achados e métricas. */
export async function verificarProjeto(
  projeto: Projeto,
  opcoes: { gravar: boolean; agora?: Date; primeiraColeta?: boolean; coletas?: Map<string, string> },
): Promise<ResultadoVerificacao> {
  const agora = opcoes.agora ?? new Date();
  const grafo = await carregarGrafo(projeto.id);
  const { contrato, intencao } = await montarIntencao(projeto, grafo);
  const agentes = await carregarEstadoAgentes(projeto.id);
  const brutos = avaliarRegras(grafo, intencao, { agora, agentes });
  const cob = cobertura(grafo, intencao);
  const emExcecao = brutos.filter((b) => intencao.excecao(b.regra, [b.objeto, b.par], agora)).map(chaveDedupe);

  if (!opcoes.gravar) {
    const existentes = (await plataforma().query("select chave_dedupe, status from public.achados where projeto_id = $1", [projeto.id])).rows;
    const abertosAntes = new Set(existentes.filter((e) => e.status !== "resolvido").map((e) => e.chave_dedupe));
    const agoraChaves = new Set(brutos.map(chaveDedupe));
    const abertos = contar(brutos.filter((b) => !intencao.excecao(b.regra, [b.objeto, b.par], agora)));
    return {
      contratoVersao: contrato?.versao ?? null, brutos,
      novos: [...agoraChaves].filter((k) => !abertosAntes.has(k)).length,
      resolvidos: [...abertosAntes].filter((k) => !agoraChaves.has(k)).length,
      reabertos: 0, abertos, saude: indiceDeSaude(abertos, grafo.objetos.size), cobertura: cob.pct, contratoCriado: false, emExcecao,
    };
  }

  return transacao(async (c) => {
    await sincronizarRegras(c, projeto.conta_id);
    const bases = await linhasDeBase(projeto.id, c);
    const herdado = (b: AchadoBruto) => {
      if (opcoes.primeiraColeta) return true;
      return [b.objeto, b.par].filter(Boolean).every((k) => {
        const no = grafo.get(k!);
        if (!no) return false;
        const base = bases.get(no.fonteId);
        if (!base || !no.vistoDesde) return true;
        const limite = Date.parse(base);
        return Date.parse(no.vistoDesde) <= limite && (!no.alteradoEm || Date.parse(no.alteradoEm) <= limite);
      });
    };
    const r = await reconciliarAchados(c, projeto, grafo, intencao, brutos, { agora, herdado, coletas: opcoes.coletas ?? new Map() });

    let contratoCriado = false;
    let versao = contrato?.versao ?? null;
    if (!contrato) {
      const fontes = [...grafo.fontes.values()];
      versao = await gravarContrato(projeto, gerarRascunho(projeto.slug, grafo, fontes), "meraki", "Rascunho v0 gerado a partir da primeira coleta", c);
      contratoCriado = true;
    }
    const saude = await gravarMetricas(c, projeto, grafo, cob);
    return { contratoVersao: versao, brutos, ...r, saude, cobertura: cob.pct, contratoCriado, emExcecao };
  });
}

function contar(lista: { severidade: Severidade }[]): Contagem {
  const c: Contagem = { critico: 0, alto: 0, medio: 0, baixo: 0 };
  for (const a of lista) c[a.severidade]++;
  return c;
}

async function sincronizarRegras(c: pg.PoolClient, contaId: string) {
  const catalogo = REGRAS.map((r) => ({
    codigo: r.codigo, pacote: r.pacote, titulo: r.titulo, descricao: r.descricao, alvo: r.alvo,
    severidade_padrao: r.severidade, bloqueia_no_gate: r.bloqueia, versao: VERSAO_REGRAS,
  }));
  await c.query(
    `insert into public.regras (conta_id, codigo, pacote, titulo, descricao, alvo, severidade_padrao, bloqueia_no_gate, versao)
     select $1, x.codigo, x.pacote, x.titulo, x.descricao, x.alvo, x.severidade_padrao, x.bloqueia_no_gate, x.versao
       from jsonb_to_recordset($2::jsonb) as x(codigo text, pacote text, titulo text, descricao text, alvo text, severidade_padrao text, bloqueia_no_gate boolean, versao int)
     on conflict (conta_id, codigo) do update set pacote = excluded.pacote, titulo = excluded.titulo, descricao = excluded.descricao, alvo = excluded.alvo,
        severidade_padrao = excluded.severidade_padrao, bloqueia_no_gate = excluded.bloqueia_no_gate, versao = excluded.versao
      where (public.regras.titulo, public.regras.descricao, public.regras.severidade_padrao, public.regras.bloqueia_no_gate, public.regras.versao)
        is distinct from (excluded.titulo, excluded.descricao, excluded.severidade_padrao, excluded.bloqueia_no_gate, excluded.versao)`,
    [contaId, JSON.stringify(catalogo)],
  );
}

async function reconciliarAchados(
  c: pg.PoolClient,
  projeto: Projeto,
  grafo: Grafo,
  intencao: Intencao,
  brutos: AchadoBruto[],
  ctx: { agora: Date; herdado: (b: AchadoBruto) => boolean; coletas: Map<string, string> },
) {
  const existentes = (await c.query("select id, chave_dedupe, status from public.achados where projeto_id = $1", [projeto.id])).rows;
  const porChave = new Map(existentes.map((e) => [e.chave_dedupe as string, e]));
  const vistos = new Set<string>();
  const inserir: Record<string, unknown>[] = [];
  const atualizar: Record<string, unknown>[] = [];
  let reabertos = 0;
  for (const b of brutos) {
    const k = chaveDedupe(b);
    if (vistos.has(k)) continue;
    vistos.add(k);
    const ex = intencao.excecao(b.regra, [b.objeto, b.par], ctx.agora);
    const status = ex ? "excecao" : "aberto";
    const fonte = grafo.get(b.objeto)?.fonteId ?? (b.par ? grafo.get(b.par)?.fonteId : undefined);
    const coleta = fonte ? ctx.coletas.get(fonte) : undefined;
    const evidencia = { ...b.evidencia, ...(coleta ? { coleta } : {}), ...(ex ? { excecao: { motivo: ex.motivo, ate: ex.ate, origem: ex.origem } } : {}) };
    const atual = porChave.get(k);
    const base = { severidade: b.severidade, status, titulo: b.titulo, detalhe: b.detalhe ?? null, evidencia, coleta_id: coleta ?? null };
    if (!atual) {
      inserir.push({ ...base, regra: b.regra, objeto_chave: b.objeto, par_chave: b.par ?? null, chave_dedupe: k, herdado: ctx.herdado(b) });
    } else {
      const reabre = status === "aberto" && (atual.status === "resolvido" || atual.status === "excecao");
      if (reabre) reabertos++;
      atualizar.push({ ...base, id: atual.id, reabre });
    }
  }
  const resolver = existentes.filter((e) => e.status !== "resolvido" && !vistos.has(e.chave_dedupe)).map((e) => e.id);

  if (inserir.length) {
    await c.query(
      `insert into public.achados (conta_id, projeto_id, regra, objeto_chave, par_chave, chave_dedupe, severidade, status, herdado, titulo, detalhe,
                                   evidencia, primeiro_visto, ultimo_visto, coleta_id)
       select $1, $2, x.regra, x.objeto_chave, x.par_chave, x.chave_dedupe, x.severidade, x.status, x.herdado, x.titulo, x.detalhe, x.evidencia, $3, $3, x.coleta_id
         from jsonb_to_recordset($4::jsonb) as x(regra text, objeto_chave text, par_chave text, chave_dedupe text, severidade text, status text,
                                                 herdado boolean, titulo text, detalhe text, evidencia jsonb, coleta_id uuid)`,
      [projeto.conta_id, projeto.id, ctx.agora, JSON.stringify(inserir)],
    );
  }
  if (atualizar.length) {
    await c.query(
      `update public.achados a set severidade = x.severidade, status = x.status, titulo = x.titulo, detalhe = x.detalhe, evidencia = x.evidencia,
              ultimo_visto = $2, resolvido_em = null, coleta_id = coalesce(x.coleta_id, a.coleta_id),
              reaberturas = a.reaberturas + case when x.reabre then 1 else 0 end
         from jsonb_to_recordset($1::jsonb) as x(id uuid, severidade text, status text, titulo text, detalhe text, evidencia jsonb, coleta_id uuid, reabre boolean)
        where a.id = x.id`,
      [JSON.stringify(atualizar), ctx.agora],
    );
  }
  if (resolver.length) {
    await c.query("update public.achados set status = 'resolvido', resolvido_em = $2 where id = any($1)", [resolver, ctx.agora]);
  }
  const abertos = contar(brutos.filter((b, i, l) => l.findIndex((x) => chaveDedupe(x) === chaveDedupe(b)) === i && !intencao.excecao(b.regra, [b.objeto, b.par], ctx.agora)));
  return { novos: inserir.length, resolvidos: resolver.length, reabertos, abertos };
}

async function gravarMetricas(c: pg.PoolClient, projeto: Projeto, grafo: Grafo, cob: ReturnType<typeof cobertura>): Promise<number> {
  const a = (
    await c.query(
      `select
         count(*) filter (where status = 'aberto' and severidade = 'critico')::int as critico,
         count(*) filter (where status = 'aberto' and severidade = 'alto')::int as alto,
         count(*) filter (where status = 'aberto' and severidade = 'medio')::int as medio,
         count(*) filter (where status = 'aberto' and severidade = 'baixo')::int as baixo,
         count(*) filter (where status = 'aberto' and not herdado and severidade in ('critico', 'alto'))::int as novos_ca,
         count(*) filter (where status = 'aberto' and herdado)::int as herdados,
         count(*) filter (where status = 'excecao')::int as excecoes,
         count(*) filter (where status = 'aberto' and regra = 'E10')::int as drift
       from public.achados where projeto_id = $1`,
      [projeto.id],
    )
  ).rows[0];
  const g = (
    await c.query(
      `select count(*) filter (where decisao = 'permitiu')::int as permitiu, count(*) filter (where decisao = 'perguntou')::int as perguntou,
              count(*) filter (where decisao = 'negou')::int as negou
         from public.gate_eventos where projeto_id = $1 and criado_em >= current_date`,
      [projeto.id],
    )
  ).rows[0];
  const k = (
    await c.query(
      `select count(*) filter (where c.status = 'ok')::int as ok, count(*) filter (where c.status = 'erro')::int as erro
         from public.coletas c join public.fontes f on f.id = c.fonte_id where f.projeto_id = $1 and c.inicio >= current_date`,
      [projeto.id],
    )
  ).rows[0];
  const saude = indiceDeSaude(a, grafo.objetos.size);
  await c.query(
    `insert into public.metricas_diarias (conta_id, projeto_id, dia, objetos, avaliados, declarados, cobertura, critico, alto, medio, baixo,
            novos_critico_alto, herdados_abertos, excecoes_ativas, drift, gate_permitiu, gate_perguntou, gate_negou, coletas_ok, coletas_erro, saude, atualizado_em)
     values ($1, $2, current_date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, now())
     on conflict (projeto_id, dia) do update set objetos = excluded.objetos, avaliados = excluded.avaliados, declarados = excluded.declarados,
        cobertura = excluded.cobertura, critico = excluded.critico, alto = excluded.alto, medio = excluded.medio, baixo = excluded.baixo,
        novos_critico_alto = excluded.novos_critico_alto, herdados_abertos = excluded.herdados_abertos, excecoes_ativas = excluded.excecoes_ativas,
        drift = excluded.drift, gate_permitiu = excluded.gate_permitiu, gate_perguntou = excluded.gate_perguntou, gate_negou = excluded.gate_negou,
        coletas_ok = excluded.coletas_ok, coletas_erro = excluded.coletas_erro, saude = excluded.saude, atualizado_em = now()`,
    [
      projeto.conta_id, projeto.id, grafo.objetos.size, cob.avaliados, cob.declarados, cob.pct, a.critico, a.alto, a.medio, a.baixo,
      a.novos_ca, a.herdados, a.excecoes, a.drift, g.permitiu, g.perguntou, g.negou, k.ok, k.erro, saude,
    ],
  );
  return saude;
}
