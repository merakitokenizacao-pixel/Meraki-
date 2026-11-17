/**
 * Estado dos agentes que as regras de avaliação e produção leem: rodadas, publicações, métricas diárias, casos
 * e o histórico de tamanho dos prompts. Tudo vem do banco da plataforma — nenhuma linha de conversa.
 */
import type pg from "pg";
import { plataforma } from "../plataforma/db.ts";
import { iso } from "../plataforma/repositorio.ts";

type Exec = Pick<pg.Pool, "query"> | Pick<pg.PoolClient, "query"> | Pick<pg.Client, "query">;

export type StatusRodada = "pedida" | "rodando" | "concluida" | "erro" | "cancelada";

export interface RodadaResumo {
  id: string;
  agente: string;
  hash: string;
  status: StatusRodada;
  motivo: string;
  aprovacao: number | null;
  casos: number;
  passaram: number;
  criticosFalhos: string[];
  aprovada: boolean | null;
  criadaEm: string;
  concluidaEm: string | null;
}

export interface PublicacaoResumo {
  agente: string;
  hash: string;
  inicio: string;
  /** A publicação aconteceu entre inicioMinimo e inicio (coleta que detectou): período de versão incerta. */
  inicioMinimo: string | null;
  fim: string | null;
  origem: "hook" | "coleta";
}

export interface MetricaDoDia {
  agente: string;
  hash: string;
  dia: string;
  conversas: number;
  repasses: number;
  conversoes: number;
  violacoes: number;
  exemplos: string[];
  execucoes: number;
  erros: number;
  latenciaP50: number | null;
  latenciaP95: number | null;
  incerta: boolean;
}

export interface CasoResumo {
  id: string;
  agente: string;
  slug: string;
  criticidade: "critico" | "normal";
  ativo: boolean;
  criadoEm: string;
  /** Fim da última rodada concluída em que o caso entrou. */
  ultimaRodada: string | null;
}

export interface VersaoDePrompt {
  tamanho: number;
  hash: string;
  criadoEm: string;
}

export interface EstadoAgentes {
  rodadas: RodadaResumo[];
  publicacoes: PublicacaoResumo[];
  metricas: MetricaDoDia[];
  casos: CasoResumo[];
  /** chave do prompt → versões em ordem de coleta */
  prompts: Map<string, VersaoDePrompt[]>;
}

export function estadoVazio(): EstadoAgentes {
  return { rodadas: [], publicacoes: [], metricas: [], casos: [], prompts: new Map() };
}

const numeroOuNulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function carregarEstadoAgentes(projetoId: string, db: Exec = plataforma(), dias = 60): Promise<EstadoAgentes> {
  const rodadas = (
    await db.query(
      `select id, agente, hash, status, motivo, aprovacao, casos, passaram, criticos_falhos, aprovada, criado_em, concluida_em
         from public.rodadas where projeto_id = $1 order by criado_em desc limit 1000`,
      [projetoId],
    )
  ).rows.map((r): RodadaResumo => ({
    id: r.id, agente: r.agente, hash: r.hash, status: r.status, motivo: r.motivo, aprovacao: numeroOuNulo(r.aprovacao), casos: r.casos, passaram: r.passaram,
    criticosFalhos: r.criticos_falhos ?? [], aprovada: r.aprovada, criadaEm: iso(r.criado_em), concluidaEm: r.concluida_em ? iso(r.concluida_em) : null,
  }));
  const publicacoes = (
    await db.query("select agente, hash, inicio, inicio_minimo, fim, origem_hora from public.agente_publicacoes where projeto_id = $1 order by inicio", [projetoId])
  ).rows.map((r): PublicacaoResumo => ({
    agente: r.agente, hash: r.hash, inicio: iso(r.inicio), inicioMinimo: r.inicio_minimo ? iso(r.inicio_minimo) : null, fim: r.fim ? iso(r.fim) : null, origem: r.origem_hora,
  }));
  const metricas = (
    await db.query(
      `select agente, hash, dia, conversas, repasses, conversoes, violacoes, violacoes_exemplos, execucoes, erros, latencia_p50_ms, latencia_p95_ms, versao_incerta
         from public.agente_metricas_diarias where projeto_id = $1 and dia > current_date - $2::int order by dia`,
      [projetoId, dias],
    )
  ).rows.map((r): MetricaDoDia => ({
    agente: r.agente, hash: r.hash, dia: String(r.dia), conversas: r.conversas, repasses: r.repasses, conversoes: r.conversoes, violacoes: r.violacoes,
    exemplos: r.violacoes_exemplos ?? [], execucoes: r.execucoes, erros: r.erros, latenciaP50: r.latencia_p50_ms, latenciaP95: r.latencia_p95_ms, incerta: r.versao_incerta,
  }));
  const casos = (
    await db.query(
      `select c.id, c.agente, c.slug, c.criticidade, c.ativo, c.criado_em,
              (select max(r.concluida_em) from public.rodada_casos rc join public.rodadas r on r.id = rc.rodada_id
                where rc.caso_id = c.id and r.status = 'concluida') as ultima
         from public.casos c where c.projeto_id = $1`,
      [projetoId],
    )
  ).rows.map((r): CasoResumo => ({
    id: r.id, agente: r.agente, slug: r.slug, criticidade: r.criticidade, ativo: r.ativo, criadoEm: iso(r.criado_em), ultimaRodada: r.ultima ? iso(r.ultima) : null,
  }));
  const prompts = new Map<string, VersaoDePrompt[]>();
  for (const r of (
    await db.query(
      `select o.chave, v.atributos ->> 'tamanho' as tamanho, v.atributos ->> 'hash' as hash, v.criado_em
         from public.objeto_versoes v join public.objetos o on o.id = v.objeto_id join public.fontes f on f.id = o.fonte_id
        where f.projeto_id = $1 and o.tipo = 'prompt' and v.mudanca <> 'removido' and v.atributos is not null
        order by v.id`,
      [projetoId],
    )
  ).rows) {
    const lista = prompts.get(r.chave) ?? [];
    lista.push({ tamanho: Number(r.tamanho ?? 0), hash: r.hash ?? "", criadoEm: iso(r.criado_em) });
    prompts.set(r.chave, lista);
  }
  return { rodadas, publicacoes, metricas, casos, prompts };
}

/** Última rodada concluída de um agente numa versão. */
export function ultimaRodada(estado: EstadoAgentes, agente: string, hash: string): RodadaResumo | undefined {
  return estado.rodadas
    .filter((r) => r.agente === agente && r.hash === hash && r.status === "concluida")
    .sort((a, b) => (a.concluidaEm ?? "").localeCompare(b.concluidaEm ?? ""))
    .at(-1);
}

/** Publicação aberta (a versão no ar) e a anterior a ela. */
export function publicacoesDe(estado: EstadoAgentes, agente: string): { atual?: PublicacaoResumo; anterior?: PublicacaoResumo } {
  const lista = estado.publicacoes.filter((p) => p.agente === agente).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const atual = lista.find((p) => !p.fim) ?? lista.at(-1);
  const anterior = atual ? lista.filter((p) => p !== atual && p.hash !== atual.hash && p.inicio < atual.inicio).at(-1) : undefined;
  return { atual, anterior };
}

export interface Somatorio {
  dias: number;
  conversas: number;
  repasses: number;
  conversoes: number;
  violacoes: number;
  execucoes: number;
  erros: number;
  /** p95 médio ponderado pelas execuções de cada dia */
  latenciaP95: number | null;
  exemplos: string[];
}

export function somar(metricas: MetricaDoDia[]): Somatorio {
  const s: Somatorio = { dias: metricas.length, conversas: 0, repasses: 0, conversoes: 0, violacoes: 0, execucoes: 0, erros: 0, latenciaP95: null, exemplos: [] };
  let peso = 0;
  let acumulado = 0;
  for (const m of [...metricas].sort((a, b) => b.dia.localeCompare(a.dia))) {
    s.conversas += m.conversas;
    s.repasses += m.repasses;
    s.conversoes += m.conversoes;
    s.violacoes += m.violacoes;
    s.execucoes += m.execucoes;
    s.erros += m.erros;
    if (m.latenciaP95 !== null && m.execucoes > 0) {
      acumulado += m.latenciaP95 * m.execucoes;
      peso += m.execucoes;
    }
    for (const e of m.exemplos) if (s.exemplos.length < 20) s.exemplos.push(e);
  }
  s.latenciaP95 = peso ? Math.round(acumulado / peso) : null;
  return s;
}
