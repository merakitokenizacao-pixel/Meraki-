/** Pacote estrutura (E01–E10): o que existe bate com o que o contrato diz que deveria existir? */
import { nomeDaFuncao, partes, refCurta, schemaDe } from "../chaves.ts";
import type { NoGrafo } from "../grafo.ts";
import type { AchadoBruto } from "../tipos.ts";
import { type ContextoRegra, type Regra, exibir, noEscopo, numero } from "./base.ts";

const DIA = 86_400_000;

function colunas(ctx: ContextoRegra, tabela: string, semGenericas: boolean): Map<string, string> {
  const genericas = new Set(ctx.intencao.contrato.convencoes.colunas_genericas);
  const m = new Map<string, string>();
  for (const c of ctx.grafo.filhos(tabela, "coluna")) {
    if (semGenericas && genericas.has(c.nome)) continue;
    m.set(c.nome, String(c.atributos.tipo));
  }
  return m;
}

function comuns(a: Map<string, string>, b: Map<string, string>): string[] {
  return [...a.keys()].filter((k) => b.get(k) === a.get(k)).sort();
}

export const E01: Regra = {
  codigo: "E01", pacote: "estrutura", severidade: "alto", bloqueia: true, alvo: "pg:tabela|visao|funcao",
  titulo: "Objeto não declarado no contrato",
  descricao: "Tabela, visão ou função que existe no banco e não aparece no contrato: ninguém disse para que ela serve.",
  avaliar: (ctx) =>
    noEscopo(ctx, ["tabela", "visao", "funcao"])
      .filter((o) => !ctx.intencao.declarado(o.chave))
      .map((o) => ({
        regra: "E01", objeto: o.chave, severidade: "alto",
        titulo: `${exibir(o.chave)} não está declarado no contrato`,
        detalhe: `Declare em objetos (papel, primitiva, nota) ou, se for novo, proponha: meraki propor --tipo ${o.tipo === "funcao" ? "nova_funcao" : "nova_tabela"} --sql <arquivo> --justificativa "..."`,
        evidencia: { objeto: o.chave, fonte: o.fonteId },
      })),
};

export const E02: Regra = {
  codigo: "E02", pacote: "estrutura", severidade: "medio", bloqueia: false, alvo: "contrato",
  titulo: "Objeto declarado sumiu",
  descricao: "O contrato fala de algo que não existe mais na fonte.",
  avaliar: (ctx) => {
    const c = ctx.intencao.contrato;
    const refs = new Set<string>();
    for (const [ref, e] of Object.entries(c.objetos)) if (e.declarado !== false) refs.add(ref);
    for (const p of Object.values(c.primitivas)) for (const r of [p.dona, p.vinculo, ...p.escritores]) if (r) refs.add(r);
    const saida: AchadoBruto[] = [];
    for (const ref of refs) {
      const chaves = ctx.intencao.chavesDe(ref);
      if (chaves.some((k) => ctx.grafo.tem(k))) continue;
      const k = chaves[0];
      const p = partes(k);
      if (p.ns === "pg" && !ctx.grafo.coletaSchema(schemaDe(k) ?? "public")) continue;
      if (p.ns === "n8n" && !ctx.grafo.temFonte("n8n")) continue;
      if (p.ns === "repo" && !ctx.grafo.temFonte("repo")) continue;
      saida.push({
        regra: "E02", objeto: k, severidade: "medio",
        titulo: `${ref} está no contrato mas não existe`,
        detalhe: "Foi removido ou renomeado fora do combinado. Atualize o contrato ou restaure o objeto.",
        evidencia: { objeto: k, contrato: `v${c.versao}`, ref },
      });
    }
    return saida;
  },
};

