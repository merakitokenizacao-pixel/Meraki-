/**
 * Fluxo "Quem usa o banco" a partir do que o motor coletou: consumidores (workflows do n8n, arquivos do
 * repositório, papéis do banco) ligados às tabelas, visões e funções que leem, escrevem ou chamam.
 * Função pura — roda no servidor ou no cliente.
 */
import type { Flow, FlowNode } from "@/components/charts/flow-diagram";
import type { Status } from "@/lib/types";
import {
  type Achado,
  type Declaracao,
  type EstruturaProjeto,
  type Objeto,
  SEV,
  TIPO_OBJETO,
  declaracaoDe,
  nomeDaChave,
  partes,
  piorSeveridade,
  rotuladorDeObjetos,
} from "./modelo";

const VERBO: Record<string, string> = { le: "lê", escreve: "escreve", chama: "chama" };
/** Ordem de leitura da aresta: "lê e escreve", nunca "escreve e lê". */
const ORDEM_VERBO = Object.keys(VERBO);
const ALVOS = new Set(["tabela", "visao", "funcao"]);
const LIMITE_ALVOS = 14;

/** Achados abertos por objeto, contando também os dos filhos (coluna → tabela, node → workflow…). */
export function achadosPorObjeto(e: Pick<EstruturaProjeto, "objetos" | "achados">) {
  const pai = new Map(e.objetos.map((o) => [o.chave, o.pai]));
  const mapa = new Map<string, Achado[]>();
  const add = (k: string, a: Achado) => mapa.set(k, [...(mapa.get(k) ?? []), a]);
  for (const a of e.achados) {
    if (a.status !== "aberto") continue;
    const visto = new Set<string>();
    let k: string | null | undefined = a.objeto;
    while (k && !visto.has(k)) {
      visto.add(k);
      add(k, a);
      k = pai.get(k);
    }
  }
  return mapa;
}

export function estadoDosAchados(lista: Achado[] | undefined): Status | null {
  const pior = piorSeveridade((lista ?? []).map((a) => a.severidade));
  return pior ? SEV[pior].status : null;
}

/** Sobe da chave da relação até o objeto que aparece no fluxo. */
function consumidorDe(k: string, porChave: Map<string, Objeto>): string | null {
  const p = partes(k);
  if (p.ns === "n8n" && p.tipo === "node") return porChave.get(k)?.pai ?? `n8n:workflow:${p.ref.split("/")[0]}`;
  if (p.ns === "n8n" && p.tipo === "workflow") return k;
  if (p.ns === "repo" && (p.tipo === "chamada" || p.tipo === "rota")) return porChave.get(k)?.pai ?? null;
  if (p.ns === "repo" && p.tipo === "arquivo") return k;
  if (p.ns === "pg" && p.tipo === "papel") return k;
  return null;
}

function alvoDe(k: string, porChave: Map<string, Objeto>, funcoes: Objeto[]): string | null {
  const p = partes(k);
  if (p.ns !== "pg") return null;
  if (p.tipo === "coluna") {
    const o = porChave.get(k);
    if (o?.pai) return o.pai;
    const ponto = p.ref.lastIndexOf(".");
    return ponto > 0 ? `pg:tabela:${p.ref.slice(0, ponto)}` : null;
  }
  if (p.tipo === "funcao" && k.endsWith("(*)")) {
    // Chamada por nome (rpc): resolve para a sobrecarga coletada, se houver uma.
    const nome = p.ref.slice(0, -3);
    return funcoes.find((f) => partes(f.chave).ref.startsWith(`${nome}(`))?.chave ?? k;
  }
  return ALVOS.has(p.tipo) ? k : null;
}

function descreverConsumidor(o: Objeto | undefined, k: string, filhos: number): string {
  const p = partes(k);
  if (p.tipo === "workflow") {
    const ativo = o?.atributos.ativo;
    return `n8n · ${ativo === false ? "inativo" : "ativo"} · ${filhos} ${filhos === 1 ? "node" : "nodes"}`;
  }
  if (p.tipo === "arquivo") return `${o?.fonte.nome ?? "Repositório"} · ${filhos} ${filhos === 1 ? "chamada" : "chamadas"}`;
  if (p.tipo === "papel") return o?.atributos.ignora_rls ? "Papel do banco · ignora RLS" : "Papel do banco";
  return TIPO_OBJETO[p.tipo] ?? p.tipo;
}

function descreverAlvo(k: string, existe: boolean, decl: Declaracao | undefined): string {
  const tipo = TIPO_OBJETO[partes(k).tipo] ?? "Objeto";
  if (!existe) return `${tipo} · não existe no banco`;
  if (decl?.primitiva) return `${tipo} · primitiva ${decl.primitiva}`;
  if (decl?.escritorDe) return `${tipo} · escritor de ${decl.escritorDe}`;
  if (decl?.papel) return `${tipo} · ${decl.papel}`;
  return `${tipo} · fora do contrato`;
}

