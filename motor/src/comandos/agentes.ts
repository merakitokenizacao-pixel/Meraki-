/**
 * Comandos dos agentes de IA (fase 2):
 *   meraki avaliar         processa as rodadas pedidas (--pedir cria uma para a versão atual do agente)
 *   meraki producao        recalcula a produção por versão e dia e roda as regras
 *   meraki conversa        mostra uma conversa ao vivo, anonimizada (nada é gravado)
 *   meraki gate-publicacao PreToolUse das tools do MCP do n8n que publicam (plano B do gate)
 *   meraki gate-rascunho   PostToolUse das tools que salvam workflow: pacote agente no rascunho, só avisa
 *   meraki servir          o motor por HTTP (hook do n8n, conversa ao vivo, rodadas)
 */
import { buscarConversa } from "../agentes/conversa.ts";
import { fontePorId, lerVersao, lerWorkflow } from "../agentes/comum.ts";
import { type PedidoDePublicacao, decidirPublicacao, projetoDoWorkflow } from "../agentes/gate.ts";
import { atualizarProducao } from "../agentes/producao.ts";
import { avaliarRascunho } from "../agentes/rascunhos.ts";
import { pedirRodada, processarRodadas } from "../agentes/rodadas.ts";
import type { WorkflowN8n } from "../coletores/n8n.ts";
import { lerEntradaDoHook, respostaPreToolUse } from "../gate/hook.ts";
import { plataforma } from "../plataforma/db.ts";
import { type Fonte, type Projeto, lerSegredo, projetoPorSlug } from "../plataforma/repositorio.ts";
import { type Argumentos, flag, obrigatorio, texto } from "../util/args.ts";
import { RAIZ } from "../util/raiz.ts";
import { verificarProjeto } from "../verificacao.ts";
import { contagem, out, projetosAlvo } from "./comum.ts";

async function agentesDoProjeto(projetoId: string): Promise<{ chave: string; nome: string; atributos: Record<string, unknown> }[]> {
  return (
    await plataforma().query(
      `select o.chave, o.nome, o.atributos from public.objetos o join public.fontes f on f.id = o.fonte_id
        where f.projeto_id = $1 and o.tipo = 'agente' and o.removido_em is null order by o.nome`,
      [projetoId],
    )
  ).rows;
}

function acharAgente<T extends { chave: string; nome: string }>(lista: T[], alvo: string): T {
  const a = lista.find((x) => x.chave === alvo || x.nome.toLowerCase() === alvo.toLowerCase());
  if (!a) throw new Error(`agente ${alvo} não existe no projeto (use a chave n8n:agente:<workflow>/<node> ou o nome do node)`);
  return a;
}

export async function avaliar(args: Argumentos): Promise<void> {
  const projetos = await projetosAlvo(args);
  for (const p of projetos) {
    if (flag(args, "pedir")) {
      const agentes = await agentesDoProjeto(p.id);
      const escolhidos = texto(args, "agente") ? [acharAgente(agentes, texto(args, "agente")!)] : agentes;
      for (const a of escolhidos) {
        const hash = (a.atributos.rascunho_versao ?? a.atributos.versao) as string | null;
        if (!hash) continue;
        const r = await pedirRodada(p, a.chave, hash, "manual", "meraki (cli)");
        out(`${a.nome} v${hash}: rodada ${r.id.slice(0, 8)} ${r.nova ? "pedida" : "já estava na fila"}`);
      }
    }
    const feitas = await processarRodadas({ projetoId: p.id, log: out });
    if (!feitas.length) {
      out(`${p.nome}: nenhuma rodada pedida`);
      continue;
    }
    const v = await verificarProjeto(p, { gravar: true });
    out(`${p.nome}: ${feitas.length} rodada(s) · abertos: ${contagem(v.abertos)}`);
  }
}

export async function producao(args: Argumentos): Promise<void> {
  const dias = Number(texto(args, "dias") ?? 30);
  for (const p of await projetosAlvo(args)) {
    const r = await atualizarProducao(p, { dias });
    if (!r.length) {
      out(`${p.nome}: nenhum agente declarado no contrato`);
      continue;
    }
    for (const a of r) {
      out(`${p.nome} · ${a.nome}: ${a.conversas} conversas · ${a.violacoes} violações · ${a.execucoes} execuções em ${a.dias} dia(s)`);
      for (const aviso of a.avisos) out(`  aviso: ${aviso}`);
    }
    const v = await verificarProjeto(p, { gravar: true });
    out(`  saúde ${v.saude} · abertos: ${contagem(v.abertos)}`);
  }
}