export const E03: Regra = {
  codigo: "E03", pacote: "estrutura", severidade: "medio", bloqueia: true, alvo: "pg:tabela",
  titulo: "Candidato a duplicado",
  descricao: "Duas tabelas com a maioria das colunas (fora as genéricas) iguais em nome e tipo.",
  avaliar: (ctx) => {
    const limiar = numero(ctx.ajuste, "limiar", 0.6);
    const minimo = numero(ctx.ajuste, "minimo_colunas", 3);
    const tabelas = noEscopo(ctx, "tabela").sort((a, b) => a.chave.localeCompare(b.chave));
    const cols = new Map(tabelas.map((t) => [t.chave, colunas(ctx, t.chave, true)]));
    const saida: AchadoBruto[] = [];
    for (let i = 0; i < tabelas.length; i++) {
      for (let j = i + 1; j < tabelas.length; j++) {
        const a = cols.get(tabelas[i].chave)!;
        const b = cols.get(tabelas[j].chave)!;
        const menor = Math.min(a.size, b.size);
        if (menor < minimo) continue;
        const iguais = comuns(a, b);
        if (iguais.length / menor < limiar) continue;
        saida.push({
          regra: "E03", objeto: tabelas[i].chave, par: tabelas[j].chave, severidade: "medio",
          titulo: `${exibir(tabelas[i].chave)} e ${exibir(tabelas[j].chave)} parecem a mesma coisa`,
          detalhe: `${iguais.length} de ${menor} colunas iguais (${iguais.join(", ")}). Junte as duas ou registre a diferença como exceção.`,
          evidencia: { objeto: tabelas[i].chave, par: tabelas[j].chave, colunas: iguais, limiar },
        });
      }
    }
    return saida;
  },
};

export const E04: Regra = {
  codigo: "E04", pacote: "estrutura", severidade: "alto", bloqueia: true, alvo: "pg:tabela",
  titulo: "Tabela nova repetindo uma primitiva",
  descricao: "Tabela fora do contrato com as colunas da dona de uma primitiva: o conceito já existe, use-o.",
  avaliar: (ctx) => {
    const limiar = numero(ctx.ajuste, "limiar", 0.6);
    const genericas = new Set(ctx.intencao.contrato.convencoes.colunas_genericas);
    const saida: AchadoBruto[] = [];
    for (const [nome, p] of Object.entries(ctx.intencao.contrato.primitivas)) {
      const dona = ctx.intencao.chavesDe(p.dona).find((k) => ctx.grafo.tem(k));
      if (!dona) continue;
      const colsDona = colunas(ctx, dona, false);
      if (!colsDona.size) continue;
      for (const t of noEscopo(ctx, "tabela")) {
        if (t.chave === dona || ctx.intencao.declarado(t.chave)) continue;
        const iguais = comuns(colunas(ctx, t.chave, false), colsDona);
        if (!iguais.some((c) => !genericas.has(c)) || iguais.length / colsDona.size < limiar) continue;
        saida.push({
          regra: "E04", objeto: t.chave, par: dona, variante: nome, severidade: "alto",
          titulo: `${exibir(t.chave)} repete a primitiva ${nome}`,
          detalhe: `Dona: ${exibir(dona)}, ${iguais.length} de ${colsDona.size} colunas iguais (${iguais.join(", ")}). Use a primitiva${p.escritores.length ? ` (escreva por ${p.escritores.join(", ")})` : ""}.`,
          evidencia: { objeto: t.chave, par: dona, primitiva: nome, colunas: iguais },
        });
      }
    }
    return saida;
  },
};

export const E05: Regra = {
  codigo: "E05", pacote: "estrutura", severidade: "alto", bloqueia: true, alvo: "relacao:escreve",
  titulo: "Escrita fora do dono",
  descricao: "Alguém grava direto na tabela de uma primitiva em vez de usar os escritores combinados.",
  avaliar: (ctx) => {
    const saida: AchadoBruto[] = [];
    const tabelas = new Set<string>();
    for (const p of Object.values(ctx.intencao.contrato.primitivas)) {
      for (const r of [p.dona, p.vinculo].filter(Boolean) as string[]) for (const k of ctx.intencao.chavesDe(r)) tabelas.add(k);
    }
    for (const t of tabelas) {
      const dona = ctx.intencao.escritoresDe(t) ?? escritoresPorVinculo(ctx, t);
      if (!dona) continue;
      for (const r of ctx.grafo.entrando(t, "escreve")) {
        if (dona.escritores.has(r.origem) || /^pg:(papel|gatilho):/.test(r.origem)) continue;
        if (!ctx.grafo.tem(r.origem)) continue;
        saida.push({
          regra: "E05", objeto: r.origem, par: t, variante: dona.primitiva, severidade: "alto",
          titulo: `${exibir(r.origem)} grava direto em ${exibir(t)}`,
          detalhe: `${exibir(t)} é da primitiva ${dona.primitiva}: escreva por ${[...dona.escritores].map(exibir).join(", ")}.`,
          evidencia: { ...r.evidencia, objeto: r.origem, par: t },
        });
      }
    }
    return saida;
  },
};

