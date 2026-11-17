import { createHash } from "node:crypto";

/** JSON canônico: chaves ordenadas em todos os níveis, sem undefined. Arrays mantêm a ordem. */
export function jsonCanonico(valor: unknown): string {
  return JSON.stringify(ordenar(valor));
}

function ordenar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenar);
  if (valor && typeof valor === "object" && !(valor instanceof Date)) {
    const saida: Record<string, unknown> = {};
    for (const chave of Object.keys(valor).sort()) {
      const v = (valor as Record<string, unknown>)[chave];
      if (v !== undefined) saida[chave] = ordenar(v);
    }
    return saida;
  }
  return valor;
}

export function sha256(texto: string): string {
  return createHash("sha256").update(texto).digest("hex");
}

/** Campos que mudam sem mudança real de estrutura. Nunca entram no hash. */
const VOLATEIS = new Set(["linhas_estimadas", "usos", "leituras", "escritas", "visto_em", "coletado_em"]);

/** Hash do objeto: sha256 do JSON canônico dos atributos, sem campos voláteis. */
export function hashAtributos(atributos: Record<string, unknown>): string {
  const estaveis: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(atributos)) if (!VOLATEIS.has(k)) estaveis[k] = v;
  return sha256(jsonCanonico(estaveis));
}
