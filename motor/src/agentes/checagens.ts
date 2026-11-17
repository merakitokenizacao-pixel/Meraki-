/**
 * Checagens fixas de um caso de referência. Determinísticas: a mesma resposta dá sempre o mesmo resultado.
 * Tools na ordem, argumentos, contém / não contém (minúsculo, sem acento), política do contrato (tamanho e
 * número de "?" sem contar links, palavras proibidas) e repasse. O juiz (LLM) só informa; nunca reprova.
 */

export interface EntradaDoCaso {
  mensagem: string;
  contexto?: { data_hora?: string; ficha?: Record<string, unknown>; [k: string]: unknown };
  historico?: { autor: string; texto: string }[];
}

export interface Espera {
  /** Tools na ordem em que devem ser chamadas. Lista vazia: nenhuma tool. Ausente: não checa. */
  tools?: string[];
  argumentos?: Record<string, Record<string, unknown>>;
  contem?: string[];
  nao_contem?: string[];
  repasse?: boolean;
}

export interface ChamadaDeTool {
  nome: string;
  argumentos: Record<string, unknown>;
}

export interface SaidaDoCaso {
  resposta: string;
  tools: ChamadaDeTool[];
  repasse: boolean | null;
}

export interface Politicas {
  proibidas: string[];
  max_caracteres?: number;
  max_perguntas?: number;
}

export interface Checagem {
  nome: string;
  passou: boolean;
  detalhe: string;
}

export function normalizar(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

export const semLinks = (s: string) => s.replace(/https?:\/\/\S+/g, "");
export const perguntas = (s: string) => (semLinks(s).match(/\?/g) ?? []).length;
const nomeDeTool = (s: string) => normalizar(s).replace(/[\s-]+/g, "_");

/** Termo inteiro (não pedaço de palavra), já normalizado. */
export function contemTermo(texto: string, termo: string): boolean {
  if (!termo) return false;
  const escapado = termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapado}($|[^\\p{L}\\p{N}])`, "u").test(texto);
}

function emOrdem(esperadas: string[], chamadas: string[]): boolean {
  let i = 0;
  for (const c of chamadas) if (i < esperadas.length && c === esperadas[i]) i++;
  return i === esperadas.length;
}

function mesmoValor(obtido: unknown, esperado: unknown): boolean {
  if (typeof esperado === "number") return Number(obtido) === esperado;
  if (typeof esperado === "boolean") return String(obtido).toLowerCase() === String(esperado);
  return normalizar(String(obtido ?? "")) === normalizar(String(esperado ?? ""));
}

export function checarCaso(espera: Espera, saida: SaidaDoCaso, politicas?: Politicas): Checagem[] {
  const c: Checagem[] = [];
  const chamadas = saida.tools.map((t) => nomeDeTool(t.nome));
  if (Array.isArray(espera.tools)) {
    const esperadas = espera.tools.map(nomeDeTool);
    const passou = esperadas.length ? emOrdem(esperadas, chamadas) : chamadas.length === 0;
    c.push({
      nome: "tools",
      passou,
      detalhe: `esperava ${espera.tools.join(" → ") || "nenhuma tool"} · chamou ${saida.tools.map((t) => t.nome).join(" → ") || "nenhuma"}`,
    });
  }
  for (const [tool, args] of Object.entries(espera.argumentos ?? {})) {
    const chamada = saida.tools.find((t) => nomeDeTool(t.nome) === nomeDeTool(tool));
    const erradas = Object.entries(args ?? {}).filter(([k, v]) => !chamada || !mesmoValor(chamada.argumentos?.[k], v));
    c.push({
      nome: `argumentos ${tool}`,
      passou: erradas.length === 0,
      detalhe: !chamada
        ? `${tool} não foi chamada`
        : erradas.length
          ? erradas.map(([k, v]) => `${k}: esperava ${JSON.stringify(v)}, veio ${JSON.stringify(chamada.argumentos?.[k] ?? null)}`).join("; ")
          : "argumentos conferem",
    });
  }
  const resposta = normalizar(saida.resposta);
  for (const termo of espera.contem ?? []) {
    const ok = resposta.includes(normalizar(termo));
    c.push({ nome: `contém "${termo}"`, passou: ok, detalhe: ok ? "presente na resposta" : "ausente na resposta" });
  }
  for (const termo of espera.nao_contem ?? []) {
    const ok = !contemTermo(resposta, normalizar(termo));
    c.push({ nome: `não contém "${termo}"`, passou: ok, detalhe: ok ? "ausente na resposta" : "presente na resposta" });
  }
  if (politicas) {
    const texto = semLinks(saida.resposta).trim();
    if (politicas.max_caracteres) {
      c.push({ nome: "tamanho", passou: texto.length <= politicas.max_caracteres, detalhe: `${texto.length} caracteres sem links (máx. ${politicas.max_caracteres})` });
    }
    if (politicas.max_perguntas !== undefined) {
      const n = perguntas(saida.resposta);
      c.push({ nome: "perguntas", passou: n <= politicas.max_perguntas, detalhe: `${n} pergunta(s) (máx. ${politicas.max_perguntas})` });
    }
    if (politicas.proibidas.length) {
      const achadas = politicas.proibidas.filter((p) => contemTermo(resposta, normalizar(p)));
      c.push({ nome: "palavras proibidas", passou: !achadas.length, detalhe: achadas.length ? `usou: ${achadas.join(", ")}` : "nenhuma" });
    }
  }
  if (typeof espera.repasse === "boolean") {
    const houve = Boolean(saida.repasse);
    c.push({ nome: "repasse", passou: houve === espera.repasse, detalhe: `esperava ${espera.repasse ? "repasse" : "sem repasse"} · ${houve ? "repassou" : "não repassou"}` });
  }
  return c;
}
