/**
 * Modelo da plataforma visto pela web: tipos já prontos para a tela e os rótulos de cada valor.
 * Pode ser importado no cliente (não toca no banco).
 */
import type { Status } from "@/lib/types";
import type { Json } from "./tipos.gen";

export type { Json };

/* ─────────────────────── Vocabulário ─────────────────────── */

export type Severidade = "critico" | "alto" | "medio" | "baixo";
export const SEVERIDADES: Severidade[] = ["critico", "alto", "medio", "baixo"];

/** A cor do estado segue a severidade; "baixo" fica neutro. */
export const SEV: Record<Severidade, { label: string; status: Status }> = {
  critico: { label: "Crítico", status: "crit" },
  alto: { label: "Alto", status: "serious" },
  medio: { label: "Médio", status: "warn" },
  baixo: { label: "Baixo", status: "maint" },
};

/** Rótulos da legenda de estados quando o estado vem de achados. */
export const ROTULO_ESTADO_ACHADO: Partial<Record<Status, string>> = {
  crit: "Achado crítico",
  serious: "Achado alto",
  warn: "Achado médio",
  maint: "Achado baixo",
  ok: "Sem achado aberto",
};

export const ordemSev = (s: Severidade) => SEVERIDADES.indexOf(s);

export function piorSeveridade(lista: Severidade[]): Severidade | null {
  return lista.length ? lista.reduce((p, s) => (ordemSev(s) < ordemSev(p) ? s : p)) : null;
}

export type StatusAchado = "aberto" | "excecao" | "resolvido";
export const STATUS_ACHADO: Record<StatusAchado, string> = { aberto: "Aberto", excecao: "Em exceção", resolvido: "Resolvido" };

export type Decisao = "permitiu" | "perguntou" | "negou";
export const DECISAO: Record<Decisao, { label: string; status: Status; descricao: string }> = {
  permitiu: { label: "Permitiu", status: "ok", descricao: "A mudança não introduz violação" },
  perguntou: { label: "Perguntou", status: "warn", descricao: "Pediu confirmação de uma pessoa" },
  negou: { label: "Negou", status: "crit", descricao: "Barrou a mudança e explicou ao agente" },
};

export type StatusProposta = "aberta" | "aprovada" | "recusada";
export const STATUS_PROPOSTA: Record<StatusProposta, { label: string; status: Status }> = {
  aberta: { label: "Aguardando decisão", status: "warn" },
  aprovada: { label: "Aprovada", status: "ok" },
  recusada: { label: "Recusada", status: "maint" },
};

export const TIPO_PROPOSTA: Record<string, string> = {
  nova_tabela: "Nova tabela",
  nova_coluna: "Nova coluna",
  nova_funcao: "Nova função",
  alterar_objeto: "Alterar objeto",
  remover_objeto: "Remover objeto",
  nova_primitiva: "Nova primitiva",
  outro: "Outra mudança",
};

export const PACOTE: Record<string, string> = {
  universal: "Universal",
  splinter: "Splinter",
  estrutura: "Estrutura",
  cruzada: "Cruzada",
  n8n: "n8n",
  repo: "Repositório",
  agente: "Agente de IA",
  avaliacao: "Avaliação",
  producao: "Produção",
};

export const TIPO_OBJETO: Record<string, string> = {
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
  credencial: "Credencial",
  arquivo: "Arquivo",
  chamada: "Chamada",
  env: "Variável de ambiente",
  rota: "Rota de API",
  agente: "Agente de IA",
  prompt: "Prompt",
};

/** Tipos que aparecem dentro do detalhe do objeto pai, não como linha própria do inventário. */
export const TIPOS_FILHOS = new Set(["coluna", "constraint", "indice", "policy", "gatilho", "node", "chamada"]);

export const TIPO_FONTE: Record<string, string> = { supabase: "Supabase", postgres: "Postgres", n8n: "n8n", repo: "Repositório" };

export const MODO_COLETA: Record<string, string> = {
  catalogo: "Catálogo",
  agregados: "Agregados",
  completo: "Completo",
  exportacao: "Exportação",
  api: "API",
  arquivos: "Arquivos",
};

