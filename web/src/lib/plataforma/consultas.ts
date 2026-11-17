import "server-only";
import { connection } from "next/server";
import type { QueryResultRow } from "pg";
import { cache } from "react";
import { type Cliente, ler, mensagemDeErro } from "./db";
import {
  type Achado,
  type AchadoDoRascunho,
  type Caso,
  type Checagem,
  type Coleta,
  type Contagem,
  type ContratoConteudo,
  type DadosAgentesIA,
  type DadosContrato,
  type DadosGate,
  type DadosShell,
  type DadosVisaoGeral,
  type Decisao,
  type DetalheAgente,
  type DetalheProjeto,
  type EntradaDoCaso,
  type EsperaDoCaso,
  type EstruturaProjeto,
  type EventoGate,
  type Fonte,
  type MetricaDiaria,
  type Objeto,
  type ProjetoRef,
  type Proposta,
  type Publicacao,
  type ResultadoDoCaso,
  type ResumoAgente,
  type ResumoProjeto,
  type Rodada,
  SEVERIDADES,
  type SessaoAgente,
  type Severidade,
  type ToolDoAgente,
  declaracoesDoContrato,
  alvoDoFluxo,
  formasDaRef,
  idDoAgente,
  nomeNoContrato,
  recentesDaVersao,
  somarProducao,
} from "./modelo";

/*
 * Leituras da web. Todas são dinâmicas (dados ao vivo, sem cache): cada função chama connection() e roda
 * dentro de ler(), com a RLS do usuário da sessão. Nenhuma lê segredo nem dado de cliente — só catálogo,
 * agregados e o que o motor gravou.
 */

const ORDEM_SEV = "array_position(array['critico','alto','medio','baixo'], a.severidade)";

const projetoDe = (r: QueryResultRow): ProjetoRef => ({ slug: r.projeto_slug, nome: r.projeto_nome, cor: r.projeto_cor });
const textos = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/* ─────────────────────── Shell ─────────────────────── */

export async function dadosDoShell(): Promise<DadosShell> {
  await connection();
  const agora = Date.now();
  try {
    return await ler(async (c) => {
      const usuario = (await c.query("select nome from public.membros order by criado_em limit 1")).rows[0]?.nome ?? null;
      const conta = (await c.query("select nome from public.contas order by criado_em limit 1")).rows[0]?.nome ?? null;
      const projetos = (
        await c.query(`
          select p.id, p.slug, p.nome, p.cor,
                 (select count(*) from public.achados a where a.projeto_id = p.id and a.status = 'aberto') as abertos,
                 (select count(*) from public.achados a where a.projeto_id = p.id and a.status = 'aberto' and not a.herdado
                     and a.severidade in ('critico', 'alto')) as novos,
                 (select count(*) from public.propostas pr where pr.projeto_id = p.id and pr.status = 'aberta') as propostas,
                 (select count(*) from public.achados a where a.projeto_id = p.id and a.status = 'aberto'
                     and a.objeto_chave like 'n8n:agente:%') as agentes_abertos
            from public.projetos p
           order by p.nome`)
      ).rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        nome: r.nome,
        cor: r.cor,
        abertos: r.abertos,
        novos: r.novos,
        propostas: r.propostas,
        agentesAbertos: r.agentes_abertos,
      }));
      // Agentes de IA de cada projeto (nome do node e o id da URL, que usa o nome do contrato quando há).
      const agentes = (
        await c.query(`
          select p.slug, o.chave, o.nome, ct.conteudo as contrato
            from public.objetos o
            join public.fontes f on f.id = o.fonte_id
            join public.projetos p on p.id = f.projeto_id
            left join lateral (select conteudo from public.contratos where projeto_id = p.id order by versao desc limit 1) ct on true
           where o.tipo = 'agente' and o.removido_em is null
           order by p.slug, o.nome`)
      ).rows.map((r) => ({ slug: r.slug as string, id: idDoAgente(r.chave, nomeNoContrato(r.contrato, r.chave)), nome: r.nome as string }));
      const propostas = (
        await c.query(`
          select pr.id, pr.justificativa, pr.origem, pr.criado_em, p.slug as projeto_slug, p.nome as projeto_nome, p.cor as projeto_cor
            from public.propostas pr join public.projetos p on p.id = pr.projeto_id
           where pr.status = 'aberta'
           order by pr.criado_em desc limit 5`)
      ).rows.map((r) => ({ id: r.id, projeto: projetoDe(r), justificativa: r.justificativa, origem: r.origem, criadoEm: r.criado_em }));
      const novos = (
        await c.query(`
          select a.id, a.regra, a.severidade, a.titulo, a.primeiro_visto, p.slug as projeto_slug, p.nome as projeto_nome, p.cor as projeto_cor
            from public.achados a join public.projetos p on p.id = a.projeto_id
           where a.status = 'aberto' and not a.herdado and a.severidade in ('critico', 'alto')
           order by ${ORDEM_SEV}, a.primeiro_visto desc limit 5`)
      ).rows.map((r) => ({ id: r.id, projeto: projetoDe(r), regra: r.regra, severidade: r.severidade, titulo: r.titulo, primeiroVisto: r.primeiro_visto }));
      const coleta = (
        await c.query(`
          select (select max(co.fim) from public.coletas co where co.status = 'ok') as ultima,
                 (select count(*) from public.fontes f where f.ativa) as fontes`)
      ).rows[0];
      return { agora, usuario, conta, projetos, propostas, novos, ultimaColeta: coleta?.ultima ?? null, fontes: coleta?.fontes ?? 0, agentes };
    });
  } catch (e) {
    return { agora, usuario: null, conta: null, projetos: [], propostas: [], novos: [], ultimaColeta: null, fontes: 0, agentes: [], erro: mensagemDeErro(e) };
  }
}

