// Power analysis for activities recorded with a power meter: normalized power, intensity and
// training stress against FTP (entered, or estimated from the best 20 minutes), time in the seven
// Coggan zones, the best average power for each duration (the power curve), and W′ balance.
//
// Everything works on a 1 Hz series over recorded time. Coasting counts as 0 W, as on a head unit;
// gaps longer than PAUSE (auto-pause, the timer stopped) are left out, as are dropouts beyond it.

import type { Sample } from "../parse/types";

const PAUSE = 10;
/** A typical W′ for a trained rider, joules, when none is entered. */
export const DEFAULT_W_PRIME = 20000;
/** Durations for the power curve, seconds. */
const CURVE = [1, 5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600, 5400, 7200, 10800, 14400, 18000];

export const POWER_ZONES = [
  { name: "Active recovery", low: 0, high: 0.55 },
  { name: "Endurance", low: 0.55, high: 0.75 },
  { name: "Tempo", low: 0.75, high: 0.9 },
  { name: "Threshold", low: 0.9, high: 1.05 },
  { name: "VO₂ max", low: 1.05, high: 1.2 },
  { name: "Anaerobic", low: 1.2, high: 1.5 },
  { name: "Neuromuscular", low: 1.5, high: Infinity },
];

export interface PowerZone {
  zone: number;
  name: string;
  /** Watts. */
  low: number;
  high: number;
  seconds: number;
}

export interface CurvePoint {
  seconds: number;
  watts: number;
  /** Sample range of the best effort, for highlighting it on the map and charts. */
  startIdx: number;
  endIdx: number;
}

/**
 * W′ balance: how much of the work you can do above threshold is left, using FTP as critical power.
 * Above FTP it drains watt for watt; below, it refills faster the emptier it is (Skiba's
 * differential model).
 */
export interface WBalance {
  /** Joules left at each sample. */
  series: Float64Array;
  wPrime: number;
  wPrimeEstimated: boolean;
  min: number;
  minIdx: number;
}

export interface PowerAnalysis {
  /** Power per sample, a centered 10 s average (NaN where nothing was recorded). */
  series: Float64Array;
  avg: number;
  max: number;
  /** Normalized power: the 4th-power mean of the 30 s rolling average. */
  np: number;
  /** Variability index, NP / average (1.00 = perfectly steady). */
  vi: number;
  /** Mechanical work, kJ (close to the calories a rider burns). */
  work: number;
  /** Seconds of recorded power. */
  seconds: number;
  ftp: number;
  ftpEstimated: boolean;
  /** Intensity factor, NP / FTP. */
  intensity?: number;
  /** Training stress score: an hour at FTP is 100. */
  tss?: number;
  zones: PowerZone[];
  curve: CurvePoint[];
  /** Absent until FTP is known (entered, or estimated from a 20-minute effort). */
  wbal?: WBalance;
}

/**
 * @param ftpSetting the rider's FTP in watts, or 0 to estimate it (95% of the best 20 minutes;
 *   no FTP, zones or stress score if the activity is shorter than that).
 * @param wPrimeSetting W′ in joules, or 0 for the typical 20 kJ.
 */