export const RELACAO: Record<string, { ida: string; volta: string }> = {
  le: { ida: "lê", volta: "lido por" },
  escreve: { ida: "escreve em", volta: "escrito por" },
  chama: { ida: "chama", volta: "chamado por" },
  referencia: { ida: "referencia", volta: "referenciado por" },
  protege: { ida: "protege", volta: "protegido por" },
  segue: { ida: "segue para", volta: "vem de" },
  usa_credencial: { ida: "usa a credencial", volta: "credencial de" },
  usa_env: { ida: "usa a variável", volta: "usada em" },
  dispara_em: { ida: "dispara em", volta: "disparado por" },
  usa_saida: { ida: "usa a saída de", volta: "saída usada por" },
  executa: { ida: "executa", volta: "executado por" },
  usa_tool: { ida: "usa a tool", volta: "tool de" },
  usa_modelo: { ida: "usa o modelo", volta: "modelo de" },
  usa_memoria: { ida: "usa a memória", volta: "memória de" },
  usa_parser: { ida: "usa o parser", volta: "parser de" },
};

export function corProjeto(cor: string | null | undefined) {
  return cor && /^s[1-8]$/.test(cor) ? `var(--color-${cor})` : "var(--color-ink-3)";
}

/** Índice de saúde 0–100 (calculado pelo motor) → estado. */
export function estadoDaSaude(saude: number | null): Status {
  if (saude === null) return "maint";
  return saude >= 80 ? "ok" : saude >= 60 ? "warn" : saude >= 40 ? "serious" : "crit";
}

/* ─────────────────────── Chaves ─────────────────────── */

export function partes(k: string) {
  const i = k.indexOf(":");
  const j = k.indexOf(":", i + 1);
  if (i < 0 || j < 0) return { ns: "", tipo: "", ref: k };
  return { ns: k.slice(0, i), tipo: k.slice(i + 1, j), ref: k.slice(j + 1) };
}

/** Forma curta usada no contrato: public.contatos, public.contatos.etiquetas, fn:public.f */
export function refCurta(k: string) {
  const p = partes(k);
  if (p.ns !== "pg") return k;
  if (p.tipo === "tabela" || p.tipo === "visao" || p.tipo === "coluna") return p.ref;
  if (p.tipo === "funcao") {
    const abre = p.ref.indexOf("(");
    return `fn:${abre >= 0 ? p.ref.slice(0, abre) : p.ref}`;
  }
  return k;
}

/**
 * Todas as formas de escrever a mesma chave no contrato, como o motor aceita (Intencao.chavesDe):
 * a chave completa, a ref curta, sem o schema public e, para função, com ou sem `fn:` e a chamada por nome `(*)`.
 */
export function formasDaRef(k: string): string[] {
  const p = partes(k);
  if (p.ns !== "pg") return [k];
  const semPublic = (ref: string) => (ref.startsWith("public.") ? [ref.slice("public.".length)] : []);
  if (p.tipo === "tabela" || p.tipo === "visao") return [k, p.ref, ...semPublic(p.ref)];
  if (p.tipo === "coluna") return [k, p.ref];
  if (p.tipo === "funcao") {
    const abre = p.ref.indexOf("(");
    const nome = abre >= 0 ? p.ref.slice(0, abre) : p.ref;
    return [k, `pg:funcao:${nome}(*)`, `fn:${nome}`, nome, ...semPublic(nome).flatMap((n) => [`fn:${n}`, n])];
  }
  return [k];
}

/** Nome legível de qualquer chave (sem prefixo técnico). */
export function nomeDaChave(k: string) {
  const p = partes(k);
  if (!p.ns) return k;
  if (p.tipo === "funcao") return p.ref.replace("(*)", "()");
  if (p.tipo === "chamada") return p.ref.replace("#L", ":");
  return p.ref;
}

/**
 * Rótulo de cada objeto na tela: o nome coletado, com a lista de tipos dos argumentos quando há
 * sobrecarga (duas funções com o mesmo nome, como relatorio_envios(uuid,date) e (uuid,date,date)).
 */
