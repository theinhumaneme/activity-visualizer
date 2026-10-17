// Cleaning: pure functions that repair obvious sensor errors before anything is measured.
// None of them drop samples (DEM elevation and lap indices stay aligned); they move bad GPS
// points back onto the track and blank bad heart-rate readings.

import { haversine } from "../geo/geo";
import type { Sample, SportKind } from "../parse/types";
import { SPORTS } from "../sport";
import { median } from "./series";

export interface CleaningReport {
  /** GPS points that implied an impossible speed and were moved back onto the track. */
  teleports: number;
  /** Points in the GPS "drift cluster" before you started / after you stopped, pinned in place. */
  driftStart: number;
  driftEnd: number;
  /** Heart-rate readings blanked: dropouts (0 or < 30 bpm) and spikes (> 25 bpm/s). */
  hrDropouts: number;
  hrSpikes: number;
  /** Distance was recomputed from the cleaned GPS (only when the file had no distance channel). */
  distanceRecomputed: boolean;
}

/** Plausible top speed per sport, m/s (running: 8 m/s is a 2:05 /km sprint). See src/lib/sport.ts. */
export const speedCeiling = (kind: SportKind) => SPORTS[kind].ceiling;

/**
 * Teleport spikes: a point is bad when reaching it implies a speed above the sport's ceiling,
 * or above 3× the rolling median speed (and fast in absolute terms), while the way out of it
 * implies a similar jump back. Those points are re-placed by time interpolation between their
 * good neighbors, so the line never shoots out and back.
 */
export function removeTeleports(samples: Sample[], kind: SportKind): number {
  const n = samples.length;
  if (n < 5) return 0;
  const ceiling = speedCeiling(kind);
  const v = new Float64Array(n); // speed arriving at i
  for (let i = 1; i < n; i++) {
    const dt = samples[i].t - samples[i - 1].t;
    v[i] = dt > 0 ? haversine(samples[i - 1].lat, samples[i - 1].lon, samples[i].lat, samples[i].lon) / dt : 0;
  }
  const bad = new Uint8Array(n);
  const W = 15;
  for (let i = 1; i < n - 1; i++) {
    // The limit below is never under half the ceiling, so slower legs can't be a spike: skip the
    // rolling median (a sort per point) for the vast majority of points.
    if (v[i] <= ceiling * 0.5 || v[i + 1] <= ceiling * 0.5) continue;
    const win: number[] = [];
    for (let k = Math.max(1, i - W); k <= Math.min(n - 1, i + W); k++) win.push(v[k]);
    const med = median(win);
    const limit = Math.min(ceiling, Math.max(3 * med, ceiling * 0.5));
    // A spike goes out and comes back: the chord over it is far shorter than the two legs.
    const dt = samples[i + 1].t - samples[i - 1].t;
    const chord = haversine(samples[i - 1].lat, samples[i - 1].lon, samples[i + 1].lat, samples[i + 1].lon);
    const legs = (v[i] * (samples[i].t - samples[i - 1].t) + v[i + 1] * (samples[i + 1].t - samples[i].t)) || 1;
    if (v[i] > limit && v[i + 1] > limit && dt > 0 && chord / legs < 0.5) bad[i] = 1;
  }
  // Sustained runs of impossible speed (> ceiling for > 3 s) are bad too, e.g. a jump after a tunnel.
  let run = 0;
  for (let i = 1; i < n; i++) {
    if (v[i] > ceiling) run += samples[i].t - samples[i - 1].t;
    else run = 0;
    if (run > 3) bad[i] = 1;
  }
  let count = 0;
  for (let i = 1; i < n - 1; i++) {
    if (!bad[i]) continue;
    let a = i - 1;
    while (a > 0 && bad[a]) a--;
    let b = i + 1;
    while (b < n - 1 && bad[b]) b++;
    const A = samples[a];
    const B = samples[b];
    const f = B.t > A.t ? (samples[i].t - A.t) / (B.t - A.t) : 0;
    samples[i] = { ...samples[i], lat: A.lat + f * (B.lat - A.lat), lon: A.lon + f * (B.lon - A.lon) };
    count++;
  }
  return count;
}

