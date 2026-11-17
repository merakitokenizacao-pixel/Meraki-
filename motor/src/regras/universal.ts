/** Pacote universal (U01–U07, U09) e splinter (U08): segurança de banco exposto, sem depender de contrato. */
import { nomeDaFuncao } from "../chaves.ts";
import { normalizarExpr } from "../sql/ddl.ts";
import type { AchadoBruto } from "../tipos.ts";
import { type ContextoRegra, type Regra, PAPEIS_DA_API, exibir, exposto, noEscopo } from "./base.ts";

const ACOES = ["SELECT", "INSERT", "UPDATE", "DELETE"];

export const U01: Regra = {
  codigo: "U01", pacote: "universal", severidade: "critico", bloqueia: true, alvo: "pg:tabela",
  titulo: "Tabela sem RLS em schema exposto",
  descricao: "Toda tabela num schema exposto pela API precisa de RLS ligada; sem ela, qualquer chave anon lê e escreve tudo.",
  avaliar: (ctx) =>
    noEscopo(ctx, "tabela")
      .filter((t) => exposto(t, ctx.grafo) && !t.atributos.rls)
      .map((t) => ({
        regra: "U01", objeto: t.chave, severidade: "critico",
        titulo: `${exibir(t.chave)} está sem RLS num schema exposto`,
        detalhe: `A tabela fica acessível pela API sem filtro de linha. Ligue com: alter table ${exibir(t.chave)} enable row level security; e crie as policies.`,
        evidencia: { objeto: t.chave, fonte: t.fonteId, atributo: "rls = false" },
      })),
};

function escritaAberta(o: { atributos: Record<string, unknown> }): string | null {
  const cmd = String(o.atributos.comando);
  const usando = normalizarExpr(o.atributos.usando);
  const checagem = normalizarExpr(o.atributos.checagem);
  if (cmd === "INSERT" && checagem === "true") return "with check (true)";
  if ((cmd === "UPDATE" || cmd === "ALL") && (usando === "true" || checagem === "true")) return usando === "true" ? "using (true)" : "with check (true)";
  if (cmd === "DELETE" && usando === "true") return "using (true)";
  return null;
}

export const U02: Regra = {
  codigo: "U02", pacote: "universal", severidade: "critico", bloqueia: true, alvo: "pg:policy",
  titulo: "Policy de escrita liberada para anon/authenticated",
  descricao: "Policy de INSERT/UPDATE/DELETE com expressão true deixa qualquer usuário escrever em qualquer linha.",
  avaliar: (ctx) =>
    noEscopo(ctx, "policy").flatMap((p): AchadoBruto[] => {
      if (!p.atributos.permissiva) return [];
      const papeis = (p.atributos.papeis as string[]) ?? [];
      if (!papeis.some((x) => PAPEIS_DA_API.has(x))) return [];
      const aberta = escritaAberta(p);
      if (!aberta) return [];
      return [{
        regra: "U02", objeto: p.chave, par: p.pai ?? undefined, severidade: "critico",
        titulo: `${exibir(p.chave)} libera ${String(p.atributos.comando).toLowerCase()} com ${aberta}`,
        detalhe: `Papéis: ${papeis.join(", ")}. Restrinja pela coluna de escopo (ex.: tenant) em vez de true.`,
        evidencia: { objeto: p.chave, trecho: `${p.atributos.comando} ${aberta}` },
      }];
    }),
};

export const U03: Regra = {
  codigo: "U03", pacote: "universal", severidade: "medio", bloqueia: true, alvo: "pg:tabela",
  titulo: "Policies permissivas sobrepostas",
  descricao: "Duas policies permissivas para o mesmo papel e ação se somam (OR): a mais aberta vence e a outra vira ruído.",
  avaliar: (ctx) => {
    const saida: AchadoBruto[] = [];
    for (const t of noEscopo(ctx, ["tabela", "visao"])) {
      const grupos = new Map<string, string[]>();
      for (const p of ctx.grafo.filhos(t.chave, "policy")) {
        if (!p.atributos.permissiva) continue;
        const cmd = String(p.atributos.comando);
        for (const acao of cmd === "ALL" ? ACOES : [cmd]) {
          for (const papel of (p.atributos.papeis as string[]) ?? []) {
            const k = `${papel}:${acao}`;
            grupos.set(k, [...(grupos.get(k) ?? []), p.nome]);
          }
        }
      }
      for (const [k, nomes] of grupos) {
        if (nomes.length < 2) continue;
        const [papel, acao] = k.split(":");
        saida.push({
          regra: "U03", objeto: t.chave, variante: k, severidade: "medio",
          titulo: `${exibir(t.chave)}: ${nomes.length} policies permissivas para ${papel} em ${acao}`,
          detalhe: `Policies ${nomes.join(", ")} valem juntas (OR). Junte numa só ou torne uma restritiva.`,
          evidencia: { objeto: t.chave, policies: nomes },
        });
      }
    }
    return saida;
  },
};

