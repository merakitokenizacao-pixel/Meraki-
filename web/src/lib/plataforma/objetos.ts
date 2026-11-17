/**
 * Leitura do inventário coletado: hierarquia (coluna → tabela, node → workflow, chamada → arquivo),
 * o que o contrato diz de cada objeto e as relações agrupadas por vizinho. Funções puras — rodam no cliente.
 */
import { achadosPorObjeto } from "./fluxo";
import { type Achado, type Declaracao, type EstruturaProjeto, type Objeto, TIPOS_FILHOS, nomeDaChave, partes, rotuladorDeObjetos } from "./modelo";

/** Tipos que o contrato precisa declarar — os mesmos que entram na cobertura. */
const DECLARAVEIS = new Set(["tabela", "visao", "funcao"]);

export const declaravel = (o: Pick<Objeto, "chave" | "tipo">) => partes(o.chave).ns === "pg" && DECLARAVEIS.has(o.tipo);

export function descreverDeclaracao(d: Declaracao | undefined): string | null {
  if (!d) return null;
  if (d.primitiva) return `primitiva ${d.primitiva}`;
  if (d.escritorDe) return `escritor de ${d.escritorDe}`;
  if (d.papel) return d.papel;
  if (d.proposta) return "em proposta";
  return "declarado";
}

export type Indice = {
  porChave: Map<string, Objeto>;
  filhos: Map<string, Objeto[]>;
  /** achados abertos por objeto, somando os dos filhos */
  achados: Map<string, Achado[]>;
  funcoes: Objeto[];
  /** nome para a tela (com os argumentos quando a função tem sobrecarga) */
  rotulo: (o: Objeto) => string;
};

export function indexar(e: EstruturaProjeto): Indice {
  const porChave = new Map(e.objetos.map((o) => [o.chave, o]));
  const filhos = new Map<string, Objeto[]>();
  for (const o of e.objetos) if (o.pai) filhos.set(o.pai, [...(filhos.get(o.pai) ?? []), o]);
  return { porChave, filhos, achados: achadosPorObjeto(e), funcoes: e.objetos.filter((o) => o.tipo === "funcao"), rotulo: rotuladorDeObjetos(e.objetos) };
}

/** Pai de uma chave, mesmo quando ela não foi coletada (referência quebrada para uma coluna, por exemplo). */
export function paiDe(k: string, idx: Indice): string | null {
  const o = idx.porChave.get(k);
  if (o) return o.pai;
  const p = partes(k);
  if (p.ns === "pg" && p.tipo === "coluna") {
    const ponto = p.ref.lastIndexOf(".");
    if (ponto < 0) return null;
    const ref = p.ref.slice(0, ponto);
    return idx.porChave.has(`pg:visao:${ref}`) ? `pg:visao:${ref}` : `pg:tabela:${ref}`;
  }
  if (p.ns === "pg" && ["policy", "constraint", "gatilho"].includes(p.tipo)) {
    const barra = p.ref.indexOf("/");
    return barra > 0 ? `pg:tabela:${p.ref.slice(0, barra)}` : null;
  }
  if (p.ns === "n8n" && p.tipo === "node") return `n8n:workflow:${p.ref.split("/")[0]}`;
  if (p.ns === "repo" && p.tipo === "chamada") return `repo:arquivo:${p.ref.split("#")[0]}`;
  return null;
}

/** Objeto de primeiro nível que contém a chave (a própria chave quando ela já é de primeiro nível). */
export function topoDe(k: string, idx: Indice): string {
  let atual = k;
  const visto = new Set<string>();
  while (!visto.has(atual)) {
    visto.add(atual);
    const tipo = idx.porChave.get(atual)?.tipo ?? partes(atual).tipo;
    if (!TIPOS_FILHOS.has(tipo)) return atual;
    const pai = paiDe(atual, idx);
    if (!pai) return atual;
    atual = pai;
  }
  return atual;
}

/**
 * Chave pedida → chave coletada. Aceita as formas do contrato, como o motor (public.contatos, contatos,
 * public.contatos.nome, fn:public.f, fn:f, public.f) e a chamada por nome (rpc, `(*)`), que resolve para a
 * sobrecarga coletada, se houver.
 */