export function rotuladorDeObjetos(objetos: { tipo: string; nome: string; chave: string }[]) {
  const vistos = new Map<string, number>();
  for (const o of objetos) if (o.tipo === "funcao") vistos.set(o.nome, (vistos.get(o.nome) ?? 0) + 1);
  return (o: { tipo: string; nome: string; chave: string }) => (o.tipo === "funcao" && (vistos.get(o.nome) ?? 0) > 1 ? nomeDaChave(o.chave) : o.nome);
}

/* ─────────────────────── Dados das telas ─────────────────────── */

export type ProjetoRef = { slug: string; nome: string; cor: string | null };

export type ProjetoNav = ProjetoRef & { id: string; novos: number; abertos: number; propostas: number; agentesAbertos: number };

export type AvisoProposta = { id: string; projeto: ProjetoRef; justificativa: string; origem: "agente" | "voce"; criadoEm: string };
export type AvisoAchado = { id: string; projeto: ProjetoRef; regra: string; severidade: Severidade; titulo: string; primeiroVisto: string };

export type DadosShell = {
  agora: number;
  usuario: string | null;
  conta: string | null;
  projetos: ProjetoNav[];
  propostas: AvisoProposta[];
  novos: AvisoAchado[];
  ultimaColeta: string | null;
  fontes: number;
  /** agentes de IA de cada projeto, para migalhas e busca */
  agentes: { slug: string; id: string; nome: string }[];
  erro?: string;
};

export type Contagem = Record<Severidade, number>;

export type ResumoProjeto = ProjetoRef & {
  id: string;
  descricao: string | null;
  saude: number | null;
  cobertura: number | null;
  objetos: number;
  avaliados: number;
  declarados: number;
  abertos: Contagem;
  /** abertos e fora da dívida herdada */
  novos: number;
  /** novos de severidade crítica ou alta */
  novosGraves: number;
  herdados: number;
  excecoes: number;
  contratoVersao: number | null;
  fontes: number;
  coletasComErro: number;
  ultimaColeta: string | null;
  propostasAbertas: number;
  gate: Record<Decisao, number>;
  /** achados abertos sobre agentes de IA (pacotes agente, avaliação e produção) */
  agentesAbertos: number;
};

export type PontoDiario = { dia: string; slug: string; saude: number | null; graves: number; novos: number; herdados: number };

export type Proposta = {
  id: string;
  projeto: ProjetoRef;
  tipo: string;
  origem: "agente" | "voce";
  sessao: string | null;
  justificativa: string;
  status: StatusProposta;
  objetos: string[];
  regras: string[];
  sql: string | null;
  resumo: string[];
  declaracao: { papel?: string; primitiva?: string } | null;
  decisaoMotivo: string | null;
  decididoPor: string | null;
  decididoEm: string | null;
  contratoVersao: number | null;
  criadoEm: string;
};

export type EventoGate = {
  id: string;
  projeto: ProjetoRef;
  criadoEm: string;
  origem: string;
  sessao: string | null;
  ferramenta: string;
  modo: "autonomo" | "pergunta" | null;
  resumo: string;
  decisao: Decisao;
  regras: string[];
  motivo: string | null;
  propostaId: string | null;
  duracaoMs: number | null;
};

export type ExcecaoDoAchado = { motivo: string; ate: string; autor: string | null; origem: "tela" | "contrato" };

export type Achado = {
  id: string;
  projeto: ProjetoRef;
  regra: string;
  regraTitulo: string | null;
  regraDescricao: string | null;
  pacote: string | null;
  bloqueiaNoGate: boolean;
  severidade: Severidade;
  status: StatusAchado;
  herdado: boolean;
  titulo: string;
  detalhe: string | null;
  objeto: string;
  par: string | null;
  evidencia: Json;
  primeiroVisto: string;
  ultimoVisto: string;
  resolvidoEm: string | null;
  reaberturas: number;
  excecao: ExcecaoDoAchado | null;
};

export type DadosVisaoGeral = {
  agora: number;
  projetos: ResumoProjeto[];
  serie: PontoDiario[];
  propostas: Proposta[];
  novos: Achado[];
  gate: EventoGate[];
};

export type Coleta = {
  id: string;
  inicio: string;
  fim: string | null;
  status: "rodando" | "ok" | "erro";
  erro: string | null;
  modo: string | null;
  total: number;
  novos: number;
  alterados: number;
  removidos: number;
  avisos: string[];
  versaoMotor: string;
};