/* ─────────────────────── Peças compartilhadas ─────────────────────── */

async function resumos(c: Cliente, slug?: string): Promise<ResumoProjeto[]> {
  const { rows } = await c.query(
    `select p.id, p.slug, p.nome, p.descricao, p.cor,
            m.saude, m.cobertura, coalesce(m.objetos, 0) as objetos, coalesce(m.avaliados, 0) as avaliados, coalesce(m.declarados, 0) as declarados,
            a.critico, a.alto, a.medio, a.baixo, a.novos, a.novos_graves, a.herdados, a.excecoes, a.agentes_abertos,
            ct.versao as contrato_versao,
            f.total as fontes, f.erros as coletas_erro, f.ultima as ultima_coleta,
            (select count(*) from public.propostas pr where pr.projeto_id = p.id and pr.status = 'aberta') as propostas_abertas,
            g.permitiu, g.perguntou, g.negou
       from public.projetos p
       left join lateral (
         select saude, cobertura, objetos, avaliados, declarados from public.metricas_diarias where projeto_id = p.id order by dia desc limit 1
       ) m on true
       left join lateral (
         select count(*) filter (where status = 'aberto' and severidade = 'critico') as critico,
                count(*) filter (where status = 'aberto' and severidade = 'alto') as alto,
                count(*) filter (where status = 'aberto' and severidade = 'medio') as medio,
                count(*) filter (where status = 'aberto' and severidade = 'baixo') as baixo,
                count(*) filter (where status = 'aberto' and not herdado) as novos,
                count(*) filter (where status = 'aberto' and not herdado and severidade in ('critico', 'alto')) as novos_graves,
                count(*) filter (where status = 'aberto' and herdado) as herdados,
                count(*) filter (where status = 'excecao') as excecoes,
                count(*) filter (where status = 'aberto' and objeto_chave like 'n8n:agente:%') as agentes_abertos
           from public.achados where projeto_id = p.id
       ) a on true
       left join lateral (select versao from public.contratos where projeto_id = p.id order by versao desc limit 1) ct on true
       left join lateral (
         select count(*) as total, count(*) filter (where u.status = 'erro') as erros, max(u.fim) as ultima
           from public.fontes fo
           left join lateral (select status, fim from public.coletas where fonte_id = fo.id order by inicio desc limit 1) u on true
          where fo.projeto_id = p.id and fo.ativa
       ) f on true
       left join lateral (
         select count(*) filter (where decisao = 'permitiu') as permitiu,
                count(*) filter (where decisao = 'perguntou') as perguntou,
                count(*) filter (where decisao = 'negou') as negou
           from public.gate_eventos where projeto_id = p.id and criado_em > now() - interval '30 days'
       ) g on true
      where $1::text is null or p.slug = $1
      order by p.nome`,
    [slug ?? null],
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    nome: r.nome,
    cor: r.cor,
    descricao: r.descricao,
    saude: r.saude,
    cobertura: r.cobertura,
    objetos: r.objetos,
    avaliados: r.avaliados,
    declarados: r.declarados,
    abertos: { critico: r.critico, alto: r.alto, medio: r.medio, baixo: r.baixo },
    novos: r.novos,
    novosGraves: r.novos_graves,
    herdados: r.herdados,
    excecoes: r.excecoes,
    contratoVersao: r.contrato_versao,
    fontes: r.fontes,
    coletasComErro: r.coletas_erro,
    ultimaColeta: r.ultima_coleta,
    propostasAbertas: r.propostas_abertas,
    gate: { permitiu: r.permitiu, perguntou: r.perguntou, negou: r.negou },
    agentesAbertos: r.agentes_abertos ?? 0,
  }));
}

