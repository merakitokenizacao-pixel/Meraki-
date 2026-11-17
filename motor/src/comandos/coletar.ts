/** meraki coletar: coleta → diff → regras → achados → métricas. meraki checar: só avalia, não grava. */
import { atualizarProducao } from "../agentes/producao.ts";
import { atualizarPublicacoes } from "../agentes/publicacoes.ts";
import { atualizarRascunhos } from "../agentes/rascunhos.ts";
import { coletarFontes } from "../coleta.ts";
import { plataforma } from "../plataforma/db.ts";
import { type Projeto, projetoPorSlug } from "../plataforma/repositorio.ts";
import { chaveDedupe } from "../tipos.ts";
import { type Argumentos, flag, obrigatorio, texto } from "../util/args.ts";
import { verificarProjeto } from "../verificacao.ts";
import { ORDEM_SEVERIDADE, contagem, out, projetosAlvo } from "./comum.ts";

/**
 * Agentes: linha do tempo de publicação (o que a coleta do n8n viu no ar) e produção por versão.
 * Falha aqui vira aviso: a verificação de estrutura roda do mesmo jeito.
 */
async function agentesDepoisDaColeta(p: Projeto, viuN8n: boolean): Promise<void> {
  try {
    if (viuN8n) {
      const pub = await atualizarPublicacoes(p);
      if (pub.abertas || pub.fechadas) out(`  agentes: ${pub.abertas} versão(ões) entrou(aram) no ar${pub.rodadas ? ` · ${pub.rodadas} rodada(s) pedida(s) (publicada sem gate)` : ""}`);
    }
    for (const a of await atualizarProducao(p)) {
      out(`  produção · ${a.nome}: ${a.conversas} conversas · ${a.violacoes} violações · ${a.execucoes} execuções (${a.dias} dia(s))`);
      for (const aviso of a.avisos) out(`  aviso · produção ${a.nome}: ${aviso}`);
    }
  } catch (e) {
    out(`  aviso · agentes: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function rascunhosDepoisDaVerificacao(p: Projeto): Promise<void> {
  try {
    const r = await atualizarRascunhos(p);
    if (r.agentes) out(`  rascunho divergente em ${r.agentes} agente(s) · ${r.achados} achado(s) no rascunho`);
  } catch (e) {
    out(`  aviso · rascunhos: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function jaColetou(projetoId: string): Promise<boolean> {
  const r = await plataforma().query(
    "select exists (select 1 from public.coletas c join public.fontes f on f.id = c.fonte_id where f.projeto_id = $1 and c.status = 'ok') as sim",
    [projetoId],
  );
  return Boolean(r.rows[0]?.sim);
}

export async function coletar(args: Argumentos): Promise<void> {
  let falhas = 0;
  for (const p of await projetosAlvo(args)) {
    out(`${p.nome} (${p.slug})`);
    const primeira = !(await jaColetou(p.id));
    const resultados = await coletarFontes(p, out);
    falhas += resultados.filter((r) => r.status === "erro").length;
    const coletas = new Map(resultados.filter((r) => r.status === "ok").map((r) => [r.fonteId, r.coletaId]));
    if (!coletas.size) {
      out("  nenhuma fonte coletada: a verificação não rodou");
      continue;
    }
    await agentesDepoisDaColeta(p, resultados.some((r) => r.status === "ok" && r.tipo === "n8n"));
    const v = await verificarProjeto(p, { gravar: true, primeiraColeta: primeira, coletas });
    await rascunhosDepoisDaVerificacao(p);
    out(`  saúde ${v.saude} · cobertura ${v.cobertura}% · abertos: ${contagem(v.abertos)}`);
    out(`  achados: +${v.novos} novos · ${v.resolvidos} resolvidos${v.reabertos ? ` · ${v.reabertos} reabertos` : ""}${primeira ? " · linha de base (tudo herdado)" : ""}`);
    if (v.contratoCriado) out(`  contrato v${v.contratoVersao} (rascunho) gerado a partir da coleta`);
    for (const r of resultados) for (const a of r.avisos.slice(0, 5)) out(`  aviso · ${r.fonte}: ${a}`);
  }
  if (falhas) process.exitCode = 1;
}

export async function checar(args: Argumentos): Promise<void> {
  const p = await projetoPorSlug(obrigatorio(args, "projeto"));
  const v = await verificarProjeto(p, { gravar: false });
  if (flag(args, "json")) {
    out(JSON.stringify(v, null, 2));
    return;
  }
  out(`${p.nome} · contrato v${v.contratoVersao ?? "—"} · saúde ${v.saude} · cobertura ${v.cobertura}%`);
  out(`abertos: ${contagem(v.abertos)} · em relação ao gravado: +${v.novos} / −${v.resolvidos}`);
  const limite = Number(texto(args, "limite") ?? 40);
  const lista = [...v.brutos].sort((a, b) => ORDEM_SEVERIDADE[a.severidade] - ORDEM_SEVERIDADE[b.severidade] || a.regra.localeCompare(b.regra));
  const excecao = new Set(v.emExcecao);
  for (const a of lista.slice(0, limite)) {
    out(`  ${a.severidade.padEnd(7)} ${a.regra}  ${a.titulo}${excecao.has(chaveDedupe(a)) ? "  (exceção)" : ""}`);
  }
  if (lista.length > limite) out(`  … e mais ${lista.length - limite}`);
}