function escritoresPorVinculo(ctx: ContextoRegra, tabela: string) {
  for (const [nome, p] of Object.entries(ctx.intencao.contrato.primitivas)) {
    if (!p.vinculo || !p.escritores.length || !ctx.intencao.chavesDe(p.vinculo).includes(tabela)) continue;
    return { primitiva: nome, escritores: new Set(p.escritores.flatMap((e) => ctx.intencao.chavesDe(e))) };
  }
  return null;
}

export const E06: Regra = {
  codigo: "E06", pacote: "estrutura", severidade: "baixo", bloqueia: false, alvo: "pg:coluna",
  titulo: "Coluna 100% vazia",
  descricao: "Coluna sem nenhum valor há N dias numa tabela com dado. Precisa de SELECT (fora do modo catálogo).",
  avaliar: (ctx) => {
    const dias = numero(ctx.ajuste, "dias", 30);
    const minimo = numero(ctx.ajuste, "minimo_linhas", 50);
    const saida: AchadoBruto[] = [];
    for (const c of noEscopo(ctx, "coluna")) {
      if (!c.pai?.startsWith("pg:tabela:") || ctx.intencao.opcionalPorDesign(c.chave)) continue;
      const obs = ctx.grafo.usoDe(c.chave, "pg_stats");
      if (!obs.length || obs[obs.length - 1].vazia !== true) continue;
      let desde = obs[obs.length - 1].dia;
      for (let i = obs.length - 1; i >= 0 && obs[i].vazia === true; i--) desde = obs[i].dia;
      const diasVazia = Math.floor((ctx.agora.getTime() - Date.parse(`${desde}T00:00:00Z`)) / DIA);
      const linhas = ctx.grafo.ultimoUso(c.pai, "pg_stat_user_tables")?.linhas ?? 0;
      if (diasVazia < dias || linhas < minimo) continue;
      saida.push({
        regra: "E06", objeto: c.chave, severidade: "baixo",
        titulo: `${exibir(c.chave)} está 100% vazia há ${diasVazia} dia(s)`,
        detalhe: `${linhas} linhas na tabela e nenhum valor nessa coluna. Remova, ou marque opcional_por_design no contrato.`,
        evidencia: { objeto: c.chave, desde, linhas },
      });
    }
    return saida;
  },
};

export const E07: Regra = {
  codigo: "E07", pacote: "estrutura", severidade: "baixo", bloqueia: false, alvo: "pg:tabela",
  titulo: "Tabela vazia",
  descricao: "Tabela sem nenhuma linha: abandonada, ou ainda não usada.",
  avaliar: (ctx) =>
    noEscopo(ctx, "tabela").flatMap((t): AchadoBruto[] => {
      if (ctx.intencao.opcionalPorDesign(t.chave)) return [];
      const u = ctx.grafo.ultimoUso(t.chave, "pg_stat_user_tables");
      if (!u || u.linhas !== 0) return [];
      return [{
        regra: "E07", objeto: t.chave, severidade: "baixo",
        titulo: `${exibir(t.chave)} não tem nenhuma linha`,
        detalhe: "Se ainda vai ser usada, marque opcional_por_design no contrato; se não, remova.",
        evidencia: { objeto: t.chave, dia: u.dia, linhas: 0 },
      }];
    }),
};

export const E08: Regra = {
  codigo: "E08", pacote: "estrutura", severidade: "medio", bloqueia: false, alvo: "pg:tabela",
  titulo: "Sem leitura nem escrita há N dias",
  descricao: "Ninguém lê nem grava na tabela no período observado.",
  avaliar: (ctx) => {
    const dias = numero(ctx.ajuste, "dias", 30);
    const corte = ctx.agora.getTime() - dias * DIA;
    return noEscopo(ctx, "tabela").flatMap((t): AchadoBruto[] => {
      const usos = ctx.grafo.usoDe(t.chave, "pg_stat_user_tables");
      if (!usos.length || Date.parse(`${usos[0].dia}T00:00:00Z`) > corte) return [];
      const janela = usos.filter((u) => Date.parse(`${u.dia}T00:00:00Z`) > corte);
      if (janela.reduce((s, u) => s + u.leituras + u.escritas, 0) > 0) return [];
      return [{
        regra: "E08", objeto: t.chave, severidade: "medio",
        titulo: `${exibir(t.chave)} sem leitura nem escrita há ${dias} dias`,
        detalhe: "Confira se algum consumidor ainda depende dela antes de remover.",
        evidencia: { objeto: t.chave, dias, observados: janela.length },
      }];
    });
  },
};

