"use server";

import { refresh } from "next/cache";
import { decidir, ler, mensagemDeErro } from "./db";
import type { ConversaAoVivo } from "./modelo";

/*
 * Decisões feitas na tela. Cada ação valida a entrada (chega por POST, de qualquer cliente) e chama a função
 * da plataforma, que confere se o objeto é da conta do usuário da sessão. Nada aqui escreve direto em tabela.
 */

export type Resultado = { ok: true; mensagem: string } | { ok: false; erro: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

const texto = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function falha(e: unknown): Resultado {
  const err = e as { code?: string; message?: string };
  switch (err?.code) {
    case "P0002":
      return { ok: false, erro: "Não encontrado nesta conta." };
    case "55000":
      return { ok: false, erro: "Já foi decidido por outra pessoa. A tela foi atualizada." };
    case "22023":
    case "22007":
    case "22008": {
      const m = err.message ?? "Valor inválido.";
      return { ok: false, erro: `${m.charAt(0).toUpperCase()}${m.slice(1)}.` };
    }
    default:
      return { ok: false, erro: mensagemDeErro(e) };
  }
}

export async function aprovarProposta(id: unknown, nota: unknown): Promise<Resultado> {
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, erro: "Proposta inválida." };
  try {
    const versao = await decidir(async (c) => (await c.query("select public.aprovar_proposta($1::uuid, $2) as versao", [id, texto(nota) || null])).rows[0].versao as number);
    refresh();
    return { ok: true, mensagem: `Contrato v${versao} publicado. O gate passa a aceitar essa estrutura.` };
  } catch (e) {
    refresh();
    return falha(e);
  }
}

export async function recusarProposta(id: unknown, motivo: unknown): Promise<Resultado> {
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, erro: "Proposta inválida." };
  const m = texto(motivo);
  if (m.length < 3) return { ok: false, erro: "Escreva o motivo: o gate devolve esse texto ao agente na próxima tentativa." };
  try {
    await decidir((c) => c.query("select public.recusar_proposta($1::uuid, $2)", [id, m]));
    refresh();
    return { ok: true, mensagem: "Proposta recusada. O agente recebe o motivo se tentar de novo." };
  } catch (e) {
    refresh();
    return falha(e);
  }
}

/* ─────────────────────── Agentes de IA (fase 2) ─────────────────────── */

const CHAVE_AGENTE = /^n8n:agente:[^\s/]{1,120}\/.{1,200}$/;
const SLUG_CASO = /^[a-z0-9][a-z0-9-]{1,79}$/;
const SLUG_PROJETO = /^[a-z0-9][a-z0-9-]{0,79}$/;
const ID_MENSAGEM = /^[\w.:-]{1,120}$/;

const listaDeTextos = (v: unknown, max = 20, tamanho = 200) =>
  Array.isArray(v) ? v.map((x) => texto(x, tamanho)).filter(Boolean).slice(0, max) : undefined;

const escalar = (v: unknown): string | number | boolean | null =>
  typeof v === "number" || typeof v === "boolean" ? v : typeof v === "string" ? v.slice(0, 300) : null;

/**
 * Caso de referência montado no formulário. Reconstrói o objeto campo a campo (nada além do que o caso usa
 * chega ao banco); a função salvar_caso ainda recusa entrada com dado pessoal aparente.
 */
