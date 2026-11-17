/**
 * Pacote agente (A01–A10): o agente de IA olhado como objeto inteiro — prompt, tools e o que elas tocam.
 * Funções puras sobre o grafo; A07 usa o histórico de prompts do estado dos agentes quando existe.
 */
import { partes, schemaDe } from "../chaves.ts";
import type { NoGrafo } from "../grafo.ts";
import type { AchadoBruto } from "../tipos.ts";
import { type ContextoRegra, type Regra, exibir, noEscopo, numero } from "./base.ts";

interface AgenteLido {
  no: NoGrafo;
  nome: string;
  tools: NoGrafo[];
  prompt?: NoGrafo;
  sistema: string;
}

interface ArgumentoTool {
  nome: string;
}

const REFERENCIAVEIS = new Set(["tabela", "visao", "coluna", "funcao"]);

function agentes(ctx: ContextoRegra): AgenteLido[] {
  return noEscopo(ctx, "agente")
    .filter((a) => !a.atributos.desativado)
    .map((a) => {
      const prompt = ctx.grafo.filhos(a.chave, "prompt")[0];
      const tools = ctx.grafo
        .saindo(a.chave, "usa_tool")
        .map((r) => ctx.grafo.get(r.destino))
        .filter((t): t is NoGrafo => Boolean(t));
      return { no: a, nome: a.nome, tools, prompt, sistema: String(prompt?.atributos.sistema ?? "") };
    });
}

const nomeDaTool = (t: NoGrafo) => String((t.atributos.tool as { nome?: string } | undefined)?.nome ?? t.nome);
const argumentosDaTool = (t: NoGrafo) => ((t.atributos.tool as { argumentos?: ArgumentoTool[] } | undefined)?.argumentos ?? []).map((a) => a.nome);

