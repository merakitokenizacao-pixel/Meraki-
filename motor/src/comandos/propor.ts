/**
 * meraki propor: o agente (ou você) pede para mudar a estrutura. Vira uma proposta aberta na tela Contrato;
 * aprovada, o contrato ganha versão nova e o gate passa a permitir.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { baixarCache, lerCache, salvarCache } from "../gate/cache.ts";
import { avaliarMudanca } from "../gate/decidir.ts";
import { plataforma } from "../plataforma/db.ts";
import { projetoPorSlug } from "../plataforma/repositorio.ts";
import { carregarParser, tentarLerComandos } from "../sql/parser.ts";
import { type Argumentos, obrigatorio, texto } from "../util/args.ts";
import { out } from "./comum.ts";

const TIPOS = ["nova_tabela", "nova_coluna", "nova_funcao", "alterar_objeto", "remover_objeto", "nova_primitiva", "outro"];

export async function propor(args: Argumentos): Promise<void> {
  const projeto = await projetoPorSlug(obrigatorio(args, "projeto"));
  const tipo = obrigatorio(args, "tipo");
  if (!TIPOS.includes(tipo)) throw new Error(`--tipo precisa ser um de: ${TIPOS.join(", ")}`);
  const justificativa = obrigatorio(args, "justificativa").trim();
  if (!justificativa) throw new Error("--justificativa não pode ser vazia");
  const origem = texto(args, "origem") ?? "agente";
  if (origem !== "agente" && origem !== "voce") throw new Error("--origem precisa ser agente ou voce");

  const arquivo = texto(args, "sql");
  const sql = arquivo ? await readFile(resolve(arquivo), "utf8") : null;
  const objetos = new Set((texto(args, "objetos") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  let regras: string[] = [];
  let resumo: string[] = [];
  if (sql) {
    await carregarParser();
    const comandos = tentarLerComandos(sql);
    if (!comandos) throw new Error(`não consegui ler o SQL de ${arquivo}`);
    const d = avaliarMudanca(await baixarCache(projeto.slug, 10_000), comandos, "pergunta");
    for (const ref of d.afetados) objetos.add(ref);
    regras = [...new Set(d.violacoes.map((v) => v.regra))];
    resumo = d.resumo;
  }
  if (!objetos.size) throw new Error("diga o que muda: --sql <arquivo> ou --objetos public.x,fn:public.y");

  const declaracao: Record<string, string> = {};
  for (const campo of ["papel", "primitiva"]) {
    const v = texto(args, campo);
    if (v) declaracao[campo] = v;
  }
  const payload = { sql, objetos: [...objetos].sort(), declaracao, regras, resumo };
  const r = await plataforma().query<{ id: string }>(
    `insert into public.propostas (conta_id, projeto_id, origem, sessao, tipo, payload, justificativa)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [projeto.conta_id, projeto.id, origem, texto(args, "sessao") ?? null, tipo, JSON.stringify(payload), justificativa],
  );
  const id = r.rows[0].id;
  out(`Proposta ${id.slice(0, 8)} aberta para ${payload.objetos.join(", ")}${regras.length ? ` (o gate barraria por ${regras.join(", ")})` : ""}.`);
  out("Aguarde a decisão na tela Contrato do Meraki antes de aplicar a migration.");

  // Com cache local (sessão de agente), atualiza para o gate já saber da proposta.
  const diretorio = process.cwd();
  if (await lerCache(diretorio, projeto.slug)) {
    await baixarCache(projeto.slug, 3_000).then((c) => salvarCache(diretorio, c)).catch(() => undefined);
  }
}