export const E09: Regra = {
  codigo: "E09", pacote: "estrutura", severidade: "alto", bloqueia: true, alvo: "pg:funcao",
  titulo: "Sobrecargas de função que se sobrepõem",
  descricao: "Duas assinaturas da mesma função aceitam a mesma chamada: o Postgres (e o PostgREST) não sabe qual usar.",
  avaliar: (ctx) => {
    const grupos = new Map<string, NoGrafo[]>();
    for (const f of noEscopo(ctx, "funcao")) {
      const nome = nomeDaFuncao(f.chave);
      grupos.set(nome, [...(grupos.get(nome) ?? []), f]);
    }
    const saida: AchadoBruto[] = [];
    for (const lista of grupos.values()) {
      if (lista.length < 2) continue;
      lista.sort((a, b) => a.chave.localeCompare(b.chave));
      for (let i = 0; i < lista.length; i++) {
        for (let j = i + 1; j < lista.length; j++) {
          const k = sobreposicao(lista[i], lista[j]);
          if (k === null) continue;
          saida.push({
            regra: "E09", objeto: lista[i].chave, par: lista[j].chave, severidade: "alto",
            titulo: `${exibir(lista[i].chave)} e ${exibir(lista[j].chave)} aceitam a mesma chamada`,
            detalhe: `Uma chamada com ${k} argumento(s) casa com as duas. Remova uma ou tire o default.`,
            evidencia: { objeto: lista[i].chave, par: lista[j].chave, argumentos: k },
          });
        }
      }
    }
    return saida;
  },
};

function sobreposicao(a: NoGrafo, b: NoGrafo): number | null {
  const pa = (a.atributos.parametros as { tipo: string; padrao: boolean }[]) ?? [];
  const pb = (b.atributos.parametros as { tipo: string; padrao: boolean }[]) ?? [];
  const min = (p: typeof pa) => p.filter((x) => !x.padrao).length;
  for (let k = Math.max(min(pa), min(pb)); k <= Math.min(pa.length, pb.length); k++) {
    if (pa.slice(0, k).every((x, i) => x.tipo === pb[i].tipo)) return k;
  }
  return null;
}

export const E10: Regra = {
  codigo: "E10", pacote: "estrutura", severidade: "medio", bloqueia: false, alvo: "pg:*",
  titulo: "Criado fora de uma migration",
  descricao: "Objeto que existe no banco e nenhuma migration criou: alguém mexeu direto em produção.",
  avaliar: (ctx) => {
    const migracoes = ctx.grafo.porTipo("migracao");
    if (!migracoes.length) return [];
    const criadas = new Set<string>();
    const funcoes = new Set<string>();
    for (const m of migracoes) {
      for (const k of (m.atributos.objetos_criados as string[]) ?? []) {
        criadas.add(k);
        if (k.startsWith("pg:funcao:")) funcoes.add(`${nomeDaFuncao(k)}/${aridade(k)}`);
      }
    }
    return noEscopo(ctx, ["tabela", "visao", "funcao", "policy", "gatilho"]).flatMap((o): AchadoBruto[] => {
      const ok = o.tipo === "funcao" ? funcoes.has(`${nomeDaFuncao(o.chave)}/${aridade(o.chave)}`) : criadas.has(o.chave);
      if (ok) return [];
      return [{
        regra: "E10", objeto: o.chave, severidade: "medio",
        titulo: `${exibir(o.chave)} foi criado fora de uma migration`,
        detalhe: `Nenhuma das ${migracoes.length} migrations cria ${refCurta(o.chave)}. Traga para uma migration para o banco ser reproduzível.`,
        evidencia: { objeto: o.chave, migracoes: migracoes.length },
      }];
    });
  },
};

function aridade(k: string): number {
  const dentro = k.slice(k.indexOf("(") + 1, k.lastIndexOf(")"));
  return dentro ? dentro.split(",").length : 0;
}

export const ESTRUTURA: Regra[] = [E01, E02, E03, E04, E05, E06, E07, E08, E09, E10];