export type Fonte = {
  id: string;
  tipo: string;
  nome: string;
  config: Record<string, unknown>;
  ativa: boolean;
  temSegredo: boolean;
  ultima: Coleta | null;
  coletas: number;
};

export type DetalheProjeto = { agora: number; resumo: ResumoProjeto; fontes: Fonte[] };

export type Objeto = {
  id: string;
  fonte: { id: string; tipo: string; nome: string };
  tipo: string;
  chave: string;
  nome: string;
  pai: string | null;
  atributos: Record<string, unknown>;
  vistoDesde: string;
  alteradoEm: string | null;
  uso: { leituras: number; escritas: number; linhas: number | null; vazia: boolean | null } | null;
  versoes: { mudanca: string; criadoEm: string }[];
};

export type Relacao = { origem: string; destino: string; tipo: string; certeza: "exata" | "inferida"; evidencia: Json };

/** O que o contrato diz de cada ref (tabela, visão ou função). */
export type Declaracao = { papel?: string; primitiva?: string; nota?: string; escritorDe?: string; proposta?: string };

export type EstruturaProjeto = {
  agora: number;
  objetos: Objeto[];
  relacoes: Relacao[];
  achados: Achado[];
  declarados: Record<string, Declaracao>;
  contratoVersao: number | null;
};

export type SessaoAgente = {
  sessao: string;
  origem: string;
  inicio: string;
  fim: string;
  decisoes: Record<Decisao, number>;
  propostas: number;
};

export type DadosGate = { agora: number; eventos: EventoGate[]; propostas: Proposta[]; sessoes: SessaoAgente[] };

export type ContratoConteudo = {
  projeto?: string;
  versao?: number;
  escopo?: { schemas?: string[]; ignorar?: string[] };
  convencoes?: { colunas_genericas?: string[]; parametro_de_escopo?: string; validadores_de_escopo?: string[] };
  consumidores?: { n8n_tags?: string[]; credenciais?: string[]; papeis_do_banco?: string[] };
  primitivas?: Record<string, { descricao?: string; dona: string; vinculo?: string; escritores?: string[] }>;
  objetos?: Record<string, { declarado?: boolean; papel?: string; primitiva?: string; nota?: string; proposta?: string } | null>;
  regras?: { ligar?: string[]; desligar?: string[]; ajustar?: Record<string, Record<string, unknown>> };
  excecoes?: { regra: string; objetos: string[]; motivo: string; ate: string }[];
  agentes?: Record<string, AgenteDoContrato>;
};

export type VersaoContrato = { versao: number; autor: string; motivo: string; criadoEm: string };

export type ExcecaoTela = {
  id: string;
  regra: string;
  objeto: string;
  motivo: string;
  autor: string;
  validaAte: string;
  criadoEm: string;
  revogadaEm: string | null;
};

export type DadosContrato = {
  agora: number;
  atual: (VersaoContrato & { conteudo: ContratoConteudo }) | null;
  versoes: VersaoContrato[];
  propostas: Proposta[];
  excecoes: ExcecaoTela[];
  naoDeclarados: Achado[];
};

/** Monta o mapa ref → declaração do mesmo jeito que o motor (objetos + donos, vínculos e escritores das primitivas). */
export function declaracoesDoContrato(c: ContratoConteudo | null | undefined): Record<string, Declaracao> {
  const mapa: Record<string, Declaracao> = {};
  if (!c) return mapa;
  for (const [nome, p] of Object.entries(c.primitivas ?? {})) {
    for (const ref of [p.dona, p.vinculo].filter((r): r is string => Boolean(r))) mapa[ref] = { ...mapa[ref], primitiva: nome };
    for (const ref of p.escritores ?? []) mapa[ref] = { ...mapa[ref], escritorDe: nome };
  }
  for (const [ref, e] of Object.entries(c.objetos ?? {})) {
    if (e?.declarado === false) continue;
    mapa[ref] = { ...mapa[ref], ...(e?.papel && { papel: e.papel }), ...(e?.primitiva && { primitiva: e.primitiva }), ...(e?.nota && { nota: e.nota }), ...(e?.proposta && { proposta: e.proposta }) };
  }
  return mapa;
}

