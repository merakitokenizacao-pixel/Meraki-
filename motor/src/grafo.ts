/**
 * Grafo normalizado de um projeto: objetos de todas as fontes, relações e uso por dia.
 * É a única entrada das regras — elas não falam com rede nem com banco.
 */
import type { Objeto, Relacao, TipoFonte } from "./tipos.ts";

export interface NoGrafo extends Objeto {
  fonteId: string;
  fonteTipo: TipoFonte;
  vistoDesde?: string;
  alteradoEm?: string | null;
}

export interface UsoDoDia {
  dia: string;
  origem: string;
  leituras: number;
  escritas: number;
  linhas: number | null;
  vazia: boolean | null;
}

export interface FonteDoGrafo {
  id: string;
  tipo: TipoFonte;
  nome: string;
  config: Record<string, unknown>;
  modo?: string | null;
}

export class Grafo {
  readonly objetos = new Map<string, NoGrafo>();
  readonly relacoes: Relacao[];
  readonly fontes: Map<string, FonteDoGrafo>;
  readonly uso: Map<string, UsoDoDia[]>;
  private readonly saindoIdx = new Map<string, Relacao[]>();
  private readonly entrandoIdx = new Map<string, Relacao[]>();
  private readonly filhosIdx = new Map<string, NoGrafo[]>();

  constructor(objetos: NoGrafo[], relacoes: Relacao[], fontes: FonteDoGrafo[], uso: Map<string, UsoDoDia[]> = new Map()) {
    for (const o of objetos) this.objetos.set(o.chave, o);
    this.fontes = new Map(fontes.map((f) => [f.id, f]));
    this.uso = uso;
    this.relacoes = this.resolver(relacoes);
    for (const r of this.relacoes) {
      empilhar(this.saindoIdx, r.origem, r);
      empilhar(this.entrandoIdx, r.destino, r);
    }
    for (const o of objetos) if (o.pai) empilhar(this.filhosIdx, o.pai, o);
  }

  /**
   * Relações por nome viram chaves reais: pg:funcao:public.f(*) → cada sobrecarga existente,
   * pg:tabela:public.v → pg:visao:public.v quando é uma visão. Sem alvo, a relação fica como está (X01).
   */
  private resolver(relacoes: Relacao[]): Relacao[] {
    const funcoes = new Map<string, string[]>();
    for (const k of this.objetos.keys()) {
      if (!k.startsWith("pg:funcao:")) continue;
      const nome = k.slice(0, k.indexOf("("));
      empilhar(funcoes, nome, k);
    }
    const saida: Relacao[] = [];
    const vistas = new Set<string>();
    const add = (r: Relacao) => {
      const id = `${r.origem}→${r.destino}:${r.tipo}`;
      if (vistas.has(id)) return;
      vistas.add(id);
      saida.push(r);
    };
    for (const r of relacoes) {
      if (r.destino.endsWith("(*)")) {
        const alvos = funcoes.get(r.destino.slice(0, -3)) ?? [];
        if (!alvos.length) add(r);
        for (const a of alvos) add({ ...r, destino: a, certeza: alvos.length === 1 ? r.certeza : "inferida" });
        continue;
      }
      if (r.destino.startsWith("pg:tabela:") && !this.objetos.has(r.destino)) {
        const visao = r.destino.replace("pg:tabela:", "pg:visao:");
        if (this.objetos.has(visao)) {
          add({ ...r, destino: visao });
          continue;
        }
      }
      add(r);
    }
    return saida;
  }

  get(k: string): NoGrafo | undefined {
    return this.objetos.get(k);
  }

  tem(k: string): boolean {
    return this.objetos.has(k);
  }

  porTipo(tipo: string): NoGrafo[] {
    return [...this.objetos.values()].filter((o) => o.tipo === tipo);
  }

  saindo(k: string, tipo?: string): Relacao[] {
    const l = this.saindoIdx.get(k) ?? [];
    return tipo ? l.filter((r) => r.tipo === tipo) : l;
  }

  entrando(k: string, tipo?: string): Relacao[] {
    const l = this.entrandoIdx.get(k) ?? [];
    return tipo ? l.filter((r) => r.tipo === tipo) : l;
  }

  filhos(k: string, tipo?: string): NoGrafo[] {
    const l = this.filhosIdx.get(k) ?? [];
    return tipo ? l.filter((o) => o.tipo === tipo) : l;
  }

  fonteDe(k: string): FonteDoGrafo | undefined {
    const o = this.objetos.get(k);
    return o ? this.fontes.get(o.fonteId) : undefined;
  }

  /** Último uso observado de uma origem (ex.: pg_stat_user_tables). */
  ultimoUso(k: string, origem: string): UsoDoDia | undefined {
    const dias = (this.uso.get(k) ?? []).filter((u) => u.origem === origem);
    return dias[dias.length - 1];
  }

  usoDe(k: string, origem: string): UsoDoDia[] {
    return (this.uso.get(k) ?? []).filter((u) => u.origem === origem);
  }

  /** Há fonte do tipo pg (postgres/supabase) que coleta este schema? */
  coletaSchema(schema: string): boolean {
    for (const f of this.fontes.values()) {
      if (f.tipo !== "postgres" && f.tipo !== "supabase") continue;
      const schemas = (f.config.schemas as string[] | undefined) ?? ["public"];
      if (schemas.includes(schema)) return true;
    }
    return false;
  }

  temFonte(tipo: TipoFonte | TipoFonte[]): boolean {
    const tipos = Array.isArray(tipo) ? tipo : [tipo];
    return [...this.fontes.values()].some((f) => tipos.includes(f.tipo));
  }
}

function empilhar<K, V>(mapa: Map<K, V[]>, k: K, v: V) {
  const l = mapa.get(k);
  if (l) l.push(v);
  else mapa.set(k, [v]);
}
