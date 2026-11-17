import type { EstadoAgentes } from "../agentes/estado.ts";
import type { Intencao } from "../contrato/intencao.ts";
import type { Grafo } from "../grafo.ts";
import { type AchadoBruto, type Objeto, SEVERIDADES, type Severidade } from "../tipos.ts";
import { AGENTES } from "./agentes.ts";
import { AVALIACAO } from "./avaliacao.ts";
import type { Regra } from "./base.ts";
import { CRUZADAS } from "./cruzadas.ts";
import { ESTRUTURA } from "./estrutura.ts";
import { PRODUCAO } from "./producao.ts";
import { UNIVERSAIS } from "./universal.ts";

export type { Regra } from "./base.ts";

/** Catálogo completo: 28 da fase 1 + 19 dos agentes (fase 2). N04 e R02 ficam para a fase 1.5. */
export const REGRAS: Regra[] = [...UNIVERSAIS, ...ESTRUTURA, ...CRUZADAS, ...AGENTES, ...AVALIACAO, ...PRODUCAO];
export const VERSAO_REGRAS = 2;

export function regraPorCodigo(codigo: string): Regra | undefined {
  return REGRAS.find((r) => r.codigo === codigo);
}

export interface OpcoesAvaliacao {
  agora: Date;
  /** Gate: só as regras que barram. */
  soBloqueantes?: boolean;
  removidos?: Map<string, Objeto>;
  /** Estado dos agentes (rodadas, publicações, métricas, casos): sem ele, avaliação e produção não acham nada. */
  agentes?: EstadoAgentes;
}

/** Roda as regras ligadas no contrato sobre o grafo. Função pura. */
export function avaliarRegras(grafo: Grafo, intencao: Intencao, opcoes: OpcoesAvaliacao): AchadoBruto[] {
  const saida: AchadoBruto[] = [];
  for (const regra of REGRAS) {
    if (opcoes.soBloqueantes && !regra.bloqueia) continue;
    if (!intencao.regraLigada(regra)) continue;
    const ajuste = intencao.ajuste(regra.codigo);
    const severidade = SEVERIDADES.includes(ajuste.severidade as Severidade) ? (ajuste.severidade as Severidade) : undefined;
    for (const a of regra.avaliar({ grafo, intencao, agora: opcoes.agora, ajuste, removidos: opcoes.removidos, agentes: opcoes.agentes })) {
      saida.push(severidade ? { ...a, severidade } : a);
    }
  }
  return saida;
}
