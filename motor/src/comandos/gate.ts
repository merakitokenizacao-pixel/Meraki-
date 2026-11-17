/**
 * meraki gate: hook PreToolUse de apply_migration/execute_sql. Decide em menos de 1 s com o cache local;
 * só vai à plataforma quando vai barrar (para enxergar aprovação recente) ou quando não há cache.
 * meraki gate-arquivos: hook PreToolUse de Edit/Write. Nega escrita do agente nas pastas protegidas.
 */
import { isAbsolute, relative, resolve } from "node:path";
import { type CacheProjeto, baixarCache, lerCache, salvarCache } from "../gate/cache.ts";
import { type Decisao, type Modo, avaliarMudanca } from "../gate/decidir.ts";
import { type EventoGate, lerEntradaDoHook, registrarEventos, respostaPreToolUse, sqlDaFerramenta } from "../gate/hook.ts";
import { comandoTemEfeitoEstrutural } from "../sql/ddl.ts";
import { carregarParser, tentarLerComandos } from "../sql/parser.ts";
import { type Argumentos, obrigatorio, texto } from "../util/args.ts";

const PRAZO_PLATAFORMA_MS = 700;
const PRAZO_EVENTO_MS = 400;

function pergunta(motivo: string): Decisao {
  return { decisao: "perguntou", motivo, violacoes: [], resumo: [], afetados: [] };
}

export async function gate(args: Argumentos): Promise<void> {
  const t0 = performance.now();
  const slug = obrigatorio(args, "projeto");
  const modo = (texto(args, "modo") ?? "autonomo") as Modo;
  if (modo !== "autonomo" && modo !== "pergunta") throw new Error("--modo precisa ser autonomo ou pergunta");
  const entrada = await lerEntradaDoHook();
  if (!entrada) throw new Error("o gate lê a chamada da ferramenta (JSON do hook PreToolUse) pela entrada padrão");
  const sql = sqlDaFerramenta(entrada);
  if (!sql) return;
  const diretorio = entrada.cwd || process.cwd();

  let decisao: Decisao;
  try {
    await carregarParser();
    const comandos = tentarLerComandos(sql);
    if (!comandos) {
      decisao = pergunta("Meraki: o parser não conseguiu ler este SQL. Confirme com uma pessoa antes de aplicar.");
    } else if (!comandos.some((c) => comandoTemEfeitoEstrutural(c.tipo))) {
      return; // consulta ou DML: o gate não olha dado
    } else {
      let cache: CacheProjeto | null = await lerCache(diretorio, slug);
      let fresco = false;
      if (!cache) {
        cache = await baixarCache(slug, PRAZO_PLATAFORMA_MS).catch(() => null);
        fresco = Boolean(cache);
        if (cache) await salvarCache(diretorio, cache).catch(() => undefined);
      }
      if (!cache) {
        decisao = pergunta(`Meraki: sem o estado do projeto ${slug} (rode meraki contexto --projeto ${slug}). Confirme com uma pessoa antes de aplicar.`);
      } else {
        decisao = avaliarMudanca(cache, comandos, modo);
        if (decisao.violacoes.length && !fresco) {
          // Pode ter proposta aprovada depois do último contexto: confere antes de barrar.
          const atual = await baixarCache(slug, PRAZO_PLATAFORMA_MS).catch(() => null);
          if (atual) {
            await salvarCache(diretorio, atual).catch(() => undefined);
            decisao = avaliarMudanca(atual, comandos, modo);
          }
        }
      }
    }
  } catch (e) {
    decisao = pergunta(`Meraki: erro ao verificar (${e instanceof Error ? e.message : String(e)}). Confirme com uma pessoa antes de aplicar.`);
  }

  if (decisao.decisao !== "permitiu") process.stdout.write(respostaPreToolUse(decisao.decisao, decisao.motivo ?? "Meraki"));
  const evento: EventoGate = {
    projeto_slug: slug,
    criado_em: new Date().toISOString(),
    origem: "claude-code",
    sessao: entrada.session_id ?? null,
    ferramenta: entrada.tool_name ?? "desconhecida",
    modo,
    resumo: (decisao.resumo.join("; ") || sql.replace(/\s+/g, " ").trim()).slice(0, 500),
    decisao: decisao.decisao,
    regras: [...new Set(decisao.violacoes.map((v) => v.regra))],
    motivo: decisao.motivo ?? null,
    proposta_id: decisao.propostaId ?? null,
    duracao_ms: Math.round(performance.now() - t0),
  };
  await registrarEventos(diretorio, [evento], PRAZO_EVENTO_MS);
}

export async function gateArquivos(args: Argumentos): Promise<void> {
  const protegidos = (texto(args, "protegido") ?? ".meraki/").split(",").map((s) => s.trim()).filter(Boolean);
  const entrada = await lerEntradaDoHook();
  if (!entrada) throw new Error("gate-arquivos lê a chamada da ferramenta (JSON do hook PreToolUse) pela entrada padrão");
  const ti = entrada.tool_input ?? {};
  const caminho = [ti.file_path, ti.notebook_path, ti.path].find((v): v is string => typeof v === "string" && v.length > 0);
  if (!caminho) return;
  const base = entrada.cwd || process.cwd();
  const alvo = resolve(base, caminho);
  for (const p of protegidos) {
    const rel = relative(resolve(base, p), alvo);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
      process.stdout.write(
        respostaPreToolUse(
          "negou",
          `Meraki: ${p} é só leitura (contrato e cache vêm da plataforma). Para mudar a estrutura, rode meraki propor e pare até a decisão.`,
        ),
      );
      return;
    }
  }
}
