/**
 * Aplica DDL a uma cópia do snapshot e devolve o estado proposto e o delta.
 * Usado pelo gate (o que a migration cria ou altera) e pelos coletores (o que cada migration criou).
 * Tudo que o modelo não sabe representar vai para `naoResolvidos`: o gate pergunta, nunca permite.
 */
import { chave } from "../chaves.ts";
import type { Objeto, Relacao } from "../tipos.ts";
import { sha256 } from "../util/hash.ts";
import {
  type Comando,
  acessosDoNo,
  lerCorpoDeFuncao,
  nomeDeRangeVar,
  nomeQualificado,
  nomes,
  tipoDeTypeName,
} from "./parser.ts";

type No = Record<string, unknown>;

export interface OpcoesDdl {
  /** supabase: funções e tabelas novas ganham os grants padrão de anon/authenticated. */
  tipoFonte: "supabase" | "postgres";
  esquemaPadrao?: string;
}

export interface EstadoProposto {
  objetos: Map<string, Objeto>;
  relacoes: Relacao[];
  novos: Set<string>;
  alterados: Set<string>;
  removidos: Map<string, Objeto>;
  naoResolvidos: string[];
  resumo: string[];
}

/** Comandos que não mudam estrutura: o gate deixa passar sem olhar. */
const SEM_EFEITO = new Set([
  "SelectStmt", "InsertStmt", "UpdateStmt", "DeleteStmt", "MergeStmt", "TransactionStmt", "VariableSetStmt", "VariableShowStmt",
  "ExplainStmt", "TruncateStmt", "CommentStmt", "CreateSchemaStmt", "CreateSeqStmt", "AlterSeqStmt", "CreateEnumStmt",
  "AlterEnumStmt", "CompositeTypeStmt", "CreateDomainStmt", "AlterDefaultPrivilegesStmt", "AlterOwnerStmt", "NotifyStmt",
  "ListenStmt", "LockStmt", "AnalyzeStmt", "VacuumStmt", "CopyStmt", "PrepareStmt", "ExecuteStmt", "DeallocateStmt",
]);

/** Comandos estruturais que o motor modela. */
const MODELADOS = new Set([
  "CreateStmt", "AlterTableStmt", "RenameStmt", "DropStmt", "CreateFunctionStmt", "AlterFunctionStmt", "CreatePolicyStmt",
  "AlterPolicyStmt", "ViewStmt", "CreateTrigStmt", "IndexStmt", "GrantStmt", "CreateExtensionStmt",
]);

export function comandoTemEfeitoEstrutural(tipo: string): boolean {
  return !SEM_EFEITO.has(tipo);
}

const TIPO_RESTRICAO: Record<string, string> = {
  CONSTR_PRIMARY: "primaria", CONSTR_FOREIGN: "estrangeira", CONSTR_UNIQUE: "unica", CONSTR_CHECK: "checagem", CONSTR_EXCLUSION: "exclusao",
};

function bool(arg: unknown): boolean | undefined {
  const a = arg as No | undefined;
  if (!a) return undefined;
  if ("Boolean" in a) return Boolean((a.Boolean as No).boolval);
  if ("String" in a) return ["true", "on", "yes", "1"].includes(String((a.String as No).sval).toLowerCase());
  if ("Integer" in a) return Number((a.Integer as No).ival) !== 0;
  return undefined;
}

function textoDe(arg: unknown): string | undefined {
  const a = arg as No | undefined;
  if (!a) return undefined;
  if ("String" in a) return (a.String as No).sval as string;
  if ("A_Const" in a) {
    const c = a.A_Const as No;
    const s = (c.sval as No | undefined)?.sval;
    return typeof s === "string" ? s : "";
  }
  if ("List" in a) return nomes((a.List as No).items).join(" ");
  if ("TypeName" in a) return tipoDeTypeName(a.TypeName as No);
  return undefined;
}