export async function conversa(args: Argumentos): Promise<void> {
  const c = await buscarConversa(obrigatorio(args, "projeto"), obrigatorio(args, "agente"), obrigatorio(args, "mensagem"));
  out(`${c.nome} · versão ${c.versao ?? "—"}${c.incerta ? " (incerta)" : ""} · ${c.mensagens.length} mensagens · ${c.anonimizados} trecho(s) anonimizado(s)`);
  for (const m of c.mensagens) out(`${m.destaque ? "»" : " "} ${m.momento.slice(0, 16).replace("T", " ")}  ${m.autor.padEnd(8)} ${m.texto}`);
}

/* ─────────────────────── Hooks do Claude Code (MCP do n8n) ─────────────────────── */
// Tools do MCP oficial do n8n (instância): publish_workflow {workflowId, versionId?} publica o rascunho ou uma
// versão do histórico; update_workflow e restore_workflow_version {workflowId} mudam o rascunho;
// create_workflow_from_code {code} só tem o id na resposta.

/** Id do workflow e, se a tool mandou, o próprio workflow (nodes e conexões). */
export function workflowDaTool(ti: Record<string, unknown>): { id: string | null; workflow: WorkflowN8n | null } {
  const candidato = (ti.workflow ?? ti.data ?? ti) as Record<string, unknown>;
  const id = [ti.workflowId, ti.workflow_id, ti.id, candidato?.id].find((v) => typeof v === "string" || typeof v === "number");
  const workflow = candidato && Array.isArray(candidato.nodes) ? ({ ...candidato, id: String(candidato.id ?? id ?? ""), name: String(candidato.name ?? id ?? "workflow") } as WorkflowN8n) : null;
  return { id: id !== undefined ? String(id) : workflow?.id || null, workflow };
}

const ehId = (v: unknown): v is string | number => (typeof v === "string" && v.trim() !== "") || (typeof v === "number" && Number.isFinite(v));

/**
 * Id do workflow no que a tool devolveu (create_workflow_from_code só sabe o id depois de criar). O MCP devolve
 * blocos de conteúdo com JSON em texto, ou o objeto estruturado; procura workflowId, o workflow criado ou o link.
 */
export function idNaResposta(resposta: unknown, fundo = 0): string | null {
  if (fundo > 5 || resposta === null || resposta === undefined) return null;
  if (typeof resposta === "string") {
    const t = resposta.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        return idNaResposta(JSON.parse(t), fundo + 1);
      } catch {
        // texto que só parece JSON: segue para os padrões abaixo
      }
    }
    return /"?workflow_?id"?\s*[:=]\s*"?([A-Za-z0-9_-]+)/i.exec(t)?.[1] ?? /\/workflow\/([A-Za-z0-9_-]+)/.exec(t)?.[1] ?? null;
  }
  if (Array.isArray(resposta)) {
    for (const x of resposta) {
      const id = idNaResposta(x, fundo + 1);
      if (id) return id;
    }
    return null;
  }
  if (typeof resposta !== "object") return null;
  const o = resposta as Record<string, unknown>;
  for (const k of ["workflowId", "workflow_id"]) if (ehId(o[k])) return String(o[k]);
  if (ehId(o.id) && (Array.isArray(o.nodes) || typeof o.name === "string")) return String(o.id);
  for (const k of ["structuredContent", "workflow", "data", "result", "content", "text", "url"]) {
    const id = idNaResposta(o[k], fundo + 1);
    if (id) return id;
  }
  return null;
}

/** O rascunho atual do workflow (o que a publicação vai pôr no ar), com a fonte n8n do projeto e o segredo dela. */
async function rascunhoAtual(projeto: Projeto, id: string): Promise<{ workflow: WorkflowN8n; fonte: Fonte; segredo: string | null }> {
  const fonteId = (
    await plataforma().query(
      `select o.fonte_id from public.objetos o join public.fontes f on f.id = o.fonte_id
        where f.projeto_id = $1 and o.chave = $2 limit 1`,
      [projeto.id, `n8n:workflow:${id}`],
    )
  ).rows[0]?.fonte_id ?? (await plataforma().query("select id from public.fontes where projeto_id = $1 and tipo = 'n8n' and ativa limit 1", [projeto.id])).rows[0]?.id;
  if (!fonteId) throw new Error("o projeto não tem fonte n8n");
  const fonte = await fontePorId(projeto.id, fonteId);
  const segredo = fonte.segredo_id ? await lerSegredo(fonte.segredo_id) : null;
  return { workflow: await lerWorkflow(fonte, segredo, RAIZ, id), fonte, segredo };
}

