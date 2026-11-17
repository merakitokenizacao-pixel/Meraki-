/**
 * meraki contrato rascunho: o v0 sai do snapshot. Todo objeto começa "não declarado",
 * agrupamentos são sugeridos pelos candidatos a duplicado e as primitivas ficam em branco.
 */
import { refCurta } from "../chaves.ts";
import type { FonteDoGrafo, Grafo } from "../grafo.ts";
import { E03 } from "../regras/estrutura.ts";
import { COLUNAS_GENERICAS_PADRAO, PACOTES_PADRAO, type Contrato, contratoVazio, validarContrato } from "./esquema.ts";
import { Intencao } from "./intencao.ts";

const ESCOPO = /^p_(tenant|conta|empresa|org|organizacao|workspace|cliente|loja|account)(_id)?$/;
const VALIDADOR = /(valid|pertence|autoriz|_do_contexto$|acesso)/;

export function gerarRascunho(projeto: string, grafo: Grafo, fontes: FonteDoGrafo[]): Contrato {
  const pg = fontes.filter((f) => f.tipo === "postgres" || f.tipo === "supabase");
  const schemas = [...new Set(pg.flatMap((f) => (f.config.schemas as string[] | undefined) ?? ["public"]))].sort();
  const noEscopo = [...grafo.objetos.values()].filter((o) => {
    const s = String(o.atributos.schema ?? "");
    return ["tabela", "visao", "funcao"].includes(o.tipo) && schemas.includes(s);
  });
  const tabelas = noEscopo.filter((o) => o.tipo === "tabela");

  // Colunas genéricas: as que aparecem em pelo menos metade das tabelas.
  const freq = new Map<string, number>();
  for (const t of tabelas) for (const c of grafo.filhos(t.chave, "coluna")) freq.set(c.nome, (freq.get(c.nome) ?? 0) + 1);
  const genericas = [...freq].filter(([, n]) => tabelas.length >= 3 && n / tabelas.length >= 0.5).map(([nome]) => nome).sort();

  // Parâmetro de escopo: o nome de parâmetro "de tenant" mais comum.
  const params = new Map<string, number>();
  for (const f of noEscopo.filter((o) => o.tipo === "funcao")) {
    for (const p of (f.atributos.parametros as { nome: string }[]) ?? []) if (ESCOPO.test(p.nome)) params.set(p.nome, (params.get(p.nome) ?? 0) + 1);
  }
  const parametro = [...params].sort((a, b) => b[1] - a[1])[0]?.[0];
  const validadores = noEscopo
    .filter((o) => o.tipo === "funcao" && VALIDADOR.test(String(o.atributos.nome)))
    .map((o) => String(o.atributos.nome))
    .sort();

  const base = contratoVazio(projeto);
  const rascunho = validarContrato({
    ...base,
    projeto,
    versao: 0,
    escopo: { schemas: schemas.length ? schemas : ["public"], ignorar: [] },
    convencoes: {
      colunas_genericas: genericas.length ? genericas : COLUNAS_GENERICAS_PADRAO,
      ...(parametro ? { parametro_de_escopo: parametro } : {}),
      validadores_de_escopo: parametro ? validadores : [],
    },
    consumidores: {
      n8n_tags: fontes.filter((f) => f.tipo === "n8n" && f.config.tag).map((f) => String(f.config.tag)).sort(),
      credenciais: grafo.porTipo("credencial").map((c) => c.chave).sort(),
      papeis_do_banco: grafo.porTipo("papel").map((p) => p.nome).filter((n) => n !== "postgres").sort(),
    },
    primitivas: {},
    objetos: Object.fromEntries(noEscopo.sort((a, b) => a.chave.localeCompare(b.chave)).map((o) => [refCurta(o.chave), { declarado: false }])),
    regras: { ligar: PACOTES_PADRAO, desligar: [], ajustar: {} },
    excecoes: [],
  });

  // Agrupamentos sugeridos: candidatos a duplicado (E03) viram nota nos dois objetos.
  const intencao = new Intencao(rascunho, grafo);
  for (const a of E03.avaliar({ grafo, intencao, agora: new Date(), ajuste: {} })) {
    const par = a.par ? refCurta(a.par) : undefined;
    const ref = refCurta(a.objeto);
    if (!par) continue;
    rascunho.objetos[ref] = { ...rascunho.objetos[ref], nota: `Sugestão: agrupar com ${par} (${a.detalhe?.split(".")[0]}).` };
    rascunho.objetos[par] = { ...rascunho.objetos[par], nota: `Sugestão: agrupar com ${ref}.` };
  }
  return rascunho;
}
