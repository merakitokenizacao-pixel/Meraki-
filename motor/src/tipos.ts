/** Vocabulário comum do motor. Todo coletor devolve o mesmo formato. */

export type TipoFonte = "postgres" | "supabase" | "n8n" | "repo";
export type Certeza = "exata" | "inferida";
export type Severidade = "critico" | "alto" | "medio" | "baixo";
export const SEVERIDADES: readonly Severidade[] = ["critico", "alto", "medio", "baixo"];

/** Toda afirmação aponta para a prova: coleta, objeto, node, arquivo, linha ou query. */
export interface Evidencia {
  coleta?: string;
  fonte?: string;
  objeto?: string;
  workflow?: string;
  node?: string;
  arquivo?: string;
  linha?: number;
  query?: string;
  trecho?: string;
  [extra: string]: unknown;
}

export interface Objeto {
  tipo: string;
  /** Chave natural e estável. Ex.: pg:tabela:public.contatos */
  chave: string;
  nome: string;
  pai?: string | null;
  atributos: Record<string, unknown>;
}

export interface Relacao {
  origem: string;
  destino: string;
  tipo: string;
  evidencia: Evidencia;
  certeza: Certeza;
}

/**
 * Observação volátil do dia: contadores brutos (cumulativos) e fatos que não entram no hash.
 * Com `absoluto`, os contadores já são o valor do dia (sem delta).
 */
export interface Observacao {
  chave: string;
  origem: string;
  leituras?: number;
  escritas?: number;
  linhas?: number | null;
  vazia?: boolean | null;
  absoluto?: boolean;
}

export interface Snapshot {
  objetos: Objeto[];
  relacoes: Relacao[];
  observacoes: Observacao[];
  /** completo | catalogo | api | exportacao | arquivos */
  modo: string;
  avisos: string[];
}

export interface FonteConfig {
  id: string;
  projetoId: string;
  projetoSlug: string;
  tipo: TipoFonte;
  nome: string;
  config: Record<string, unknown>;
  /** Valor lido do Vault. Só existe dentro do motor. */
  segredo?: string | null;
}

export interface ContextoColeta {
  /** Raiz do repositório Meraki: caminhos relativos das fontes partem daqui. */
  raiz: string;
  agora: Date;
}

export interface Coletor {
  tipos: TipoFonte[];
  coletar(fonte: FonteConfig, ctx: ContextoColeta): Promise<Snapshot>;
}

/** Achado como sai de uma regra, antes de virar linha na tabela achados. */
export interface AchadoBruto {
  regra: string;
  objeto: string;
  par?: string;
  /** Distingue variantes da mesma regra no mesmo objeto (ex.: lint do splinter, papel + ação). */
  variante?: string;
  severidade: Severidade;
  titulo: string;
  detalhe?: string;
  evidencia: Evidencia;
}

export function chaveDedupe(a: Pick<AchadoBruto, "regra" | "objeto" | "par" | "variante">): string {
  return [a.regra, a.variante ?? "", a.objeto, a.par ?? ""].join("|");
}
