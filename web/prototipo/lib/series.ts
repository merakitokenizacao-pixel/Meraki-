import { RANGES, minutesAgoAt, stamp, type RangeKey } from "./time";

export function hash(str: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** PRNG determinístico (mulberry32) — mesmo resultado no servidor e no navegador. */
export function rng(seed: string) {
  let s = hash(seed);
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Patamar de uma métrica: vale de `from` minutos atrás até o próximo patamar mais recente. */
export type Phase = { from: number; value: number };

export function levelAt(phases: Phase[], t: number) {
  let best: Phase | undefined;
  for (const p of phases) if (p.from >= t && (!best || p.from < best.from)) best = p;
  return best ? best.value : phases[0].value;
}

export type GenOpts = {
  /** valor atual (o último ponto converge para ele) */
  now: number;
  /** valor no início da janela, para tendências lineares */
  start?: number;
  /** patamares por evento (deploys, incidentes) */
  phases?: Phase[];
  vol: number;
  min?: number;
  max?: number;
  /** amplitude da sazonalidade diária (0.2 = ±20%, pico às 14h) */
  daily?: number;
  spikes?: number;
  smooth?: number;
  decimals?: number;
};

export function gen(seed: string, range: RangeKey, o: GenOpts): number[] {
  const R = RANGES[range];
  const r = rng(`${seed}|${range}`);
  const total = (R.points - 1) * R.step || 1;
  const out: number[] = [];
  let prev: number | undefined;

  for (let i = 0; i < R.points; i++) {
    const t = minutesAgoAt(range, i);
    let level = o.phases
      ? levelAt(o.phases, t)
      : (o.start ?? o.now) + (o.now - (o.start ?? o.now)) * (1 - t / total);
    if (o.daily && R.step < 1440) {
      const s = stamp(t);
      const hod = s.hh + s.mm / 60;
      level *= 1 + o.daily * Math.cos((2 * Math.PI * (hod - 14)) / 24);
    }
    let v = level + (r() - 0.5) * 2 * o.vol;
    if (o.spikes && r() < o.spikes) v += o.vol * (1.5 + r() * 2.5);
    if (prev !== undefined && o.smooth) v = prev + (v - prev) * (1 - o.smooth);
    prev = v;
    out.push(v);
  }

  const n = out.length;
  [1, 0.55, 0.25].forEach((w, k) => {
    const idx = n - 1 - k;
    if (idx >= 0) out[idx] = out[idx] * (1 - w) + o.now * w;
  });

  const p = 10 ** (o.decimals ?? 2);
  return out.map((v) => {
    let x = v;
    if (o.min !== undefined) x = Math.max(o.min, x);
    if (o.max !== undefined) x = Math.min(o.max, x);
    return Math.round(x * p) / p;
  });
}

export function downsample(data: number[], n: number) {
  if (data.length <= n) return data;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * data.length) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * data.length) / n));
    let s = 0;
    for (let j = a; j < b; j++) s += data[j];
    out.push(s / (b - a));
  }
  out[n - 1] = data[data.length - 1];
  return out;
}

export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