/**
 * PreToolUse (plano B): a mesma decisão do hook do n8n, para quem publica pelo MCP. Com versionId, o que vai ao
 * ar é aquela versão do histórico, não o rascunho. Erro ao verificar não libera: pede confirmação de uma pessoa.
 */
export async function gatePublicacao(args: Argumentos): Promise<void> {
  const modo = (texto(args, "modo") ?? "autonomo") as "autonomo" | "pergunta";
  const entrada = await lerEntradaDoHook();
  if (!entrada) throw new Error("gate-publicacao lê a chamada da ferramenta (JSON do hook PreToolUse) pela entrada padrão");
  const ti = entrada.tool_input ?? {};
  const { id, workflow } = workflowDaTool(ti);
  if (!id) return;
  let decisao: "permitiu" | "perguntou" | "negou";
  let motivo: string | null;
  try {
    const slug = texto(args, "projeto");
    const projeto = slug ? await projetoPorSlug(slug) : await projetoDoWorkflow(workflow ?? { id });
    if (!projeto) return;
    let pedido: Pick<PedidoDePublicacao, "workflow" | "versao" | "rascunho">;
    if (workflow) pedido = { workflow };
    else {
      const atual = await rascunhoAtual(projeto, id);
      const w = atual.workflow;
      const versionId = ehId(ti.versionId) ? String(ti.versionId) : null;
      pedido = {
        workflow: w,
        versao: versionId ? await lerVersao(atual.fonte, atual.segredo, w, versionId) : undefined,
        rascunho: { versionId: w.versionId, nodes: w.nodes ?? [], connections: w.connections ?? {} },
      };
    }
    ({ decisao, motivo } = await decidirPublicacao({
      ...pedido, projeto: projeto.slug, origem: "claude-code", ferramenta: entrada.tool_name ?? "publicar", sessao: entrada.session_id ?? null, modo,
    }));
  } catch (e) {
    decisao = "perguntou";
    motivo = `Meraki: erro ao verificar a publicação (${e instanceof Error ? e.message : String(e)}). Confirme com uma pessoa antes de publicar.`;
  }
  if (decisao !== "permitiu") process.stdout.write(respostaPreToolUse(decisao, motivo ?? "Meraki"));
}

/** PostToolUse: o rascunho que acabou de ser salvo passa pelo pacote agente; os achados voltam como contexto. */
export async function gateRascunho(args: Argumentos): Promise<void> {
  try {
    const entrada = await lerEntradaDoHook();
    if (!entrada) return;
    const doPedido = workflowDaTool(entrada.tool_input ?? {});
    const id = doPedido.id ?? idNaResposta(entrada.tool_response);
    if (!id) return;
    const workflow = doPedido.id ? doPedido.workflow : null;
    const slug = texto(args, "projeto");
    const projeto = slug ? await projetoPorSlug(slug) : await projetoDoWorkflow(workflow ?? { id });
    if (!projeto) return;
    const w = workflow ?? (await rascunhoAtual(projeto, id)).workflow;
    const avaliacoes = await avaliarRascunho(projeto, w);
    const linhas = avaliacoes.flatMap((a) =>
      a.achados.map((x) => `- ${x.regra} (${x.severidade}${x.bloqueia ? ", barra a publicação" : ""}${x.novo ? ", novo neste rascunho" : ""}): ${x.titulo}.${x.detalhe ? ` ${x.detalhe}` : ""}`),
    );
    if (!linhas.length) return;
    const texto_ = [
      `Meraki: o rascunho de "${w.name}" tem ${linhas.length} achado(s) no pacote agente (${avaliacoes.map((a) => `${a.nome} v${a.hash}`).join(", ")}).`,
      ...linhas,
      "Corrija antes de pedir publicação: o que barra vai ser negado no gate.",
    ].join("\n");
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: texto_ } }));
  } catch {
    // Rascunho só avisa: erro aqui não pode atrapalhar quem salvou.
  }
}

export async function servir(args: Argumentos): Promise<void> {
  const { iniciarServico } = await import("../servico.ts");
  const host = texto(args, "host") ?? "127.0.0.1";
  const porta = Number(texto(args, "porta") ?? process.env.MERAKI_SERVICO_PORTA ?? 7341);
  const s = iniciarServico({ host, porta });
  out(`meraki servir em http://${host.includes(":") ? `[${host}]` : host}:${porta} · rodadas a cada 30 s · Ctrl+C para parar`);
  await new Promise<void>((resolve) => {
    const parar = () => {
      void s.fechar().then(resolve);
    };
    process.once("SIGINT", parar);
    process.once("SIGTERM", parar);
  });
}