const definer = (ctx: ContextoRegra) => noEscopo(ctx, "funcao").filter((f) => f.atributos.security_definer);

export const U04: Regra = {
  codigo: "U04", pacote: "universal", severidade: "alto", bloqueia: true, alvo: "pg:funcao",
  titulo: "SECURITY DEFINER sem search_path fixo",
  descricao: "Função que roda com os privilégios do dono precisa fixar o search_path; senão um schema do chamador sequestra nomes.",
  avaliar: (ctx) =>
    definer(ctx)
      .filter((f) => !f.atributos.search_path)
      .map((f) => ({
        regra: "U04", objeto: f.chave, severidade: "alto",
        titulo: `${exibir(f.chave)} é SECURITY DEFINER sem search_path fixo`,
        detalhe: `Adicione set search_path = '' e qualifique os nomes (public.tabela).`,
        evidencia: { objeto: f.chave, atributo: "search_path = null" },
      })),
};

export const U05: Regra = {
  codigo: "U05", pacote: "universal", severidade: "alto", bloqueia: true, alvo: "pg:funcao",
  titulo: "SECURITY DEFINER executável por anon",
  descricao: "Função com privilégio do dono chamável sem login. No Postgres, função nova nasce executável por PUBLIC.",
  avaliar: (ctx) =>
    definer(ctx)
      .filter((f) => f.atributos.exec_anon)
      .map((f) => ({
        regra: "U05", objeto: f.chave, severidade: "alto",
        titulo: `${exibir(f.chave)} é SECURITY DEFINER e anon pode executar`,
        detalhe: `Revogue: revoke execute on function ${exibir(f.chave)} from public, anon;`,
        evidencia: { objeto: f.chave, executores: f.atributos.executores },
      })),
};

export const U06: Regra = {
  codigo: "U06", pacote: "universal", severidade: "critico", bloqueia: true, alvo: "pg:funcao",
  titulo: "Função com parâmetro de escopo sem validar o escopo",
  descricao: "SECURITY DEFINER que recebe o parâmetro de escopo (ex.: p_tenant), executável por authenticated, sem chamar um validador: um usuário passa o tenant de outro.",
  avaliar: (ctx) => {
    const param = ctx.intencao.contrato.convencoes.parametro_de_escopo;
    const validadores = ctx.intencao.validadores();
    if (!param || !validadores.size) return [];
    return definer(ctx).flatMap((f): AchadoBruto[] => {
      if (!f.atributos.exec_authenticated || ctx.intencao.ehValidador(f.chave)) return [];
      const params = (f.atributos.parametros as { nome: string }[]) ?? [];
      if (!params.some((p) => p.nome === param)) return [];
      const chamadas = ctx.grafo.saindo(f.chave, "chama").map((r) => nomeDaFuncao(r.destino));
      const corpo = String(f.atributos.corpo ?? "");
      const valida = chamadas.some((c) => validadores.has(c)) || [...validadores].some((v) => new RegExp(`\\b${v.split(".").pop()}\\s*\\(`).test(corpo));
      if (valida) return [];
      return [{
        regra: "U06", objeto: f.chave, severidade: "critico",
        titulo: `${exibir(f.chave)} recebe ${param} e não chama ${[...validadores].join(" nem ")}`,
        detalhe: `Qualquer usuário autenticado pode passar o ${param} de outro. Valide no início: if not ${[...validadores][0]}(${param}) then raise exception ...`,
        evidencia: { objeto: f.chave, parametro: param, chama: chamadas },
      }];
    });
  },
};

export const U07: Regra = {
  codigo: "U07", pacote: "universal", severidade: "alto", bloqueia: true, alvo: "pg:visao",
  titulo: "Visão sem security_invoker em schema exposto",
  descricao: "Visão roda com o privilégio do dono e ignora a RLS de quem consulta.",
  avaliar: (ctx) =>
    noEscopo(ctx, "visao")
      .filter((v) => exposto(v, ctx.grafo) && !v.atributos.materializada && !v.atributos.security_invoker)
      .map((v) => ({
        regra: "U07", objeto: v.chave, severidade: "alto",
        titulo: `${exibir(v.chave)} ignora a RLS de quem consulta`,
        detalhe: `Use: alter view ${exibir(v.chave)} set (security_invoker = true);`,
        evidencia: { objeto: v.chave, atributo: "security_invoker = false" },
      })),
};

