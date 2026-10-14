// Pure UI-side math for the analysis view: axis clipping, the raw-pace band, split bars,
// interval timeline geometry. Nothing here touches React or the DOM, so it's unit-tested.

/** Value at fraction p of an ascending-sorted array (nearest rank, clamped). */
export function quantile(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (!n) return NaN;
  return sorted[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))];
}

export interface ClippedRange {
  range: [number, number];
  /** Finite values that fall outside the padded axis (drawn off the edge). */
  outliers: number;
}

/**
 * Axis range from the lo–hi percentiles of the values, padded by `pad` of the span on each side.
 * `include` values (e.g. a reference line) are always kept on the axis. Null with no finite data.
 */
export function clippedRange(values: ArrayLike<number>, lo: number, hi: number, pad = 0.08, include: number[] = []): ClippedRange | null {
  const finite: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) finite.push(values[i]);
  if (!finite.length) return null;
  finite.sort((p, q) => p - q);
  let a = quantile(finite, lo);
  let b = quantile(finite, hi);
  for (const v of include) {
    if (!Number.isFinite(v)) continue;
    a = Math.min(a, v);
    b = Math.max(b, v);
  }
  // A flat series still gets a visible span.
  const p = b > a ? (b - a) * pad : 1;
  const range: [number, number] = [a - p, b + p];
  let outliers = 0;
  for (const v of finite) if (v < range[0] || v > range[1]) outliers++;
  return { range, outliers };
}

/**
 * Point-to-point speed (m/s) over a short window: for each sample, distance to the first sample
 * at least `window` seconds later. Unsmoothed on purpose; it's the noisy "what the GPS saw" band.
 * NaN where the athlete wasn't moving or the window runs past the end.
 */
export function rawSpeed(t: ArrayLike<number>, dist: ArrayLike<number>, moving: ArrayLike<number>, window = 3): Float64Array {
  const n = t.length;
  const out = new Float64Array(n).fill(NaN);
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (j < i) j = i;
    while (j < n - 1 && t[j] - t[i] < window) j++;
    const dt = t[j] - t[i];
    if (dt < window * 0.5 || dt > window * 4 || !moving[i]) continue;
    out[i] = (dist[j] - dist[i]) / dt;
  }
  return out;
}

export interface MinMaxBuckets {
  /** Bucket centers in x units. */
  x: Float64Array;
  lo: Float64Array;
  hi: Float64Array;
}

/** Min and max of `v` in `count` equal-width buckets of x (NaN for empty buckets). */
export function bucketMinMax(x: ArrayLike<number>, v: ArrayLike<number>, count: number): MinMaxBuckets {
  const n = x.length;
  const lo = new Float64Array(count).fill(NaN);
  const hi = new Float64Array(count).fill(NaN);
  const centers = new Float64Array(count);
  const x0 = n ? x[0] : 0;
  const span = n ? x[n - 1] - x0 : 0;
  for (let k = 0; k < count; k++) centers[k] = x0 + ((k + 0.5) / count) * span;
  if (!(span > 0)) return { x: centers, lo, hi };
  for (let i = 0; i < n; i++) {
    const val = v[i];
    if (!Number.isFinite(val)) continue;
    const k = Math.min(count - 1, Math.max(0, Math.floor(((x[i] - x0) / span) * count)));
    if (!(val >= lo[k])) lo[k] = val;
    if (!(val <= hi[k])) hi[k] = val;
  }
  return { x: centers, lo, hi };
}

/**
 * Bar offsets for a list of split paces around their average: −1…1, positive = faster than
 * average (shorter pace). Scaled so the largest deviation fills the half-width.
 */
export function splitOffsets(paces: number[], average: number): number[] {
  const deltas = paces.map((p) => (Number.isFinite(p) && Number.isFinite(average) ? average - p : 0));
  const max = Math.max(1e-9, ...deltas.map(Math.abs));
  return deltas.map((d) => d / max);
}

/** Plain-language read of rep-pace coefficient of variation. */
export function consistencyLabel(cv: number): string {
  if (!Number.isFinite(cv)) return "";
  if (cv < 0.03) return "very consistent";
  if (cv < 0.06) return "consistent";
  if (cv < 0.1) return "some spread";
  return "wide spread";
}

export interface Span {
  /** Start as a fraction of the whole, 0…1. */
  start: number;
  width: number;
}

/** Positions of sample ranges along a timeline by time, as fractions of the total span. */
export function timelineSpans(ranges: { startIdx: number; endIdx: number }[], t: ArrayLike<number>): Span[] {
  if (!ranges.length) return [];
  const t0 = t[ranges[0].startIdx];
  const total = t[ranges[ranges.length - 1].endIdx] - t0;
  if (!(total > 0)) return ranges.map(() => ({ start: 0, width: 0 }));
  return ranges.map((r) => ({ start: (t[r.startIdx] - t0) / total, width: (t[r.endIdx] - t[r.startIdx]) / total }));
}

/** Share of each entry in a list of durations (0 when the total is 0). */
export function shares(seconds: number[]): number[] {
  const total = seconds.reduce((x, y) => x + y, 0);
  return seconds.map((s) => (total > 0 ? s / total : 0));
}

/** "#rrggbb" or "rgb(r,g,b)" → "rgba(r,g,b,alpha)". Other strings are returned unchanged. */
export function withAlpha(color: string, alpha: number): string {
  const c = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) {
    const n = parseInt(c.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  if (/^#[0-9a-f]{3}$/i.test(c)) {
    const [r, g, b] = [1, 2, 3].map((i) => parseInt(c[i] + c[i], 16));
    return `rgba(${r},${g},${b},${alpha})`;
  }
  const m = c.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  return m ? `rgba(${m[1]},${m[2]},${m[3]},${alpha})` : c;
}
