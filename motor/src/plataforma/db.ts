/**
 * Conexão do motor com o banco da plataforma. Só o motor lê segredo (Vault); a web usa outro papel.
 * MERAKI_DB_URL: no Supabase, a URL do pooler com o papel do motor; local, o cluster de desenvolvimento.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { RAIZ } from "../util/raiz.ts";

// date como texto (sem fuso), bigint e numeric como número.
pg.types.setTypeParser(1082, (v: string) => v);
pg.types.setTypeParser(20, (v: string) => Number(v));
pg.types.setTypeParser(1700, (v: string) => Number(v));

let envCarregado = false;
export function carregarEnv(): void {
  if (envCarregado) return;
  envCarregado = true;
  for (const arquivo of [join(RAIZ, ".env"), join(RAIZ, "motor", ".env")]) {
    if (existsSync(arquivo)) process.loadEnvFile(arquivo);
  }
}

export const URL_LOCAL = "postgresql://postgres@localhost:54329/meraki";

export function urlPlataforma(): string {
  carregarEnv();
  return process.env.MERAKI_DB_URL || URL_LOCAL;
}

let pool: pg.Pool | undefined;

export function plataforma(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: urlPlataforma(),
      max: 4,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 2_000,
      application_name: "meraki-motor",
    });
    // Conexão ociosa derrubada pelo servidor emite "error" no pool: sem ouvinte, derrubaria o processo.
    // O pool já descarta o cliente morto e abre outro no próximo pedido.
    pool.on("error", (e) => process.stderr.write(`meraki: conexão com a plataforma caiu (${e.message})\n`));
  }
  return pool;
}

/** Cliente emprestado ou avulso sem ouvinte: queda no meio da operação vira erro da consulta, não exceção solta. */
export const ignorarQueda = () => undefined;

export async function fecharPlataforma(): Promise<void> {
  const p = pool;
  pool = undefined;
  await p?.end();
}

export async function transacao<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const cliente = await plataforma().connect();
  cliente.on("error", ignorarQueda);
  try {
    await cliente.query("begin");
    const r = await fn(cliente);
    await cliente.query("commit");
    return r;
  } catch (e) {
    await cliente.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    cliente.off("error", ignorarQueda);
    cliente.release();
  }
}

/** Uma conexão avulsa com prazo curto (gate: nunca pode travar o agente). */
export async function comPrazo<T>(ms: number, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const cliente = new pg.Client({ connectionString: urlPlataforma(), connectionTimeoutMillis: ms, statement_timeout: ms, application_name: "meraki-gate" });
  // Queda vira falha da consulta, e o gate pergunta (fecha seguro) em vez de o hook morrer.
  cliente.on("error", ignorarQueda);
  const prazo = new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`plataforma não respondeu em ${ms} ms`)), ms).unref());
  try {
    await Promise.race([cliente.connect(), prazo]);
    return await Promise.race([fn(cliente), prazo]);
  } finally {
    cliente.end().catch(() => undefined);
  }
}