/** Recorta o texto entre parênteses que segue uma palavra-chave (ex.: "with check"). */
export function trechoAposPalavra(texto: string, palavra: RegExp): string | null {
  const m = palavra.exec(texto);
  if (!m) return null;
  let i = texto.indexOf("(", m.index + m[0].length - 1);
  if (i < 0) return null;
  let nivel = 0;
  const inicio = i;
  for (; i < texto.length; i++) {
    if (texto[i] === "(") nivel++;
    else if (texto[i] === ")" && --nivel === 0) return texto.slice(inicio + 1, i).trim();
  }
  return null;
}

/** Remove parênteses externos e espaços: "(true)" → "true". */
export function normalizarExpr(expr: unknown): string | null {
  if (typeof expr !== "string") return null;
  let e = expr.trim().toLowerCase().replace(/\s+/g, " ");
  while (e.startsWith("(") && e.endsWith(")") && equilibrado(e.slice(1, -1))) e = e.slice(1, -1).trim();
  return e;
}

function equilibrado(s: string): boolean {
  let n = 0;
  for (const c of s) {
    if (c === "(") n++;
    else if (c === ")" && --n < 0) return false;
  }
  return n === 0;
}

function papelDe(rs: No): string {
  const r = rs.RoleSpec as No;
  if (r.roletype === "ROLESPEC_PUBLIC") return "public";
  if (r.roletype === "ROLESPEC_CURRENT_USER" || r.roletype === "ROLESPEC_SESSION_USER") return "current_user";
  return String(r.rolename).toLowerCase();
}

export function executoresPadrao(tipoFonte: OpcoesDdl["tipoFonte"]): string[] {
  return tipoFonte === "supabase" ? ["anon", "authenticated", "public", "service_role"] : ["public"];
}

export function permissoesDeExecucao(executores: string[]) {
  const publico = executores.includes("public");
  return {
    exec_anon: publico || executores.includes("anon"),
    exec_authenticated: publico || executores.includes("authenticated"),
  };
}

