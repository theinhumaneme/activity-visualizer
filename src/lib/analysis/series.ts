// Small numeric helpers shared by the analysis modules. Arrays are assumed sorted ascending.

/** Largest index i with xs[i] <= x, clamped to [0, n-1]. */
export function lowerIndex(xs: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  if (x <= xs[0]) return 0;
  if (x >= xs[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Linear interpolation of ys at x, where xs is strictly increasing. */
export function interpAt(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number): number {
  const i = lowerIndex(xs, x);
  if (i >= xs.length - 1) return ys[xs.length - 1];
  const span = xs[i + 1] - xs[i];
  const f = span > 0 ? Math.min(1, Math.max(0, (x - xs[i]) / span)) : 0;
  return ys[i] + f * (ys[i + 1] - ys[i]);
}

/**
 * Fractional sample index where cumulative distance first reaches d.
 * Distance is non-decreasing (it repeats while standing still), so this picks the arrival moment.
 */
export function indexAtDist(dist: ArrayLike<number>, d: number): number {
  const n = dist.length;
  if (d <= dist[0]) return 0;
  if (d >= dist[n - 1]) return n - 1;
  let lo = 0;
  let hi = n - 1; // invariant: dist[lo] < d <= dist[hi]
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (dist[mid] < d) lo = mid;
    else hi = mid;
  }
  return lo + (d - dist[lo]) / (dist[hi] - dist[lo]);
}

/** Value of `ys` at a fractional index. */
export function atIndex(ys: ArrayLike<number>, f: number): number {
  const i = Math.floor(f);
  if (i >= ys.length - 1) return ys[ys.length - 1];
  if (i < 0) return ys[0];
  const a = ys[i];
  const b = ys[i + 1];
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  return a + (f - i) * (b - a);
}

/** Centered moving average over a ±half-width window of samples, ignoring NaN. */
export function movingAverage(ys: ArrayLike<number>, half: number): Float64Array {
  const n = ys.length;
  const out = new Float64Array(n);
  const sum = new Float64Array(n + 1);
  const cnt = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const ok = !Number.isNaN(ys[i]);
    sum[i + 1] = sum[i] + (ok ? ys[i] : 0);
    cnt[i + 1] = cnt[i] + (ok ? 1 : 0);
  }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    const c = cnt[b] - cnt[a];
    out[i] = c > 0 ? (sum[b] - sum[a]) / c : NaN;
  }
  return out;
}

/** Fills NaN gaps by linear interpolation (edges take the nearest value). */
export function fillGaps(ys: Float64Array): Float64Array {
  const out = Float64Array.from(ys);
  let last = -1;
  for (let i = 0; i < out.length; i++) {
    if (Number.isNaN(out[i])) continue;
    if (last === -1) out.fill(out[i], 0, i);
    else if (i - last > 1) for (let k = last + 1; k < i; k++) out[k] = out[last] + ((k - last) / (i - last)) * (out[i] - out[last]);
    last = i;
  }
  if (last >= 0) out.fill(out[last], last + 1);
  return out;
}

export function median(values: number[]): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Centered mean over ±halfMeters of distance (not samples), ignoring NaN. Smoothing by distance
 * means a stop doesn't flatten the profile and fast sections aren't over-smoothed.
 */
export function smoothByDistance(dist: ArrayLike<number>, ys: ArrayLike<number>, halfMeters: number): Float64Array {
  const n = ys.length;
  const out = new Float64Array(n);
  const sum = new Float64Array(n + 1);
  const cnt = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const ok = !Number.isNaN(ys[i]);
    sum[i + 1] = sum[i] + (ok ? ys[i] : 0);
    cnt[i + 1] = cnt[i] + (ok ? 1 : 0);
  }
  let a = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    while (dist[a] < dist[i] - halfMeters) a++;
    while (b < n && dist[b] <= dist[i] + halfMeters) b++;
    const c = cnt[b] - cnt[a];
    out[i] = c > 0 ? (sum[b] - sum[a]) / c : NaN;
  }
  return out;
}
