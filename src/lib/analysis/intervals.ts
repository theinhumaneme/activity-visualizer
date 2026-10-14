// Interval detection: from device laps when they describe a workout, otherwise from the data
// by splitting moving speed into fast and slow blocks (a two-level segmentation).

import type { Lap } from "../parse/types";
import { atIndex, median } from "./series";

export interface Rep {
  /** 1-based rep number among work blocks. */
  n: number;
  startIdx: number;
  endIdx: number;
  duration: number;
  distance: number;
  /** Seconds per km. */
  pace: number;
  avgHr?: number;
  peakHr?: number;
  /** Recovery after this rep (absent for the last rep if nothing follows). */
  recovery?: {
    duration: number;
    /** HR at the end of the rep, and the lowest HR in the following window (≤ 60 s). */
    hrFrom?: number;
    hrTo?: number;
    /** Seconds over which the drop was measured. */
    window: number;
    pace: number;
  };
}

export interface Block {
  kind: "warmup" | "work" | "recovery" | "cooldown";
  startIdx: number;
  endIdx: number;
}

export interface Intervals {
  source: "laps" | "detected";
  reps: Rep[];
  blocks: Block[];
  /** Coefficient of variation of rep pace (lower is more consistent). */
  paceCv: number;
  /** Mean rep duration, s. */
  repDuration: number;
}

interface Series {
  t: Float64Array;
  dist: Float64Array;
  /** Speed over a short (~10 s) window, m/s. */
  speed: Float64Array;
  hr: Float64Array;
  moving: Uint8Array;
}

const MIN_WORK = 30;
const MIN_REST = 20;

export function detectIntervals(s: Series, laps: Lap[]): Intervals | null {
  return fromLaps(s, laps) ?? fromData(s);
}

/** Laps describe a workout when there are several and they alternate fast/slow (or Active/Resting). */
function fromLaps(s: Series, laps: Lap[]): Intervals | null {
  if (laps.length < 4) return null;
  const speedOf = (l: Lap) => {
    const dt = s.t[l.endIndex] - s.t[l.startIndex];
    return dt > 0 ? (s.dist[l.endIndex] - s.dist[l.startIndex]) / dt : 0;
  };
  const speeds = laps.map(speedOf);
  let kinds: ("work" | "rest")[];
  if (laps.some((l) => l.intensity === "Resting")) {
    kinds = laps.map((l) => (l.intensity === "Resting" ? "rest" : "work"));
  } else {
    const thr = otsu(speeds);
    if (thr === null) return null;
    kinds = speeds.map((v) => (v >= thr ? "work" : "rest"));
    const fast = speeds.filter((v) => v >= thr);
    const slow = speeds.filter((v) => v < thr);
    if (!slow.length || median(fast) / Math.max(0.1, median(slow)) < 1.15) return null;
  }
  const blocks: Block[] = laps.map((l, i) => ({ kind: kinds[i] === "work" ? "work" : "recovery", startIdx: l.startIndex, endIdx: l.endIndex }));
  return finish(s, labelEnds(blocks), "laps");
}

/**
 * Two-level segmentation of moving speed: Otsu's threshold splits fast from slow, labels are
 * median-filtered over ~15 s, then blocks shorter than the minimum are merged into neighbors.
 * It counts as a workout when there are ≥ 3 work blocks clearly faster than the recoveries.
 */