/** Lints no estilo splinter (Supabase), calculados sobre o grafo. Não barram no gate. */
export const U08: Regra = {
  codigo: "U08", pacote: "splinter", severidade: "medio", bloqueia: false, alvo: "pg:*",
  titulo: "Lints do splinter",
  descricao: "Boas práticas de banco Supabase: FK sem índice, tabela sem chave primária, RLS sem policy, auth.uid() sem select, extensão no public.",
  avaliar: (ctx) => {
    const saida: AchadoBruto[] = [];
    const lint = (variante: string, objeto: string, severidade: AchadoBruto["severidade"], titulo: string, detalhe: string) =>
      saida.push({ regra: "U08", variante, objeto, severidade, titulo, detalhe, evidencia: { objeto, lint: variante } });

    for (const t of noEscopo(ctx, "tabela")) {
      const policies = ctx.grafo.filhos(t.chave, "policy");
      const restricoes = ctx.grafo.filhos(t.chave, "constraint");
      const indices = ctx.grafo.filhos(t.chave, "indice");
      if (t.atributos.rls && !policies.length && exposto(t, ctx.grafo)) {
        lint("rls_sem_policy", t.chave, "baixo", `${exibir(t.chave)} tem RLS ligada e nenhuma policy`, "Ninguém além do service_role acessa: confirme se é intencional.");
      }
      if (!t.atributos.rls && policies.length) {
        lint("policy_sem_rls", t.chave, "alto", `${exibir(t.chave)} tem policies mas a RLS está desligada`, "As policies não valem nada enquanto a RLS estiver desligada.");
      }
      if (!restricoes.some((c) => c.atributos.tipo === "primaria")) {
        lint("sem_chave_primaria", t.chave, "baixo", `${exibir(t.chave)} não tem chave primária`, "Sem PK não há replicação lógica nem update/delete confiável pela API.");
      }
      for (const fk of restricoes.filter((c) => c.atributos.tipo === "estrangeira")) {
        const cols = (fk.atributos.colunas as string[]) ?? [];
        const coberta = indices.some((i) => {
          const ic = (i.atributos.colunas as string[]) ?? [];
          return cols.every((c, n) => ic[n] === c);
        });
        if (!coberta) lint("fk_sem_indice", fk.chave, "baixo", `FK ${fk.nome} (${cols.join(", ")}) sem índice`, `Joins e deletes em cascata fazem varredura completa em ${exibir(t.chave)}.`);
      }
      const vistos = new Map<string, string>();
      for (const i of indices) {
        const assinatura = `${i.atributos.unico}:${((i.atributos.colunas as string[]) ?? []).join(",")}`;
        const igual = vistos.get(assinatura);
        if (igual) lint("indice_duplicado", i.chave, "medio", `Índice ${i.nome} repete ${igual}`, "Índice duplicado custa escrita e espaço sem ganho de leitura.");
        else vistos.set(assinatura, i.nome);
      }
    }
    for (const p of noEscopo(ctx, "policy")) {
      const exprs = `${p.atributos.usando ?? ""} ${p.atributos.checagem ?? ""}`;
      if (/\bauth\.(uid|jwt|role)\(\)/.test(exprs) && !/select\s+auth\.(uid|jwt|role)\(\)/i.test(exprs)) {
        lint("auth_rls_initplan", p.chave, "medio", `${exibir(p.chave)} chama auth.uid() por linha`, "Use (select auth.uid()) para avaliar uma vez por consulta.");
      }
    }
    for (const f of noEscopo(ctx, "funcao")) {
      if (!f.atributos.security_definer && !f.atributos.search_path && f.atributos.linguagem !== "c") {
        lint("search_path_mutavel", f.chave, "baixo", `${exibir(f.chave)} sem search_path fixo`, "Fixe com set search_path = '' para a função não mudar de comportamento conforme quem chama.");
      }
    }
    for (const e of ctx.grafo.porTipo("extensao")) {
      // Só pesa onde o public é exposto pela API (Supabase); em Postgres puro é o lugar padrão.
      if (e.atributos.schema === "public" && exposto(e, ctx.grafo)) lint("extensao_no_public", e.chave, "medio", `Extensão ${e.nome} instalada no schema public`, "Mova para o schema extensions para não expor funções pela API.");
    }
    return saida;
  },
};

export const U09: Regra = {
  codigo: "U09", pacote: "universal", severidade: "medio", bloqueia: false, alvo: "pg:papel",
  titulo: "Consumidor usando o papel postgres",
  descricao: "Painel ou automação acessando o banco como superusuário: ignora RLS e não deixa rastro de quem fez o quê.",
  avaliar: (ctx) =>
    ctx.grafo
      .porTipo("papel")
      .filter((p) => p.nome === "postgres" || p.atributos.superusuario)
      .flatMap((p): AchadoBruto[] => {
        const usos = ctx.grafo.saindo(p.chave).filter((r) => r.tipo === "le" || r.tipo === "escreve");
        if (!usos.length) return [];
        return [{
          regra: "U09", objeto: p.chave, severidade: "medio",
          titulo: `${p.nome} acessa ${usos.length} tabela(s) do projeto`,
          detalhe: "Crie um papel por consumidor (ex.: app_painel, app_n8n) com só o que ele precisa.",
          evidencia: { objeto: p.chave, query: String(usos[0].evidencia.query ?? "") },
        }];
      }),
};

export const UNIVERSAIS: Regra[] = [U01, U02, U03, U04, U05, U06, U07, U08, U09];
