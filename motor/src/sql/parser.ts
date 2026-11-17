/**
 * Leitura de SQL com o parser real do Postgres (libpg-query, WASM).
 * Carrega sob demanda: o gate só paga o custo quando precisa.
 */
import type { Certeza } from "../tipos.ts";

type No = Record<string, unknown>;
interface Lib {
  parseSync(sql: string): { stmts: { stmt: No; stmt_location?: number; stmt_len?: number }[] };
  parsePlPgSQLSync(sql: string): { plpgsql_funcs: No[] };
}

let lib: Lib | undefined;

export async function carregarParser(): Promise<void> {
  if (lib) return;
  const m = (await import("libpg-query")) as unknown as Lib & { loadModule?: () => Promise<void> };
  await m.loadModule?.();
  lib = m;
}

function parser(): Lib {
  if (!lib) throw new Error("parser SQL não carregado: chame carregarParser() antes");
  return lib;
}

export interface Comando {
  tipo: string;
  no: No;
  texto: string;
}

/** Divide e lê os comandos. Lança erro se o SQL não for válido. */
export function lerComandos(sql: string): Comando[] {
  const r = parser().parseSync(sql);
  return (r.stmts ?? []).map((s) => {
    const tipo = Object.keys(s.stmt)[0];
    const inicio = s.stmt_location ?? 0;
    const texto = (s.stmt_len ? sql.slice(inicio, inicio + s.stmt_len) : sql.slice(inicio)).trim();
    return { tipo, no: s.stmt[tipo] as No, texto };
  });
}

export function tentarLerComandos(sql: string): Comando[] | null {
  // Parser não carregado é erro de programa, não SQL inválido: calado, a tool perderia os alvos e o hash do agente mudaria.
  parser();
  try {
    return lerComandos(sql);
  } catch {
    return null;
  }
}

/** Percorre a árvore chamando `visitar(tipo, no)` em cada nó tipado ({ Tipo: {...} }). */
export function percorrer(valor: unknown, visitar: (tipo: string, no: No) => void): void {
  if (Array.isArray(valor)) {
    for (const v of valor) percorrer(v, visitar);
    return;
  }
  if (!valor || typeof valor !== "object") return;
  for (const [k, v] of Object.entries(valor as No)) {
    if (v && typeof v === "object" && !Array.isArray(v) && /^[A-Z]/.test(k)) visitar(k, v as No);
    percorrer(v, visitar);
  }
}

export function nomes(lista: unknown): string[] {
  if (!Array.isArray(lista)) return [];
  return lista.map((n) => ((n as No).String as No | undefined)?.sval as string).filter(Boolean);
}

export function nomeQualificado(partes: string[], esquemaPadrao = "public"): string {
  if (partes.length >= 2) return `${partes[partes.length - 2]}.${partes[partes.length - 1]}`;
  return `${esquemaPadrao}.${partes[0]}`;
}

export function nomeDeRangeVar(rv: No, esquemaPadrao = "public"): string {
  return `${(rv.schemaname as string) ?? esquemaPadrao}.${rv.relname as string}`;
}

export interface Acesso {
  /** schema.nome */
  alvo: string;
  tipo: "le" | "escreve" | "chama";
  certeza: Certeza;
  linha?: number;
}

const CATALOGOS = /^(pg_catalog|information_schema)\./;
const FUNCOES_DO_SISTEMA = new Set([
  "count", "sum", "avg", "min", "max", "now", "coalesce", "nullif", "format", "lower", "upper", "array_agg", "jsonb_build_object",
  "json_build_object", "to_jsonb", "row_to_json", "gen_random_uuid", "make_interval", "date_trunc", "length", "btrim", "trim",
  "concat", "string_agg", "jsonb_agg", "json_agg", "greatest", "least", "random", "current_setting", "set_config", "exists",
]);