function fromData(s: Series): Intervals | null {
  const { t, speed, moving } = s;
  const n = t.length;
  const v: number[] = [];
  for (let i = 0; i < n; i++) if (moving[i]) v.push(speed[i]);
  if (v.length < 120) return null;
  const thr = otsu(v);
  if (thr === null) return null;

  let label = Uint8Array.from(speed, (x, i) => (moving[i] && x >= thr ? 1 : 0));
  // Median filter over ±7 samples so a single slow stride doesn't split a rep.
  const f = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let c = 0;
    let k = 0;
    for (let j = Math.max(0, i - 7); j <= Math.min(n - 1, i + 7); j++, k++) c += label[j];
    f[i] = c * 2 > k ? 1 : 0;
  }
  label = f;

  type B = { fast: boolean; a: number; b: number };
  let raw: B[] = [];
  for (let i = 0; i < n; i++) {
    const fast = label[i] === 1;
    const last = raw[raw.length - 1];
    if (last && last.fast === fast) last.b = i;
    else raw.push({ fast, a: i, b: i });
  }
  // Merge the shortest too-short block into its neighbors until all are long enough.
  const dur = (x: B) => t[x.b] - t[x.a];
  for (;;) {
    let worst = -1;
    for (let k = 0; k < raw.length; k++) {
      const min = raw[k].fast ? MIN_WORK : MIN_REST;
      if (dur(raw[k]) < min && (worst < 0 || dur(raw[k]) < dur(raw[worst]))) worst = k;
    }
    if (worst < 0 || raw.length < 2) break;
    const x = raw[worst];
    const prev = raw[worst - 1];
    const next = raw[worst + 1];
    if (prev && next) {
      prev.b = next.b;
      raw.splice(worst, 2);
    } else if (prev) {
      prev.b = x.b;
      raw.splice(worst, 1);
    } else {
      next.a = x.a;
      raw.splice(worst, 1);
    }
    // Neighbors that are now the same kind join up.
    raw = raw.reduce<B[]>((acc, y) => {
      const last = acc[acc.length - 1];
      if (last && last.fast === y.fast) last.b = y.b;
      else acc.push({ ...y });
      return acc;
    }, []);
  }

  const work = raw.filter((x) => x.fast);
  const rest = raw.filter((x) => !x.fast);
  if (work.length < 3 || !rest.length) return null;
  const avgSpeed = (x: B) => (dur(x) > 0 ? (s.dist[x.b] - s.dist[x.a]) / dur(x) : 0);
  const ratio = median(work.map(avgSpeed)) / Math.max(0.1, median(rest.map(avgSpeed)));
  if (ratio < 1.2) return null;
  // Steady runs with a couple of traffic lights aren't workouts: the work blocks must make up
  // a structured share of the session, not one long block and scraps.
  const workTimes = work.map(dur);
  if (Math.max(...workTimes) > 0.6 * (t[n - 1] - t[0])) return null;
  // A planned session repeats: reps of similar length with similar recoveries. Stop-and-go
  // traffic on a ride or a run through town alternates fast and slow too, but at random.
  // Judge the inner blocks (the first and last may fold in a warm-up or the way home).
  const cv = (xs: number[]) => {
    const m = xs.reduce((p, q) => p + q, 0) / xs.length;
    return Math.sqrt(xs.reduce((p, q) => p + (q - m) ** 2, 0) / xs.length) / m;
  };
  const innerWork = workTimes.length > 3 ? workTimes.slice(1, -1) : workTimes;
  const restTimes = rest.map(dur);
  const innerRest = restTimes.length > 3 ? restTimes.slice(1, -1) : restTimes;
  if (cv(innerWork) > 0.3 || cv(innerRest) > 0.45) return null;

  const blocks: Block[] = raw.map((x) => ({ kind: x.fast ? "work" : "recovery", startIdx: x.a, endIdx: x.b }));
  return finish(s, labelEnds(blocks), "detected");
}

/**
 * Anything slow before the first rep is a warm-up. A slow block after the last rep is a
 * cool-down when it's much longer than a typical recovery; otherwise it's that rep's recovery.
 */
function labelEnds(blocks: Block[]): Block[] {
  const span = (b: Block) => b.endIdx - b.startIdx;
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  if (first.kind === "recovery") first.kind = "warmup";
  const inner = blocks.slice(1, -1).filter((b) => b.kind === "recovery");
  if (last.kind === "recovery" && last !== first && (!inner.length || span(last) > 1.8 * median(inner.map(span)))) last.kind = "cooldown";
  return blocks;
}