async function carregarAchados(c: Cliente, filtro: string, params: unknown[]): Promise<Achado[]> {
  const { rows } = await c.query(
    `select a.id, a.projeto_id, a.regra, a.severidade, a.status, a.herdado, a.titulo, a.detalhe, a.objeto_chave, a.par_chave,
            a.evidencia, a.primeiro_visto, a.ultimo_visto, a.resolvido_em, a.reaberturas,
            p.slug as projeto_slug, p.nome as projeto_nome, p.cor as projeto_cor,
            r.titulo as regra_titulo, r.descricao as regra_descricao, r.pacote, coalesce(r.bloqueia_no_gate, false) as bloqueia_no_gate,
            x.motivo as x_motivo, x.valida_ate as x_ate, x.autor as x_autor
       from public.achados a
       join public.projetos p on p.id = a.projeto_id
       left join public.regras r on r.conta_id = a.conta_id and r.codigo = a.regra
       left join lateral (
         select e.motivo, e.valida_ate, e.autor from public.excecoes e
          where e.projeto_id = a.projeto_id and e.regra = a.regra and e.objeto_chave in (a.objeto_chave, coalesce(a.par_chave, ''))
            and e.revogada_em is null and e.valida_ate >= current_date
          order by e.criado_em desc limit 1
       ) x on a.status = 'excecao'
      where ${filtro}
      order by case a.status when 'aberto' then 0 when 'excecao' then 1 else 2 end, ${ORDEM_SEV}, a.herdado, a.primeiro_visto desc, a.titulo`,
    params,
  );
  if (!rows.length) return [];

  // Exceção declarada no contrato (o motor marca o achado; o motivo está no YAML publicado).
  const projetos = [...new Set(rows.filter((r) => r.status === "excecao" && !r.x_motivo).map((r) => r.projeto_id as string))];
  const doContrato = new Map<string, { lista: NonNullable<ContratoConteudo["excecoes"]>; autor: string }>();
  if (projetos.length) {
    const cs = await c.query(
      `select distinct on (projeto_id) projeto_id, conteudo -> 'excecoes' as excecoes, autor
         from public.contratos where projeto_id = any($1::uuid[]) order by projeto_id, versao desc`,
      [projetos],
    );
    for (const r of cs.rows) doContrato.set(r.projeto_id, { lista: Array.isArray(r.excecoes) ? r.excecoes : [], autor: r.autor });
  }

  return rows.map((r) => {
    let excecao: Achado["excecao"] = null;
    if (r.x_motivo) excecao = { motivo: r.x_motivo, ate: r.x_ate, autor: r.x_autor, origem: "tela" };
    else if (r.status === "excecao") {
      // Mesma regra do motor: exceção de um objeto cobre o achado que o envolve; de dois ou mais, todos os objetos do achado.
      const doAchado = [r.objeto_chave as string, r.par_chave as string | null].filter((k): k is string => Boolean(k)).map((k) => new Set(formasDaRef(k)));
      const ct = doContrato.get(r.projeto_id);
      const e = ct?.lista.find((x) => {
        if (x.regra !== r.regra) return false;
        const lista = textos(x.objetos);
        const cobre = (formas: Set<string>) => lista.some((o) => formas.has(o));
        return lista.length > 1 ? doAchado.every(cobre) : doAchado.some(cobre);
      });
      if (e) excecao = { motivo: e.motivo, ate: String(e.ate), autor: ct?.autor ?? null, origem: "contrato" };
    }
    return {
      id: r.id,
      projeto: projetoDe(r),
      regra: r.regra,
      regraTitulo: r.regra_titulo,
      regraDescricao: r.regra_descricao,
      pacote: r.pacote,
      bloqueiaNoGate: r.bloqueia_no_gate,
      severidade: r.severidade,
      status: r.status,
      herdado: r.herdado,
      titulo: r.titulo,
      detalhe: r.detalhe,
      objeto: r.objeto_chave,
      par: r.par_chave,
      evidencia: r.evidencia,
      primeiroVisto: r.primeiro_visto,
      ultimoVisto: r.ultimo_visto,
      resolvidoEm: r.resolvido_em,
      reaberturas: r.reaberturas,
      excecao,
    };
  });
}

async function carregarPropostas(c: Cliente, filtro: string, params: unknown[]): Promise<Proposta[]> {
  const { rows } = await c.query(
    `select pr.id, pr.tipo, pr.origem, pr.sessao, pr.justificativa, pr.status, pr.payload, pr.decisao_motivo, pr.decidido_por,
            pr.decidido_em, pr.contrato_versao, pr.criado_em, p.slug as projeto_slug, p.nome as projeto_nome, p.cor as projeto_cor
       from public.propostas pr join public.projetos p on p.id = pr.projeto_id
      where ${filtro}
      order by case pr.status when 'aberta' then 0 else 1 end, coalesce(pr.decidido_em, pr.criado_em) desc
      limit 200`,
    params,
  );
  return rows.map((r) => {
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    const declaracao = payload.declaracao && typeof payload.declaracao === "object" ? (payload.declaracao as Proposta["declaracao"]) : null;
    return {
      id: r.id,
      projeto: projetoDe(r),
      tipo: r.tipo,
      origem: r.origem,
      sessao: r.sessao,
      justificativa: r.justificativa,
      status: r.status,
      objetos: textos(payload.objetos),
      regras: textos(payload.regras),
      sql: typeof payload.sql === "string" ? payload.sql : null,
      resumo: textos(payload.resumo),
      declaracao,
      decisaoMotivo: r.decisao_motivo,
      decididoPor: r.decidido_por,
      decididoEm: r.decidido_em,
      contratoVersao: r.contrato_versao,
      criadoEm: r.criado_em,
    };
  });
}

async function carregarEventos(c: Cliente, filtro: string, params: unknown[], limite: number): Promise<EventoGate[]> {
  const { rows } = await c.query(
    `select g.id, g.criado_em, g.origem, g.sessao, g.ferramenta, g.modo, g.resumo, g.decisao, g.regras, g.motivo, g.proposta_id, g.duracao_ms,
            p.slug as projeto_slug, p.nome as projeto_nome, p.cor as projeto_cor
       from public.gate_eventos g join public.projetos p on p.id = g.projeto_id
      where ${filtro}
      order by g.criado_em desc
      limit ${Math.max(1, Math.floor(limite))}`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    projeto: projetoDe(r),
    criadoEm: r.criado_em,
    origem: r.origem,
    sessao: r.sessao,
    ferramenta: r.ferramenta,
    modo: r.modo,
    resumo: r.resumo,
    decisao: r.decisao,
    regras: r.regras ?? [],
    motivo: r.motivo,
    propostaId: r.proposta_id,
    duracaoMs: r.duracao_ms,
  }));
}