/**
 * GPS drift at the ends: before you start (and after you stop) the fix wanders around a
 * ~15 m cluster, which draws a scribble at the start pin. Pin those points to where movement
 * begins (or ends). Time is untouched, so elapsed time stays honest.
 */
export function pinDrift(samples: Sample[], radius = 15): { start: number; end: number } {
  const n = samples.length;
  if (n < 10) return { start: 0, end: 0 };
  const scan = (from: number, step: 1 | -1) => {
    const o = samples[from];
    let i = from;
    while (i + step >= 0 && i + step < n && haversine(o.lat, o.lon, samples[i + step].lat, samples[i + step].lon) <= radius) i += step;
    return i;
  };
  // Only a cluster that lasts a while is drift; otherwise it's just the first few strides.
  const startEnd = scan(0, 1);
  const endStart = scan(n - 1, -1);
  let start = 0;
  let end = 0;
  if (startEnd > 0 && samples[startEnd].t - samples[0].t >= 8 && startEnd < n / 3) {
    const pin = samples[startEnd];
    for (let i = 0; i < startEnd; i++) samples[i] = { ...samples[i], lat: pin.lat, lon: pin.lon };
    start = startEnd;
  }
  if (endStart < n - 1 && samples[n - 1].t - samples[endStart].t >= 8 && endStart > (2 * n) / 3) {
    const pin = samples[endStart];
    for (let i = endStart + 1; i < n; i++) samples[i] = { ...samples[i], lat: pin.lat, lon: pin.lon };
    end = n - 1 - endStart;
  }
  return { start, end };
}

/**
 * Heart rate: blank dropouts (0 or < 30 bpm) and spikes (changes > 25 bpm/s, the classic
 * optical-sensor cadence lock), then bridge short gaps (≤ 10 s) by interpolation.
 */
export function cleanHeartRate(samples: Sample[]): { hr: Float64Array; dropouts: number; spikes: number } {
  const n = samples.length;
  const hr = Float64Array.from(samples, (s) => (s.hr === undefined ? NaN : s.hr));
  let dropouts = 0;
  let spikes = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(hr[i]) && hr[i] < 30) {
      hr[i] = NaN;
      dropouts++;
    }
  }
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(hr[i])) continue;
    if (last >= 0) {
      const dt = Math.max(1, samples[i].t - samples[last].t);
      if (Math.abs(hr[i] - hr[last]) / dt > 25) {
        hr[i] = NaN;
        spikes++;
        continue;
      }
    }
    last = i;
  }
  // Bridge short gaps only; long gaps stay gaps (sensor off).
  let prev = -1;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(hr[i])) continue;
    if (prev >= 0 && i - prev > 1 && samples[i].t - samples[prev].t <= 10) {
      for (let k = prev + 1; k < i; k++) {
        const f = (samples[k].t - samples[prev].t) / (samples[i].t - samples[prev].t);
        hr[k] = hr[prev] + f * (hr[i] - hr[prev]);
      }
    }
    prev = i;
  }
  return { hr, dropouts, spikes };
}

/** Recomputes cumulative distance from positions (for files without a distance channel). */
export function recomputeDistance(samples: Sample[]): void {
  let d = 0;
  for (let i = 0; i < samples.length; i++) {
    if (i > 0) d += haversine(samples[i - 1].lat, samples[i - 1].lon, samples[i].lat, samples[i].lon);
    samples[i] = { ...samples[i], dist: d };
  }
}

/** Runs the GPS cleaning steps on a copy of the samples. Heart rate is cleaned separately (see analyze). */
export function cleanSamples(input: Sample[], kind: SportKind, hasFileDistance: boolean, routeOnly: boolean) {
  const samples = input.slice();
  const teleports = routeOnly ? 0 : removeTeleports(samples, kind);
  const drift = routeOnly ? { start: 0, end: 0 } : pinDrift(samples);
  const distanceRecomputed = !hasFileDistance && (teleports > 0 || drift.start > 0 || drift.end > 0);
  if (distanceRecomputed) recomputeDistance(samples);
  return { samples, teleports, driftStart: drift.start, driftEnd: drift.end, distanceRecomputed };
}
