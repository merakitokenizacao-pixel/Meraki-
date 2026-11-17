// Gerado por `meraki tipos` a partir do banco da plataforma. Não edite à mão.
export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export interface Achados {
  id: string;
  conta_id: string;
  projeto_id: string;
  regra: string;
  objeto_chave: string;
  par_chave: string | null;
  chave_dedupe: string;
  severidade: string;
  status: string;
  herdado: boolean;
  titulo: string;
  detalhe: string | null;
  evidencia: Json;
  primeiro_visto: string;
  ultimo_visto: string;
  resolvido_em: string | null;
  reaberturas: number;
  coleta_id: string | null;
}

export interface AgenteMetricasDiarias {
  conta_id: string;
  projeto_id: string;
  agente: string;
  hash: string;
  dia: string;
  conversas: number;
  repasses: number;
  conversoes: number;
  violacoes: number;
  violacoes_exemplos: string[];
  execucoes: number;
  erros: number;
  latencia_p50_ms: number | null;
  latencia_p95_ms: number | null;
  tokens: number | null;
  versao_incerta: boolean;
  atualizado_em: string;
}

export interface AgentePublicacoes {
  id: string;
  conta_id: string;
  projeto_id: string;
  agente: string;
  hash: string;
  version_id: string | null;
  inicio: string;
  inicio_minimo: string | null;
  fim: string | null;
  origem_hora: string;
  criado_em: string;
}

export interface AgenteRascunhos {
  conta_id: string;
  projeto_id: string;
  agente: string;
  hash: string;
  achados: Json;
  avaliado_em: string;
}

export interface CasoVersoes {
  id: string;
  conta_id: string;
  caso_id: string;
  hash: string;
  entrada: Json;
  espera: Json;
  rubrica: string | null;
  autor: string;
  motivo: string;
  criado_em: string;
}

export interface Casos {
  id: string;
  conta_id: string;
  projeto_id: string;
  agente: string;
  slug: string;
  criticidade: string;
  origem: string;
  ativo: boolean;
  hash_atual: string;
  criado_em: string;
  atualizado_em: string;
  arquivado_em: string | null;
  arquivado_motivo: string | null;
}

export interface Coletas {
  id: string;
  conta_id: string;
  fonte_id: string;
  inicio: string;
  fim: string | null;
  status: string;
  erro: string | null;
  versao_motor: string;
  modo: string | null;
  total: number;
  novos: number;
  alterados: number;
  removidos: number;
  avisos: string[];
}

export interface Contas {
  id: string;
  nome: string;
  criado_em: string;
}

export interface Contratos {
  id: string;
  conta_id: string;
  projeto_id: string;
  versao: number;
  conteudo: Json;
  autor: string;
  motivo: string;
  criado_em: string;
}

export interface Excecoes {
  id: string;
  conta_id: string;
  projeto_id: string;
  regra: string;
  objeto_chave: string;
  motivo: string;
  autor: string;
  valida_ate: string;
  criado_em: string;
  revogada_em: string | null;
}

export interface Fontes {
  id: string;
  conta_id: string;
  projeto_id: string;
  tipo: string;
  nome: string;
  config: Json;
  segredo_id: string | null;
  ativa: boolean;
  criado_em: string;
}

export interface GateEventos {
  id: string;
  conta_id: string;
  projeto_id: string;
  criado_em: string;
  origem: string;
  sessao: string | null;
  ferramenta: string;
  modo: string | null;
  resumo: string;
  decisao: string;
  regras: string[];
  motivo: string | null;
  proposta_id: string | null;
  duracao_ms: number | null;
}

export interface Membros {
  conta_id: string;
  usuario_id: string;
  nome: string | null;
  papel: string;
  criado_em: string;
}

export interface MetricasDiarias {
  conta_id: string;
  projeto_id: string;
  dia: string;
  objetos: number;
  avaliados: number;
  declarados: number;
  cobertura: number | null;
  critico: number;
  alto: number;
  medio: number;
  baixo: number;
  novos_critico_alto: number;
  herdados_abertos: number;
  excecoes_ativas: number;
  drift: number;
  gate_permitiu: number;
  gate_perguntou: number;
  gate_negou: number;
  coletas_ok: number;
  coletas_erro: number;
  saude: number | null;
  atualizado_em: string;
}

export interface ObjetoVersoes {
  id: number;
  conta_id: string;
  objeto_id: string;
  coleta_id: string;
  hash: string;
  atributos: Json | null;
  mudanca: string;
  criado_em: string;
}

export interface Objetos {
  id: string;
  conta_id: string;
  fonte_id: string;
  tipo: string;
  chave: string;
  nome: string;
  pai_chave: string | null;
  atributos: Json;
  hash: string;
  visto_desde: string;
  alterado_em: string | null;
  removido_em: string | null;
}

export interface Projetos {
  id: string;
  conta_id: string;
  slug: string;
  nome: string;
  descricao: string | null;
  cor: string | null;
  criado_em: string;
}

export interface Propostas {
  id: string;
  conta_id: string;
  projeto_id: string;
  origem: string;
  sessao: string | null;
  tipo: string;
  payload: Json;
  justificativa: string;
  status: string;
  decisao_motivo: string | null;
  decidido_por: string | null;
  decidido_em: string | null;
  contrato_versao: number | null;
  criado_em: string;
}

export interface Regras {
  id: string;
  conta_id: string;
  codigo: string;
  pacote: string;
  titulo: string;
  descricao: string | null;
  alvo: string;
  severidade_padrao: string;
  bloqueia_no_gate: boolean;
  versao: number;
}

export interface Relacoes {
  id: string;
  conta_id: string;
  fonte_id: string;
  origem_chave: string;
  destino_chave: string;
  tipo: string;
  evidencia: Json;
  certeza: string;
  visto_desde: string;
  removido_em: string | null;
}

export interface RodadaCasos {
  id: string;
  conta_id: string;
  rodada_id: string;
  caso_id: string | null;
  slug: string;
  criticidade: string;
  caso_hash: string;
  passou: boolean;
  checagens: Json;
  tools_chamadas: Json;
  resposta: string | null;
  repasse: boolean | null;
  juiz: Json | null;
  duracao_ms: number | null;
}

export interface Rodadas {
  id: string;
  conta_id: string;
  projeto_id: string;
  agente: string;
  hash: string;
  n8n_id: string | null;
  motivo: string;
  status: string;
  aprovacao: number | null;
  casos: number;
  passaram: number;
  criticos_falhos: string[];
  aprovada: boolean | null;
  executor: string | null;
  erro: string | null;
  pedida_por: string | null;
  criado_em: string;
  iniciada_em: string | null;
  concluida_em: string | null;
}

export interface UsoDiario {
  conta_id: string;
  objeto_id: string;
  dia: string;
  origem: string;
  leituras: number;
  escritas: number;
  linhas: number | null;
  vazia: boolean | null;
  base_leituras: number | null;
  base_escritas: number | null;
  atualizado_em: string;
}