/* ─────────────────────── Telas ─────────────────────── */

export async function visaoGeral(): Promise<DadosVisaoGeral> {
  await connection();
  const agora = Date.now();
  return ler(async (c) => {
    const projetos = await resumos(c);
    const serie = (
      await c.query(`
        select m.dia, p.slug, m.saude, m.critico + m.alto as graves, m.novos_critico_alto as novos, m.herdados_abertos as herdados
          from public.metricas_diarias m join public.projetos p on p.id = m.projeto_id
         where m.dia > current_date - 30
         order by m.dia, p.slug`)
    ).rows.map((r) => ({ dia: r.dia, slug: r.slug, saude: r.saude, graves: r.graves, novos: r.novos, herdados: r.herdados }));
    const propostas = await carregarPropostas(c, "pr.status = 'aberta'", []);
    const novos = (await carregarAchados(c, "a.status = 'aberto' and not a.herdado", [])).slice(0, 6);
    const gate = await carregarEventos(c, "true", [], 6);
    return { agora, projetos, serie, propostas, novos, gate };
  });
}

export async function listarProjetos(): Promise<{ agora: number; projetos: ResumoProjeto[] }> {
  await connection();
  const agora = Date.now();
  return ler(async (c) => ({ agora, projetos: await resumos(c) }));
}

export async function listarAchados(): Promise<{ agora: number; achados: Achado[] }> {
  await connection();
  const agora = Date.now();
  return ler(async (c) => ({
    agora,
    achados: await carregarAchados(c, "a.status <> 'resolvido' or a.resolvido_em > now() - interval '90 days'", []),
  }));
}

/** Cabeçalho e parte "Sistemas" leem o mesmo projeto: cache() evita a segunda ida ao banco na mesma requisição. */
export const projetoPorSlug = cache(async (slug: string): Promise<DetalheProjeto | null> => {
  await connection();
  const agora = Date.now();
  return ler(async (c) => {
    const [resumo] = await resumos(c, slug);
    if (!resumo) return null;
    const { rows } = await c.query(
      `select f.id, f.tipo, f.nome, f.config, f.ativa, f.segredo_id is not null as tem_segredo,
              (select count(*) from public.coletas where fonte_id = f.id) as coletas,
              u.id as c_id, u.inicio, u.fim, u.status, u.erro, u.modo, u.total, u.novos, u.alterados, u.removidos, u.avisos, u.versao_motor
         from public.fontes f
         left join lateral (select * from public.coletas where fonte_id = f.id order by inicio desc limit 1) u on true
        where f.projeto_id = $1
        order by case f.tipo when 'supabase' then 0 when 'postgres' then 0 when 'n8n' then 1 else 2 end, f.nome`,
      [resumo.id],
    );
    const fontes: Fonte[] = rows.map((r) => {
      const ultima: Coleta | null = r.c_id
        ? {
            id: r.c_id,
            inicio: r.inicio,
            fim: r.fim,
            status: r.status,
            erro: r.erro,
            modo: r.modo,
            total: r.total,
            novos: r.novos,
            alterados: r.alterados,
            removidos: r.removidos,
            avisos: r.avisos ?? [],
            versaoMotor: r.versao_motor,
          }
        : null;
      return { id: r.id, tipo: r.tipo, nome: r.nome, config: r.config ?? {}, ativa: r.ativa, temSegredo: r.tem_segredo, coletas: r.coletas, ultima };
    });
    return { agora, resumo, fontes };
  });
});

export async function estruturaDoProjeto(projetoId: string): Promise<EstruturaProjeto> {
  await connection();
  const agora = Date.now();
  return ler(async (c) => {
    const uso = new Map<string, Objeto["uso"]>();
    for (const r of (
      await c.query(
        `select u.objeto_id, sum(u.leituras) as leituras, sum(u.escritas) as escritas,
                (array_agg(u.linhas order by u.dia desc) filter (where u.linhas is not null))[1] as linhas,
                (array_agg(u.vazia order by u.dia desc) filter (where u.vazia is not null))[1] as vazia
           from public.uso_diario u
           join public.objetos o on o.id = u.objeto_id
           join public.fontes f on f.id = o.fonte_id
          where f.projeto_id = $1 and u.dia > current_date - 7
          group by u.objeto_id`,
        [projetoId],
      )
    ).rows) {
      uso.set(r.objeto_id, { leituras: r.leituras ?? 0, escritas: r.escritas ?? 0, linhas: r.linhas, vazia: r.vazia });
    }

    const versoes = new Map<string, Objeto["versoes"]>();
    for (const r of (
      await c.query(
        `select v.objeto_id, v.mudanca, v.criado_em
           from public.objeto_versoes v
           join public.objetos o on o.id = v.objeto_id
           join public.fontes f on f.id = o.fonte_id
          where f.projeto_id = $1
          order by v.id desc`,
        [projetoId],
      )
    ).rows) {
      const lista = versoes.get(r.objeto_id) ?? [];
      if (lista.length < 12) lista.push({ mudanca: r.mudanca, criadoEm: r.criado_em });
      versoes.set(r.objeto_id, lista);
    }

    const objetos: Objeto[] = (
      await c.query(
        `select o.id, o.fonte_id, f.tipo as fonte_tipo, f.nome as fonte_nome, o.tipo, o.chave, o.nome, o.pai_chave, o.atributos,
                o.visto_desde, o.alterado_em
           from public.objetos o join public.fontes f on f.id = o.fonte_id
          where f.projeto_id = $1 and o.removido_em is null
          order by o.chave`,
        [projetoId],
      )
    ).rows.map((r) => ({
      id: r.id,
      fonte: { id: r.fonte_id, tipo: r.fonte_tipo, nome: r.fonte_nome },
      tipo: r.tipo,
      chave: r.chave,
      nome: r.nome,
      pai: r.pai_chave,
      atributos: r.atributos ?? {},
      vistoDesde: r.visto_desde,
      alteradoEm: r.alterado_em,
      uso: uso.get(r.id) ?? null,
      versoes: versoes.get(r.id) ?? [],
    }));

    const relacoes = (
      await c.query(
        `select r.origem_chave, r.destino_chave, r.tipo, r.certeza, r.evidencia
           from public.relacoes r join public.fontes f on f.id = r.fonte_id
          where f.projeto_id = $1 and r.removido_em is null`,
        [projetoId],
      )
    ).rows.map((r) => ({ origem: r.origem_chave, destino: r.destino_chave, tipo: r.tipo, certeza: r.certeza, evidencia: r.evidencia }));

    const achados = await carregarAchados(
      c,
      "a.projeto_id = $1 and (a.status <> 'resolvido' or a.resolvido_em > now() - interval '90 days')",
      [projetoId],
    );
    const contrato = (await c.query("select versao, conteudo from public.contratos where projeto_id = $1 order by versao desc limit 1", [projetoId])).rows[0];

    return {
      agora,
      objetos,
      relacoes,
      achados,
      declarados: declaracoesDoContrato(contrato?.conteudo as ContratoConteudo | undefined),
      contratoVersao: contrato?.versao ?? null,
    };
  });
}

