/**
 * Executor simulado das rodadas, só para desenvolvimento: responde cada caso a partir de ensaio/simulador.json.
 * O comportamento depende da versão do agente: trecho do prompt liga uma variação, e tool que a versão não
 * tem (ou tem desativada) não é chamada. Em produção a rodada roda no próprio n8n (API de avaliação).
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ConfigAgente } from "../coletores/n8n.ts";
import { type ChamadaDeTool, normalizar } from "./checagens.ts";

export interface SaidaSimulada {
  resposta: string;
  tools?: ChamadaDeTool[];
  duracao_ms?: number;
}

export interface Simulador {
  padrao: SaidaSimulada;
  casos: Record<string, SaidaSimulada>;
  /** Quando o prompt da versão tem o trecho, as saídas daqui substituem as de `casos`. */
  variacoes?: { prompt_contem: string; descricao?: string; casos: Record<string, SaidaSimulada> }[];
}

export async function lerSimulador(raiz: string, pasta: string): Promise<Simulador> {
  const arquivo = join(resolve(raiz, pasta), "simulador.json");
  const s = JSON.parse(await readFile(arquivo, "utf8")) as Simulador;
  if (!s?.padrao || typeof s.casos !== "object") throw new Error(`${arquivo}: simulador sem "padrao" ou "casos"`);
  return s;
}

function espalhar(texto: string): number {
  let h = 0;
  for (const c of texto) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

export function simularCaso(sim: Simulador, config: ConfigAgente, slug: string): { resposta: string; tools: ChamadaDeTool[]; duracao_ms: number } {
  const prompt = normalizar(config.prompt.sistema);
  let saida: SaidaSimulada = sim.casos[slug] ?? sim.padrao;
  for (const v of sim.variacoes ?? []) {
    if (v.casos[slug] && prompt.includes(normalizar(v.prompt_contem))) saida = { ...saida, ...v.casos[slug] };
  }
  const disponiveis = new Set(config.tools.filter((t) => !t.desativada).map((t) => normalizar(t.nome)));
  const tools = (saida.tools ?? []).filter((t) => disponiveis.has(normalizar(t.nome)));
  return { resposta: saida.resposta, tools, duracao_ms: saida.duracao_ms ?? 1_500 + (espalhar(slug) % 2_500) };
}