function conteudoDoCaso(v: unknown): { ok: true; conteudo: Record<string, unknown> } | { ok: false; erro: string } {
  if (!v || typeof v !== "object") return { ok: false, erro: "Caso inválido." };
  const c = v as Record<string, unknown>;
  const e = (c.entrada ?? {}) as Record<string, unknown>;
  const mensagem = texto(e.mensagem, 4000);
  if (!mensagem) return { ok: false, erro: "Escreva a mensagem que o cliente manda." };
  const historico = Array.isArray(e.historico)
    ? e.historico
        .map((h) => ({ autor: texto((h as Record<string, unknown>)?.autor, 40), texto: texto((h as Record<string, unknown>)?.texto, 4000) }))
        .filter((h) => h.autor && h.texto)
        .slice(0, 30)
    : [];
  const ctx = (e.contexto ?? {}) as Record<string, unknown>;
  const dataHora = texto(ctx.data_hora, 40);
  const ficha = ctx.ficha && typeof ctx.ficha === "object" && !Array.isArray(ctx.ficha) ? Object.fromEntries(Object.entries(ctx.ficha as object).slice(0, 20).map(([k, x]) => [k.slice(0, 60), escalar(x)])) : undefined;

  const s = (c.espera ?? {}) as Record<string, unknown>;
  const espera: Record<string, unknown> = {};
  const tools = listaDeTextos(s.tools, 20, 120);
  if (tools) espera.tools = tools;
  if (s.argumentos && typeof s.argumentos === "object") {
    const argumentos: Record<string, Record<string, unknown>> = {};
    for (const [tool, args] of Object.entries(s.argumentos as object).slice(0, 20)) {
      if (!args || typeof args !== "object") continue;
      const limpos = Object.fromEntries(Object.entries(args as object).slice(0, 20).map(([k, x]) => [k.slice(0, 80), escalar(x)]));
      if (Object.keys(limpos).length) argumentos[tool.slice(0, 120)] = limpos;
    }
    if (Object.keys(argumentos).length) espera.argumentos = argumentos;
  }
  const contem = listaDeTextos(s.contem);
  if (contem?.length) espera.contem = contem;
  const naoContem = listaDeTextos(s.nao_contem);
  if (naoContem?.length) espera.nao_contem = naoContem;
  if (typeof s.repasse === "boolean") espera.repasse = s.repasse;

  return {
    ok: true,
    conteudo: {
      criticidade: c.criticidade === "critico" ? "critico" : "normal",
      origem: c.origem === "conversa" || c.origem === "achado" ? c.origem : "manual",
      entrada: {
        mensagem,
        ...((dataHora || ficha) && { contexto: { ...(dataHora && { data_hora: dataHora }), ...(ficha && { ficha }) } }),
        historico,
      },
      espera,
      rubrica: texto(c.rubrica, 2000) || null,
    },
  };
}

export async function salvarCaso(projeto: unknown, agente: unknown, slug: unknown, conteudo: unknown, motivo: unknown): Promise<Resultado> {
  if (typeof projeto !== "string" || !UUID.test(projeto)) return { ok: false, erro: "Projeto inválido." };
  if (typeof agente !== "string" || !CHAVE_AGENTE.test(agente)) return { ok: false, erro: "Agente inválido." };
  if (typeof slug !== "string" || !SLUG_CASO.test(slug)) return { ok: false, erro: "Id do caso: minúsculas, números e hífen, de 2 a 80 caracteres." };
  const m = texto(motivo);
  if (m.length < 3) return { ok: false, erro: "Escreva o motivo: fica no histórico do caso." };
  const c = conteudoDoCaso(conteudo);
  if (!c.ok) return c;
  try {
    await decidir((db) => db.query("select public.salvar_caso($1::uuid, $2, $3, $4::jsonb, $5)", [projeto, agente, slug, JSON.stringify(c.conteudo), m]));
    refresh();
    return { ok: true, mensagem: `Caso "${slug}" salvo. Entra na próxima rodada do agente.` };
  } catch (e) {
    return falha(e);
  }
}

export async function arquivarCaso(id: unknown, motivo: unknown): Promise<Resultado> {
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, erro: "Caso inválido." };
  const m = texto(motivo);
  if (m.length < 3) return { ok: false, erro: "Escreva o motivo do arquivamento." };
  try {
    await decidir((db) => db.query("select public.arquivar_caso($1::uuid, $2)", [id, m]));
    refresh();
    return { ok: true, mensagem: "Caso arquivado. As rodadas antigas continuam com o resultado dele." };
  } catch (e) {
    refresh();
    // 55000 aqui é "já arquivado" (outra aba ou outra pessoa chegou antes), não uma decisão de proposta.
    if ((e as { code?: string })?.code === "55000") return { ok: false, erro: "Esse caso já estava arquivado. A tela foi atualizada." };
    return falha(e);
  }
}

/** Endereço do motor (meraki servir) na rede interna. O token só vale no servidor da web. */
function motor() {
  const url = (process.env.MERAKI_MOTOR_URL || "http://127.0.0.1:7341").replace(/\/+$/, "");
  const token = process.env.MERAKI_SERVICO_TOKEN;
  return { url, headers: token ? { authorization: `Bearer ${token}` } : ({} as Record<string, string>) };
}