function declaracaoPelasFormas(declarados: Record<string, Declaracao>, k: string): Declaracao | undefined {
  let d: Declaracao | undefined;
  for (const forma of formasDaRef(k)) if (declarados[forma]) d = { ...d, ...declarados[forma] };
  return d;
}

/** O que o contrato diz do objeto, em qualquer forma que a ref foi escrita. Filhos herdam do pai (coluna, policy, índice…). */
export function declaracaoDe(declarados: Record<string, Declaracao>, o: Pick<Objeto, "chave" | "tipo" | "pai">): Declaracao | undefined {
  return declaracaoPelasFormas(declarados, o.chave) ?? (o.pai && TIPOS_FILHOS.has(o.tipo) ? declaracaoPelasFormas(declarados, o.pai) : undefined);
}

/* ─────────────────────── Agentes de IA (fase 2) ─────────────────────── */

/** Agente como o contrato declara (já validado pelo motor ao publicar). */
export type AgenteDoContrato = {
  workflow: string;
  node: string;
  escopo?: { coluna: string; valor: string | number };
  conversas?: { tabela: string; id?: string; contato: string; texto: string; momento: string; autor: { coluna: string; agente: string | number } };
  eventos?: {
    repasse?: { tabela: string; contato: string; momento: string };
    conversao?: { tabela: string; contato: string; momento: string; janela_dias?: number };
  };
  politicas?: { proibidas?: string[]; max_caracteres?: number; max_perguntas?: number };
  ensaio?: { parametro: string };
  metas?: { aprovacao_minima?: number; queda_maxima_pts?: number; repasse_maximo?: number; latencia_p95_ms?: number };
};

/** Chave do objeto agente (n8n:agente:<workflow>/<node>) para o agente declarado no contrato. */
export function chaveDoAgente(a: Pick<AgenteDoContrato, "workflow" | "node">) {
  return `n8n:agente:${a.workflow.replace(/^n8n:workflow:/, "")}/${a.node}`;
}

/** Nome do agente no contrato (atendimento, qualificacao…) pela chave do objeto. */
export function nomeNoContrato(c: ContratoConteudo | null | undefined, chave: string): string | null {
  for (const [nome, a] of Object.entries(c?.agentes ?? {})) if (a && chaveDoAgente(a) === chave) return nome;
  return null;
}

/**
 * Identificador do agente na URL. O nome do contrato quando declarado (escolhido pelo time e estável);
 * sem contrato, workflow e node em minúsculas (crm-04-atendente).
 */
