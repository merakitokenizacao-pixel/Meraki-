/**
 * Coletor Postgres/Supabase. Só leitura, a partir do pg_catalog, com o papel meraki_leitor.
 * Sem SELECT nas tabelas a fonte roda em modo catálogo: estrutura completa, sem dado agregado (E06 desligada).
 *
 * Armadilhas conhecidas:
 *  - information_schema filtra por privilégio → aqui só pg_catalog;
 *  - reltuples é estimativa → vai para observação, nunca para o hash;
 *  - delta negativo de pg_stat é reset → tratado na gravação do uso;
 *  - cron.job tem RLS → não é lido.
 */
import pg from "pg";
import { chave } from "../chaves.ts";
import { chavesCriadas, permissoesDeExecucao, relacoesDeAcessos } from "../sql/ddl.ts";
import { acessosDoSql, carregarParser, lerCorpoDeFuncao, normalizarTipo, tentarLerComandos } from "../sql/parser.ts";
import type { Coletor, FonteConfig, Objeto, Observacao, Relacao, Snapshot } from "../tipos.ts";
import { sha256 } from "../util/hash.ts";

type Linha = Record<string, any>;

const TIPO_RESTRICAO: Record<string, string> = { p: "primaria", f: "estrangeira", u: "unica", c: "checagem", x: "exclusao", t: "gatilho" };
const PAPEIS_DE_SISTEMA = /^(pg_|supabase_|rds|azure_|cloudsqladmin$|authenticator$|pgbouncer$|dashboard_user$)/;

export const coletorPostgres: Coletor = {
  tipos: ["postgres", "supabase"],

  async coletar(fonte: FonteConfig): Promise<Snapshot> {
    if (!fonte.segredo) throw new Error("fonte sem conexão: guarde a URL do papel meraki_leitor no Vault e grave o id em fontes.segredo_id");
    await carregarParser();
    const schemas = ((fonte.config.schemas as string[] | undefined) ?? ["public"]).filter(Boolean);
    const cliente = new pg.Client({
      connectionString: fonte.segredo,
      application_name: "meraki-coletor",
      statement_timeout: 15_000,
      connectionTimeoutMillis: 10_000,
    });
    // Fonte que cai no meio da coleta falha só ela, sem derrubar a coleta das outras.
    cliente.on("error", () => undefined);
    await cliente.connect();
    try {
      await cliente.query("set default_transaction_read_only = on");
      await cliente.query("begin transaction read only");
      const r = await coletarCatalogo(cliente, schemas, fonte.tipo === "supabase" ? "supabase" : "postgres");
      await cliente.query("commit");
      return r;
    } finally {
      await cliente.end().catch(() => undefined);
    }
  },
};

async function existe(cliente: pg.Client, relacao: string): Promise<boolean> {
  const r = await cliente.query("select to_regclass($1) is not null as ok", [relacao]);
  return Boolean(r.rows[0]?.ok);
}

