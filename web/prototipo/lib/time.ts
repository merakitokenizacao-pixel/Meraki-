export type RangeKey = "1h" | "24h" | "7d" | "30d";

export const RANGES: Record<
  RangeKey,
  { label: string; points: number; step: number; compare: string; window: string }
> = {
  "1h": { label: "Última hora", points: 60, step: 1, compare: "vs. hora anterior", window: "1 hora" },
  "24h": { label: "Últimas 24 horas", points: 48, step: 30, compare: "vs. ontem", window: "24 horas" },
  "7d": { label: "Últimos 7 dias", points: 56, step: 180, compare: "vs. semana anterior", window: "7 dias" },
  "30d": { label: "Últimos 30 dias", points: 30, step: 1440, compare: "vs. mês anterior", window: "30 dias" },
};

export const RANGE_KEYS: RangeKey[] = ["1h", "24h", "7d", "30d"];

/** "Agora" fictício e determinístico do protótipo: domingo, 15/11/2026, 15:42. */
export const NOW = { day: 15, month: 11, year: 2026, hour: 15, minute: 42 };
const NOW_MOD = NOW.hour * 60 + NOW.minute;

const pad = (n: number) => String(n).padStart(2, "0");

export function stamp(minutesAgo: number) {
  const abs = NOW_MOD - minutesAgo;
  const dayOffset = Math.floor(abs / 1440);
  const mod = abs - dayOffset * 1440;
  let d = NOW.day + dayOffset;
  let mo = NOW.month;
  if (d <= 0) {
    d += 31;
    mo = 10;
  }
  return { d, mo, hh: Math.floor(mod / 60), mm: mod % 60, dayOffset };
}

export function offsetFor(range: RangeKey) {
  const step = RANGES[range].step;
  return step >= 1440 ? 0 : NOW_MOD % step;
}

export function minutesAgoAt(range: RangeKey, i: number) {
  const r = RANGES[range];
  return (r.points - 1 - i) * r.step + offsetFor(range);
}

export function axisLabels(range: RangeKey): string[] {
  const r = RANGES[range];
  return Array.from({ length: r.points }, (_, i) => {
    const s = stamp(minutesAgoAt(range, i));
    if (range === "7d") return `${pad(s.d)}/${pad(s.mo)} ${pad(s.hh)}h`;
    if (range === "30d") return `${pad(s.d)}/${pad(s.mo)}`;
    return `${pad(s.hh)}:${pad(s.mm)}`;
  });
}

/** Índice do ponto mais próximo de um evento ocorrido há `minutesAgo`; -1 se fora da janela. */
export function indexFor(range: RangeKey, minutesAgo: number) {
  const r = RANGES[range];
  const idx = Math.round(r.points - 1 - (minutesAgo - offsetFor(range)) / r.step);
  return idx < 0 || idx > r.points - 1 ? -1 : idx;
}

export function relTime(m: number) {
  if (m < 1) return "agora";
  if (m < 60) return `há ${Math.round(m)} min`;
  if (m < 1440) {
    const h = Math.floor(m / 60);
    const mm = Math.round(m % 60);
    return mm ? `há ${h} h ${mm} min` : `há ${h} h`;
  }
  const d = Math.floor(m / 1440);
  return d === 1 ? "há 1 dia" : `há ${d} dias`;
}

export function clockTime(m: number) {
  const s = stamp(m);
  return `${pad(s.hh)}:${pad(s.mm)}`;
}

export function when(m: number) {
  const s = stamp(m);
  const t = `${pad(s.hh)}:${pad(s.mm)}`;
  if (s.dayOffset === 0) return `hoje, ${t}`;
  if (s.dayOffset === -1) return `ontem, ${t}`;
  return `${pad(s.d)}/${pad(s.mo)}, ${t}`;
}

export function shortDate(m: number) {
  const s = stamp(m);
  return `${pad(s.d)}/${pad(s.mo)}`;
}

export function durationLabel(m: number) {
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  if (h < 24) return mm ? `${h} h ${mm} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh ? `${d} d ${hh} h` : `${d} d`;
}

export const TODAY_LONG = "Domingo, 15 de novembro";