/** Tabelas lidas/escritas e funções chamadas por um comando SQL já lido. */
export function acessosDoNo(no: unknown, certeza: Certeza = "exata", linha?: number): Acesso[] {
  const ctes = new Set<string>();
  percorrer(no, (tipo, n) => {
    if (tipo === "CommonTableExpr") ctes.add(n.ctename as string);
  });
  const acessos = new Map<string, Acesso>();
  const anotar = (a: Acesso) => {
    const k = `${a.tipo}:${a.alvo}`;
    if (!acessos.has(k)) acessos.set(k, a);
  };
  const tabela = (rv: No, tipo: "le" | "escreve") => {
    if (!rv.schemaname && ctes.has(rv.relname as string)) return;
    const alvo = nomeDeRangeVar(rv);
    if (!CATALOGOS.test(alvo)) anotar({ alvo, tipo, certeza, linha });
  };
  const chamada = (fc: No) => {
    const partes = nomes(fc.funcname);
    if (!partes.length || partes[0] === "pg_catalog") return;
    if (partes.length === 1 && FUNCOES_DO_SISTEMA.has(partes[0])) return;
    anotar({ alvo: nomeQualificado(partes), tipo: "chama", certeza, linha });
  };
  percorrer(no, (tipo, n) => {
    if (tipo === "RangeVar") {
      tabela(n, "le");
    } else if (tipo === "FuncCall") {
      chamada(n);
    } else if ((tipo === "InsertStmt" || tipo === "UpdateStmt" || tipo === "DeleteStmt" || tipo === "MergeStmt") && n.relation) {
      // O alvo da escrita é um RangeVar sem o invólucro { RangeVar: ... }: o percurso genérico não o vê.
      const rv = n.relation as No;
      tabela((rv.RangeVar as No | undefined) ?? rv, "escreve");
    } else if (tipo === "CallStmt" && n.funccall) {
      const fc = n.funccall as No;
      chamada((fc.FuncCall as No | undefined) ?? fc);
    }
  });
  return [...acessos.values()];
}

/** Acessos de um SQL solto (query de node, statement de pg_stat_statements). Nulo se não der para ler. */
export function acessosDoSql(sql: string, certeza: Certeza = "exata"): Acesso[] | null {
  const comandos = tentarLerComandos(sql);
  if (!comandos) return null;
  // Reembrulha o comando ({ InsertStmt: ... }): é pelo tipo do topo que a escrita é reconhecida.
  return comandos.flatMap((c) => acessosDoNo({ [c.tipo]: c.no }, certeza));
}

const ALVO_DINAMICO =
  /\b(delete\s+from|insert\s+into|merge\s+into|truncate(?:\s+table)?|update|from|join|into|table)\s+((?:[a-z_][a-z0-9_]*\.)?(?:[a-z_][a-z0-9_]*|%I))/gi;
const VERBO_DE_ESCRITA = /^(delete|insert|merge|truncate|update|into)/i;

/** Tabelas que aparecem literalmente em SQL dinâmico (EXECUTE format(...)): relação inferida. */
export function acessosInferidos(textoDinamico: string, linha?: number): Acesso[] {
  const saida: Acesso[] = [];
  for (const m of textoDinamico.matchAll(ALVO_DINAMICO)) {
    const ref = m[2];
    if (ref.includes("%")) continue;
    const alvo = ref.includes(".") ? ref : `public.${ref}`;
    saida.push({ alvo, tipo: VERBO_DE_ESCRITA.test(m[1]) ? "escreve" : "le", certeza: "inferida", linha });
  }
  return saida;
}

export interface LeituraDeCorpo {
  acessos: Acesso[];
  dinamico: boolean;
  ok: boolean;
}

