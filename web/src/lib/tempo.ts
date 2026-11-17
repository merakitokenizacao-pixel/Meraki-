/**
 * Datas vindas da plataforma (ISO 8601). O fuso é fixo para o servidor e o navegador escreverem o mesmo texto,
 * e o "agora" vem do servidor junto com os dados (nada de Date.now() na renderização).
 */
const FUSO = "America/Sao_Paulo";
const cache = new Map<string, Intl.DateTimeFormat>();

function df(key: string, options: Intl.DateTimeFormatOptions) {
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, ...options });
    cache.set(key, f);
  }
  return f;
}

/** 16/11, 13:47 */
export function dataHora(iso: string) {
  return df("dh", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** 16/11/2026 */
export function dataCurta(iso: string) {
  return df("d", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}

/** Dia sem hora (coluna `date`, "2026-11-16") → 16/11. */
export function diaCurto(dia: string) {
  const [, m, d] = dia.split("-");
  return `${d}/${m}`;
}

/** Dia sem hora → 01/03/2027. */
export function diaLongo(dia: string) {
  const [a, m, d] = dia.split("-");
  return `${d}/${m}/${a}`;
}

/** "há 5 min", "há 3 h", "há 2 dias"; acima de 30 dias, a data. */
export function relativo(iso: string | null | undefined, agora: number) {
  if (!iso) return "—";
  const min = (agora - Date.parse(iso)) / 60_000;
  if (min < 1) return "agora";
  if (min < 60) return `há ${Math.floor(min)} min`;
  const h = min / 60;
  if (h < 24) return `há ${Math.floor(h)} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return d === 1 ? "há 1 dia" : `há ${d} dias`;
  return dataCurta(iso);
}

/** Dias inteiros até uma data (coluna `date`). Negativo = já passou. */
export function diasAte(dia: string, agora: number) {
  const alvo = Date.parse(`${dia}T23:59:59-03:00`);
  return Math.floor((alvo - agora) / 86_400_000);
}

/** Data de hoje + n dias no fuso fixo, no formato da coluna `date`. */
export function diaMais(agora: number, n: number) {
  const partes = df("iso", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(agora + n * 86_400_000));
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")}`;
}
