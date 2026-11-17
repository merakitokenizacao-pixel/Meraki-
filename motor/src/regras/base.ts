import { partes } from "../chaves.ts";
import type { Intencao } from "../contrato/intencao.ts";
import type { Grafo, NoGrafo } from "../grafo.ts";
import type { EstadoAgentes } from "../agentes/estado.ts";
import type { AchadoBruto, Objeto, Severidade } from "../tipos.ts";

export type Pacote = "universal" | "splinter" | "estrutura" | "cruzada" | "n8n" | "repo" | "agente" | "avaliacao" | "producao";

export interface ContextoRegra {
  grafo: Grafo;
  intencao: Intencao;
  agora: Date;
  /** Limiares da regra vindos do contrato (regras.ajustar). */
  ajuste: Record<string, unknown>;
  /** Só no gate: objetos que a mudança remove (DROP/RENAME). */
  removidos?: Map<string, Objeto>;
  /** Rodadas, publicações, métricas de produção e casos dos agentes. Sem isso, as regras de avaliação e produção não rodam. */
  agentes?: EstadoAgentes;
}

/** Regra: função pura sobre o grafo normalizado. Grafo entra, achados saem. Sem rede, sem banco. */
export interface Regra {
  codigo: string;
  pacote: Pacote;
  titulo: string;
  descricao: string;
  alvo: string;
  severidade: Severidade;
  /** Barra no gate — só o que a mudança cria ou altera. */
  bloqueia: boolean;
  avaliar(ctx: ContextoRegra): AchadoBruto[];
}

/** Nome legível de uma chave para mensagens. */
export function exibir(k: string): string {
  const p = partes(k);
  if (p.ns === "pg") {
    if (p.tipo === "funcao") return p.ref.replace(/,/g, ", ");
    if (p.tipo === "policy" || p.tipo === "gatilho" || p.tipo === "constraint") {
      const [alvo, nome] = p.ref.split("/");
      return `${p.tipo === "policy" ? "policy" : p.tipo === "gatilho" ? "gatilho" : "restrição"} ${nome} em ${alvo}`;
    }
    if (p.tipo === "papel") return `papel ${p.ref}`;
    return p.ref;
  }
  if (p.ns === "n8n") {
    if (p.tipo === "node") return `node "${p.ref.slice(p.ref.indexOf("/") + 1)}"`;
    if (p.tipo === "credencial") return `credencial ${p.ref}`;
    if (p.tipo === "agente") return `agente "${p.ref.slice(p.ref.indexOf("/") + 1)}"`;
    if (p.tipo === "prompt") return `prompt do agente "${p.ref.slice(p.ref.indexOf("/") + 1)}"`;
    return `workflow ${p.ref}`;
  }
  if (p.ns === "repo") {
    if (p.tipo === "chamada") return p.ref.replace("#L", ":");
    if (p.tipo === "env") return p.ref;
    return p.ref;
  }
  return k;
}

/** Objeto num schema exposto pela API (Supabase/PostgREST). Em Postgres puro nada é exposto por padrão. */
export function exposto(o: NoGrafo, grafo: Grafo): boolean {
  const fonte = grafo.fontes.get(o.fonteId);
  if (!fonte) return false;
  const padrao = fonte.tipo === "supabase" ? ["public", "graphql_public"] : [];
  const expostos = (fonte.config.schemas_expostos as string[] | undefined) ?? padrao;
  return expostos.includes(String(o.atributos.schema ?? ""));
}

export function numero(ajuste: Record<string, unknown>, nome: string, padrao: number): number {
  const v = ajuste[nome];
  return typeof v === "number" && Number.isFinite(v) ? v : padrao;
}

export function noEscopo(ctx: ContextoRegra, tipo: string | string[]): NoGrafo[] {
  const tipos = Array.isArray(tipo) ? tipo : [tipo];
  return [...ctx.grafo.objetos.values()].filter((o) => tipos.includes(o.tipo) && !ctx.intencao.ignorado(o.chave));
}

export function workflowDoNode(grafo: Grafo, k: string): string {
  const o = grafo.get(k);
  const wf = o?.pai ? grafo.get(o.pai) : undefined;
  return wf ? `"${wf.nome}"` : "";
}

/** Papéis que representam usuários da API (anon/authenticated) ou todo mundo (public). */
export const PAPEIS_DA_API = new Set(["anon", "authenticated", "public"]);
