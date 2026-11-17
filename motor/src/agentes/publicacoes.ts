/**
 * Linha do tempo de publicação: cada período em que uma versão (hash) do agente esteve no ar.
 * O hook do n8n grava a hora exata (origem hook). A coleta confirma; quando a versão mudou sem passar pelo
 * hook, abre o período na hora da coleta e marca o intervalo desde a coleta anterior como versão incerta.
 */
import type pg from "pg";
import { plataforma, transacao } from "../plataforma/db.ts";
import type { Projeto } from "../plataforma/repositorio.ts";

type Exec = Pick<pg.PoolClient, "query">;

export interface ResultadoPublicacoes {
  abertas: number;
  fechadas: number;
  /** Rodadas pedidas para versões que entraram no ar sem rodada (plano B do gate). */
  rodadas: number;
}

/** Fecha o período aberto (se for outra versão) e abre o da versão nova. Devolve se mudou algo. */
export async function registrarPublicacao(
  c: Exec,
  projeto: Pick<Projeto, "id" | "conta_id">,
  agente: string,
  hash: string | null,
  quando: Date,
  origem: "hook" | "coleta",
  extra: { versionId?: string | null; inicioMinimo?: Date | null } = {},
): Promise<{ abriu: boolean; fechou: boolean }> {
  const aberta = (
    await c.query("select id, hash, inicio from public.agente_publicacoes where projeto_id = $1 and agente = $2 and fim is null for update", [projeto.id, agente])
  ).rows[0];
  if (aberta && aberta.hash === hash) return { abriu: false, fechou: false };
  let fechou = false;
  if (aberta) {
    await c.query("update public.agente_publicacoes set fim = greatest($2::timestamptz, inicio) where id = $1", [aberta.id, quando]);
    fechou = true;
  }
  if (!hash) return { abriu: false, fechou };
  await c.query(
    `insert into public.agente_publicacoes (conta_id, projeto_id, agente, hash, version_id, inicio, inicio_minimo, origem_hora)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [projeto.conta_id, projeto.id, agente, hash, extra.versionId ?? null, quando, aberta ? (extra.inicioMinimo ?? null) : null, origem],
  );
  return { abriu: true, fechou };
}

/**
 * Depois de cada coleta: compara a versão publicada de cada agente com o período aberto.
 * Versão nova vista pela coleta (não passou pelo hook) ganha rodada automática se o agente tem casos.
 */
export async function atualizarPublicacoes(projeto: Projeto, agora = new Date()): Promise<ResultadoPublicacoes> {
  const agentes = (
    await plataforma().query(
      `select o.chave, o.fonte_id, o.atributos, o.removido_em,
              (select c.fim from public.coletas c where c.fonte_id = o.fonte_id and c.status = 'ok' and c.fim is not null
                order by c.fim desc offset 1 limit 1) as coleta_anterior
         from public.objetos o join public.fontes f on f.id = o.fonte_id
        where f.projeto_id = $1 and o.tipo = 'agente'`,
      [projeto.id],
    )
  ).rows;
  const r: ResultadoPublicacoes = { abertas: 0, fechadas: 0, rodadas: 0 };
  for (const a of agentes) {
    const at = (a.atributos ?? {}) as Record<string, unknown>;
    const hash = a.removido_em || at.desativado || !at.publicado ? null : ((at.versao as string | null) ?? null);
    await transacao(async (c) => {
      const m = await registrarPublicacao(c, projeto, a.chave, hash, agora, "coleta", {
        versionId: (at.version_id as string | null) ?? null,
        inicioMinimo: a.coleta_anterior ?? null,
      });
      if (m.abriu) r.abertas++;
      if (m.fechou) r.fechadas++;
      if (!m.abriu || !hash || !m.fechou) return;
      // Entrou no ar sem passar pelo gate: AV3 acusa e a rodada já fica pedida.
      const pedida = await c.query(
        `insert into public.rodadas (conta_id, projeto_id, agente, hash, motivo, status, pedida_por)
         select $1, $2, $3, $4, 'publicacao', 'pedida', 'meraki'
          where exists (select 1 from public.casos where projeto_id = $2 and agente = $3 and ativo)
            and not exists (select 1 from public.rodadas where projeto_id = $2 and agente = $3 and hash = $4 and status in ('pedida', 'rodando', 'concluida'))
         on conflict (projeto_id, agente, hash) where status in ('pedida', 'rodando') do nothing
         returning id`,
        [projeto.conta_id, projeto.id, a.chave, hash],
      );
      r.rodadas += pedida.rowCount ?? 0;
    });
  }
  return r;
}