export function resolverChave(k: string, idx: Indice): string {
  if (idx.porChave.has(k)) return k;
  if (!partes(k).ns) {
    if (k.startsWith("fn:")) {
      const nome = k.slice(3);
      return resolverChave(`pg:funcao:${nome.includes(".") ? nome : `public.${nome}`}(*)`, idx);
    }
    const pedacos = k.split(".");
    if (pedacos.length === 1) pedacos.unshift("public");
    const ref = pedacos.join(".");
    if (pedacos.length !== 2) return idx.porChave.has(`pg:coluna:${ref}`) ? `pg:coluna:${ref}` : k;
    const relacao = [`pg:visao:${ref}`, `pg:tabela:${ref}`].find((c) => idx.porChave.has(c));
    if (relacao) return relacao;
    const funcao = resolverChave(`pg:funcao:${ref}(*)`, idx);
    return idx.porChave.has(funcao) ? funcao : k;
  }
  if (!k.endsWith("(*)")) return k;
  const nome = partes(k).ref.slice(0, -3);
  return idx.funcoes.find((f) => partes(f.chave).ref.startsWith(`${nome}(`))?.chave ?? k;
}

/** Nome curto de um filho para listar ao lado do pai: coluna, node, linha da chamada, nome da policy. */
export function nomeCurto(k: string) {
  const p = partes(k);
  if (p.tipo === "coluna") return p.ref.slice(p.ref.lastIndexOf(".") + 1);
  if (p.tipo === "chamada") return `linha ${p.ref.split("#L")[1] ?? "?"}`;
  if (p.tipo === "node" || p.tipo === "policy" || p.tipo === "constraint" || p.tipo === "gatilho") return p.ref.slice(p.ref.indexOf("/") + 1);
  return nomeDaChave(k);
}

export type GrupoRelacao = { outro: string; tipos: Set<string>; detalhes: Set<string>; via: Set<string>; inferida: boolean };

const ORDEM_RELACAO = ["le", "escreve", "chama", "executa", "referencia", "protege", "dispara_em", "usa_credencial", "usa_env", "usa_saida", "segue"];
export const ordenarTipos = (tipos: Set<string>) => [...tipos].sort((a, b) => ORDEM_RELACAO.indexOf(a) - ORDEM_RELACAO.indexOf(b));

/**
 * Relações de um objeto (e dos filhos dele) agrupadas pelo vizinho de primeiro nível:
 * "usa" = o objeto é a origem; "usadoPor" = o objeto é o destino. Relações internas (policy → própria tabela) ficam de fora.
 */
export function relacoesDe(chave: string, e: EstruturaProjeto, idx: Indice) {
  const alvo = idx.porChave.get(chave);
  const nomeFuncao = alvo?.tipo === "funcao" ? partes(chave).ref.slice(0, partes(chave).ref.indexOf("(")) : null;
  const meu = (k: string) => {
    if (nomeFuncao && k.endsWith("(*)") && partes(k).ref.slice(0, -3) === nomeFuncao) return true;
    let atual: string | null = k;
    const visto = new Set<string>();
    while (atual && !visto.has(atual)) {
      if (atual === chave) return true;
      visto.add(atual);
      atual = paiDe(atual, idx);
    }
    return false;
  };

  const usa = new Map<string, GrupoRelacao>();
  const usadoPor = new Map<string, GrupoRelacao>();
  const somar = (mapa: Map<string, GrupoRelacao>, tipo: string, outroReal: string, meuLado: string, inferida: boolean) => {
    const resolvido = resolverChave(outroReal, idx);
    const outro = topoDe(resolvido, idx);
    const g = mapa.get(outro) ?? { outro, tipos: new Set<string>(), detalhes: new Set<string>(), via: new Set<string>(), inferida: false };
    g.tipos.add(tipo);
    if (resolvido !== outro) g.detalhes.add(nomeCurto(resolvido));
    if (meuLado !== chave && !meuLado.endsWith("(*)")) g.via.add(nomeCurto(meuLado));
    g.inferida ||= inferida;
    mapa.set(outro, g);
  };
  for (const r of e.relacoes) {
    const deMim = meu(r.origem);
    const paraMim = meu(r.destino);
    if (deMim && !paraMim) somar(usa, r.tipo, r.destino, r.origem, r.certeza === "inferida");
    else if (paraMim && !deMim) somar(usadoPor, r.tipo, r.origem, r.destino, r.certeza === "inferida");
  }
  const ordenar = (m: Map<string, GrupoRelacao>) => [...m.values()].sort((a, b) => nomeDaChave(a.outro).localeCompare(nomeDaChave(b.outro)));
  return { usa: ordenar(usa), usadoPor: ordenar(usadoPor) };
}
