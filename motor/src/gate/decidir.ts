/**
 * O gate olha a mudança, não o passado: aplica o SQL numa cópia do último snapshot, roda só as regras
 * que barram e reporta o que a mudança INTRODUZ (achado que não existia antes). Dívida herdada não barra.
 */
import { refCurta } from "../chaves.ts";
import { Intencao } from "../contrato/intencao.ts";
import { Grafo, type NoGrafo } from "../grafo.ts";
import { avaliarRegras } from "../regras/index.ts";
import { type EstadoProposto, aplicarDdl, comandoTemEfeitoEstrutural } from "../sql/ddl.ts";
import type { Comando } from "../sql/parser.ts";
import { type AchadoBruto, chaveDedupe } from "../tipos.ts";
import type { CacheProjeto, PropostaEmCache } from "./cache.ts";

export type Modo = "autonomo" | "pergunta";

export interface Decisao {
  decisao: "permitiu" | "perguntou" | "negou";
  motivo?: string;
  violacoes: AchadoBruto[];
  resumo: string[];
  /** Tabelas, visões e funções que a mudança cria, altera ou remove (ref curta do contrato). */
  afetados: string[];
  propostaId?: string;
}

/** Coluna, policy, gatilho, restrição e índice contam como mudança na tabela dona. */
function afetadosDe(estado: EstadoProposto): string[] {
  const topo = (k: string): string | null => {
    const o = estado.objetos.get(k) ?? estado.removidos.get(k);
    if (!o) return null;
    if (o.tipo === "tabela" || o.tipo === "visao" || o.tipo === "funcao") return o.chave;
    return o.pai && /^pg:(tabela|visao):/.test(o.pai) ? o.pai : null;
  };
  const chaves = [...estado.novos, ...estado.alterados, ...estado.removidos.keys()].map(topo).filter((k): k is string => Boolean(k));
  return [...new Set(chaves.map(refCurta))].sort();
}

function tipoDaProposta(estado: EstadoProposto): string {
  if (estado.resumo.some((r) => r.startsWith("CREATE TABLE"))) return "nova_tabela";
  if (estado.resumo.some((r) => /^(CREATE|REPLACE) FUNCTION/.test(r))) return "nova_funcao";
  if (estado.resumo.some((r) => r.startsWith("ADD COLUMN"))) return "nova_coluna";
  if (estado.removidos.size && !estado.novos.size) return "remover_objeto";
  return "alterar_objeto";
}

export function avaliarMudanca(cache: CacheProjeto, comandos: Comando[], modo: Modo, agora = new Date()): Decisao {
  if (!comandos.some((c) => comandoTemEfeitoEstrutural(c.tipo))) return { decisao: "permitiu", violacoes: [], resumo: [], afetados: [] };

  const fontePg = cache.fontes.find((f) => f.tipo === "supabase" || f.tipo === "postgres");
  if (!fontePg) {
    return { decisao: "perguntou", motivo: "Meraki: este projeto não tem fonte de banco, não há como verificar a mudança.", violacoes: [], resumo: [], afetados: [] };
  }
  const estado = aplicarDdl(comandos, { objetos: cache.objetos, relacoes: cache.relacoes }, { tipoFonte: fontePg.tipo === "supabase" ? "supabase" : "postgres" });
  const afetados = afetadosDe(estado);
  if (estado.naoResolvidos.length) {
    const trecho = estado.naoResolvidos[0].replace(/\s+/g, " ").slice(0, 160);
    const mais = estado.naoResolvidos.length > 1 ? ` e mais ${estado.naoResolvidos.length - 1}` : "";
    return {
      decisao: "perguntou",
      motivo: `Meraki: não consigo verificar este SQL (${trecho}${mais}). Confirme com uma pessoa antes de aplicar.`,
      violacoes: [], resumo: estado.resumo, afetados,
    };
  }

  const antes = new Grafo(cache.objetos, cache.relacoes, cache.fontes);
  const nos: NoGrafo[] = [...estado.objetos.values()].map((o) =>
    "fonteId" in o ? (o as NoGrafo) : { ...o, fonteId: fontePg.id, fonteTipo: fontePg.tipo, vistoDesde: agora.toISOString(), alteradoEm: null },
  );
  const depois = new Grafo(nos, estado.relacoes, cache.fontes);
  const jaExistiam = new Set(avaliarRegras(antes, new Intencao(cache.contrato, antes, cache.excecoes), { agora, soBloqueantes: true }).map(chaveDedupe));
  const intencao = new Intencao(cache.contrato, depois, cache.excecoes);
  const violacoes = avaliarRegras(depois, intencao, { agora, soBloqueantes: true, removidos: estado.removidos }).filter(
    (a) =>
      !jaExistiam.has(chaveDedupe(a)) &&
      !intencao.excecao(a.regra, [a.objeto, a.par], agora) &&
      // Referência quebrada pelo próprio DROP já sai como X05, com a lista de consumidores.
      !(a.regra === "X01" && a.par && estado.removidos.has(a.par)),
  );
  if (!violacoes.length) return { decisao: "permitiu", violacoes: [], resumo: estado.resumo, afetados };

  // Proposta já decidida para esses objetos? Recusada devolve o motivo; aberta pede para esperar.
  const refs = new Set([...afetados, ...violacoes.flatMap((v) => [v.objeto, v.par].filter((k): k is string => Boolean(k)).map(refCurta))]);
  const relacionada = (p: PropostaEmCache) => p.objetos.some((o) => refs.has(o));
  const recusada = cache.propostas.find((p) => p.status === "recusada" && relacionada(p));
  const aberta = cache.propostas.find((p) => p.status === "aberta" && relacionada(p));

  const linhas = violacoes.slice(0, 4).map((v) => `${v.regra}: ${v.titulo}.${v.detalhe ? ` ${v.detalhe}` : ""}`);
  if (violacoes.length > 4) linhas.push(`(+${violacoes.length - 4} violação(ões))`);
  if (recusada) {
    const quando = recusada.decidido_em ? ` em ${recusada.decidido_em.slice(0, 10)}` : "";
    const motivo = (recusada.decisao_motivo ?? "sem motivo").trim().replace(/[.\s]+$/, "");
    linhas.push(`Proposta recusada${quando}: ${motivo}. Não insista nessa estrutura.`);
  } else if (aberta) {
    linhas.push(`Já existe proposta aberta para isso (${aberta.id.slice(0, 8)}). Aguarde a decisão na tela Contrato e pare.`);
  } else {
    linhas.push(
      `Se a mudança é intencional, rode meraki propor --projeto ${cache.projeto.slug} --tipo ${tipoDaProposta(estado)} --sql <arquivo-da-migration> --justificativa "..." e pare.`,
    );
  }
  return {
    decisao: modo === "autonomo" ? "negou" : "perguntou",
    motivo: linhas.join(" "),
    violacoes,
    resumo: estado.resumo,
    afetados,
    propostaId: (recusada ?? aberta)?.id,
  };
}