/** Parte "Gate": o que os agentes de código e o n8n tentaram, o que o gate decidiu e o que foi proposto. */
export async function gateDoProjeto(projetoId: string): Promise<DadosGate> {
  await connection();
  const agora = Date.now();
  return ler(async (c) => {
    const eventos = await carregarEventos(c, "g.projeto_id = $1", [projetoId], 200);
    const propostas = await carregarPropostas(c, "pr.projeto_id = $1", [projetoId]);

    // Sessões de agente: o que cada sessão tentou, o que o gate decidiu e o que ela propôs.
    const sessoes = new Map<string, SessaoAgente>();
    const sessao = (origem: string, id: string | null, quando: string) => {
      const chave = `${origem}\u0000${id ?? ""}`;
      let s = sessoes.get(chave);
      if (!s) {
        s = { sessao: id ?? "sem identificação", origem, inicio: quando, fim: quando, decisoes: { permitiu: 0, perguntou: 0, negou: 0 }, propostas: 0 };
        sessoes.set(chave, s);
      }
      if (quando < s.inicio) s.inicio = quando;
      if (quando > s.fim) s.fim = quando;
      return s;
    };
    for (const e of eventos) sessao(e.origem, e.sessao, e.criadoEm).decisoes[e.decisao as Decisao]++;
    for (const p of propostas) if (p.origem === "agente") sessao("claude-code", p.sessao, p.criadoEm).propostas++;

    return { agora, eventos, propostas, sessoes: [...sessoes.values()].sort((a, b) => (a.fim < b.fim ? 1 : -1)) };
  });
}

export async function contratoDoProjeto(projetoId: string): Promise<DadosContrato> {
  await connection();
  const agora = Date.now();
  return ler(async (c) => {
    const versoes = (await c.query("select versao, conteudo, autor, motivo, criado_em from public.contratos where projeto_id = $1 order by versao desc", [projetoId])).rows;
    const atual = versoes[0]
      ? { versao: versoes[0].versao, autor: versoes[0].autor, motivo: versoes[0].motivo, criadoEm: versoes[0].criado_em, conteudo: versoes[0].conteudo as ContratoConteudo }
      : null;
    const propostas = await carregarPropostas(c, "pr.projeto_id = $1", [projetoId]);
    const excecoes = (
      await c.query(
        `select id, regra, objeto_chave, motivo, autor, valida_ate, criado_em, revogada_em
           from public.excecoes where projeto_id = $1 order by criado_em desc`,
        [projetoId],
      )
    ).rows.map((r) => ({
      id: r.id,
      regra: r.regra,
      objeto: r.objeto_chave,
      motivo: r.motivo,
      autor: r.autor,
      validaAte: r.valida_ate,
      criadoEm: r.criado_em,
      revogadaEm: r.revogada_em,
    }));
    const naoDeclarados = await carregarAchados(c, "a.projeto_id = $1 and a.regra = 'E01' and a.status = 'aberto'", [projetoId]);
    return {
      agora,
      atual,
      versoes: versoes.map((v) => ({ versao: v.versao, autor: v.autor, motivo: v.motivo, criadoEm: v.criado_em })),
      propostas,
      excecoes,
      naoDeclarados,
    };
  });
}

/* ─────────────────────── Agentes de IA (fase 2) ─────────────────────── */

type Linha = QueryResultRow;

const rodadaDe = (r: Linha): Rodada => ({
  id: r.id,
  hash: r.hash,
  motivo: r.motivo,
  status: r.status,
  aprovacao: r.aprovacao,
  casos: r.casos,
  passaram: r.passaram,
  criticosFalhos: r.criticos_falhos ?? [],
  aprovada: r.aprovada,
  executor: r.executor,
  erro: r.erro,
  pedidaPor: r.pedida_por,
  criadoEm: r.criado_em,
  concluidaEm: r.concluida_em,
});

