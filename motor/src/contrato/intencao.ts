/**
 * Intenção resolvida: o contrato aplicado ao grafo.
 * Responde "está declarado?", "de que primitiva é?", "quem pode escrever?", "a regra está ligada?", "tem exceção?".
 */
import { chave, nomeDaFuncao, partes, refCurta, schemaDe } from "../chaves.ts";
import type { Grafo } from "../grafo.ts";
import type { AgenteDoContrato, Contrato, EntradaDeObjeto } from "./esquema.ts";

export interface ExcecaoAtiva {
  regra: string;
  objeto: string;
  motivo: string;
  ate: string;
  origem: "contrato" | "tela";
  autor?: string;
}

export interface RegraConfiguravel {
  codigo: string;
  pacote: string;
}

export class Intencao {
  readonly contrato: Contrato;
  private readonly grafo: Grafo;
  private readonly excecoesTela: ExcecaoAtiva[];
  private readonly primitivaPorChave = new Map<string, string>();
  private readonly declaradas = new Set<string>();

  constructor(contrato: Contrato, grafo: Grafo, excecoesTela: ExcecaoAtiva[] = []) {
    this.contrato = contrato;
    this.grafo = grafo;
    this.excecoesTela = excecoesTela;
    for (const [nome, p] of Object.entries(contrato.primitivas)) {
      for (const ref of [p.dona, p.vinculo].filter(Boolean) as string[]) {
        for (const k of this.chavesDe(ref)) {
          this.primitivaPorChave.set(k, nome);
          this.declaradas.add(k);
        }
      }
      for (const ref of p.escritores) for (const k of this.chavesDe(ref)) this.declaradas.add(k);
    }
    for (const [ref, entrada] of Object.entries(contrato.objetos)) {
      if (entrada.declarado === false) continue;
      for (const k of this.chavesDe(ref)) {
        this.declaradas.add(k);
        if (entrada.primitiva) this.primitivaPorChave.set(k, entrada.primitiva);
      }
    }
  }

  /** public.x → tabela ou visão · public.x.y → coluna · fn:public.f → todas as sobrecargas · chave completa → ela mesma. */
  chavesDe(ref: string): string[] {
    if (/^(pg|n8n|repo|sb):/.test(ref)) {
      if (ref.endsWith("(*)")) return [...this.grafo.objetos.keys()].filter((k) => k.startsWith(ref.slice(0, -2)));
      return [ref];
    }
    if (ref.startsWith("fn:")) {
      const nome = ref.slice(3).includes(".") ? ref.slice(3) : `public.${ref.slice(3)}`;
      const achadas = [...this.grafo.objetos.keys()].filter((k) => k.startsWith(`pg:funcao:${nome}(`));
      return achadas.length ? achadas : [chave.funcaoPorNome(...dividir(nome))];
    }
    const pedacos = ref.split(".");
    if (pedacos.length === 1) pedacos.unshift("public");
    if (pedacos.length === 2) {
      const [s, n] = pedacos;
      const visao = chave.visao(s, n);
      if (this.grafo.tem(visao)) return [visao];
      const funcoes = [...this.grafo.objetos.keys()].filter((k) => k.startsWith(`pg:funcao:${s}.${n}(`));
      if (funcoes.length && !this.grafo.tem(chave.tabela(s, n))) return funcoes;
      return [chave.tabela(s, n)];
    }
    const [s, t, c] = pedacos;
    return [chave.coluna(s, t, c)];
  }

  /** Entrada do contrato para o objeto (pelo ref curto ou pela chave). */
  entrada(k: string): EntradaDeObjeto | undefined {
    const o = this.contrato.objetos;
    const curta = refCurta(k);
    return o[k] ?? o[curta] ?? (curta.startsWith("fn:") ? o[curta.slice(3)] : undefined);
  }

  ignorado(k: string): boolean {
    const schema = schemaDe(k);
    if (schema && !this.contrato.escopo.schemas.includes(schema)) return true;
    const curta = refCurta(k).replace(/^fn:/, "");
    const nome = curta.split(".").slice(1).join(".") || curta;
    return this.contrato.escopo.ignorar.some((padrao) => casa(padrao, curta) || casa(padrao, nome));
  }