async function coletarCatalogo(cliente: pg.Client, schemas: string[], tipoFonte: "supabase" | "postgres"): Promise<Snapshot> {
  const objetos = new Map<string, Objeto>();
  const relacoes: Relacao[] = [];
  const observacoes: Observacao[] = [];
  const avisos: string[] = [];
  const por = (o: Objeto) => objetos.set(o.chave, o);
  const consulta = async (rotulo: string, sql: string, params: unknown[] = []): Promise<Linha[]> => {
    await cliente.query("savepoint meraki");
    try {
      const r = await cliente.query(sql, params);
      await cliente.query("release savepoint meraki");
      return r.rows;
    } catch (e) {
      await cliente.query("rollback to savepoint meraki");
      avisos.push(`${rotulo}: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  };

  const papeisSupabase = (await consulta("papéis", "select rolname from pg_roles where rolname = any($1)", [["anon", "authenticated", "service_role"]])).map(
    (l) => l.rolname as string,
  );
  const usuarioAtual = (await consulta("usuário", "select current_user as u"))[0]?.u as string;

  // Tabelas e visões
  const relacoesPg = await consulta(
    "tabelas",
    `select n.nspname as schema, c.relname as nome, c.relkind, c.relrowsecurity as rls, c.relforcerowsecurity as rls_forcado,
            c.reltuples::bigint as linhas_estimadas, obj_description(c.oid, 'pg_class') as comentario,
            coalesce(c.reloptions, '{}')::text[] as opcoes, has_table_privilege(c.oid, 'SELECT') as posso_ler,
            case when c.relkind in ('v', 'm') then pg_get_viewdef(c.oid, true) end as definicao,
            coalesce((select jsonb_object_agg(g.papel, g.privs) from (
               select case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end as papel,
                      jsonb_agg(lower(a.privilege_type) order by a.privilege_type) as privs
                 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                where a.grantee <> c.relowner
                group by 1) g), '{}'::jsonb) as grants
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1) and c.relkind in ('r', 'p', 'v', 'm')
        and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
      order by 1, 2`,
    [schemas],
  );
  let semLeitura = 0;
  for (const t of relacoesPg) {
    const ehVisao = t.relkind === "v" || t.relkind === "m";
    const k = ehVisao ? chave.visao(t.schema, t.nome) : chave.tabela(t.schema, t.nome);
    if (!t.posso_ler) semLeitura++;
    if (ehVisao) {
      const opcoes = (t.opcoes as string[]).map((o) => o.toLowerCase());
      por({
        tipo: "visao", chave: k, nome: `${t.schema}.${t.nome}`, pai: null,
        atributos: {
          schema: t.schema, materializada: t.relkind === "m",
          security_invoker: opcoes.includes("security_invoker=true") || opcoes.includes("security_invoker=on") || opcoes.includes("security_invoker=1"),
          definicao: String(t.definicao ?? "").trim(), comentario: t.comentario ?? null, grants: ordenarGrants(t.grants),
        },
      });
    } else {
      por({
        tipo: "tabela", chave: k, nome: `${t.schema}.${t.nome}`, pai: null,
        atributos: {
          schema: t.schema, rls: Boolean(t.rls), rls_forcado: Boolean(t.rls_forcado), particionada: t.relkind === "p",
          comentario: t.comentario ?? null, grants: ordenarGrants(t.grants),
        },
      });
    }
  }
  const tabelaOuVisao = (schema: string, nome: string) =>
    objetos.has(chave.visao(schema, nome)) ? chave.visao(schema, nome) : chave.tabela(schema, nome);

  // Colunas
  for (const c of await consulta(
    "colunas",
    `select n.nspname as schema, c.relname as tabela, a.attname as nome, format_type(a.atttypid, a.atttypmod) as tipo,
            a.attnotnull as obrigatoria, pg_get_expr(d.adbin, d.adrelid) as padrao, a.attidentity <> '' as identidade,
            a.attgenerated <> '' as gerada, col_description(c.oid, a.attnum) as comentario
       from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
       left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where n.nspname = any($1) and c.relkind in ('r', 'p', 'v', 'm') and a.attnum > 0 and not a.attisdropped
        and not exists (select 1 from pg_depend dp where dp.objid = c.oid and dp.deptype = 'e')
      order by 1, 2, a.attnum`,
    [schemas],
  )) {
    por({
      tipo: "coluna", chave: chave.coluna(c.schema, c.tabela, c.nome), nome: c.nome, pai: tabelaOuVisao(c.schema, c.tabela),
      atributos: {
        tabela: `${c.schema}.${c.tabela}`, tipo: normalizarTipo(c.tipo), obrigatoria: Boolean(c.obrigatoria), padrao: c.padrao ?? null,
        identidade: Boolean(c.identidade), gerada: Boolean(c.gerada), comentario: c.comentario ?? null,
      },
    });
  }

  // Restrições (PG18 guarda NOT NULL como restrição 'n': já está na coluna)
  for (const r of await consulta(
    "restrições",
    `select n.nspname as schema, c.relname as tabela, con.conname as nome, con.contype as tipo,
            pg_get_constraintdef(con.oid, true) as definicao, fn.nspname as ref_schema, fc.relname as ref_tabela,
            coalesce((select array_agg(a.attname::text order by k.ord) from unnest(con.conkey) with ordinality k(attnum, ord)
                       join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum), '{}') as colunas,
            coalesce((select array_agg(a.attname::text order by k.ord) from unnest(con.confkey) with ordinality k(attnum, ord)
                       join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum), '{}') as ref_colunas
       from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
       left join pg_class fc on fc.oid = con.confrelid left join pg_namespace fn on fn.oid = fc.relnamespace
      where n.nspname = any($1) and con.contype in ('p', 'f', 'u', 'c', 'x')
      order by 1, 2, 3`,
    [schemas],
  )) {
    const k = chave.constraint(r.schema, r.tabela, r.nome);
    const referencia = r.ref_tabela ? `${r.ref_schema}.${r.ref_tabela}` : null;
    por({
      tipo: "constraint", chave: k, nome: r.nome, pai: chave.tabela(r.schema, r.tabela),
      atributos: {
        tabela: `${r.schema}.${r.tabela}`, tipo: TIPO_RESTRICAO[r.tipo] ?? r.tipo, colunas: r.colunas, referencia,
        ref_colunas: r.ref_colunas, definicao: r.definicao,
      },
    });
    if (r.tipo === "f" && referencia) {
      relacoes.push({
        origem: chave.tabela(r.schema, r.tabela), destino: tabelaOuVisao(r.ref_schema, r.ref_tabela), tipo: "referencia",
        evidencia: { objeto: k, trecho: r.definicao }, certeza: "exata",
      });
    }
  }

  // Índices, com uso
  for (const i of await consulta(
    "índices",
    `select n.nspname as schema, t.relname as tabela, i.relname as nome, pg_get_indexdef(ix.indexrelid) as definicao,
            ix.indisunique as unico, ix.indisprimary as primario, s.idx_scan as usos,
            coalesce((select array_agg(a.attname::text order by k.ord) from unnest(ix.indkey) with ordinality k(attnum, ord)
                       join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = k.attnum), '{}') as colunas
       from pg_index ix join pg_class i on i.oid = ix.indexrelid join pg_class t on t.oid = ix.indrelid
       join pg_namespace n on n.oid = t.relnamespace left join pg_stat_user_indexes s on s.indexrelid = ix.indexrelid
      where n.nspname = any($1)
      order by 1, 2, 3`,
    [schemas],
  )) {
    const k = chave.indice(i.schema, i.nome);
    por({
      tipo: "indice", chave: k, nome: i.nome, pai: tabelaOuVisao(i.schema, i.tabela),
      atributos: { tabela: `${i.schema}.${i.tabela}`, unico: Boolean(i.unico), primario: Boolean(i.primario), colunas: i.colunas, definicao: i.definicao },
    });
    if (i.usos !== null && i.usos !== undefined) observacoes.push({ chave: k, origem: "pg_stat_user_indexes", leituras: Number(i.usos) });
  }

  // Funções
  const funcoes = await consulta(
    "funções",
    `select n.nspname as schema, p.proname as nome, oidvectortypes(p.proargtypes) as tipos,
            pg_get_function_identity_arguments(p.oid) as argumentos, pg_get_function_result(p.oid) as retorno,
            l.lanname as linguagem, p.prosecdef as security_definer, p.provolatile as volatilidade, p.prokind = 'p' as procedimento,
            coalesce(p.proconfig, '{}')::text[] as config, p.prosrc as corpo, p.pronargdefaults as n_padroes,
            coalesce((select array_agg(coalesce(nullif(x.n, ''), '$' || x.ord) order by x.ord)
                        from unnest(p.proargnames) with ordinality as x(n, ord)
                       where p.proargmodes is null or p.proargmodes[x.ord] in ('i', 'b', 'v')), '{}')::text[] as nomes,
            coalesce((select array_agg(distinct case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end)
                        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '{}')::text[] as executores
            ${papeisSupabase.includes("anon") ? ", has_function_privilege('anon', p.oid, 'EXECUTE') as exec_anon" : ""}
            ${papeisSupabase.includes("authenticated") ? ", has_function_privilege('authenticated', p.oid, 'EXECUTE') as exec_authenticated" : ""}
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
      where n.nspname = any($1) and p.prokind in ('f', 'p')
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      order by 1, 2, 3`,
    [schemas],
  );
  const leiturasDeCorpo: { k: string; f: Linha }[] = [];
  for (const f of funcoes) {
    const tipos = String(f.tipos ?? "").split(",").map((t) => t.trim()).filter(Boolean).map(normalizarTipo);
    const k = chave.funcao(f.schema, f.nome, tipos.join(","));
    const searchPath = (f.config as string[]).find((c) => c.startsWith("search_path="));
    const executores = [...(f.executores as string[])].sort();
    const permissoes = permissoesDeExecucao(executores);
    const nomesArgs = f.nomes as string[];
    const nPadroes = Number(f.n_padroes ?? 0);
    por({
      tipo: "funcao", chave: k, nome: `${f.schema}.${f.nome}`, pai: null,
      atributos: {
        schema: f.schema, nome: f.nome, tipos, retorno: f.retorno, linguagem: f.linguagem,
        parametros: tipos.map((t, i) => ({ nome: nomesArgs[i] ?? `$${i + 1}`, tipo: t, padrao: i >= tipos.length - nPadroes })),
        security_definer: Boolean(f.security_definer),
        search_path: searchPath ? searchPath.slice("search_path=".length) : null,
        volatilidade: f.volatilidade, procedimento: Boolean(f.procedimento), executores,
        exec_anon: f.exec_anon ?? (papeisSupabase.includes("anon") ? permissoes.exec_anon : false),
        exec_authenticated: f.exec_authenticated ?? (papeisSupabase.includes("authenticated") ? permissoes.exec_authenticated : false),
        corpo: f.corpo, corpo_hash: sha256(String(f.corpo ?? "")).slice(0, 16), sql_dinamico: false,
      },
    });
    leiturasDeCorpo.push({ k, f });
  }
  // Corpos lidos depois que todas as funções existem, para resolver chamadas pela assinatura.
  for (const { k, f } of leiturasDeCorpo) {
    const leitura = lerCorpoDeFuncao(f.linguagem, String(f.corpo ?? ""), String(f.argumentos ?? ""), String(f.retorno ?? "void"));
    if (!leitura.ok) avisos.push(`corpo de ${f.schema}.${f.nome} não pôde ser lido por completo`);
    if (leitura.dinamico) objetos.get(k)!.atributos.sql_dinamico = true;
    relacoes.push(...relacoesDeAcessos(k, leitura.acessos, objetos).filter((r) => schemas.some((s) => r.destino.includes(`:${s}.`))));
  }

  // Policies
  for (const p of await consulta(
    "policies",
    `select schemaname as schema, tablename as tabela, policyname as nome, permissive, roles::text[] as papeis, cmd, qual, with_check
       from pg_policies where schemaname = any($1) order by 1, 2, 3`,
    [schemas],
  )) {
    const k = chave.policy(p.schema, p.tabela, p.nome);
    const alvo = tabelaOuVisao(p.schema, p.tabela);
    por({
      tipo: "policy", chave: k, nome: p.nome, pai: alvo,
      atributos: {
        tabela: `${p.schema}.${p.tabela}`, comando: String(p.cmd).toUpperCase(), permissiva: p.permissive === "PERMISSIVE",
        papeis: [...(p.papeis as string[])].map((x) => x.toLowerCase()).sort(), usando: p.qual ?? null, checagem: p.with_check ?? null,
      },
    });
    relacoes.push({ origem: k, destino: alvo, tipo: "protege", evidencia: { objeto: k }, certeza: "exata" });
    for (const expr of [p.qual, p.with_check]) {
      if (!expr) continue;
      const acessos = acessosDoSql(`select ${expr}`) ?? [];
      relacoes.push(...relacoesDeAcessos(k, acessos, objetos, { trecho: String(expr).slice(0, 200) }).filter((r) => r.tipo === "chama" || objetos.has(r.destino)));
    }
  }

  // Gatilhos
  for (const g of await consulta(
    "gatilhos",
    `select n.nspname as schema, c.relname as tabela, t.tgname as nome, pg_get_triggerdef(t.oid, true) as definicao,
            pn.nspname as funcao_schema, p.proname as funcao_nome, oidvectortypes(p.proargtypes) as funcao_tipos, t.tgenabled <> 'D' as habilitado
       from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
       join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
      where not t.tgisinternal and n.nspname = any($1)
      order by 1, 2, 3`,
    [schemas],
  )) {
    const k = chave.gatilho(g.schema, g.tabela, g.nome);
    const alvo = tabelaOuVisao(g.schema, g.tabela);
    const fn = chave.funcao(g.funcao_schema, g.funcao_nome, String(g.funcao_tipos ?? "").split(",").map((t) => t.trim()).filter(Boolean).map(normalizarTipo).join(","));
    por({ tipo: "gatilho", chave: k, nome: g.nome, pai: alvo, atributos: { tabela: `${g.schema}.${g.tabela}`, funcao: fn, definicao: g.definicao, habilitado: Boolean(g.habilitado) } });
    relacoes.push({ origem: k, destino: alvo, tipo: "dispara_em", evidencia: { objeto: k, trecho: g.definicao }, certeza: "exata" });
    relacoes.push({ origem: k, destino: fn, tipo: "executa", evidencia: { objeto: k, trecho: g.definicao }, certeza: "exata" });
  }

  // Visão → tabela (pg_depend)
  for (const d of await consulta(
    "dependências de visões",
    `select distinct vn.nspname as visao_schema, v.relname as visao, tn.nspname as schema, t.relname as tabela
       from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class v on v.oid = r.ev_class
       join pg_namespace vn on vn.oid = v.relnamespace join pg_class t on t.oid = d.refobjid join pg_namespace tn on tn.oid = t.relnamespace
      where d.classid = 'pg_rewrite'::regclass and d.refclassid = 'pg_class'::regclass and v.oid <> t.oid
        and vn.nspname = any($1) and t.relkind in ('r', 'p', 'v', 'm')`,
    [schemas],
  )) {
    const origem = chave.visao(d.visao_schema, d.visao);
    relacoes.push({ origem, destino: tabelaOuVisao(d.schema, d.tabela), tipo: "le", evidencia: { objeto: origem, fonte_da_prova: "pg_depend" }, certeza: "exata" });
  }

  // Extensões
  for (const e of await consulta(
    "extensões",
    "select e.extname as nome, e.extversion as versao, n.nspname as schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname <> 'plpgsql' order by 1",
  )) {
    por({ tipo: "extensao", chave: chave.extensao(e.nome), nome: e.nome, pai: null, atributos: { versao: e.versao, schema: e.schema } });
  }

  // Storage (Supabase)
  if (await existe(cliente, "storage.buckets")) {
    for (const b of await consulta("buckets", "select id, name as nome, public as publico from storage.buckets order by id")) {
      por({ tipo: "bucket", chave: chave.bucket(b.id), nome: b.nome, pai: null, atributos: { publico: Boolean(b.publico) } });
    }
  }

  // Migrations aplicadas (Supabase)
  if (await existe(cliente, "supabase_migrations.schema_migrations")) {
    for (const m of await consulta(
      "migrations",
      "select version, name, coalesce(statements, '{}') as statements from supabase_migrations.schema_migrations order by version",
    )) {
      const comandos = (m.statements as string[]).flatMap((s) => tentarLerComandos(s) ?? []);
      por({
        tipo: "migracao", chave: chave.migracao(m.version), nome: m.name ?? m.version, pai: null,
        atributos: { versao: m.version, nome: m.name ?? null, comandos: (m.statements as string[]).length, objetos_criados: chavesCriadas(comandos, tipoFonte) },
      });
    }
  }

  // Uso por tabela (contadores brutos; o delta do dia é calculado na gravação)
  for (const u of await consulta(
    "uso de tabelas",
    `select schemaname as schema, relname as tabela, coalesce(seq_scan, 0) + coalesce(idx_scan, 0) as leituras,
            coalesce(n_tup_ins, 0) + coalesce(n_tup_upd, 0) + coalesce(n_tup_del, 0) as escritas, n_live_tup as linhas
       from pg_stat_user_tables where schemaname = any($1)`,
    [schemas],
  )) {
    observacoes.push({
      chave: chave.tabela(u.schema, u.tabela), origem: "pg_stat_user_tables",
      leituras: Number(u.leituras), escritas: Number(u.escritas), linhas: u.linhas === null ? null : Number(u.linhas),
    });
  }
  for (const u of await consulta(
    "uso de funções",
    `select s.schemaname as schema, s.funcname as nome, oidvectortypes(p.proargtypes) as tipos, s.calls
       from pg_stat_user_functions s join pg_proc p on p.oid = s.funcid where s.schemaname = any($1)`,
    [schemas],
  )) {
    const tipos = String(u.tipos ?? "").split(",").map((t) => t.trim()).filter(Boolean).map(normalizarTipo).join(",");
    observacoes.push({ chave: chave.funcao(u.schema, u.nome, tipos), origem: "pg_stat_user_functions", leituras: Number(u.calls) });
  }

  // Colunas vazias. pg_stats esconde tabela sem SELECT e tabela com RLS ativa para quem não passa por cima dela.
  // A função opcional meraki.colunas_vazias() (SECURITY DEFINER, devolve só null_frac) entrega o agregado
  // sem SELECT nem BYPASSRLS: nenhuma linha de dado sai do banco. Ver exemplos/fontes/meraki_leitor.sql.
  const comFuncao = Boolean(
    (
      await consulta(
        "estatísticas de coluna",
        `select case when to_regprocedure('meraki.colunas_vazias()') is null then false
                     else has_function_privilege('meraki.colunas_vazias()', 'EXECUTE') end as ok`,
      )
    )[0]?.ok,
  );
  for (const s of await consulta(
    "colunas vazias",
    comFuncao
      ? "select schema, tabela, coluna, null_frac from meraki.colunas_vazias() where schema = any($1)"
      : "select schemaname as schema, tablename as tabela, attname as coluna, null_frac from pg_stats where schemaname = any($1)",
    [schemas],
  )) {
    observacoes.push({ chave: chave.coluna(s.schema, s.tabela, s.coluna), origem: "pg_stats", vazia: Number(s.null_frac) >= 0.999 });
  }

  // Quem usa o quê: pg_stat_statements por papel, cada query lida pelo parser
  const papeisVistos = new Set<string>();
  // A extensão pode estar em qualquer schema (no Supabase, extensions): procura pelo catálogo, não pelo search_path.
  const schemaPss = (
    await consulta(
      "pg_stat_statements",
      "select n.nspname as schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_stat_statements'",
    )
  )[0]?.schema as string | undefined;
  if (schemaPss) {
    const statements = await consulta(
      "pg_stat_statements",
      `select r.rolname as papel, s.query, s.calls
         from ${pg.escapeIdentifier(schemaPss)}.pg_stat_statements s join pg_roles r on r.oid = s.userid
        where s.dbid = (select oid from pg_database where datname = current_database()) and s.toplevel
        order by s.calls desc limit 3000`,
    );
    const vistas = new Set<string>();
    for (const s of statements) {
      const papel = String(s.papel);
      if (papel === usuarioAtual || PAPEIS_DE_SISTEMA.test(papel)) continue;
      const acessos = acessosDoSql(String(s.query));
      if (!acessos) continue;
      const origem = chave.papel(papel);
      for (const rel of relacoesDeAcessos(origem, acessos, objetos, { query: String(s.query).slice(0, 300), chamadas: Number(s.calls) })) {
        if (!objetos.has(rel.destino)) continue;
        const id = `${rel.tipo}:${rel.destino}`;
        if (vistas.has(`${papel}:${id}`)) continue;
        vistas.add(`${papel}:${id}`);
        papeisVistos.add(papel);
        relacoes.push(rel);
      }
    }
  } else {
    avisos.push("pg_stat_statements indisponível: relações papel → tabela não coletadas");
  }

  if (papeisVistos.size) {
    for (const r of await consulta(
      "papéis consumidores",
      "select rolname as nome, rolcanlogin as login, rolsuper as superusuario, rolbypassrls as ignora_rls from pg_roles where rolname = any($1) order by 1",
      [[...papeisVistos]],
    )) {
      por({ tipo: "papel", chave: chave.papel(r.nome), nome: r.nome, pai: null, atributos: { login: r.login, superusuario: r.superusuario, ignora_rls: r.ignora_rls } });
    }
  }

  // catalogo: só estrutura · agregados: estrutura + null_frac pela função · completo: o leitor tem SELECT em tudo
  const modo = comFuncao ? "agregados" : semLeitura > 0 ? "catalogo" : "completo";
  if (modo === "catalogo") {
    avisos.push(`modo catálogo: sem SELECT em ${semLeitura} tabela(s) e sem meraki.colunas_vazias() — E06 e X02 ficam desligadas nelas`);
  } else if (modo === "completo" && [...objetos.values()].some((o) => o.tipo === "tabela" && o.atributos.rls)) {
    avisos.push("pg_stats esconde tabelas com RLS ativa: instale meraki.colunas_vazias() para E06 e X02 enxergarem essas colunas");
  }
  return { objetos: [...objetos.values()], relacoes: dedupeRelacoes(relacoes), observacoes, modo, avisos };
}

function ordenarGrants(grants: Record<string, string[]> | null): Record<string, string[]> {
  const saida: Record<string, string[]> = {};
  for (const papel of Object.keys(grants ?? {}).sort()) saida[papel] = [...(grants![papel] ?? [])].sort();
  return saida;
}

export function dedupeRelacoes(relacoes: Relacao[]): Relacao[] {
  const mapa = new Map<string, Relacao>();
  for (const r of relacoes) {
    const k = `${r.origem}→${r.destino}:${r.tipo}`;
    const atual = mapa.get(k);
    if (!atual || (atual.certeza === "inferida" && r.certeza === "exata")) mapa.set(k, r);
  }
  return [...mapa.values()];
}