const publicacaoDe = (r: Linha): Publicacao => ({
  hash: r.hash,
  versionId: r.version_id,
  inicio: r.inicio,
  inicioMinimo: r.inicio_minimo,
  fim: r.fim,
  origem: r.origem_hora,
});

const metricaDe = (r: Linha): MetricaDiaria => ({
  hash: r.hash,
  dia: r.dia,
  conversas: r.conversas,
  repasses: r.repasses,
  conversoes: r.conversoes,
  violacoes: r.violacoes,
  exemplos: r.violacoes_exemplos ?? [],
  execucoes: r.execucoes,
  erros: r.erros,
  p50: r.latencia_p50_ms,
  p95: r.latencia_p95_ms,
  incerta: r.versao_incerta,
});

const vazia = (): Contagem => ({ critico: 0, alto: 0, medio: 0, baixo: 0 });
const texto = (v: unknown) => (typeof v === "string" && v ? v : null);

/** Tudo o que a lista e o detalhe precisam para resumir cada agente — numa só leitura, com a RLS do usuário. */
async function carregarResumos(c: Cliente, projetoId: string, agora: number) {
  const contrato = (await c.query("select versao, conteudo from public.contratos where projeto_id = $1 order by versao desc limit 1", [projetoId])).rows[0];
  const conteudo = (contrato?.conteudo ?? null) as ContratoConteudo | null;

  const objetos = (
    await c.query(
      `select o.id, o.chave, o.nome, o.atributos, o.fonte_id, w.chave as wf_chave, w.nome as wf_nome, w.atributos as wf_atributos
         from public.objetos o
         join public.fontes f on f.id = o.fonte_id
         left join public.objetos w on w.fonte_id = o.fonte_id and w.chave = o.pai_chave and w.removido_em is null
        where f.projeto_id = $1 and o.tipo = 'agente' and o.removido_em is null
        order by o.nome`,
      [projetoId],
    )
  ).rows;

  const achados = (
    await c.query(
      `select a.objeto_chave, a.regra, a.titulo, a.severidade from public.achados a
        where a.projeto_id = $1 and a.status = 'aberto' and a.objeto_chave like 'n8n:agente:%'
        order by ${ORDEM_SEV}, a.primeiro_visto desc`,
      [projetoId],
    )
  ).rows;
  const rodadas = (await c.query("select * from public.rodadas where projeto_id = $1 order by criado_em desc limit 400", [projetoId])).rows;
  const publicacoes = (await c.query("select * from public.agente_publicacoes where projeto_id = $1 order by inicio", [projetoId])).rows;
  const metricas = (
    // Folga de dois dias: o recorte exato (o mesmo das regras P2–P4, em UTC) é feito em recentesDaVersao.
    await c.query("select * from public.agente_metricas_diarias where projeto_id = $1 and dia > current_date - 10 order by dia", [projetoId])
  ).rows;
  const casos = (
    await c.query(
      `select c.agente, c.criticidade, c.ativo,
              exists (select 1 from public.rodada_casos rc join public.rodadas r on r.id = rc.rodada_id
                       where rc.caso_id = c.id and r.status = 'concluida') as rodou
         from public.casos c where c.projeto_id = $1`,
      [projetoId],
    )
  ).rows;

  const resumos: (ResumoAgente & { objetoId: string; atributos: Record<string, unknown> })[] = objetos.map((o) => {
    const a = (o.atributos ?? {}) as Record<string, unknown>;
    const wa = (o.wf_atributos ?? {}) as Record<string, unknown>;
    const nomeContrato = nomeNoContrato(conteudo, o.chave);
    const config = nomeContrato ? (conteudo?.agentes?.[nomeContrato] ?? null) : null;
    const versao = texto(a.versao);
    const rascunho = texto(a.rascunho_versao);
    const divergente = Boolean(a.rascunho_divergente);

    const doAgente = achados.filter((x) => x.objeto_chave === o.chave);
    const abertos = vazia();
    for (const x of doAgente) abertos[x.severidade as Severidade]++;
    const rds = rodadas.filter((r) => r.agente === o.chave).map(rodadaDe);
    const concluida = (h: string | null) => (h ? (rds.find((r) => r.hash === h && r.status === "concluida") ?? null) : null);
    const pubs = publicacoes.filter((p) => p.agente === o.chave).map(publicacaoDe);
    const publicacao = pubs.find((p) => !p.fim) ?? pubs.at(-1) ?? null;
    const mapeado = Boolean(config?.conversas);
    const ms = recentesDaVersao(metricas.filter((m) => m.agente === o.chave).map(metricaDe), publicacao?.hash ?? versao, agora);
    const cs = casos.filter((x) => x.agente === o.chave && x.ativo);

    return {
      objetoId: o.id,
      atributos: a,
      chave: o.chave,
      id: idDoAgente(o.chave, nomeContrato),
      nome: o.nome,
      contrato: nomeContrato,
      workflow: { chave: o.wf_chave ?? `n8n:workflow:${a.workflow}`, id: String(a.workflow ?? ""), nome: o.wf_nome ?? String(a.workflow ?? ""), ativo: Boolean(wa.ativo) },
      versao,
      rascunho,
      divergente,
      desativado: Boolean(a.desativado),
      modelo: texto((a.modelo as { nome?: unknown } | null)?.nome),
      fallback: texto((a.fallback as { nome?: unknown } | null)?.nome),
      tools: Array.isArray(a.tools) ? a.tools.length : 0,
      publicacao,
      abertos,
      pior: doAgente[0] ? { regra: doAgente[0].regra, titulo: doAgente[0].titulo, severidade: doAgente[0].severidade } : null,
      rodadaPublicada: concluida(versao),
      rodadaRascunho: divergente ? concluida(rascunho) : null,
      rodadaEmCurso: rds.find((r) => r.status === "pedida" || r.status === "rodando") ?? null,
      producao: mapeado || ms.length ? somarProducao(ms) : null,
      casos: { ativos: cs.length, criticos: cs.filter((x) => x.criticidade === "critico").length, nuncaRodaram: cs.filter((x) => !x.rodou).length },
      metas: config?.metas ?? {},
      conversasMapeadas: mapeado,
    };
  });

  // Pior primeiro: severidade do pior achado aberto, quantos achados, aprovação da versão publicada.
  const peso = (r: ResumoAgente) => (r.pior ? SEVERIDADES.indexOf(r.pior.severidade) : 9);
  resumos.sort(
    (x, y) =>
      peso(x) - peso(y) ||
      SEVERIDADES.reduce((s, k) => s + y.abertos[k], 0) - SEVERIDADES.reduce((s, k) => s + x.abertos[k], 0) ||
      (x.rodadaPublicada?.aprovacao ?? 2) - (y.rodadaPublicada?.aprovacao ?? 2) ||
      x.nome.localeCompare(y.nome),
  );
  return { resumos, conteudo, contratoVersao: (contrato?.versao as number | undefined) ?? null };
}

