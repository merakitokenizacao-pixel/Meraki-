/**
 * Pacote produção (P1–P5): o agente em uso real, por versão. Só agregados (calculados no banco do cliente) e
 * execuções do n8n — nenhuma conversa chega aqui. Dias de versão incerta ficam fora das comparações.
 */
import { type MetricaDoDia, publicacoesDe, somar } from "../agentes/estado.ts";
import type { NoGrafo } from "../grafo.ts";
import type { AchadoBruto } from "../tipos.ts";
import { type ContextoRegra, type Regra, noEscopo, numero } from "./base.ts";

interface Leitura {
  a: NoGrafo;
  atual?: string;
  anterior?: string;
  metricas: (hash: string) => MetricaDoDia[];
  recentes: MetricaDoDia[];
}

function emProducao(ctx: ContextoRegra): Leitura[] {
  const estado = ctx.agentes;
  if (!estado) return [];
  const dias = numero(ctx.ajuste, "dias", 7);
  const desde = new Date(ctx.agora.getTime() - dias * 86_400_000).toISOString().slice(0, 10);
  return noEscopo(ctx, "agente")
    .filter((a) => !a.atributos.desativado && ctx.intencao.agenteDe(a.chave))
    .map((a) => {
      const { atual, anterior } = publicacoesDe(estado, a.chave);
      const doAgente = estado.metricas.filter((m) => m.agente === a.chave && !m.incerta);
      return {
        a,
        atual: atual?.hash,
        anterior: anterior?.hash,
        metricas: (hash: string) => doAgente.filter((m) => m.hash === hash),
        recentes: doAgente.filter((m) => m.dia >= desde && (!atual || m.hash === atual.hash)),
      };
    });
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

export const P1: Regra = {
  codigo: "P1", pacote: "producao", severidade: "alto", bloqueia: false, alvo: "n8n:agente",
  titulo: "Repasse para humano subiu além do limite",
  descricao: "A versão no ar passa mais conversas para humano que a anterior (com volume mínimo nas duas).",
  avaliar: (ctx) => {
    const minimo = numero(ctx.ajuste, "minimo_conversas", 50);
    const limite = numero(ctx.ajuste, "limite_pts", 5);
    return emProducao(ctx).flatMap((l): AchadoBruto[] => {
      if (!l.atual || !l.anterior) return [];
      const agora = somar(l.metricas(l.atual));
      const antes = somar(l.metricas(l.anterior));
      if (agora.conversas < minimo || antes.conversas < minimo) return [];
      const ta = agora.repasses / agora.conversas;
      const tb = antes.repasses / antes.conversas;
      const meta = ctx.intencao.agenteDe(l.a.chave)?.config.metas.repasse_maximo;
      const subiu = (ta - tb) * 100 > limite;
      const passouMeta = meta !== undefined && ta > meta && ta > tb;
      if (!subiu && !passouMeta) return [];
      return [{
        regra: "P1", objeto: l.a.chave, variante: l.atual, severidade: "alto",
        titulo: `Repasse do agente "${l.a.nome}" subiu de ${pct(tb)} para ${pct(ta)} na versão ${l.atual}`,
        detalhe: `${agora.conversas} conversas na versão atual, ${antes.conversas} na anterior.${passouMeta ? ` Acima da meta de ${pct(meta!)}.` : ""} Revise as conversas com repasse.`,
        evidencia: { objeto: l.a.chave, versao: l.atual, anterior: l.anterior, repasse: ta, repasse_anterior: tb, conversas: agora.conversas, conversas_anterior: antes.conversas },
      }];
    });
  },
};

export const P2: Regra = {
  codigo: "P2", pacote: "producao", severidade: "medio", bloqueia: false, alvo: "n8n:agente",
  titulo: "Violação de política em resposta real",
  descricao: "Resposta do agente com palavra proibida, acima do tamanho ou com perguntas demais (links fora da conta).",
  avaliar: (ctx) =>
    emProducao(ctx).flatMap((l): AchadoBruto[] => {
      const s = somar(l.recentes);
      if (!s.violacoes) return [];
      return [{
        regra: "P2", objeto: l.a.chave, variante: l.atual ?? "", severidade: "medio",
        titulo: `${s.violacoes} resposta(s) do agente "${l.a.nome}" violaram a política nos últimos ${numero(ctx.ajuste, "dias", 7)} dias`,
        detalhe: "Abra as conversas de exemplo (busca ao vivo, nada fica gravado) e vire as piores em caso de referência.",
        evidencia: { objeto: l.a.chave, versao: l.atual, violacoes: s.violacoes, mensagens: s.exemplos },
      }];
    }),
};

export const P3: Regra = {
  codigo: "P3", pacote: "producao", severidade: "alto", bloqueia: false, alvo: "n8n:agente",
  titulo: "Erro de tool acima do limite",
  descricao: "Execuções do workflow do agente terminando em erro acima do limite.",
  avaliar: (ctx) => {
    const limite = numero(ctx.ajuste, "limite", 0.05);
    const minimo = numero(ctx.ajuste, "minimo_execucoes", 20);
    return emProducao(ctx).flatMap((l): AchadoBruto[] => {
      const s = somar(l.recentes);
      if (s.execucoes < minimo || s.erros / s.execucoes <= limite) return [];
      return [{
        regra: "P3", objeto: l.a.chave, variante: l.atual ?? "", severidade: "alto",
        titulo: `${pct(s.erros / s.execucoes)} das execuções do agente "${l.a.nome}" terminaram em erro (limite ${pct(limite)})`,
        detalhe: `${s.erros} de ${s.execucoes} execuções nos últimos dias. Veja qual tool falha nas execuções do n8n.`,
        evidencia: { objeto: l.a.chave, versao: l.atual, erros: s.erros, execucoes: s.execucoes },
      }];
    });
  },
};

export const P4: Regra = {
  codigo: "P4", pacote: "producao", severidade: "medio", bloqueia: false, alvo: "n8n:agente",
  titulo: "Latência p95 acima da meta",
  descricao: "O cliente espera mais que a meta do contrato em 5% das respostas.",
  avaliar: (ctx) => {
    const minimo = numero(ctx.ajuste, "minimo_execucoes", 20);
    return emProducao(ctx).flatMap((l): AchadoBruto[] => {
      const meta = ctx.intencao.agenteDe(l.a.chave)?.config.metas.latencia_p95_ms;
      const s = somar(l.recentes);
      if (!meta || s.execucoes < minimo || s.latenciaP95 === null || s.latenciaP95 <= meta) return [];
      return [{
        regra: "P4", objeto: l.a.chave, variante: l.atual ?? "", severidade: "medio",
        titulo: `Latência p95 do agente "${l.a.nome}" está em ${(s.latenciaP95 / 1000).toFixed(1)} s (meta ${(meta / 1000).toFixed(1)} s)`,
        detalhe: "Tools lentas, memória longa ou modelo maior que o necessário costumam ser a causa.",
        evidencia: { objeto: l.a.chave, versao: l.atual, latencia_p95_ms: s.latenciaP95, meta_ms: meta, execucoes: s.execucoes },
      }];
    });
  },
};

export const P5: Regra = {
  codigo: "P5", pacote: "producao", severidade: "medio", bloqueia: false, alvo: "n8n:agente",
  titulo: "Conversão caiu frente à versão anterior",
  descricao: "Menos conversas viram o evento de conversão do contrato do que na versão anterior.",
  avaliar: (ctx) => {
    const minimo = numero(ctx.ajuste, "minimo_conversas", 50);
    const limite = numero(ctx.ajuste, "queda_pts", 5);
    return emProducao(ctx).flatMap((l): AchadoBruto[] => {
      if (!l.atual || !l.anterior || !ctx.intencao.agenteDe(l.a.chave)?.config.eventos.conversao) return [];
      const agora = somar(l.metricas(l.atual));
      const antes = somar(l.metricas(l.anterior));
      if (agora.conversas < minimo || antes.conversas < minimo) return [];
      const ca = agora.conversoes / agora.conversas;
      const cb = antes.conversoes / antes.conversas;
      if ((cb - ca) * 100 <= limite) return [];
      return [{
        regra: "P5", objeto: l.a.chave, variante: l.atual, severidade: "medio",
        titulo: `Conversão do agente "${l.a.nome}" caiu de ${pct(cb)} para ${pct(ca)} na versão ${l.atual}`,
        detalhe: `${agora.conversas} conversas na versão atual, ${antes.conversas} na anterior.`,
        evidencia: { objeto: l.a.chave, versao: l.atual, anterior: l.anterior, conversao: ca, conversao_anterior: cb },
      }];
    });
  },
};

export const PRODUCAO: Regra[] = [P1, P2, P3, P4, P5];
