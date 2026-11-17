import type { Coletor, TipoFonte } from "../tipos.ts";
import { coletorN8n } from "./n8n.ts";
import { coletorPostgres } from "./postgres.ts";
import { coletorRepo } from "./repo.ts";

/** Um coletor por tipo de fonte. Nada aqui conhece projeto: a fonte traz a configuração. */
const COLETORES: Coletor[] = [coletorPostgres, coletorN8n, coletorRepo];

export function coletorPara(tipo: TipoFonte): Coletor {
  const c = COLETORES.find((x) => x.tipos.includes(tipo));
  if (!c) throw new Error(`sem coletor para fontes do tipo ${tipo}`);
  return c;
}
