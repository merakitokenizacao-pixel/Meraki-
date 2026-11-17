import "server-only";
import pg from "pg";

/**
 * Acesso da web ao banco da plataforma. Só no servidor, com o papel meraki_web (sem privilégio próprio e sem
 * acesso ao Vault: a web nunca lê segredo). Cada operação abre uma transação, assume o papel `authenticated`
 * e grava as claims do usuário da sessão — a RLS da plataforma vale de verdade em toda leitura e decisão.
 *
 * Fase 1: a sessão é o membro configurado em MERAKI_USUARIO_ID. Fora do banco local ele é obrigatório;
 * a autenticação de verdade (Supabase Auth) substitui esse ponto sem mudar as consultas.
 */

const URL_LOCAL = "postgresql://meraki_web@localhost:54329/meraki";
const USUARIO_LOCAL = "00000000-0000-4000-8000-0000000000a1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// date como texto (sem fuso), bigint e numeric como número, timestamptz como ISO (serializável para o cliente).
// Só nas conexões deste pool, sem mexer no pg global: o hot reload reavalia este módulo, e um conversor global
// passaria a embrulhar ele mesmo (na segunda avaliação recebia texto em vez de Date e todas as telas quebravam).
const { builtins } = pg.types;
const dataHora = pg.types.getTypeParser(builtins.TIMESTAMPTZ);
const CONVERSORES: Partial<Record<number, (v: string) => unknown>> = {
  [builtins.DATE]: (v) => v,
  [builtins.INT8]: (v) => Number(v),
  [builtins.NUMERIC]: (v) => Number(v),
  [builtins.TIMESTAMPTZ]: (v) => (dataHora(v) as Date).toISOString(),
};
const tipos: pg.CustomTypesConfig = {
  getTypeParser: (oid, formato) => (formato !== "binary" && CONVERSORES[oid]) || pg.types.getTypeParser(oid, formato),
};

function local(url: string) {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

function configuracao() {
  const url = process.env.MERAKI_WEB_DB_URL || URL_LOCAL;
  const usuario = process.env.MERAKI_USUARIO_ID || (local(url) ? USUARIO_LOCAL : "");
  if (!UUID.test(usuario)) {
    throw new Error("MERAKI_USUARIO_ID ausente ou inválido: fora do banco local a sessão precisa ser configurada.");
  }
  return { url, usuario };
}

const global = globalThis as typeof globalThis & { __merakiWeb?: pg.Pool };

function pool() {
  // Um pool por processo (o hot reload do dev recarrega o módulo, não o processo).
  const p = (global.__merakiWeb ??= new pg.Pool({
    connectionString: configuracao().url,
    max: 5,
    connectionTimeoutMillis: 4_000,
    idleTimeoutMillis: 10_000,
    application_name: "meraki-web",
    types: tipos,
  }));
  // Conexão ociosa derrubada pelo banco (restart, failover, pg_terminate_backend) emite "error" no pool: sem
  // ouvinte, vira exceção não tratada. O pool já descarta o cliente morto e abre outro no próximo pedido.
  // Confere a cada chamada porque o pool sobrevive ao hot reload e o módulo não.
  if (!p.listenerCount("error")) p.on("error", (e) => console.warn(`[meraki] conexão com a plataforma caiu: ${e.message}`));
  return p;
}

/** Emprestado, o cliente fica sem o ouvinte do pool: queda no meio da operação vira erro da consulta, não exceção solta. */
const ignorarQueda = () => undefined;

export type Cliente = Pick<pg.PoolClient, "query">;

async function comSessao<T>(modo: "leitura" | "escrita", fn: (c: Cliente) => Promise<T>): Promise<T> {
  const { usuario } = configuracao();
  const c = await pool().connect();
  c.on("error", ignorarQueda);
  try {
    await c.query(modo === "leitura" ? "begin read only" : "begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: usuario, role: "authenticated" })]);
    await c.query("set local statement_timeout = '10s'");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    c.off("error", ignorarQueda);
    c.release();
  }
}

/** Leitura com a RLS do usuário da sessão (transação somente leitura). */
export const ler = <T,>(fn: (c: Cliente) => Promise<T>) => comSessao("leitura", fn);

/** Decisão do usuário (aprovar, recusar, abrir exceção): só por funções da plataforma, que conferem a conta. */
export const decidir = <T,>(fn: (c: Cliente) => Promise<T>) => comSessao("escrita", fn);

/** Mensagem curta para a tela quando o banco não responde ou recusa. */
export function mensagemDeErro(e: unknown) {
  const err = e as { code?: string; message?: string };
  if (err?.code === "ECONNREFUSED" || /ECONNREFUSED|connect/i.test(err?.message ?? "")) {
    return "O banco da plataforma não respondeu. Suba o ambiente local com `node motor/bin/meraki.mjs dev preparar`.";
  }
  return err?.message ?? String(e);
}