export async function pedirRodada(projeto: unknown, agente: unknown): Promise<Resultado> {
  if (typeof projeto !== "string" || !UUID.test(projeto)) return { ok: false, erro: "Projeto inválido." };
  if (typeof agente !== "string" || !CHAVE_AGENTE.test(agente)) return { ok: false, erro: "Agente inválido." };
  try {
    await decidir((db) => db.query("select public.pedir_rodada($1::uuid, $2)", [projeto, agente]));
  } catch (e) {
    return falha(e);
  }
  // Acorda o motor para não esperar a próxima passada (30 s). Fora do ar, a rodada fica na fila.
  let acordou = false;
  try {
    const m = motor();
    const r = await fetch(`${m.url}/rodadas`, { method: "POST", headers: m.headers, cache: "no-store", signal: AbortSignal.timeout(2_000) });
    acordou = r.ok;
  } catch {
    acordou = false;
  }
  refresh();
  return {
    ok: true,
    mensagem: acordou
      ? "Rodada pedida. O motor está rodando os casos no n8n; o resultado aparece aqui."
      : "Rodada na fila. O motor (meraki servir) não respondeu agora; ele pega a rodada quando voltar.",
  };
}

export type ResultadoConversa = { ok: true; conversa: ConversaAoVivo } | { ok: false; erro: string };

/**
 * Revisar uma conversa: o motor busca ao vivo no banco do cliente e anonimiza. Nada é gravado — nem aqui, nem
 * no motor. Antes, a leitura com a RLS do usuário confirma que o projeto e o agente são da conta dele.
 */
export async function buscarConversa(projeto: unknown, agente: unknown, mensagem: unknown): Promise<ResultadoConversa> {
  if (typeof projeto !== "string" || !SLUG_PROJETO.test(projeto)) return { ok: false, erro: "Projeto inválido." };
  if (typeof agente !== "string" || !CHAVE_AGENTE.test(agente)) return { ok: false, erro: "Agente inválido." };
  if (typeof mensagem !== "string" || !ID_MENSAGEM.test(mensagem)) return { ok: false, erro: "Mensagem inválida." };
  try {
    const visivel = await ler(async (c) =>
      (
        await c.query(
          `select 1 from public.projetos p join public.fontes f on f.projeto_id = p.id join public.objetos o on o.fonte_id = f.id
            where p.slug = $1 and o.chave = $2 and o.tipo = 'agente' and o.removido_em is null limit 1`,
          [projeto, agente],
        )
      ).rowCount,
    );
    if (!visivel) return { ok: false, erro: "Agente não encontrado nesta conta." };
  } catch (e) {
    return { ok: false, erro: mensagemDeErro(e) };
  }
  const m = motor();
  const q = new URLSearchParams({ projeto, agente, mensagem });
  try {
    const r = await fetch(`${m.url}/conversa?${q}`, { headers: m.headers, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const corpo = (await r.json().catch(() => ({}))) as ConversaAoVivo & { erro?: string };
    if (!r.ok) return { ok: false, erro: corpo.erro ? `${corpo.erro.charAt(0).toUpperCase()}${corpo.erro.slice(1)}.` : `O motor respondeu ${r.status}.` };
    return { ok: true, conversa: corpo };
  } catch {
    return { ok: false, erro: "O motor não respondeu. A conversa é buscada ao vivo pelo motor: suba com `node motor/bin/meraki.mjs servir`." };
  }
}

export async function criarExcecao(achado: unknown, motivo: unknown, validaAte: unknown): Promise<Resultado> {
  if (typeof achado !== "string" || !UUID.test(achado)) return { ok: false, erro: "Achado inválido." };
  const m = texto(motivo);
  if (m.length < 3) return { ok: false, erro: "Escreva o motivo da exceção." };
  const ate = typeof validaAte === "string" && DIA.test(validaAte) ? validaAte : null;
  try {
    await decidir((c) => c.query("select public.criar_excecao($1::uuid, $2, $3::date)", [achado, m, ate]));
    refresh();
    return { ok: true, mensagem: "Exceção registrada. O achado reabre sozinho quando a validade vencer." };
  } catch (e) {
    return falha(e);
  }
}
