/** Chaves naturais e estáveis. Nunca oid: a mesma coisa tem a mesma chave em qualquer coleta. */

export const chave = {
  tabela: (schema: string, nome: string) => `pg:tabela:${schema}.${nome}`,
  visao: (schema: string, nome: string) => `pg:visao:${schema}.${nome}`,
  coluna: (schema: string, tabela: string, nome: string) => `pg:coluna:${schema}.${tabela}.${nome}`,
  /** A assinatura faz parte da chave: uma sobrecarga é um objeto novo. */
  funcao: (schema: string, nome: string, tipos: string) => `pg:funcao:${schema}.${nome}(${tipos})`,
  /** Referência por nome, sem assinatura (ex.: chamada via /rest/v1/rpc). Resolvida no grafo. */
  funcaoPorNome: (schema: string, nome: string) => `pg:funcao:${schema}.${nome}(*)`,
  policy: (schema: string, tabela: string, nome: string) => `pg:policy:${schema}.${tabela}/${nome}`,
  gatilho: (schema: string, tabela: string, nome: string) => `pg:gatilho:${schema}.${tabela}/${nome}`,
  constraint: (schema: string, tabela: string, nome: string) => `pg:constraint:${schema}.${tabela}/${nome}`,
  indice: (schema: string, nome: string) => `pg:indice:${schema}.${nome}`,
  bucket: (id: string) => `pg:bucket:${id}`,
  extensao: (nome: string) => `pg:extensao:${nome}`,
  migracao: (versao: string) => `pg:migracao:${versao}`,
  papel: (nome: string) => `pg:papel:${nome}`,
  workflow: (id: string) => `n8n:workflow:${id}`,
  node: (workflow: string, nome: string) => `n8n:node:${workflow}/${nome}`,
  /** Agente de IA: o node do agente visto como um todo (prompt, modelo, memória, tools). */
  agente: (workflow: string, nome: string) => `n8n:agente:${workflow}/${nome}`,
  prompt: (workflow: string, nome: string) => `n8n:prompt:${workflow}/${nome}`,
  credencial: (id: string) => `n8n:credencial:${id}`,
  arquivo: (caminho: string) => `repo:arquivo:${caminho}`,
  chamada: (caminho: string, linha: number) => `repo:chamada:${caminho}#L${linha}`,
  env: (nome: string) => `repo:env:${nome}`,
  rota: (rota: string) => `repo:rota:${rota}`,
  migracaoArquivo: (caminho: string) => `repo:migracao:${caminho}`,
  edge: (nome: string) => `sb:edge:${nome}`,
};

export interface PartesDaChave {
  ns: string;
  tipo: string;
  ref: string;
}

export function partes(k: string): PartesDaChave {
  const i = k.indexOf(":");
  const j = k.indexOf(":", i + 1);
  if (i < 0 || j < 0) return { ns: "", tipo: "", ref: k };
  return { ns: k.slice(0, i), tipo: k.slice(i + 1, j), ref: k.slice(j + 1) };
}

/** schema da chave pg (tabela, visão, coluna, função, policy, gatilho, constraint, índice). */
export function schemaDe(k: string): string | undefined {
  const p = partes(k);
  if (p.ns !== "pg") return undefined;
  const ponto = p.ref.indexOf(".");
  return ponto > 0 ? p.ref.slice(0, ponto) : undefined;
}

/** Nome da função sem assinatura: pg:funcao:public.f(uuid) → public.f */
export function nomeDaFuncao(k: string): string {
  const ref = partes(k).ref;
  const abre = ref.indexOf("(");
  return abre >= 0 ? ref.slice(0, abre) : ref;
}

/** Forma curta usada no contrato e na tela: public.contatos, public.contatos.etiquetas, fn:public.f */
export function refCurta(k: string): string {
  const p = partes(k);
  if (p.ns !== "pg") return k;
  if (p.tipo === "tabela" || p.tipo === "visao" || p.tipo === "coluna") return p.ref;
  if (p.tipo === "funcao") return `fn:${nomeDaFuncao(k)}`;
  return k;
}

export const ROTULO_TIPO: Record<string, string> = {
  tabela: "Tabela",
  visao: "Visão",
  coluna: "Coluna",
  funcao: "Função",
  policy: "Policy",
  gatilho: "Gatilho",
  constraint: "Restrição",
  indice: "Índice",
  bucket: "Bucket",
  extensao: "Extensão",
  migracao: "Migration",
  papel: "Papel do banco",
  workflow: "Workflow",
  node: "Node",
  agente: "Agente de IA",
  prompt: "Prompt",
  credencial: "Credencial",
  arquivo: "Arquivo",
  chamada: "Chamada",
  env: "Variável de ambiente",
  rota: "Rota de API",
};