function finish(s: Series, blocks: Block[], source: Intervals["source"]): Intervals | null {
  const { t, dist, hr } = s;
  const reps: Rep[] = [];
  blocks.forEach((b, k) => {
    if (b.kind !== "work") return;
    const duration = t[b.endIdx] - t[b.startIdx];
    const distance = dist[b.endIdx] - dist[b.startIdx];
    if (duration <= 0 || distance <= 0) return;
    let hs = 0;
    let hc = 0;
    let peak = -Infinity;
    for (let i = b.startIdx; i <= b.endIdx; i++) {
      if (Number.isNaN(hr[i])) continue;
      hs += hr[i];
      hc++;
      peak = Math.max(peak, hr[i]);
    }
    const rep: Rep = {
      n: reps.length + 1,
      startIdx: b.startIdx,
      endIdx: b.endIdx,
      duration,
      distance,
      pace: (duration / distance) * 1000,
      avgHr: hc ? hs / hc : undefined,
      peakHr: hc ? peak : undefined,
    };
    const next = blocks[k + 1];
    if (next && next.kind !== "work") {
      const rd = t[next.endIdx] - t[next.startIdx];
      const window = Math.min(60, rd);
      const hrFrom = atIndex(hr, b.endIdx);
      let hrTo = hrFrom;
      for (let i = b.endIdx; i <= next.endIdx && t[i] - t[b.endIdx] <= window; i++) if (hr[i] < hrTo) hrTo = hr[i];
      const rdist = dist[next.endIdx] - dist[next.startIdx];
      rep.recovery = {
        duration: rd,
        hrFrom: Number.isFinite(hrFrom) ? hrFrom : undefined,
        hrTo: Number.isFinite(hrTo) ? hrTo : undefined,
        window,
        pace: rdist > 0 ? (rd / rdist) * 1000 : NaN,
      };
    }
    reps.push(rep);
  });
  if (reps.length < 3) return null;
  // Consistency is judged on the structured reps: a first or last block that's far longer than
  // the typical rep (it folded in a warm-up or a run home) doesn't count against it.
  const typical = median(reps.map((r) => r.duration));
  const structured = reps.filter((r) => Math.abs(r.duration - typical) <= typical * 0.25);
  const paces = (structured.length >= 3 ? structured : reps).map((r) => r.pace);
  const mean = paces.reduce((a, b) => a + b, 0) / paces.length;
  const sd = Math.sqrt(paces.reduce((a, b) => a + (b - mean) ** 2, 0) / paces.length);
  return {
    source,
    reps,
    blocks,
    paceCv: sd / mean,
    repDuration: reps.reduce((a, r) => a + r.duration, 0) / reps.length,
  };
}

/** Otsu's threshold for a 1-D sample: the split that maximizes between-class variance. */
export function otsu(values: number[]): number | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < 4) return null;
  const lo = v[Math.floor(v.length * 0.02)];
  const hi = v[Math.floor(v.length * 0.98)];
  if (hi - lo < 1e-6) return null;
  const BINS = 64;
  const hist = new Float64Array(BINS);
  for (const x of v) hist[Math.min(BINS - 1, Math.max(0, Math.floor(((x - lo) / (hi - lo)) * BINS)))]++;
  const total = v.length;
  let sumAll = 0;
  for (let i = 0; i < BINS; i++) sumAll += i * hist[i];
  let wB = 0;
  let sumB = 0;
  let best = -1;
  let bestK = -1;
  for (let k = 0; k < BINS - 1; k++) {
    wB += hist[k];
    if (!wB || wB === total) continue;
    sumB += k * hist[k];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / (total - wB);
    const between = wB * (total - wB) * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      bestK = k;
    }
  }
  return bestK < 0 ? null : lo + ((bestK + 1) / BINS) * (hi - lo);
}
