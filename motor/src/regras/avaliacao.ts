/**
 * Pacote avaliação (AV1–AV4): o que as rodadas de casos de referência dizem de cada versão do agente.
 * Lê o estado dos agentes (rodadas e casos); sem ele, não acha nada.
 */
import { ultimaRodada } from "../agentes/estado.ts";
import type { NoGrafo } from "../grafo.ts";
import type { AchadoBruto } from "../tipos.ts";
import { type ContextoRegra, type Regra, noEscopo, numero } from "./base.ts";

/** Agentes que entram na avaliação: declarados no contrato ou com caso ativo. */
function avaliados(ctx: ContextoRegra): NoGrafo[] {
  const estado = ctx.agentes;
  if (!estado) return [];
  return noEscopo(ctx, "agente").filter(
    (a) => !a.atributos.desativado && (ctx.intencao.agenteDe(a.chave) || estado.casos.some((c) => c.agente === a.chave && c.ativo)),
  );
}

/** Versão candidata: o rascunho quando difere do publicado; senão o publicado. */
export function versaoCandidata(a: NoGrafo): string | null {
  const publicada = (a.atributos.versao as string | null) ?? null;
  const rascunho = (a.atributos.rascunho_versao as string | null) ?? null;
  return a.atributos.rascunho_divergente || !publicada ? rascunho : publicada;
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

export const AV1: Regra = {
  codigo: "AV1", pacote: "avaliacao", severidade: "critico", bloqueia: true, alvo: "n8n:agente",
  titulo: "Caso crítico falhou na versão candidata",
  descricao: "Um caso de referência marcado como crítico falhou na última rodada da versão que vai ao ar.",
  avaliar: (ctx) =>
    avaliados(ctx).flatMap((a): AchadoBruto[] => {
      const hash = versaoCandidata(a);
      const r = hash ? ultimaRodada(ctx.agentes!, a.chave, hash) : undefined;
      if (!r || !r.criticosFalhos.length) return [];
      return [{
        regra: "AV1", objeto: a.chave, variante: hash!, severidade: "critico",
        titulo: `Caso crítico falhou na versão ${hash} do agente "${a.nome}": ${r.criticosFalhos.slice(0, 3).join(", ")}${r.criticosFalhos.length > 3 ? "…" : ""}`,
        detalhe: "Corrija o prompt ou a tool e rode de novo. Enquanto falhar, o gate não publica essa versão.",
        evidencia: { objeto: a.chave, versao: hash, rodada: r.id, criticos: r.criticosFalhos, aprovacao: r.aprovacao },
      }];
    }),
};

export const AV2: Regra = {
  codigo: "AV2", pacote: "avaliacao", severidade: "alto", bloqueia: true, alvo: "n8n:agente",
  titulo: "Aprovação caiu além do limite frente à versão publicada",
  descricao: "A versão candidata passa em menos casos que a publicada, além da queda máxima do contrato.",
  avaliar: (ctx) =>
    avaliados(ctx).flatMap((a): AchadoBruto[] => {
      const publicada = (a.atributos.versao as string | null) ?? null;
      const candidata = versaoCandidata(a);
      if (!publicada || !candidata || candidata === publicada) return [];
      const rc = ultimaRodada(ctx.agentes!, a.chave, candidata);
      const rp = ultimaRodada(ctx.agentes!, a.chave, publicada);
      if (rc?.aprovacao == null || rp?.aprovacao == null) return [];
      const limite = ctx.intencao.agenteDe(a.chave)?.config.metas.queda_maxima_pts ?? numero(ctx.ajuste, "queda_maxima_pts", 5);
      const queda = (rp.aprovacao - rc.aprovacao) * 100;
      if (queda <= limite) return [];
      return [{
        regra: "AV2", objeto: a.chave, variante: candidata, severidade: "alto",
        titulo: `Aprovação do agente "${a.nome}" caiu de ${pct(rp.aprovacao)} para ${pct(rc.aprovacao)} na versão ${candidata}`,
        detalhe: `Queda de ${Math.round(queda * 10) / 10} pts (limite ${limite}). Compare as rodadas caso a caso.`,
        evidencia: { objeto: a.chave, versao: candidata, publicada, rodada: rc.id, rodada_publicada: rp.id },
      }];
    }),
};

export const AV3: Regra = {
  codigo: "AV3", pacote: "avaliacao", severidade: "alto", bloqueia: false, alvo: "n8n:agente",
  titulo: "Versão publicada sem rodada de avaliação",
  descricao: "A versão no ar nunca passou pelos casos de referência (publicação manual ou fora do gate).",
  avaliar: (ctx) =>
    avaliados(ctx).flatMap((a): AchadoBruto[] => {
      const publicada = (a.atributos.versao as string | null) ?? null;
      if (!publicada || ultimaRodada(ctx.agentes!, a.chave, publicada)) return [];
      return [{
        regra: "AV3", objeto: a.chave, variante: publicada, severidade: "alto",
        titulo: `Versão ${publicada} do agente "${a.nome}" está publicada sem rodada de avaliação`,
        detalhe: "Peça uma rodada na tela do agente. Se a publicação foi manual, ela escapou do gate.",
        evidencia: { objeto: a.chave, versao: publicada },
      }];
    }),
};

export const AV4: Regra = {
  codigo: "AV4", pacote: "avaliacao", severidade: "baixo", bloqueia: false, alvo: "n8n:agente",
  titulo: "Caso de referência sem rodar há mais de 30 dias",
  descricao: "Caso que não roda não protege nada: o agente pode ter mudado por baixo dele.",
  avaliar: (ctx) => {
    if (!ctx.agentes) return [];
    const dias = numero(ctx.ajuste, "dias", 30);
    const limite = ctx.agora.getTime() - dias * 86_400_000;
    const nomes = new Map(noEscopo(ctx, "agente").map((a) => [a.chave, a.nome]));
    return ctx.agentes.casos
      .filter((c) => c.ativo && nomes.has(c.agente) && Date.parse(c.ultimaRodada ?? c.criadoEm) < limite)
      .map((c) => ({
        regra: "AV4", objeto: c.agente, variante: c.slug, severidade: "baixo" as const,
        titulo: `Caso "${c.slug}" do agente "${nomes.get(c.agente)}" não roda há mais de ${dias} dias`,
        detalhe: c.ultimaRodada ? `Última rodada em ${c.ultimaRodada.slice(0, 10)}.` : "Nunca entrou numa rodada.",
        evidencia: { objeto: c.agente, caso: c.slug, ultima_rodada: c.ultimaRodada },
      }));
  },
};

export const AVALIACAO: Regra[] = [AV1, AV2, AV3, AV4];
