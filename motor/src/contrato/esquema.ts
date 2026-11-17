/**
 * Contrato: a intenção do projeto. YAML na mão de quem escreve, JSON versionado no banco da plataforma.
 * A cópia em .meraki/contrato.md é só leitura.
 */
import YAML from "yaml";
import { z } from "zod";

export const COLUNAS_GENERICAS_PADRAO = ["id", "tenant_id", "criado_em", "atualizado_em", "created_at", "updated_at"];
export const PACOTES_PADRAO = [
  "pacote:universal", "pacote:splinter", "pacote:estrutura", "pacote:cruzada", "pacote:n8n", "pacote:repo",
  "pacote:agente", "pacote:avaliacao", "pacote:producao",
];

const Primitiva = z.object({
  descricao: z.string().optional(),
  dona: z.string(),
  vinculo: z.string().optional(),
  escritores: z.array(z.string()).default([]),
});

const ObjetoDeclarado = z
  .object({
    declarado: z.boolean().optional(),
    papel: z.string().optional(),
    primitiva: z.string().optional(),
    nota: z.string().optional(),
    opcional_por_design: z.boolean().optional(),
    proposta: z.string().optional(),
  })
  .passthrough();

const data = z.union([z.string(), z.date()]).transform((v) => (typeof v === "string" ? v : v.toISOString().slice(0, 10)));

const Excecao = z.object({
  regra: z.string(),
  objetos: z.array(z.string()).min(1),
  motivo: z.string().min(1, "exceção precisa de motivo"),
  ate: data,
});

/* ── Agentes (fase 2): o contrato de comportamento de cada agente de IA ── */

/** Identificador SQL simples: entra no SQL gerado pelo motor, então só letras, números e "_". */
const Ident = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "use só letras, números e _ (identificador SQL)");
const RefTabela = z.string().regex(/^([A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*$/, "use schema.tabela");
const ValorSql = z.union([z.string(), z.number(), z.boolean()]);

const Evento = z.object({
  tabela: RefTabela,
  contato: Ident,
  momento: Ident,
  janela_dias: z.number().int().min(1).max(90).optional(),
});

const Agente = z.object({
  workflow: z.string().min(1).transform((v) => (v.startsWith("n8n:workflow:") ? v : `n8n:workflow:${v}`)),
  node: z.string().min(1),
  escopo: z.object({ coluna: Ident, valor: ValorSql }).optional(),
  conversas: z
    .object({
      tabela: RefTabela,
      id: Ident.default("id"),
      contato: Ident,
      texto: Ident,
      momento: Ident,
      autor: z.object({ coluna: Ident, agente: ValorSql }),
    })
    .optional(),
  eventos: z.object({ repasse: Evento.optional(), conversao: Evento.optional() }).prefault({}),
  politicas: z
    .object({
      proibidas: z.array(z.string().min(1)).default([]),
      max_caracteres: z.number().int().positive().optional(),
      max_perguntas: z.number().int().min(0).optional(),
    })
    .prefault({}),
  ensaio: z.object({ parametro: Ident }).optional(),
  avaliacao: z.object({ workflow: z.string().min(1).optional() }).optional(),
  metas: z
    .object({
      aprovacao_minima: z.number().min(0).max(1).default(0.9),
      queda_maxima_pts: z.number().min(0).max(100).default(5),
      repasse_maximo: z.number().min(0).max(1).optional(),
      latencia_p95_ms: z.number().positive().optional(),
    })
    .prefault({}),
});

export type AgenteDoContrato = z.infer<typeof Agente>;

export const EsquemaContrato = z.object({
  projeto: z.string(),
  versao: z.number().int().min(0).default(0),
  escopo: z
    .object({
      schemas: z.array(z.string()).default(["public"]),
      ignorar: z.array(z.string()).default([]),
    })
    .prefault({}),
  convencoes: z
    .object({
      colunas_genericas: z.array(z.string()).default(COLUNAS_GENERICAS_PADRAO),
      parametro_de_escopo: z.string().optional(),
      validadores_de_escopo: z.array(z.string()).default([]),
    })
    .prefault({}),
  consumidores: z
    .object({
      n8n_tags: z.array(z.string()).default([]),
      credenciais: z.array(z.string()).default([]),
      papeis_do_banco: z.array(z.string()).default([]),
    })
    .prefault({}),
  primitivas: z.record(z.string(), Primitiva).default({}),
  objetos: z
    .record(z.string(), ObjetoDeclarado.nullable())
    .default({})
    .transform((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v ?? {}]))),
  regras: z
    .object({
      ligar: z.array(z.string()).default(PACOTES_PADRAO),
      desligar: z.array(z.string()).default([]),
      ajustar: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
    })
    .prefault({}),
  agentes: z.record(z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, "nome de agente: minúsculas, números, - e _"), Agente).default({}),
  excecoes: z.array(Excecao).default([]),
});

export type Contrato = z.infer<typeof EsquemaContrato>;
export type EntradaDeObjeto = z.infer<typeof ObjetoDeclarado>;

export function validarContrato(valor: unknown): Contrato {
  const r = EsquemaContrato.safeParse(valor);
  if (!r.success) {
    const problemas = r.error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`).join("; ");
    throw new Error(`contrato inválido — ${problemas}`);
  }
  return r.data;
}

export function lerContratoYaml(texto: string): Contrato {
  return validarContrato(YAML.parse(texto));
}

export function contratoVazio(projeto: string): Contrato {
  return validarContrato({ projeto, versao: 0 });
}

const ORDEM = ["projeto", "versao", "escopo", "convencoes", "consumidores", "primitivas", "objetos", "agentes", "regras", "excecoes"];

/** YAML na ordem do formato, sem campos vazios de ruído. */
export function contratoParaYaml(c: Contrato, cabecalho?: string): string {
  const ordenado: Record<string, unknown> = {};
  for (const k of ORDEM) {
    const v = (c as Record<string, unknown>)[k];
    if (v === undefined) continue;
    if (k === "excecoes" && Array.isArray(v) && !v.length) continue;
    if (k === "agentes" && v && typeof v === "object" && !Object.keys(v).length) continue;
    ordenado[k] = v;
  }
  for (const [k, v] of Object.entries(c)) if (!ORDEM.includes(k)) ordenado[k] = v;
  const corpo = YAML.stringify(ordenado, { lineWidth: 0, defaultStringType: "PLAIN", flowCollectionPadding: false });
  return cabecalho ? `${cabecalho.split("\n").map((l) => `# ${l}`.trimEnd()).join("\n")}\n${corpo}` : corpo;
}