export function fluxoDoProjeto(e: EstruturaProjeto): Flow | null {
  const porChave = new Map(e.objetos.map((o) => [o.chave, o]));
  const funcoes = e.objetos.filter((o) => o.tipo === "funcao");
  const achados = achadosPorObjeto(e);
  const rotulo = rotuladorDeObjetos(e.objetos);
  const nomeDe = (k: string) => {
    const o = porChave.get(k);
    return o ? rotulo(o) : nomeDaChave(k);
  };

  // Arestas consumidor → alvo, com os verbos agregados.
  const arestas = new Map<string, { from: string; to: string; verbos: Set<string> }>();
  for (const r of e.relacoes) {
    if (!VERBO[r.tipo]) continue;
    const from = consumidorDe(r.origem, porChave);
    const to = alvoDe(r.destino, porChave, funcoes);
    if (!from || !to) continue;
    const id = `${from}>${to}`;
    const a = arestas.get(id) ?? { from, to, verbos: new Set<string>() };
    a.verbos.add(r.tipo);
    arestas.set(id, a);
  }
  if (!arestas.size) return null;

  // Achado sobre uma referência quebrada (X01) aponta o alvo no par: vale para o nó tracejado.
  const quebrados = new Map<string, Achado[]>();
  for (const a of e.achados) if (a.status === "aberto" && a.par && !porChave.has(a.par)) quebrados.set(a.par, [...(quebrados.get(a.par) ?? []), a]);

  const grau = new Map<string, number>();
  for (const a of arestas.values()) {
    grau.set(a.from, (grau.get(a.from) ?? 0) + 1);
    grau.set(a.to, (grau.get(a.to) ?? 0) + 1);
  }
  const estado = (k: string) => estadoDosAchados(achados.get(k) ?? quebrados.get(k));
  const peso = (k: string) => {
    const s = estado(k);
    return (s === "crit" ? 400 : s === "serious" ? 300 : s === "warn" ? 200 : 0) + (grau.get(k) ?? 0);
  };

  // Alvos: os mais ligados e os com achado; o resto vira nota na descrição.
  const todosAlvos = [...new Set([...arestas.values()].map((a) => a.to))];
  const alvos = todosAlvos.sort((a, b) => peso(b) - peso(a) || a.localeCompare(b)).slice(0, LIMITE_ALVOS);
  const mantidos = new Set(alvos);
  const visiveis = [...arestas.values()].filter((a) => mantidos.has(a.to));
  const consumidores = [...new Set(visiveis.map((a) => a.from))];

  const ordemConsumidor = (k: string) => ({ workflow: 0, arquivo: 1, papel: 2 })[partes(k).tipo] ?? 3;
  consumidores.sort((a, b) => ordemConsumidor(a) - ordemConsumidor(b) || nomeDe(a).localeCompare(nomeDe(b)));
  const ordemAlvo = (k: string) => ({ tabela: 0, visao: 1, funcao: 2 })[partes(k).tipo] ?? 3;
  alvos.sort((a, b) => ordemAlvo(a) - ordemAlvo(b) || nomeDe(a).localeCompare(nomeDe(b)));

  const filhosDe = (k: string) => e.objetos.filter((o) => o.pai === k).length;
  const subComAchado = (k: string, padrao: string) => {
    const lista = achados.get(k) ?? quebrados.get(k);
    const pior = lista?.find((a) => SEV[a.severidade].status === estado(k));
    return pior ? `${pior.regra} · ${pior.regraTitulo ?? pior.titulo}` : padrao;
  };

  const noConsumidor = (k: string): FlowNode => {
    const o = porChave.get(k);
    return {
      id: k,
      title: nomeDe(k),
      sub: subComAchado(k, descreverConsumidor(o, k, filhosDe(k))),
      icon: partes(k).tipo,
      mono: partes(k).tipo !== "workflow",
      status: estado(k),
      dashed: !o,
      objeto: o ? k : undefined,
    };
  };
  const noAlvo = (k: string): FlowNode => {
    const o = porChave.get(k);
    return {
      id: k,
      title: o ? rotulo(o) : nomeDaChave(k).replace(/\(\*\)$/, "()"),
      sub: subComAchado(k, descreverAlvo(k, Boolean(o), declaracaoDe(e.declarados, o ?? { chave: k, tipo: partes(k).tipo, pai: null }))),
      icon: partes(k).tipo,
      mono: true,
      status: estado(k),
      dashed: !o,
      objeto: o ? k : undefined,
    };
  };

  const resto = todosAlvos.length - alvos.length;
  return {
    title: "Quem usa o banco",
    description: `Workflows, arquivos do repositório e papéis do banco ligados ao que leem, escrevem ou chamam${
      resto > 0 ? ` · ${resto} objetos menos ligados ficam no inventário` : ""
    }. Passe o mouse para ver as conexões · clique para abrir o detalhe.`,
    columns: [
      { title: "Quem usa", nodes: consumidores.map(noConsumidor) },
      { title: "Banco", nodes: alvos.map(noAlvo) },
    ],
    edges: visiveis.map((a) => ({
      from: a.from,
      to: a.to,
      label: [...a.verbos]
        .sort((x, y) => ORDEM_VERBO.indexOf(x) - ORDEM_VERBO.indexOf(y))
        .map((v) => VERBO[v])
        .join(" e "),
    })),
  };
}