  declarado(k: string): boolean {
    if (this.declaradas.has(k)) return true;
    const o = this.grafo.get(k);
    if (o?.pai && ["coluna", "constraint", "indice", "policy", "gatilho"].includes(o.tipo)) return this.declarado(o.pai);
    return false;
  }

  primitivaDe(k: string): string | undefined {
    return this.primitivaPorChave.get(k) ?? this.entrada(k)?.primitiva;
  }

  opcionalPorDesign(k: string): boolean {
    return Boolean(this.entrada(k)?.opcional_por_design);
  }

  /** Escritores permitidos da tabela dona de uma primitiva (chaves de função). Nulo se a tabela não é dona. */
  escritoresDe(tabela: string): { primitiva: string; escritores: Set<string> } | null {
    for (const [nome, p] of Object.entries(this.contrato.primitivas)) {
      if (!this.chavesDe(p.dona).includes(tabela) || !p.escritores.length) continue;
      return { primitiva: nome, escritores: new Set(p.escritores.flatMap((e) => this.chavesDe(e))) };
    }
    return null;
  }

  regraLigada(regra: RegraConfiguravel): boolean {
    const { ligar, desligar } = this.contrato.regras;
    if (desligar.includes(regra.codigo) || desligar.includes(`pacote:${regra.pacote}`)) return false;
    return ligar.includes(regra.codigo) || ligar.includes(`pacote:${regra.pacote}`);
  }

  ajuste(codigo: string): Record<string, unknown> {
    return this.contrato.regras.ajustar[codigo] ?? {};
  }

  /**
   * Exceção ativa (contrato ou tela) para o achado. Exceção de um objeto vale para todo achado da regra que o
   * envolva. Com dois ou mais, a lista nomeia o par (ou o grupo): o achado só sai se todos os objetos dele estiverem
   * nela — a exceção do par A×B não cobre o B×C.
   */
  excecao(regra: string, objetos: (string | undefined)[], agora: Date): ExcecaoAtiva | undefined {
    const hoje = agora.toISOString().slice(0, 10);
    const alvos = objetos.filter(Boolean) as string[];
    for (const e of this.contrato.excecoes) {
      if (e.regra !== regra || e.ate < hoje) continue;
      const chaves = new Set(e.objetos.flatMap((r) => this.chavesDe(r)));
      const cobre = e.objetos.length > 1 ? alvos.length > 0 && alvos.every((a) => chaves.has(a)) : alvos.some((a) => chaves.has(a));
      if (cobre) {
        return { regra, objeto: alvos[0], motivo: e.motivo, ate: e.ate, origem: "contrato" };
      }
    }
    return this.excecoesTela.find((e) => e.regra === regra && alvos.includes(e.objeto) && e.ate >= hoje);
  }

  /** Agente declarado no contrato para a chave do objeto agente (n8n:agente:wf/node). */
  agenteDe(k: string): { nome: string; config: AgenteDoContrato } | undefined {
    for (const [nome, config] of Object.entries(this.contrato.agentes ?? {})) {
      if (`n8n:agente:${config.workflow.slice("n8n:workflow:".length)}/${config.node}` === k) return { nome, config };
    }
    return undefined;
  }

  /** Validadores de escopo como nomes qualificados (public.tenant_valido). */
  validadores(): Set<string> {
    return new Set(this.contrato.convencoes.validadores_de_escopo.map((v) => (v.replace(/^fn:/, "").includes(".") ? v.replace(/^fn:/, "") : `public.${v.replace(/^fn:/, "")}`)));
  }

  ehValidador(k: string): boolean {
    return partes(k).tipo === "funcao" && this.validadores().has(nomeDaFuncao(k));
  }
}

function dividir(ref: string): [string, string] {
  const i = ref.indexOf(".");
  return i < 0 ? ["public", ref] : [ref.slice(0, i), ref.slice(i + 1)];
}

function casa(padrao: string, valor: string): boolean {
  if (!padrao.includes("*")) return padrao === valor;
  const re = new RegExp(`^${padrao.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return re.test(valor);
}
