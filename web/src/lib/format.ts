const cache = new Map<string, Intl.NumberFormat>();

function nf(key: string, options: Intl.NumberFormatOptions) {
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("pt-BR", options);
    cache.set(key, f);
  }
  return f;
}

export const fmtInt = (n: number) => nf("int", { maximumFractionDigits: 0 }).format(n);

export const fmtDec = (n: number, d = 1) =>
  nf(`dec${d}`, { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);

export const fmtPct = (n: number, d = 1) => `${fmtDec(n, d)}%`;

export const fmtCompact = (n: number) =>
  nf("compact", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export const fmtBRL = (n: number, d = 2) =>
  nf(`brl${d}`, {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);

export function fmtMs(ms: number) {
  if (ms >= 1000) return `${fmtDec(ms / 1000, ms >= 10000 ? 0 : 1)} s`;
  if (ms < 10) return `${fmtDec(ms, 1)} ms`;
  return `${fmtInt(ms)} ms`;
}

export function fmtSigned(n: number, d = 1) {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${fmtDec(Math.abs(n), d)}`;
}