/** Lê o corpo de uma função (sql ou plpgsql) e devolve o que ela lê, escreve e chama. */
export function lerCorpoDeFuncao(linguagem: string, corpo: string, argumentos: string, retorno: string): LeituraDeCorpo {
  if (linguagem === "sql") {
    const acessos = acessosDoSql(corpo);
    return { acessos: acessos ?? [], dinamico: false, ok: acessos !== null };
  }
  if (linguagem !== "plpgsql") return { acessos: [], dinamico: false, ok: true };
  const delim = corpo.includes("$meraki$") ? "$meraki_corpo$" : "$meraki$";
  // O tipo de retorno real importa: o compilador do plpgsql recusa `return x` em função void e `return query` fora de setof.
  const ddl = `create function meraki_corpo(${argumentos}) returns ${retorno.trim() || "void"} language plpgsql as ${delim}${corpo}${delim}`;
  let arvore: { plpgsql_funcs: No[] };
  const lib = parser();
  try {
    arvore = lib.parsePlPgSQLSync(ddl);
  } catch {
    return { acessos: [], dinamico: false, ok: false };
  }
  const acessos: Acesso[] = [];
  let dinamico = false;
  let ok = true;
  const visitarExpr = (expr: No | undefined, linha: number | undefined, isDinamico: boolean) => {
    const q = expr?.query as string | undefined;
    if (!q) return;
    if (isDinamico) {
      dinamico = true;
      acessos.push(...acessosInferidos(q, linha));
      const chamadas = acessosDoSql(`select ${q}`);
      if (chamadas) acessos.push(...chamadas.filter((a) => a.tipo === "chama"));
      return;
    }
    // Atribuição (PG14+) chega como "alvo := expressão": lê só a expressão.
    const atribuicao = /^[^:]*?:=\s*([\s\S]+)$/.exec(q);
    const lidos = acessosDoSql(q) ?? acessosDoSql(`select ${q}`) ?? (atribuicao ? acessosDoSql(`select ${atribuicao[1]}`) : null);
    if (lidos) acessos.push(...lidos.map((a) => ({ ...a, linha })));
    else ok = false;
  };
  percorrer(arvore, (tipo, n) => {
    const linha = typeof n.lineno === "number" ? n.lineno : undefined;
    if (tipo === "PLpgSQL_stmt_dynexecute") {
      visitarExpr((n.query as No)?.PLpgSQL_expr as No, linha, true);
      return;
    }
    if (tipo.startsWith("PLpgSQL_stmt_")) {
      for (const [k, v] of Object.entries(n)) {
        if (k === "query" && tipo === "PLpgSQL_stmt_dynexecute") continue;
        const expr = (v as No | undefined)?.PLpgSQL_expr as No | undefined;
        if (expr) visitarExpr(expr, linha, false);
      }
    }
  });
  const unicos = new Map<string, Acesso>();
  for (const a of acessos) {
    const k = `${a.tipo}:${a.alvo}:${a.certeza}`;
    if (!unicos.has(k)) unicos.set(k, a);
  }
  return { acessos: [...unicos.values()], dinamico, ok };
}

/** Tipos de argumento normalizados para a chave de função: "uuid,text". */
export function tiposNormalizados(tipos: string[]): string {
  return tipos.map(normalizarTipo).join(",");
}

const SINONIMOS: Record<string, string> = {
  int: "integer", int4: "integer", int8: "bigint", int2: "smallint", bool: "boolean", float8: "double precision",
  float4: "real", varchar: "character varying", "timestamp with time zone": "timestamp with time zone",
  timestamptz: "timestamp with time zone", timestamp: "timestamp without time zone", time: "time without time zone",
  timetz: "time with time zone", decimal: "numeric", char: "character", serial: "integer", bigserial: "bigint",
};

export function normalizarTipo(tipo: string): string {
  const t = tipo.trim().toLowerCase().replace(/\s+/g, " ").replace(/\(.*\)$/, "").replace(/^pg_catalog\./, "");
  const arr = t.endsWith("[]");
  const base = arr ? t.slice(0, -2) : t;
  return (SINONIMOS[base] ?? base) + (arr ? "[]" : "");
}

/** Nome do tipo de um TypeName do parser (ex.: ["pg_catalog","int4"] → integer). */
export function tipoDeTypeName(tn: No | undefined): string {
  if (!tn) return "unknown";
  const partes = nomes(tn.names);
  const base = normalizarTipo(partes[partes.length - 1] ?? "unknown");
  return Array.isArray(tn.arrayBounds) && tn.arrayBounds.length ? `${base}[]` : base;
}
