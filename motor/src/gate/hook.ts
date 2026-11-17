/**
 * Protocolo de hook do Claude Code: a chamada da ferramenta chega em JSON pela entrada padrão,
 * a decisão sai em JSON pela saída padrão. Sem saída = segue o fluxo normal de permissão.
 */
import { readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { comPrazo } from "../plataforma/db.ts";
import { anotarPendente, pastaMeraki } from "./cache.ts";

export interface EntradaHook {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  /** Só no PostToolUse: o que a ferramenta devolveu. */
  tool_response?: unknown;
}

export async function lerStdin(prazoMs = 2_000): Promise<string> {
  if (process.stdin.isTTY) return "";
  return new Promise((resolve) => {
    const partes: Buffer[] = [];
    let feito = false;
    const fim = () => {
      if (feito) return;
      feito = true;
      process.stdin.pause();
      resolve(Buffer.concat(partes).toString("utf8"));
    };
    setTimeout(fim, prazoMs).unref();
    process.stdin.on("data", (d: Buffer) => partes.push(d));
    process.stdin.on("end", fim);
    process.stdin.on("error", fim);
  });
}

export async function lerEntradaDoHook(prazoMs = 2_000): Promise<EntradaHook | null> {
  const bruto = (await lerStdin(prazoMs)).trim();
  if (!bruto) return null;
  try {
    const v = JSON.parse(bruto);
    return v && typeof v === "object" ? (v as EntradaHook) : null;
  } catch {
    return null;
  }
}

/** apply_migration e execute_sql (MCP do Supabase e afins) mandam o SQL em `query`. */
export function sqlDaFerramenta(e: EntradaHook): string | null {
  const ti = e.tool_input ?? {};
  for (const k of ["query", "sql", "statement"]) {
    const v = ti[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

export function respostaPreToolUse(decisao: "negou" | "perguntou", motivo: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decisao === "negou" ? "deny" : "ask",
      permissionDecisionReason: motivo,
    },
  });
}

export interface EventoGate {
  projeto_slug: string;
  criado_em: string;
  origem: string;
  sessao: string | null;
  ferramenta: string;
  modo: string;
  resumo: string;
  decisao: "permitiu" | "perguntou" | "negou";
  regras: string[];
  motivo: string | null;
  proposta_id: string | null;
  duracao_ms: number;
}

const INSERIR_EVENTOS = `
  insert into public.gate_eventos (conta_id, projeto_id, criado_em, origem, sessao, ferramenta, modo, resumo, decisao, regras, motivo, proposta_id, duracao_ms)
  select p.conta_id, p.id, x.criado_em, x.origem, x.sessao, x.ferramenta, x.modo, x.resumo, x.decisao, coalesce(x.regras, '{}'), x.motivo,
         (select pr.id from public.propostas pr where pr.id = x.proposta_id), x.duracao_ms
    from jsonb_to_recordset($1::jsonb) as x(projeto_slug text, criado_em timestamptz, origem text, sessao text, ferramenta text, modo text,
                                           resumo text, decisao text, regras text[], motivo text, proposta_id uuid, duracao_ms int)
    join public.projetos p on p.slug = x.projeto_slug`;

/** Pega os eventos pendentes renomeando o arquivo (dois gates ao mesmo tempo não enviam o mesmo evento). */
async function pegarPendentes(diretorio: string): Promise<{ eventos: EventoGate[]; arquivo: string | null }> {
  const origem = join(pastaMeraki(diretorio), "cache", "eventos-pendentes.jsonl");
  const meu = `${origem}.${process.pid}.envio`;
  try {
    await rename(origem, meu);
  } catch {
    return { eventos: [], arquivo: null };
  }
  const texto = await readFile(meu, "utf8").catch(() => "");
  const eventos = texto.split("\n").filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l) as EventoGate];
    } catch {
      return [];
    }
  });
  return { eventos, arquivo: meu };
}

/**
 * Grava o evento (e os pendentes) em gate_eventos com prazo curto.
 * Sem plataforma, o evento vai para .meraki/cache/eventos-pendentes.jsonl e sobe na próxima vez.
 */
export async function registrarEventos(diretorio: string, novos: EventoGate[], prazoMs: number): Promise<{ enviados: number; pendentes: number }> {
  const { eventos, arquivo } = await pegarPendentes(diretorio);
  const todos = [...eventos, ...novos];
  if (!todos.length) return { enviados: 0, pendentes: 0 };
  try {
    await comPrazo(prazoMs, (c) => c.query(INSERIR_EVENTOS, [JSON.stringify(todos)]));
    if (arquivo) await rm(arquivo, { force: true });
    return { enviados: todos.length, pendentes: 0 };
  } catch {
    for (const ev of todos) await anotarPendente(diretorio, ev as unknown as Record<string, unknown>);
    if (arquivo) await rm(arquivo, { force: true });
    return { enviados: 0, pendentes: todos.length };
  }
}
