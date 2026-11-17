/**
 * meraki contexto: hook SessionStart. Baixa o estado do projeto para .meraki/cache, grava a cópia
 * só de leitura do contrato em .meraki/contrato.md e imprime o resumo que entra no contexto do agente.
 */
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { contratoEmMarkdown } from "../contrato/markdown.ts";
import { type CacheProjeto, baixarCache, lerCache, pastaMeraki, salvarCache } from "../gate/cache.ts";
import { lerEntradaDoHook, registrarEventos } from "../gate/hook.ts";
import { REGRAS } from "../regras/index.ts";
import { type Argumentos, obrigatorio, texto } from "../util/args.ts";
import { contagem, out } from "./comum.ts";

async function escreverContrato(diretorio: string, cache: CacheProjeto): Promise<void> {
  const pasta = pastaMeraki(diretorio);
  await mkdir(pasta, { recursive: true });
  await writeFile(join(pasta, ".gitignore"), "cache/\n", { flag: "wx" }).catch(() => undefined);
  const arquivo = join(pasta, "contrato.md");
  await chmod(arquivo, 0o644).catch(() => undefined);
  await writeFile(arquivo, contratoEmMarkdown(cache.contrato, { geradoEm: new Date(), abertos: cache.abertos }));
  await chmod(arquivo, 0o444).catch(() => undefined);
}

export function resumoParaAgente(c: CacheProjeto, online: boolean): string {
  const l: string[] = [];
  const total = Object.values(c.abertos).reduce((s, n) => s + n, 0);
  const estado = online ? "" : ` · OFFLINE, cache de ${c.gerado_em.slice(0, 16).replace("T", " ")} UTC`;
  l.push(`Meraki · ${c.projeto.nome} (${c.projeto.slug}) · contrato v${c.contrato_versao ?? 0} · ${total} achado(s) aberto(s): ${contagem(c.abertos)}${estado}`);
  l.push("Toda mudança de estrutura no banco (apply_migration/execute_sql) passa pelo gate do Meraki. Dívida herdada não barra; o que a mudança introduz, barra.");
  const primitivas = Object.entries(c.contrato.primitivas);
  if (primitivas.length) {
    l.push("Primitivas — use-as em vez de criar tabela parecida:");
    for (const [nome, p] of primitivas) {
      l.push(`- ${nome}: dona ${p.dona}${p.vinculo ? `, vínculo ${p.vinculo}` : ""}${p.escritores.length ? `; escreva só por ${p.escritores.join(", ")}` : ""}`);
    }
  }
  const cv = c.contrato.convencoes;
  if (cv.parametro_de_escopo) {
    l.push(`Convenção: funções recebem ${cv.parametro_de_escopo} e validam com ${cv.validadores_de_escopo.join(" ou ") || "um validador de escopo"}.`);
  }
  l.push(`O gate barra: ${REGRAS.filter((r) => r.bloqueia).map((r) => `${r.codigo} ${r.titulo.toLowerCase()}`).join("; ")}.`);
  const abertas = c.propostas.filter((p) => p.status === "aberta");
  if (abertas.length) {
    l.push(`Propostas aguardando decisão: ${abertas.map((p) => `${p.id.slice(0, 8)} (${p.objetos.join(", ") || "sem objetos"})`).join("; ")}. Não aplique antes da aprovação.`);
  }
  for (const p of c.propostas.filter((x) => x.status === "recusada").slice(0, 3)) {
    l.push(`Recusada: ${p.objetos.join(", ") || p.id.slice(0, 8)} — ${p.decisao_motivo ?? "sem motivo"}`);
  }
  l.push(`Estrutura nova fora do contrato: rode meraki propor --projeto ${c.projeto.slug} --tipo nova_tabela --sql <arquivo> --justificativa "..." e pare até a decisão.`);
  l.push("Contrato completo, só leitura: .meraki/contrato.md");
  return l.join("\n");
}

export async function contexto(args: Argumentos): Promise<void> {
  const slug = obrigatorio(args, "projeto");
  const entrada = await lerEntradaDoHook(300);
  const diretorio = texto(args, "dir") ?? entrada?.cwd ?? process.cwd();
  let cache: CacheProjeto | null = null;
  let online = true;
  try {
    cache = await baixarCache(slug, 4_000);
    await salvarCache(diretorio, cache);
  } catch {
    online = false;
    cache = await lerCache(diretorio, slug);
  }
  if (!cache) {
    out(`Meraki: sem o estado do projeto ${slug} (plataforma fora do ar e sem cache em .meraki/). O gate vai pedir confirmação para toda migration.`);
    return;
  }
  await escreverContrato(diretorio, cache);
  if (online) await registrarEventos(diretorio, [], 1_500);
  out(resumoParaAgente(cache, online));
}