export function aplicarDdl(
  comandos: Comando[],
  base: { objetos: Iterable<Objeto>; relacoes: Iterable<Relacao> },
  opcoes: OpcoesDdl,
): EstadoProposto {
  const esquema = opcoes.esquemaPadrao ?? "public";
  const objetos = new Map<string, Objeto>();
  for (const o of base.objetos) objetos.set(o.chave, { ...o, atributos: { ...o.atributos } });
  const relacoes: Relacao[] = [...base.relacoes];
  const novos = new Set<string>();
  const alterados = new Set<string>();
  const removidos = new Map<string, Objeto>();
  const naoResolvidos: string[] = [];
  const resumo: string[] = [];

  const por = (o: Objeto) => {
    const existia = objetos.has(o.chave) || removidos.has(o.chave);
    objetos.set(o.chave, o);
    if (removidos.has(o.chave)) removidos.delete(o.chave);
    if (!existia || novos.has(o.chave)) novos.add(o.chave);
    else alterados.add(o.chave);
  };
  const alterar = (k: string, mudar: (atributos: Record<string, unknown>) => void) => {
    const o = objetos.get(k);
    if (!o) return false;
    const copia = { ...o, atributos: { ...o.atributos } };
    mudar(copia.atributos);
    objetos.set(k, copia);
    if (!novos.has(k)) alterados.add(k);
    return true;
  };
  const remover = (k: string) => {
    const o = objetos.get(k);
    if (!o) return;
    objetos.delete(k);
    novos.delete(k);
    alterados.delete(k);
    removidos.set(k, o);
    for (const filho of [...objetos.values()].filter((x) => x.pai === k)) remover(filho.chave);
  };
  const relacionar = (r: Relacao) => relacoes.push(r);
  const tabelaOuVisao = (ref: string) =>
    objetos.has(chave.tabela(...dividir(ref))) ? chave.tabela(...dividir(ref)) : chave.visao(...dividir(ref));
  const funcoesPorNome = (ref: string) => [...objetos.keys()].filter((k) => k.startsWith(`pg:funcao:${ref}(`));

  const colunaDe = (schema: string, tabela: string, def: No): Objeto => {
    const restricoes = ((def.constraints as No[]) ?? []).map((c) => c.Constraint as No);
    const tem = (t: string) => restricoes.some((c) => c.contype === t);
    return {
      tipo: "coluna",
      chave: chave.coluna(schema, tabela, def.colname as string),
      nome: def.colname as string,
      pai: chave.tabela(schema, tabela),
      atributos: {
        tabela: `${schema}.${tabela}`,
        tipo: tipoDeTypeName(def.typeName as No),
        obrigatoria: tem("CONSTR_NOTNULL") || tem("CONSTR_PRIMARY"),
        padrao: tem("CONSTR_DEFAULT") ? "(definido na migration)" : null,
        identidade: tem("CONSTR_IDENTITY"),
        gerada: tem("CONSTR_GENERATED"),
      },
    };
  };

  const fkDe = (schema: string, tabela: string, c: No, colunas: string[], texto: string) => {
    const destino = nomeDeRangeVar(c.pktable as No, esquema);
    const nome = (c.conname as string) ?? `${tabela}_${colunas.join("_")}_fkey`;
    const k = chave.constraint(schema, tabela, nome);
    por({
      tipo: "constraint",
      chave: k,
      nome,
      pai: chave.tabela(schema, tabela),
      atributos: {
        tabela: `${schema}.${tabela}`, tipo: "estrangeira", colunas, referencia: destino,
        ref_colunas: nomes(c.pk_attrs), definicao: texto.slice(0, 300),
      },
    });
    relacionar({
      origem: chave.tabela(schema, tabela), destino: chave.tabela(...dividir(destino)), tipo: "referencia",
      evidencia: { objeto: k, trecho: texto.slice(0, 300) }, certeza: "exata",
    });
  };

  for (const cmd of comandos) {
    const n = cmd.no;
    const texto = cmd.texto;
    if (SEM_EFEITO.has(cmd.tipo)) continue;
    if (!MODELADOS.has(cmd.tipo)) {
      naoResolvidos.push(texto);
      continue;
    }
    switch (cmd.tipo) {
      case "CreateStmt": {
        const [schema, tabela] = dividir(nomeDeRangeVar(n.relation as No, esquema));
        const k = chave.tabela(schema, tabela);
        if (objetos.has(k) && n.if_not_exists) break;
        if ((n.relation as No).relpersistence === "t") break; // temporária
        por({
          tipo: "tabela", chave: k, nome: `${schema}.${tabela}`, pai: null,
          atributos: {
            schema, rls: false, rls_forcado: false, particionada: Boolean(n.partspec),
            grants: opcoes.tipoFonte === "supabase" ? { anon: ["*"], authenticated: ["*"], service_role: ["*"] } : {},
          },
        });
        resumo.push(`CREATE TABLE ${schema}.${tabela}`);
        for (const el of (n.tableElts as No[]) ?? []) {
          if (el.ColumnDef) {
            const def = el.ColumnDef as No;
            por(colunaDe(schema, tabela, def));
            for (const c of ((def.constraints as No[]) ?? []).map((x) => x.Constraint as No)) {
              if (c.contype === "CONSTR_FOREIGN") fkDe(schema, tabela, c, [def.colname as string], texto);
            }
          } else if (el.Constraint) {
            const c = el.Constraint as No;
            if (c.contype === "CONSTR_FOREIGN") fkDe(schema, tabela, c, nomes(c.fk_attrs), texto);
            else if (TIPO_RESTRICAO[c.contype as string]) {
              const nome = (c.conname as string) ?? `${tabela}_${String(c.contype).replace("CONSTR_", "").toLowerCase()}`;
              por({
                tipo: "constraint", chave: chave.constraint(schema, tabela, nome), nome, pai: k,
                atributos: { tabela: `${schema}.${tabela}`, tipo: TIPO_RESTRICAO[c.contype as string], colunas: nomes(c.keys), referencia: null, ref_colunas: [] },
              });
            }
          }
        }
        break;
      }
      case "AlterTableStmt": {
        const ref = nomeDeRangeVar(n.relation as No, esquema);
        const [schema, tabela] = dividir(ref);
        const kTabela = n.objtype === "OBJECT_VIEW" ? chave.visao(schema, tabela) : tabelaOuVisao(ref);
        for (const c of ((n.cmds as No[]) ?? []).map((x) => x.AlterTableCmd as No)) {
          switch (c.subtype) {
            case "AT_EnableRowSecurity":
              alterar(kTabela, (a) => (a.rls = true));
              resumo.push(`ENABLE RLS ${ref}`);
              break;
            case "AT_DisableRowSecurity":
              alterar(kTabela, (a) => (a.rls = false));
              resumo.push(`DISABLE RLS ${ref}`);
              break;
            case "AT_ForceRowSecurity":
              alterar(kTabela, (a) => (a.rls_forcado = true));
              break;
            case "AT_NoForceRowSecurity":
              alterar(kTabela, (a) => (a.rls_forcado = false));
              break;
            case "AT_AddColumn": {
              const def = (c.def as No).ColumnDef as No;
              por(colunaDe(schema, tabela, def));
              resumo.push(`ADD COLUMN ${ref}.${def.colname}`);
              for (const r of ((def.constraints as No[]) ?? []).map((x) => x.Constraint as No)) {
                if (r.contype === "CONSTR_FOREIGN") fkDe(schema, tabela, r, [def.colname as string], texto);
              }
              break;
            }
            case "AT_DropColumn":
              remover(chave.coluna(schema, tabela, c.name as string));
              resumo.push(`DROP COLUMN ${ref}.${c.name}`);
              break;
            case "AT_AlterColumnType": {
              const tipo = tipoDeTypeName(((c.def as No).ColumnDef as No)?.typeName as No);
              alterar(chave.coluna(schema, tabela, c.name as string), (a) => (a.tipo = tipo));
              resumo.push(`ALTER COLUMN ${ref}.${c.name} TYPE ${tipo}`);
              break;
            }
            case "AT_SetNotNull":
            case "AT_DropNotNull":
              alterar(chave.coluna(schema, tabela, c.name as string), (a) => (a.obrigatoria = c.subtype === "AT_SetNotNull"));
              break;
            case "AT_ColumnDefault":
              alterar(chave.coluna(schema, tabela, c.name as string), (a) => (a.padrao = c.def ? "(definido na migration)" : null));
              break;
            case "AT_AddConstraint": {
              const r = (c.def as No).Constraint as No;
              if (r.contype === "CONSTR_FOREIGN") fkDe(schema, tabela, r, nomes(r.fk_attrs), texto);
              break;
            }
            case "AT_SetRelOptions":
            case "AT_ResetRelOptions": {
              for (const d of ((c.def as No[]) ?? []).map((x) => x.DefElem as No)) {
                if (d.defname === "security_invoker") {
                  const v = c.subtype === "AT_ResetRelOptions" ? false : (bool(d.arg) ?? true);
                  alterar(kTabela, (a) => (a.security_invoker = v));
                }
              }
              break;
            }
            case "AT_DropConstraint":
              remover(chave.constraint(schema, tabela, c.name as string));
              break;
            default:
              break;
          }
        }
        break;
      }
      case "RenameStmt": {
        const tipo = n.renameType as string;
        if (tipo === "OBJECT_TABLE" || tipo === "OBJECT_VIEW") {
          const ref = nomeDeRangeVar(n.relation as No, esquema);
          const [schema] = dividir(ref);
          const antigo = tabelaOuVisao(ref);
          const o = objetos.get(antigo);
          if (!o) break;
          const novoNome = n.newname as string;
          const novaChave = o.tipo === "visao" ? chave.visao(schema, novoNome) : chave.tabela(schema, novoNome);
          const filhos = [...objetos.values()].filter((x) => x.pai === antigo);
          remover(antigo);
          por({ ...o, chave: novaChave, nome: `${schema}.${novoNome}` });
          for (const f of filhos) {
            const fk = f.chave.replace(`${ref}.`, `${schema}.${novoNome}.`).replace(`${ref}/`, `${schema}.${novoNome}/`);
            por({ ...f, chave: fk, pai: novaChave });
          }
          resumo.push(`RENAME ${ref} → ${schema}.${novoNome}`);
        } else if (tipo === "OBJECT_COLUMN") {
          const ref = nomeDeRangeVar(n.relation as No, esquema);
          const [schema, tabela] = dividir(ref);
          const antiga = chave.coluna(schema, tabela, n.subname as string);
          const o = objetos.get(antiga);
          if (!o) break;
          remover(antiga);
          por({ ...o, chave: chave.coluna(schema, tabela, n.newname as string), nome: n.newname as string });
          resumo.push(`RENAME COLUMN ${ref}.${n.subname} → ${n.newname}`);
        } else {
          naoResolvidos.push(texto);
        }
        break;
      }
      case "DropStmt": {
        const tipo = n.removeType as string;
        for (const item of (n.objects as No[]) ?? []) {
          if (tipo === "OBJECT_TABLE" || tipo === "OBJECT_VIEW" || tipo === "OBJECT_MATVIEW") {
            const ref = nomeQualificado(nomes((item.List as No)?.items), esquema);
            const k = tipo === "OBJECT_TABLE" ? chave.tabela(...dividir(ref)) : chave.visao(...dividir(ref));
            remover(k);
            resumo.push(`DROP ${tipo === "OBJECT_TABLE" ? "TABLE" : "VIEW"} ${ref}`);
          } else if (tipo === "OBJECT_FUNCTION" || tipo === "OBJECT_PROCEDURE" || tipo === "OBJECT_ROUTINE") {
            const ow = item.ObjectWithArgs as No;
            const ref = nomeQualificado(nomes(ow.objname), esquema);
            const alvos = ow.args_unspecified
              ? funcoesPorNome(ref)
              : [chave.funcao(...dividir(ref), ((ow.objargs as No[]) ?? []).map((t) => tipoDeTypeName(t.TypeName as No)).join(","))];
            for (const k of alvos) remover(k);
            resumo.push(`DROP FUNCTION ${ref}`);
          } else if (tipo === "OBJECT_POLICY" || tipo === "OBJECT_TRIGGER") {
            const partesNome = nomes((item.List as No)?.items);
            const nome = partesNome.pop()!;
            const ref = nomeQualificado(partesNome, esquema);
            const [schema, tabela] = dividir(ref);
            remover(tipo === "OBJECT_POLICY" ? chave.policy(schema, tabela, nome) : chave.gatilho(schema, tabela, nome));
            resumo.push(`DROP ${tipo === "OBJECT_POLICY" ? "POLICY" : "TRIGGER"} ${nome} ON ${ref}`);
          } else if (tipo === "OBJECT_INDEX") {
            remover(chave.indice(...dividir(nomeQualificado(nomes((item.List as No)?.items), esquema))));
          } else if (tipo === "OBJECT_SCHEMA" || tipo === "OBJECT_TYPE" || tipo === "OBJECT_EXTENSION") {
            if (tipo === "OBJECT_SCHEMA") naoResolvidos.push(texto);
          } else {
            naoResolvidos.push(texto);
          }
        }
        break;
      }
      case "CreateFunctionStmt": {
        const ref = nomeQualificado(nomes(n.funcname), esquema);
        const [schema, nome] = dividir(ref);
        const params = ((n.parameters as No[]) ?? [])
          .map((p) => p.FunctionParameter as No)
          .filter((p) => ["FUNC_PARAM_IN", "FUNC_PARAM_DEFAULT", "FUNC_PARAM_INOUT", "FUNC_PARAM_VARIADIC", undefined].includes(p.mode as string));
        const tipos = params.map((p) => tipoDeTypeName(p.argType as No));
        const opts = Object.fromEntries(((n.options as No[]) ?? []).map((o) => o.DefElem as No).map((d) => [d.defname as string, d]));
        const linguagem = (textoDe((opts.language as No | undefined)?.arg) ?? "sql").toLowerCase();
        const corpoLista = ((opts.as as No | undefined)?.arg as No | undefined)?.List as No | undefined;
        const corpo = corpoLista ? nomes(corpoLista.items)[0] ?? "" : texto;
        const setVar = ((opts.set as No | undefined)?.arg as No | undefined)?.VariableSetStmt as No | undefined;
        const searchPath = setVar?.name === "search_path" ? ((setVar.args as No[]) ?? []).map((a) => textoDe(a) ?? "").join(", ") : null;
        const retornoTipo = n.returnType ? tipoDeTypeName(n.returnType as No) : "void";
        const retorno = (n.returnType as No | undefined)?.setof ? `setof ${retornoTipo}` : retornoTipo;
        const k = chave.funcao(schema, nome, tipos.join(","));
        const anterior = objetos.get(k);
        const executores = (anterior?.atributos.executores as string[] | undefined) ?? executoresPadrao(opcoes.tipoFonte);
        // Assinatura completa para o compilador do plpgsql: OUT viram argumentos, TABLE vira o retorno.
        const todos = ((n.parameters as No[]) ?? []).map((p) => p.FunctionParameter as No);
        const modo: Record<string, string> = { FUNC_PARAM_OUT: "out ", FUNC_PARAM_INOUT: "inout ", FUNC_PARAM_VARIADIC: "variadic " };
        const assinatura = todos
          .filter((p) => p.mode !== "FUNC_PARAM_TABLE")
          .map((p, i) => `${modo[p.mode as string] ?? ""}${(p.name as string) ?? `p${i}`} ${tipoDeTypeName(p.argType as No)}`)
          .join(", ");
        const colunasTabela = todos.filter((p) => p.mode === "FUNC_PARAM_TABLE").map((p) => `${p.name as string} ${tipoDeTypeName(p.argType as No)}`);
        const leitura = lerCorpoDeFuncao(linguagem, corpo, assinatura, colunasTabela.length ? `table(${colunasTabela.join(", ")})` : retorno);
        por({
          tipo: "funcao", chave: k, nome: `${schema}.${nome}`, pai: null,
          atributos: {
            schema, nome, tipos, retorno, linguagem,
            parametros: params.map((p, i) => ({ nome: (p.name as string) ?? `$${i + 1}`, tipo: tipos[i], padrao: Boolean(p.defexpr) })),
            security_definer: bool((opts.security as No | undefined)?.arg) ?? false,
            search_path: searchPath,
            volatilidade: ({ immutable: "i", stable: "s", volatile: "v" } as Record<string, string>)[textoDe((opts.volatility as No | undefined)?.arg) ?? "volatile"] ?? "v",
            procedimento: Boolean(n.is_procedure),
            executores, ...permissoesDeExecucao(executores),
            corpo, corpo_hash: sha256(corpo).slice(0, 16), sql_dinamico: leitura.dinamico,
          },
        });
        relacoes.push(...relacoesDeAcessos(k, leitura.acessos, objetos, { trecho: texto.slice(0, 200) }));
        resumo.push(`${anterior ? "REPLACE" : "CREATE"} FUNCTION ${ref}(${tipos.join(", ")})`);
        break;
      }
      case "AlterFunctionStmt": {
        const ow = n.func as No;
        const ref = nomeQualificado(nomes(ow.objname), esquema);
        const tipos = ((ow.objargs as No[]) ?? []).map((t) => tipoDeTypeName(t.TypeName as No)).join(",");
        const alvos = ow.objargs ? [chave.funcao(...dividir(ref), tipos)] : funcoesPorNome(ref);
        for (const d of ((n.actions as No[]) ?? []).map((a) => a.DefElem as No)) {
          for (const k of alvos) {
            alterar(k, (a) => {
              if (d.defname === "security") a.security_definer = bool(d.arg) ?? false;
              if (d.defname === "set") {
                const v = (d.arg as No)?.VariableSetStmt as No;
                if (v?.name === "search_path") a.search_path = ((v.args as No[]) ?? []).map((x) => textoDe(x) ?? "").join(", ");
              }
              if (d.defname === "reset") a.search_path = null;
            });
          }
        }
        resumo.push(`ALTER FUNCTION ${ref}`);
        break;
      }
      case "CreatePolicyStmt":
      case "AlterPolicyStmt": {
        const ref = nomeDeRangeVar(n.table as No, esquema);
        const [schema, tabela] = dividir(ref);
        const nome = n.policy_name as string;
        const k = chave.policy(schema, tabela, nome);
        const usando = trechoAposPalavra(texto, /\busing\s*\(/i);
        const checagem = trechoAposPalavra(texto, /\bwith\s+check\s*\(/i);
        const papeis = ((n.roles as No[]) ?? []).map(papelDe).sort();
        if (cmd.tipo === "CreatePolicyStmt") {
          por({
            tipo: "policy", chave: k, nome, pai: tabelaOuVisao(ref),
            atributos: {
              tabela: ref, comando: String(n.cmd_name ?? "all").toUpperCase(), permissiva: n.permissive !== false,
              papeis: papeis.length ? papeis : ["public"], usando, checagem,
            },
          });
          resumo.push(`CREATE POLICY ${nome} ON ${ref}`);
        } else {
          alterar(k, (a) => {
            if (papeis.length) a.papeis = papeis;
            if (usando !== null) a.usando = usando;
            if (checagem !== null) a.checagem = checagem;
          });
          resumo.push(`ALTER POLICY ${nome} ON ${ref}`);
        }
        relacionar({ origem: k, destino: tabelaOuVisao(ref), tipo: "protege", evidencia: { objeto: k }, certeza: "exata" });
        for (const expr of [n.qual, n.with_check]) {
          relacoes.push(...relacoesDeAcessos(k, acessosDoNo(expr).filter((a) => a.tipo === "chama"), objetos, { trecho: texto.slice(0, 200) }));
        }
        break;
      }
      case "ViewStmt": {
        const ref = nomeDeRangeVar(n.view as No, esquema);
        const [schema, nome] = dividir(ref);
        const k = chave.visao(schema, nome);
        const invoker = ((n.options as No[]) ?? []).map((o) => o.DefElem as No).find((d) => d.defname === "security_invoker");
        por({
          tipo: "visao", chave: k, nome: ref, pai: null,
          atributos: { schema, materializada: false, security_invoker: invoker ? (bool(invoker.arg) ?? true) : false, definicao: texto.slice(0, 2000) },
        });
        relacoes.push(...relacoesDeAcessos(k, acessosDoNo(n.query), objetos, { trecho: texto.slice(0, 200) }));
        resumo.push(`CREATE VIEW ${ref}`);
        break;
      }
      case "CreateTrigStmt": {
        const ref = nomeDeRangeVar(n.relation as No, esquema);
        const [schema, tabela] = dividir(ref);
        const k = chave.gatilho(schema, tabela, n.trigname as string);
        const fn = funcoesPorNome(nomeQualificado(nomes(n.funcname), esquema));
        por({
          tipo: "gatilho", chave: k, nome: n.trigname as string, pai: tabelaOuVisao(ref),
          atributos: { tabela: ref, funcao: fn[0] ?? null, definicao: texto.slice(0, 500), habilitado: true },
        });
        relacionar({ origem: k, destino: tabelaOuVisao(ref), tipo: "dispara_em", evidencia: { objeto: k }, certeza: "exata" });
        for (const f of fn) relacionar({ origem: k, destino: f, tipo: "executa", evidencia: { objeto: k }, certeza: "exata" });
        resumo.push(`CREATE TRIGGER ${n.trigname} ON ${ref}`);
        break;
      }
      case "IndexStmt": {
        const ref = nomeDeRangeVar(n.relation as No, esquema);
        const [schema] = dividir(ref);
        const nome = (n.idxname as string) ?? `${dividir(ref)[1]}_idx`;
        if (objetos.has(chave.indice(schema, nome)) && n.if_not_exists) break;
        por({
          tipo: "indice", chave: chave.indice(schema, nome), nome, pai: tabelaOuVisao(ref),
          atributos: { tabela: ref, unico: Boolean(n.unique), primario: false, definicao: texto.slice(0, 300) },
        });
        resumo.push(`CREATE ${n.unique ? "UNIQUE " : ""}INDEX ${schema}.${nome} ON ${ref}`);
        break;
      }
      case "GrantStmt": {
        const objtype = n.objtype as string;
        const papeis = ((n.grantees as No[]) ?? []).map(papelDe);
        const privs = ((n.privileges as No[]) ?? []).map((p) => String((p.AccessPriv as No).priv_name).toLowerCase());
        const concede = Boolean(n.is_grant);
        if (objtype === "OBJECT_FUNCTION" || objtype === "OBJECT_PROCEDURE" || objtype === "OBJECT_ROUTINE") {
          if (privs.length && !privs.includes("execute")) break;
          let alvos: string[];
          if (n.targtype === "ACL_TARGET_ALL_IN_SCHEMA") {
            const schemas = nomes(n.objects);
            alvos = [...objetos.values()].filter((o) => o.tipo === "funcao" && schemas.includes(String(o.atributos.schema))).map((o) => o.chave);
          } else {
            alvos = ((n.objects as No[]) ?? []).flatMap((o) => {
              const ow = o.ObjectWithArgs as No;
              const ref = nomeQualificado(nomes(ow.objname), esquema);
              return ow.objargs
                ? [chave.funcao(...dividir(ref), ((ow.objargs as No[]) ?? []).map((t) => tipoDeTypeName(t.TypeName as No)).join(","))]
                : funcoesPorNome(ref);
            });
          }
          for (const k of alvos) {
            alterar(k, (a) => {
              const atual = new Set((a.executores as string[]) ?? []);
              for (const p of papeis) concede ? atual.add(p) : atual.delete(p);
              a.executores = [...atual].sort();
              Object.assign(a, permissoesDeExecucao(a.executores as string[]));
            });
          }
          resumo.push(`${concede ? "GRANT" : "REVOKE"} EXECUTE ${papeis.join(", ")}`);
        }
        break;
      }
      case "CreateExtensionStmt": {
        const nome = n.extname as string;
        if (!objetos.has(chave.extensao(nome))) {
          por({ tipo: "extensao", chave: chave.extensao(nome), nome, pai: null, atributos: { versao: null, schema: esquema } });
          resumo.push(`CREATE EXTENSION ${nome}`);
        }
        break;
      }
    }
  }

  return { objetos, relacoes, novos, alterados, removidos, naoResolvidos, resumo };
}

export function dividir(ref: string): [string, string] {
  const i = ref.indexOf(".");
  return i < 0 ? ["public", ref] : [ref.slice(0, i), ref.slice(i + 1)];
}

/** Converte acessos (schema.nome) em relações, resolvendo funções pela assinatura conhecida. */
export function relacoesDeAcessos(
  origem: string,
  acessos: { alvo: string; tipo: string; certeza: "exata" | "inferida"; linha?: number }[],
  objetos: Map<string, Objeto>,
  evidencia: Record<string, unknown> = {},
): Relacao[] {
  const saida: Relacao[] = [];
  for (const a of acessos) {
    const ev = { ...evidencia, objeto: origem, ...(a.linha ? { linha: a.linha } : {}) };
    if (a.tipo === "chama") {
      const candidatas = [...objetos.keys()].filter((k) => k.startsWith(`pg:funcao:${a.alvo}(`));
      if (!candidatas.length) continue; // função de sistema, extensão ou de outro schema
      for (const k of candidatas) {
        saida.push({ origem, destino: k, tipo: "chama", evidencia: ev, certeza: candidatas.length === 1 ? a.certeza : "inferida" });
      }
      continue;
    }
    const [schema, nome] = dividir(a.alvo);
    const tabela = chave.tabela(schema, nome);
    const visao = chave.visao(schema, nome);
    const destino = objetos.has(visao) ? visao : tabela;
    saida.push({ origem, destino, tipo: a.tipo, evidencia: ev, certeza: objetos.has(destino) ? a.certeza : "inferida" });
  }
  return saida;
}

/** Chaves que um SQL de migration cria (tabelas, visões, funções, policies, gatilhos). */
export function chavesCriadas(comandos: Comando[], tipoFonte: OpcoesDdl["tipoFonte"] = "postgres"): string[] {
  const estado = aplicarDdl(comandos, { objetos: [], relacoes: [] }, { tipoFonte });
  return [...estado.novos].filter((k) => /^pg:(tabela|visao|funcao|policy|gatilho):/.test(k)).sort();
}