export function idDoAgente(chave: string, contrato: string | null | undefined): string {
  if (contrato) return contrato;
  return chave
    .replace(/^n8n:agente:/, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type Criticidade = "critico" | "normal";
export type OrigemCaso = "conversa" | "achado" | "manual";
export const ORIGEM_CASO: Record<OrigemCaso, string> = { conversa: "Conversa real", achado: "Achado", manual: "Escrito à mão" };

export type StatusRodada = "pedida" | "rodando" | "concluida" | "erro" | "cancelada";
export const STATUS_RODADA: Record<StatusRodada, { label: string; status: Status }> = {
  pedida: { label: "Na fila", status: "maint" },
  rodando: { label: "Rodando", status: "warn" },
  concluida: { label: "Concluída", status: "ok" },
  erro: { label: "Erro", status: "crit" },
  cancelada: { label: "Cancelada", status: "maint" },
};
export const MOTIVO_RODADA: Record<string, string> = { gate: "pedida pelo gate", manual: "pedida na tela", publicacao: "depois da publicação" };

export type ToolDoAgente = {
  nome: string;
  node: string;
  tipo: string;
  descricao: string | null;
  argumentos: { nome: string; descricao: string; tipo: string }[];
  /** chaves do que a tool toca: tabelas, colunas, funções, rotas */
  alvos: string[];
  /** toolCode, MCP e afins: o Meraki não vê o que ela toca */
  opaca: boolean;
  desativada: boolean;
};

export type Rodada = {
  id: string;
  hash: string;
  motivo: string;
  status: StatusRodada;
  aprovacao: number | null;
  casos: number;
  passaram: number;
  criticosFalhos: string[];
  aprovada: boolean | null;
  executor: string | null;
  erro: string | null;
  pedidaPor: string | null;
  criadoEm: string;
  concluidaEm: string | null;
};

export type Checagem = { nome: string; passou: boolean; detalhe: string };

/** Resultado de um caso numa rodada. A resposta é do ensaio (entrada anonimizada), não conversa de cliente. */
export type ResultadoDoCaso = {
  rodada: string;
  slug: string;
  criticidade: Criticidade;
  casoHash: string;
  passou: boolean;
  checagens: Checagem[];
  tools: { nome: string; argumentos?: Record<string, unknown> }[];
  resposta: string | null;
  repasse: boolean | null;
  juiz: Json | null;
  duracaoMs: number | null;
};

export type EntradaDoCaso = {
  mensagem: string;
  contexto?: { data_hora?: string; ficha?: Record<string, unknown> };
  historico?: { autor: string; texto: string }[];
};

export type EsperaDoCaso = {
  /** ordem em que as tools devem ser chamadas; [] = nenhuma tool; ausente = não checa */
  tools?: string[];
  argumentos?: Record<string, Record<string, unknown>>;
  contem?: string[];
  nao_contem?: string[];
  repasse?: boolean;
};

export type Caso = {
  id: string;
  slug: string;
  criticidade: Criticidade;
  origem: OrigemCaso;
  ativo: boolean;
  hash: string;
  criadoEm: string;
  atualizadoEm: string;
  arquivadoEm: string | null;
  arquivadoMotivo: string | null;
  entrada: EntradaDoCaso;
  espera: EsperaDoCaso;
  rubrica: string | null;
  autor: string | null;
  motivo: string | null;
  versoes: number;
  /** fim da última rodada concluída em que o caso entrou */
  ultimaRodada: string | null;
};

export type Publicacao = {
  hash: string;
  versionId: string | null;
  inicio: string;
  /** a publicação aconteceu entre inicioMinimo e inicio: veio da coleta, a hora exata é incerta */
  inicioMinimo: string | null;
  fim: string | null;
  origem: "hook" | "coleta";
};

export type MetricaDiaria = {
  hash: string;
  dia: string;
  conversas: number;
  repasses: number;
  conversoes: number;
  violacoes: number;
  /** ids de mensagem (nunca o texto): a conversa é buscada ao vivo quando alguém abre */
  exemplos: string[];
  execucoes: number;
  erros: number;
  p50: number | null;
  p95: number | null;
  incerta: boolean;
};

export type AchadoDoRascunho = { regra: string; severidade: Severidade; titulo: string; detalhe: string | null; novo: boolean; bloqueia: boolean };

/** Produção somada num período (só agregados). */
export type Producao = { conversas: number; repasses: number; conversoes: number; violacoes: number; execucoes: number; erros: number; p95: number | null };

export type ResumoAgente = {
  chave: string;
  id: string;
  nome: string;
  contrato: string | null;
  workflow: { chave: string; id: string; nome: string; ativo: boolean };
  /** hash da versão publicada (null: workflow nunca publicado) */
  versao: string | null;
  /** hash do rascunho (o que o n8n roda nas avaliações) */
  rascunho: string | null;
  divergente: boolean;
  desativado: boolean;
  modelo: string | null;
  fallback: string | null;
  tools: number;
  publicacao: Publicacao | null;
  abertos: Contagem;
  pior: { regra: string; titulo: string; severidade: Severidade } | null;
  /** última rodada concluída da versão publicada e do rascunho (quando diverge) */
  rodadaPublicada: Rodada | null;
  rodadaRascunho: Rodada | null;
  rodadaEmCurso: Rodada | null;
  /** últimos 7 dias, versão publicada */
  producao: Producao | null;
  casos: { ativos: number; criticos: number; nuncaRodaram: number };
  metas: NonNullable<AgenteDoContrato["metas"]>;
  /** o contrato diz onde estão as conversas (sem isso não há produção) */
  conversasMapeadas: boolean;
};

export type DadosAgentesIA = { agora: number; agentes: ResumoAgente[]; contratoVersao: number | null };

export type DetalheAgente = {
  agora: number;
  projeto: { id: string; slug: string; nome: string };
  resumo: ResumoAgente;
  config: AgenteDoContrato | null;
  prompt: { sistema: string; entrada: string; tamanho: number; exemplos: number; leJson: boolean; hash: string } | null;
  /** tamanho do prompt a cada versão coletada, da mais antiga para a atual */
  promptHistorico: { tamanho: number; criadoEm: string }[];
  ferramentas: ToolDoAgente[];
  gatilhos: string[];
  entradaRamificada: boolean;
  avaliacaoNativa: boolean;
  desviaEnsaio: boolean;
  memoria: { node: string; tipo: string; tabela: string | null; sessao: string | null } | null;
  parser: { node: string; tipo: string } | null;
  /** objetos que as tools alcançam (existem no banco ou não) */
  alvos: { chave: string; tipo: string; nome: string; existe: boolean }[];
  achados: Achado[];
  rascunho: { hash: string; achados: AchadoDoRascunho[]; avaliadoEm: string } | null;
  casos: Caso[];
  rodadas: Rodada[];
  resultados: ResultadoDoCaso[];
  publicacoes: Publicacao[];
  metricas: MetricaDiaria[];
};

/** Conversa buscada ao vivo no banco do cliente (anonimizada pelo motor). Nunca é gravada. */
export type ConversaAoVivo = {
  agente: string;
  nome: string;
  versao: string | null;
  incerta: boolean;
  mensagens: { id: string; autor: string; texto: string; momento: string; destaque: boolean }[];
  anonimizados: number;
};

/** Mínimo de conversas por versão para comparar taxas (as regras P1 e P5 usam o mesmo corte). */
export const MINIMO_CONVERSAS = 50;

export const versaoCurta = (h: string | null | undefined) => (h ? h.slice(0, 8) : "—");

/** Alvo de uma tool no nível do fluxo: coluna vira a tabela; o resto fica como está. */
export function alvoDoFluxo(k: string): string {
  const m = /^pg:coluna:(.+)\.[^.]+$/.exec(k);
  return m ? `pg:tabela:${m[1]}` : k;
}

/** Chave sem a assinatura da função: a chamada por nome (fn(*)) e a sobrecarga coletada viram a mesma. */
export const semAssinatura = (k: string) => alvoDoFluxo(k).replace(/\(.*\)$/, "");

/**
 * Os mesmos recortes das regras de produção (motor/src/regras/producao.ts), para a tela e o achado mostrarem o
 * mesmo número. Dias de versão incerta (entre a publicação e a coleta que a viu) ficam fora de tudo que compara.
 */
export const daVersao = (ms: MetricaDiaria[], hash: string | null | undefined) => ms.filter((m) => m.hash === hash && !m.incerta);

/** Janela das regras P2–P4: a versão no ar, nos dias desde (agora − N dias) em UTC. Sem publicação, todas as versões. */
export function recentesDaVersao(ms: MetricaDiaria[], hash: string | null | undefined, agora: number, dias = 7) {
  const desde = new Date(agora - dias * 86_400_000).toISOString().slice(0, 10);
  return ms.filter((m) => m.dia >= desde && !m.incerta && (!hash || m.hash === hash));
}

/** Soma de produção num período. O p95 é a média dos p95 diários ponderada pelas execuções — o mesmo número da regra P4. */
export function somarProducao(lista: MetricaDiaria[]): Producao {
  let peso = 0;
  let acumulado = 0;
  for (const m of lista) {
    if (m.p95 !== null && m.execucoes > 0) {
      acumulado += m.p95 * m.execucoes;
      peso += m.execucoes;
    }
  }
  return {
    conversas: lista.reduce((s, m) => s + m.conversas, 0),
    repasses: lista.reduce((s, m) => s + m.repasses, 0),
    conversoes: lista.reduce((s, m) => s + m.conversoes, 0),
    violacoes: lista.reduce((s, m) => s + m.violacoes, 0),
    execucoes: lista.reduce((s, m) => s + m.execucoes, 0),
    erros: lista.reduce((s, m) => s + m.erros, 0),
    p95: peso ? Math.round(acumulado / peso) : null,
  };
}