/** O resumo que vai para a tela, sem o que só a consulta usa (id do objeto e atributos crus). */
function semInternos(r: ResumoAgente & { objetoId: string; atributos: Record<string, unknown> }): ResumoAgente {
  const copia: Partial<typeof r> = { ...r };
  delete copia.objetoId;
  delete copia.atributos;
  return copia as ResumoAgente;
}

export async function agentesDoProjeto(projetoId: string): Promise<DadosAgentesIA> {
  await connection();
  const agora = Date.now();
  return ler(async (c) => {
    const { resumos, contratoVersao } = await carregarResumos(c, projetoId, agora);
    return { agora, agentes: resumos.map(semInternos), contratoVersao };
  });
}

export async function agenteDoProjeto(projeto: { id: string; slug: string; nome: string }, id: string): Promise<DetalheAgente | null> {
  await connection();
  const agora = Date.now();
  return ler(async (c) => {
    const { resumos, conteudo } = await carregarResumos(c, projeto.id, agora);
    // O id da URL é o nome no contrato (ou o slug); a chave do objeto também serve (links que só conhecem a chave).
    const r = resumos.find((x) => x.id === id) ?? resumos.find((x) => x.chave === id);
    if (!r) return null;
    const a = r.atributos;
    const chavePrompt = r.chave.replace(/^n8n:agente:/, "n8n:prompt:");

    const prompt = (
      await c.query(
        `select o.id, o.atributos from public.objetos o join public.fontes f on f.id = o.fonte_id
          where f.projeto_id = $1 and o.chave = $2 and o.removido_em is null limit 1`,
        [projeto.id, chavePrompt],
      )
    ).rows[0];
    const pa = (prompt?.atributos ?? {}) as Record<string, unknown>;
    const promptHistorico = prompt
      ? (
          await c.query(
            `select (v.atributos ->> 'tamanho')::int as tamanho, v.criado_em from public.objeto_versoes v
              where v.objeto_id = $1 and v.atributos ? 'tamanho' order by v.id`,
            [prompt.id],
          )
        ).rows.map((x) => ({ tamanho: x.tamanho as number, criadoEm: x.criado_em as string }))
      : [];

    const ferramentas = (Array.isArray(a.tools) ? a.tools : []) as ToolDoAgente[];
    const chavesAlvo = [...new Set(ferramentas.flatMap((t) => (t.alvos ?? []).map(alvoDoFluxo)))];
    const exatas = chavesAlvo.filter((k) => !k.endsWith("(*)"));
    const porNome = chavesAlvo.filter((k) => k.endsWith("(*)")).map((k) => `${k.slice(0, -3)}(%`);
    const encontrados = (
      await c.query(
        `select o.chave, o.tipo, o.nome from public.objetos o join public.fontes f on f.id = o.fonte_id
          where f.projeto_id = $1 and o.removido_em is null and (o.chave = any($2::text[]) or o.chave like any($3::text[]))`,
        [projeto.id, exatas, porNome],
      )
    ).rows;
    const alvos = chavesAlvo.map((k) => {
      const achado = k.endsWith("(*)") ? encontrados.find((o) => o.chave.startsWith(k.slice(0, -2))) : encontrados.find((o) => o.chave === k);
      const tipo = k.split(":")[1] ?? "objeto";
      return achado
        ? { chave: k, tipo: achado.tipo as string, nome: achado.nome as string, existe: true }
        : { chave: k, tipo, nome: k.split(":").slice(2).join(":").replace(/\(\*\)$/, "()"), existe: false };
    });

    const achados = await carregarAchados(
      c,
      "a.projeto_id = $1 and a.objeto_chave = $2 and (a.status <> 'resolvido' or a.resolvido_em > now() - interval '90 days')",
      [projeto.id, r.chave],
    );

    const rasc = (await c.query("select hash, achados, avaliado_em from public.agente_rascunhos where projeto_id = $1 and agente = $2", [projeto.id, r.chave])).rows[0];
    const rascunho =
      rasc && r.divergente && rasc.hash === r.rascunho ? { hash: rasc.hash as string, achados: (rasc.achados ?? []) as AchadoDoRascunho[], avaliadoEm: rasc.avaliado_em as string } : null;

    const casos: Caso[] = (
      await c.query(
        `select c.id, c.slug, c.criticidade, c.origem, c.ativo, c.hash_atual, c.criado_em, c.atualizado_em, c.arquivado_em, c.arquivado_motivo,
                v.entrada, v.espera, v.rubrica, v.autor, v.motivo,
                (select count(*) from public.caso_versoes x where x.caso_id = c.id) as versoes,
                (select max(rd.concluida_em) from public.rodada_casos rc join public.rodadas rd on rd.id = rc.rodada_id
                  where rc.caso_id = c.id and rd.status = 'concluida') as ultima_rodada
           from public.casos c
           left join public.caso_versoes v on v.caso_id = c.id and v.hash = c.hash_atual
          where c.projeto_id = $1 and c.agente = $2
          order by c.ativo desc, (c.criticidade = 'critico') desc, c.slug`,
        [projeto.id, r.chave],
      )
    ).rows.map((x) => ({
      id: x.id,
      slug: x.slug,
      criticidade: x.criticidade,
      origem: x.origem,
      ativo: x.ativo,
      hash: x.hash_atual,
      criadoEm: x.criado_em,
      atualizadoEm: x.atualizado_em,
      arquivadoEm: x.arquivado_em,
      arquivadoMotivo: x.arquivado_motivo,
      entrada: (x.entrada ?? { mensagem: "" }) as EntradaDoCaso,
      espera: (x.espera ?? {}) as EsperaDoCaso,
      rubrica: x.rubrica,
      autor: x.autor,
      motivo: x.motivo,
      versoes: x.versoes,
      ultimaRodada: x.ultima_rodada,
    }));

    const rodadas = (await c.query("select * from public.rodadas where projeto_id = $1 and agente = $2 order by criado_em desc limit 60", [projeto.id, r.chave])).rows.map(
      rodadaDe,
    );
    // Resultados caso a caso das rodadas concluídas mais recentes (a comparação lado a lado escolhe duas delas).
    const comResultado = rodadas.filter((x) => x.status === "concluida").slice(0, 16).map((x) => x.id);
    const resultados: ResultadoDoCaso[] = comResultado.length
      ? (await c.query("select * from public.rodada_casos where rodada_id = any($1::uuid[]) order by slug", [comResultado])).rows.map((x) => ({
          rodada: x.rodada_id,
          slug: x.slug,
          criticidade: x.criticidade,
          casoHash: x.caso_hash,
          passou: x.passou,
          checagens: (x.checagens ?? []) as Checagem[],
          tools: (x.tools_chamadas ?? []) as ResultadoDoCaso["tools"],
          resposta: x.resposta,
          repasse: x.repasse,
          juiz: x.juiz,
          duracaoMs: x.duracao_ms,
        }))
      : [];

    const publicacoes = (await c.query("select * from public.agente_publicacoes where projeto_id = $1 and agente = $2 order by inicio", [projeto.id, r.chave])).rows.map(
      publicacaoDe,
    );
    const metricas = (
      await c.query("select * from public.agente_metricas_diarias where projeto_id = $1 and agente = $2 and dia > current_date - 60 order by dia, hash", [
        projeto.id,
        r.chave,
      ])
    ).rows.map(metricaDe);

    const memoria = a.memoria as { node?: string; tipo?: string; parametros?: Record<string, unknown> } | null;
    const parser = a.parser as { node?: string; tipo?: string } | null;
    const valor = (v: unknown) => (typeof v === "string" ? v.replace(/^=/, "") : null);
    return {
      agora,
      projeto,
      resumo: semInternos(r),
      config: r.contrato ? (conteudo?.agentes?.[r.contrato] ?? null) : null,
      prompt: prompt
        ? {
            sistema: String(pa.sistema ?? ""),
            entrada: String(pa.entrada ?? ""),
            tamanho: Number(pa.tamanho ?? 0),
            exemplos: Number(pa.exemplos ?? 0),
            leJson: Boolean(pa.le_json),
            hash: String(pa.hash ?? ""),
          }
        : null,
      promptHistorico,
      ferramentas,
      gatilhos: Array.isArray(a.gatilhos) ? (a.gatilhos as string[]) : [],
      entradaRamificada: Boolean(a.entrada_ramificada),
      avaliacaoNativa: Boolean(a.avaliacao_nativa),
      desviaEnsaio: Boolean(a.desvia_ensaio),
      memoria: memoria?.node
        ? {
            node: memoria.node,
            tipo: memoria.tipo ?? "",
            tabela: valor(memoria.parametros?.tableName),
            sessao: valor(memoria.parametros?.sessionKey),
          }
        : null,
      parser: parser?.node ? { node: parser.node, tipo: parser.tipo ?? "" } : null,
      alvos,
      achados,
      rascunho,
      casos,
      rodadas,
      resultados,
      publicacoes,
      metricas,
    };
  });
}