export function computePower(samples: Sample[], t: Float64Array, ftpSetting: number, wPrimeSetting = 0): PowerAnalysis | null {
  const n = samples.length;
  let withPower = 0;
  for (const s of samples) if (s.power !== undefined) withPower++;
  if (n < 2 || withPower < n * 0.5) return null;

  // 1 Hz series over elapsed time; NaN for pauses. owner[k] is the sample covering second k.
  const T = Math.floor(t[n - 1]);
  const w = new Float64Array(T + 1).fill(NaN);
  const owner = new Int32Array(T + 1);
  for (let i = 0; i < n - 1; i++) {
    const dt = t[i + 1] - t[i];
    const from = Math.ceil(t[i]);
    const to = Math.min(T, Math.ceil(t[i + 1]) - 1);
    const p = Math.max(0, samples[i].power ?? 0);
    for (let k = from; k <= to; k++) {
      owner[k] = i;
      if (dt <= PAUSE) w[k] = p;
    }
  }
  owner[T] = n - 1;

  // Recorded seconds only, in order (pauses squeezed out), with where each came from.
  const rec: number[] = [];
  const at: number[] = [];
  for (let k = 0; k <= T; k++) {
    if (Number.isNaN(w[k])) continue;
    rec.push(w[k]);
    at.push(k);
  }
  const m = rec.length;
  if (m < 60) return null;

  const prefix = new Float64Array(m + 1);
  let max = 0;
  for (let k = 0; k < m; k++) {
    prefix[k + 1] = prefix[k] + rec[k];
    if (rec[k] > max) max = rec[k];
  }
  const avg = prefix[m] / m;

  // Normalized power.
  let np = avg;
  if (m >= 30) {
    let sum4 = 0;
    for (let k = 29; k < m; k++) sum4 += ((prefix[k + 1] - prefix[k - 29]) / 30) ** 4;
    np = (sum4 / (m - 29)) ** 0.25;
  }

  // Power curve: best rolling mean per duration.
  const curve: CurvePoint[] = [];
  for (const d of CURVE) {
    if (d > m) break;
    let best = -1;
    let bestAt = 0;
    for (let k = d; k <= m; k++) {
      const v = prefix[k] - prefix[k - d];
      if (v > best) {
        best = v;
        bestAt = k - d;
      }
    }
    curve.push({ seconds: d, watts: best / d, startIdx: owner[at[bestAt]], endIdx: owner[at[bestAt + d - 1]] });
  }

  const best20 = curve.find((c) => c.seconds === 1200)?.watts;
  const ftp = ftpSetting > 0 ? ftpSetting : best20 ? Math.round(best20 * 0.95) : 0;

  const zones: PowerZone[] = [];
  if (ftp > 0) {
    for (const [k, z] of POWER_ZONES.entries()) zones.push({ zone: k + 1, name: z.name, low: z.low * ftp, high: z.high * ftp, seconds: 0 });
    for (const p of rec) {
      let z = 0;
      while (z < zones.length - 1 && p >= zones[z + 1].low) z++;
      zones[z].seconds++;
    }
  }
  const intensity = ftp > 0 ? np / ftp : undefined;

  // Per-sample series for the chart: a centered 10 s mean of recorded seconds.
  const wp = new Float64Array(T + 2);
  const wc = new Float64Array(T + 2);
  for (let k = 0; k <= T; k++) {
    const ok = !Number.isNaN(w[k]);
    wp[k + 1] = wp[k] + (ok ? w[k] : 0);
    wc[k + 1] = wc[k] + (ok ? 1 : 0);
  }
  const series = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const c = Math.round(t[i]);
    const lo = Math.max(0, c - 5);
    const hi = Math.min(T, c + 5) + 1;
    const cnt = wc[hi] - wc[lo];
    series[i] = cnt > 0 ? (wp[hi] - wp[lo]) / cnt : NaN;
  }

  // W′ balance second by second; paused seconds count as resting at 0 W.
  let wbal: WBalance | undefined;
  if (ftp > 0) {
    const wPrime = wPrimeSetting > 0 ? wPrimeSetting : DEFAULT_W_PRIME;
    const bySecond = new Float64Array(T + 1);
    let bal = wPrime;
    for (let k = 0; k <= T; k++) {
      const p = Number.isNaN(w[k]) ? 0 : w[k];
      bal = p > ftp ? bal - (p - ftp) : bal + ((ftp - p) * (wPrime - bal)) / wPrime;
      bySecond[k] = bal;
    }
    const s = Float64Array.from(t, (ti) => bySecond[Math.min(T, Math.round(ti))]);
    let minIdx = 0;
    for (let i = 1; i < n; i++) if (s[i] < s[minIdx]) minIdx = i;
    wbal = { series: s, wPrime, wPrimeEstimated: wPrimeSetting <= 0, min: s[minIdx], minIdx };
  }

  return {
    series,
    avg,
    max,
    np,
    vi: avg > 0 ? np / avg : 1,
    work: prefix[m] / 1000,
    seconds: m,
    ftp,
    ftpEstimated: ftpSetting <= 0,
    intensity,
    tss: intensity !== undefined ? ((m * np * intensity) / (ftp * 3600)) * 100 : undefined,
    zones,
    curve,
    wbal,
  };
}

export const curveLabel = (s: number) => (s < 60 ? `${s} s` : s < 3600 ? `${s / 60} min` : `${s / 3600} h`);