/** minúsculas, sem acento, espaço/hífen/underscore viram "_" */
export function normalizarNome(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function semExpressoes(texto: string): string {
  return texto.replace(/\{\{[\s\S]*?\}\}/g, " ");
}

/** O prompt cita a tool pelo nome (com espaço ou "_", sem diferença de caixa e acento). */
export function citaTool(sistema: string, nome: string): boolean {
  const corpo = `_${normalizarNome(semExpressoes(sistema).replace(/[^\p{L}\p{N}_\s-]+/gu, " "))}_`;
  return corpo.includes(`_${normalizarNome(nome)}_`);
}

/**
 * Nomes que o prompt trata como tool: entre crases, em lista ("- Nome_Da_Tool: ...") ou depois de
 * "tool", "ferramenta", "use", "chame", "acione". Só nomes com "_" (ou entre crases), para não confundir com texto.
 */
export function toolsCitadas(sistema: string): string[] {
  const texto = semExpressoes(sistema);
  const nome = "([A-Za-zÀ-ÿ][\\wÀ-ÿ-]*(?:_[\\wÀ-ÿ-]+)+)";
  const achados = new Set<string>();
  for (const m of texto.matchAll(/`([A-Za-zÀ-ÿ][\wÀ-ÿ-]{2,})`/g)) achados.add(m[1]);
  for (const m of texto.matchAll(new RegExp(`^\\s*[-*•]\\s*${nome}\\s*[:—–(-]`, "gm"))) achados.add(m[1]);
  for (const m of texto.matchAll(new RegExp(`\\b(?:tools?|ferramentas?|fun[cç][aã]o|use|usar|usa|chame|chamar|acione|acionar|aciona)\\s+(?:a\\s+|o\\s+)?["'“]?${nome}`, "gi"))) achados.add(m[1]);
  return [...achados];
}

/** Função que grava (direto ou chamando outra que grava). */
function escreve(ctx: ContextoRegra, k: string, vistos = new Set<string>()): boolean {
  if (vistos.has(k)) return false;
  vistos.add(k);
  if (ctx.grafo.saindo(k, "escreve").length) return true;
  return ctx.grafo.saindo(k, "chama").some((r) => r.destino !== k && escreve(ctx, r.destino, vistos));
}

/** Parâmetros que uma chamada passa: nomeados + os primeiros N posicionais pela ordem da função. */
function passados(evidencia: Record<string, unknown>, funcao: NoGrafo | undefined): Set<string> | null {
  const nomeados = evidencia.nomeados as string[] | undefined;
  const posicionais = evidencia.posicionais as number | undefined;
  if (!Array.isArray(nomeados) && typeof posicionais !== "number") return null;
  const params = (funcao?.atributos.parametros as { nome: string }[] | undefined) ?? [];
  return new Set([...(nomeados ?? []), ...params.slice(0, posicionais ?? 0).map((p) => p.nome)]);
}

function alvoFaltando(ctx: ContextoRegra, destino: string): boolean {
  if (ctx.grafo.tem(destino)) return false;
  const p = partes(destino);
  if (p.ns === "pg") return REFERENCIAVEIS.has(p.tipo) && ctx.grafo.coletaSchema(schemaDe(destino) ?? "public") && !ctx.intencao.ignorado(destino);
  if (p.ns === "n8n") return ctx.grafo.temFonte("n8n");
  return false;
}

export const A01: Regra = {
  codigo: "A01", pacote: "agente", severidade: "medio", bloqueia: false, alvo: "n8n:agente",
  titulo: "Tool ligada que o prompt não cita",
  descricao: "O modelo recebe a tool, mas o prompt não diz quando usá-la: ela vira palpite do modelo.",
  avaliar: (ctx) =>
    agentes(ctx).flatMap((a) =>
      a.prompt
        ? a.tools
            .filter((t) => !citaTool(a.sistema, nomeDaTool(t)))
            .map((t): AchadoBruto => ({
              regra: "A01", objeto: a.no.chave, par: t.chave, severidade: "medio",
              titulo: `Tool "${nomeDaTool(t)}" está ligada ao agente "${a.nome}", mas o prompt não cita`,
              detalhe: "Diga no prompt quando usar a tool (ou desligue-a): sem isso, chamar ou não fica a critério do modelo.",
              evidencia: { objeto: a.no.chave, par: t.chave, tool: nomeDaTool(t) },
            }))
        : [],
    ),
};

export const A02: Regra = {
  codigo: "A02", pacote: "agente", severidade: "alto", bloqueia: true, alvo: "n8n:agente",
  titulo: "Prompt cita tool que não está ligada",
  descricao: "O prompt manda usar uma tool que o agente não tem: o modelo inventa a resposta ou trava.",
  avaliar: (ctx) =>
    agentes(ctx).flatMap((a) => {
      const ligadas = new Set(a.tools.map((t) => normalizarNome(nomeDaTool(t))));
      return toolsCitadas(a.sistema)
        .filter((n) => !ligadas.has(normalizarNome(n)))
        .map((n): AchadoBruto => ({
          regra: "A02", objeto: a.no.chave, variante: normalizarNome(n), severidade: "alto",
          titulo: `Prompt do agente "${a.nome}" manda usar "${n}", que não está ligada`,
          detalhe: "Ligue a tool ao agente ou tire a menção do prompt.",
          evidencia: { objeto: a.no.chave, tool: n, prompt: a.prompt?.chave, ligadas: a.tools.map(nomeDaTool) },
        }));
    }),
};

export const A03: Regra = {
  codigo: "A03", pacote: "agente", severidade: "critico", bloqueia: true, alvo: "n8n:agente",
  titulo: "Tool aponta para tabela, coluna ou função que não existe",
  descricao: "A tool falha na primeira vez que o modelo chamar — e o agente responde sem o dado.",
  avaliar: (ctx) =>
    agentes(ctx).flatMap((a) =>
      a.tools.flatMap((t) =>
        ctx.grafo
          .saindo(t.chave)
          .filter((r) => ["le", "escreve", "chama", "executa"].includes(r.tipo) && r.certeza === "exata" && alvoFaltando(ctx, r.destino))
          .map((r): AchadoBruto => ({
            regra: "A03", objeto: a.no.chave, par: r.destino, variante: normalizarNome(nomeDaTool(t)), severidade: "critico",
            titulo: `Tool "${nomeDaTool(t)}" do agente "${a.nome}" ${r.tipo === "chama" ? "chama" : r.tipo === "escreve" ? "grava em" : r.tipo === "executa" ? "executa" : "lê"} ${exibir(r.destino).replace(/\(\*\)$/, "")}, que não existe`,
            detalhe: "Corrija o alvo da tool ou crie o objeto. Enquanto isso, toda chamada dessa tool falha.",
            evidencia: { ...r.evidencia, objeto: a.no.chave, par: r.destino, tool: nomeDaTool(t), node: t.nome },
          })),
      ),
    ),
};

export const A04: Regra = {
  codigo: "A04", pacote: "agente", severidade: "medio", bloqueia: false, alvo: "n8n:agente",
  titulo: "Parâmetro de função que nenhuma tool passa",
  descricao: "A função espera um parâmetro obrigatório que nenhuma tool do agente envia.",
  avaliar: (ctx) => {
    const saida: AchadoBruto[] = [];
    for (const a of agentes(ctx)) {
      const porFuncao = new Map<string, { tools: string[]; passados: Set<string> }>();
      for (const t of a.tools) {
        for (const r of ctx.grafo.saindo(t.chave, "chama")) {
          const f = ctx.grafo.get(r.destino);
          if (!f || f.tipo !== "funcao") continue;
          const lista = passados(r.evidencia, f);
          if (!lista) continue;
          const atual = porFuncao.get(f.chave) ?? { tools: [], passados: new Set<string>() };
          atual.tools.push(nomeDaTool(t));
          for (const p of lista) atual.passados.add(p);
          porFuncao.set(f.chave, atual);
        }
      }
      for (const [k, uso] of porFuncao) {
        const f = ctx.grafo.get(k)!;
        for (const p of (f.atributos.parametros as { nome: string; padrao: boolean }[]) ?? []) {
          if (p.padrao || p.nome.startsWith("$") || uso.passados.has(p.nome)) continue;
          saida.push({
            regra: "A04", objeto: a.no.chave, par: k, variante: p.nome, severidade: "medio",
            titulo: `${p.nome} de ${exibir(k)} não é passado por nenhuma tool do agente "${a.nome}"`,
            detalhe: `Tools que chamam a função: ${uso.tools.join(", ")}. Passe o parâmetro (um $fromAI ou valor do fluxo) ou dê um padrão a ele.`,
            evidencia: { objeto: a.no.chave, par: k, parametro: p.nome, tools: uso.tools },
          });
        }
      }
    }
    return saida;
  },
};

const REGRA_DE_COMPORTAMENTO = /\b(sempre|nunca|antes de|depois de|n[aã]o (?:use|chame|responda|diga|confirme)|s[oó] (?:use|chame)|apenas quando|obrigat[oó]ri[oa])\b/i;

export const A05: Regra = {
  codigo: "A05", pacote: "agente", severidade: "baixo", bloqueia: false, alvo: "n8n:agente",
  titulo: "Descrição de tool com regra de comportamento",
  descricao: "Regra (\"sempre\", \"nunca\", \"antes de\") escondida na descrição da tool, longe do prompt — heurística.",
  avaliar: (ctx) =>
    agentes(ctx).flatMap((a) =>
      a.tools.flatMap((t): AchadoBruto[] => {
        const d = (t.atributos.tool as { descricao?: string | null } | undefined)?.descricao ?? "";
        const m = REGRA_DE_COMPORTAMENTO.exec(d);
        if (!m) return [];
        return [{
          regra: "A05", objeto: a.no.chave, par: t.chave, severidade: "baixo",
          titulo: `Descrição da tool "${nomeDaTool(t)}" (agente "${a.nome}") traz regra de comportamento ("${m[0]}")`,
          detalhe: "A descrição diz o que a tool faz; quando usar fica no prompt, junto das outras regras.",
          evidencia: { objeto: a.no.chave, par: t.chave, trecho: d.slice(0, 300) },
        }];
      }),
    ),
};

export const A06: Regra = {
  codigo: "A06", pacote: "agente", severidade: "medio", bloqueia: false, alvo: "n8n:agente",
  titulo: "Prompt lendo $json direto com entrada ramificada",
  descricao: "O $json é o item que chegou ao agente: com o fluxo ramificado, ele muda de forma ou vem vazio.",
  avaliar: (ctx) =>
    agentes(ctx)
      .filter((a) => a.prompt?.atributos.le_json && a.no.atributos.entrada_ramificada)
      .map((a) => ({
        regra: "A06", objeto: a.no.chave, par: a.prompt!.chave, severidade: "medio",
        titulo: `Prompt do agente "${a.nome}" lê $json direto, mas o agente recebe de mais de um caminho`,
        detalhe: "Use $('Nome do node').item.json.campo: o valor deixa de depender de qual ramo chegou.",
        evidencia: { objeto: a.no.chave, par: a.prompt!.chave },
      })),
};

export const A07: Regra = {
  codigo: "A07", pacote: "agente", severidade: "baixo", bloqueia: false, alvo: "n8n:agente",
  titulo: "Prompt cresceu mais de 20% numa versão",
  descricao: "Prompt que incha de uma vez costuma ser remendo: revise antes de publicar.",
  avaliar: (ctx) => {
    const limite = numero(ctx.ajuste, "limite", 0.2);
    const saida: AchadoBruto[] = [];
    for (const a of agentes(ctx)) {
      if (!a.prompt) continue;
      const versoes = (ctx.agentes?.prompts.get(a.prompt.chave) ?? []).filter((v, i, l) => i === 0 || v.hash !== l[i - 1].hash);
      const atual = Number(a.prompt.atributos.tamanho ?? 0);
      const anterior = versoes.filter((v) => v.hash !== a.prompt!.atributos.hash).at(-1);
      if (!anterior || anterior.tamanho <= 0 || versoes.at(-1)?.hash !== a.prompt.atributos.hash) continue;
      const cresceu = (atual - anterior.tamanho) / anterior.tamanho;
      if (cresceu <= limite) continue;
      saida.push({
        regra: "A07", objeto: a.no.chave, par: a.prompt.chave, variante: String(a.prompt.atributos.hash), severidade: "baixo",
        titulo: `Prompt do agente "${a.nome}" cresceu ${Math.round(cresceu * 100)}% (${anterior.tamanho} → ${atual} caracteres)`,
        detalhe: "Confira se o trecho novo não repete regra que já existe ou contradiz outra.",
        evidencia: { objeto: a.no.chave, par: a.prompt.chave, antes: anterior.tamanho, depois: atual },
      });
    }
    return saida;
  },
};

export const A08: Regra = {
  codigo: "A08", pacote: "agente", severidade: "baixo", bloqueia: false, alvo: "n8n:agente",
  titulo: "Exemplos literais acima do limite",
  descricao: "Muitos exemplos no prompt fazem o modelo copiar frase pronta — heurística.",
  avaliar: (ctx) => {
    const maximo = numero(ctx.ajuste, "maximo", 3);
    return agentes(ctx).flatMap((a): AchadoBruto[] => {
      const n = Number(a.prompt?.atributos.exemplos ?? 0);
      if (!a.prompt || n <= maximo) return [];
      return [{
        regra: "A08", objeto: a.no.chave, par: a.prompt.chave, severidade: "baixo",
        titulo: `Prompt do agente "${a.nome}" tem ${n} exemplos literais (limite ${maximo})`,
        detalhe: "Troque exemplos por regras e leve os exemplos para casos de referência.",
        evidencia: { objeto: a.no.chave, par: a.prompt.chave, exemplos: n, limite: maximo },
      }];
    });
  },
};

export const A09: Regra = {
  codigo: "A09", pacote: "agente", severidade: "baixo", bloqueia: false, alvo: "n8n:agente",
  titulo: "Agente sem modelo de fallback",
  descricao: "Quando o provedor do modelo cai ou estoura limite, o agente para de responder.",
  avaliar: (ctx) =>
    agentes(ctx)
      .filter((a) => a.no.atributos.modelo && !a.no.atributos.fallback)
      .map((a) => ({
        regra: "A09", objeto: a.no.chave, severidade: "baixo",
        titulo: `Agente "${a.nome}" não tem modelo de fallback`,
        detalhe: "Ligue um segundo modelo (de outro provedor) na entrada de fallback do agente.",
        evidencia: { objeto: a.no.chave, modelo: (a.no.atributos.modelo as { nome?: string } | null)?.nome ?? null },
      })),
};

export const A10: Regra = {
  codigo: "A10", pacote: "agente", severidade: "alto", bloqueia: true, alvo: "n8n:agente",
  titulo: "Tool de escrita sem o parâmetro de ensaio",
  descricao: "No ensaio a tool grava de verdade: a função precisa do parâmetro de ensaio do contrato e a tool precisa passá-lo.",
  avaliar: (ctx) => {
    const saida: AchadoBruto[] = [];
    for (const a of agentes(ctx)) {
      const parametro = ctx.intencao.agenteDe(a.no.chave)?.config.ensaio?.parametro;
      if (!parametro) continue;
      for (const t of a.tools) {
        const nome = nomeDaTool(t);
        for (const r of ctx.grafo.saindo(t.chave)) {
          if (r.tipo === "escreve") {
            saida.push({
              regra: "A10", objeto: a.no.chave, par: r.destino, variante: `${normalizarNome(nome)}:direta`, severidade: "alto",
              titulo: `Tool "${nome}" do agente "${a.nome}" grava direto em ${exibir(r.destino)}: o ensaio grava de verdade`,
              detalhe: `Troque a escrita direta por uma função que receba ${parametro} e, no ensaio, só valide e devolva o que faria.`,
              evidencia: { ...r.evidencia, objeto: a.no.chave, par: r.destino, tool: nome, parametro },
            });
            continue;
          }
          if (r.tipo !== "chama") continue;
          const f = ctx.grafo.get(r.destino);
          if (!f || f.tipo !== "funcao" || !escreve(ctx, f.chave)) continue;
          const params = (f.atributos.parametros as { nome: string }[] | undefined) ?? [];
          if (!params.some((p) => p.nome === parametro)) {
            saida.push({
              regra: "A10", objeto: a.no.chave, par: f.chave, variante: `${normalizarNome(nome)}:sem_parametro`, severidade: "alto",
              titulo: `${exibir(f.chave)} grava e não tem ${parametro}: a tool "${nome}" do agente "${a.nome}" grava de verdade no ensaio`,
              detalhe: `Acrescente ${parametro} boolean default false: com true, a função valida e devolve o que faria, sem gravar.`,
              evidencia: { ...r.evidencia, objeto: a.no.chave, par: f.chave, tool: nome, parametro },
            });
            continue;
          }
          const lista = passados(r.evidencia, f);
          if (lista && !lista.has(parametro)) {
            saida.push({
              regra: "A10", objeto: a.no.chave, par: f.chave, variante: `${normalizarNome(nome)}:nao_passa`, severidade: "alto",
              titulo: `Tool "${nome}" do agente "${a.nome}" não passa ${parametro} para ${exibir(f.chave)}`,
              detalhe: `Passe ${parametro} com o valor do fluxo (ensaio: true na entrada do caso).`,
              evidencia: { ...r.evidencia, objeto: a.no.chave, par: f.chave, tool: nome, parametro, argumentos: argumentosDaTool(t) },
            });
          }
        }
      }
    }
    return saida;
  },
};

export const AGENTES: Regra[] = [A01, A02, A03, A04, A05, A06, A07, A08, A09, A10];
