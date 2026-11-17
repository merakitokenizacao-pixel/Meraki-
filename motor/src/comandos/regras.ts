/** meraki regras: o catálogo. meraki tipos: tipos TypeScript das tabelas da plataforma para a web. */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { plataforma } from "../plataforma/db.ts";
import { REGRAS } from "../regras/index.ts";
import { type Argumentos, texto } from "../util/args.ts";
import { RAIZ } from "../util/raiz.ts";
import { out } from "./comum.ts";

export async function regras(): Promise<void> {
  for (const r of REGRAS) {
    out(`${r.codigo}  ${r.pacote.padEnd(9)} ${r.severidade.padEnd(7)} ${r.bloqueia ? "barra " : "      "} ${r.titulo}`);
  }
  out(`${REGRAS.length} regras · ${REGRAS.filter((r) => r.bloqueia).length} barram no gate`);
}

const TIPO_TS: Record<string, string> = {
  uuid: "string", text: "string", "character varying": "string", date: "string", "timestamp with time zone": "string",
  "timestamp without time zone": "string", integer: "number", bigint: "number", smallint: "number", numeric: "number",
  real: "number", "double precision": "number", boolean: "boolean", jsonb: "Json", json: "Json",
};

const pascal = (s: string) => s.split("_").map((p) => p[0].toUpperCase() + p.slice(1)).join("");

export async function tipos(args: Argumentos): Promise<void> {
  const destino = resolve(texto(args, "saida") ?? join(RAIZ, "web", "src", "lib", "plataforma", "tipos.gen.ts"));
  const { rows } = await plataforma().query<{ tabela: string; coluna: string; tipo: string; elemento: string | null; nulo: boolean }>(
    `select c.relname as tabela, a.attname as coluna, format_type(a.atttypid, null) as tipo,
            case when t.typcategory = 'A' then format_type(t.typelem, null) end as elemento, not a.attnotnull as nulo
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid and c.relkind = 'r'
       join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       join pg_type t on t.oid = a.atttypid
      where a.attnum > 0 and not a.attisdropped
      order by c.relname, a.attnum`,
  );
  const tabelas = new Map<string, string[]>();
  for (const r of rows) {
    const base = r.elemento ? `${TIPO_TS[r.elemento] ?? "unknown"}[]` : (TIPO_TS[r.tipo] ?? "unknown");
    if (!tabelas.has(r.tabela)) tabelas.set(r.tabela, []);
    tabelas.get(r.tabela)!.push(`  ${r.coluna}: ${base}${r.nulo ? " | null" : ""};`);
  }
  const corpo = [
    "// Gerado por `meraki tipos` a partir do banco da plataforma. Não edite à mão.",
    "export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];",
    "",
    ...[...tabelas].flatMap(([t, cols]) => [`export interface ${pascal(t)} {`, ...cols, "}", ""]),
  ].join("\n");
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, corpo);
  out(`${tabelas.size} tabelas → ${destino}`);
}
