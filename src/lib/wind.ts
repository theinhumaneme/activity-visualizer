// Wind along the route: the hour's wind (Open-Meteo, 10 m above ground) against the direction you
// were travelling at each point, split into headwind (+) or tailwind (−) and crosswind. Needs the
// weather, which is opt-in.

import type { Analysis } from "./analysis/types";
import { bearing } from "./geo/geo";
import { type Weather, weatherAt } from "./weather";

export interface WindStretch {
  startIdx: number;
  endIdx: number;
  /** Average headwind over the stretch, km/h (negative: tailwind). */
  head: number;
  seconds: number;
}

export interface WindAnalysis {
  /** Headwind at each sample, km/h (negative = tailwind; NaN while stopped). */
  head: Float64Array;
  /** Crosswind at each sample, km/h (always ≥ 0; NaN while stopped). */
  cross: Float64Array;
  /** Wind at the middle of the activity: speed km/h, and the direction it blew from (degrees). */
  speed: number;
  from: number;
  /** Shares of moving time into the wind, with it, and across it. */
  headShare: number;
  tailShare: number;
  crossShare: number;
  /** Moving-time average of the headwind component, km/h (negative: mostly helped). */
  avgHead: number;
  /** The hardest sustained headwind and the best tailwind. */
  hardest: WindStretch | null;
  kindest: WindStretch | null;
}

const RAD = Math.PI / 180;
/** Direction of travel is measured over this much distance (a GPS wobble isn't a turn). */
const HEADING_SPAN = 25;
/** Under this, it's calm: no headwind or tailwind worth naming (km/h). */
const CALM = 3;

const cache = new WeakMap<Analysis, { w: Weather; result: WindAnalysis | null }>();

/** Wind along the route for this analysis and weather (cached per pair). */
export function windAlong(a: Analysis, w: Weather | null | undefined): WindAnalysis | null {
  if (!w || a.activity.routeOnly || a.n < 2) return null;
  const hit = cache.get(a);
  if (hit && hit.w === w) return hit.result;
  const result = compute(a, w);
  cache.set(a, { w, result });
  return result;
}

function compute(a: Analysis, w: Weather): WindAnalysis | null {
  const { n, samples, dist, t, moving } = a;
  const head = new Float64Array(n).fill(NaN);
  const cross = new Float64Array(n).fill(NaN);
  let j = 0;
  let heading = NaN;
  let headT = 0;
  let tailT = 0;
  let crossT = 0;
  let headSum = 0;
  let movingT = 0;
  for (let i = 0; i < n; i++) {
    if (j < i) j = i;
    while (j < n - 1 && dist[j] - dist[i] < HEADING_SPAN) j++;
    if (dist[j] - dist[i] >= HEADING_SPAN * 0.5) heading = bearing(samples[i].lat, samples[i].lon, samples[j].lat, samples[j].lon);
    if (!moving[Math.min(i, n - 2)] || !Number.isFinite(heading)) continue;
    const at = weatherAt(w, samples[i].time);
    if (!Number.isFinite(at.windSpeed)) continue;
    // Wind blows FROM windDir: riding toward that direction is riding into it.
    const angle = (at.windDir - heading) * RAD;
    head[i] = at.windSpeed * Math.cos(angle);
    cross[i] = Math.abs(at.windSpeed * Math.sin(angle));
    if (i < n - 1) {
      const dt = Math.min(t[i + 1] - t[i], 30);
      movingT += dt;
      headSum += head[i] * dt;
      if (at.windSpeed < CALM) continue;
      const c = Math.cos(angle);
      if (c > 0.5) headT += dt;
      else if (c < -0.5) tailT += dt;
      else crossT += dt;
    }
  }
  if (movingT <= 0) return null;
  const mid = weatherAt(w, (samples[0].time + samples[n - 1].time) / 2);
  return {
    head,
    cross,
    speed: mid.windSpeed,
    from: mid.windDir,
    headShare: headT / movingT,
    tailShare: tailT / movingT,
    crossShare: crossT / movingT,
    avgHead: headSum / movingT,
    hardest: stretch(a, head, 1),
    kindest: stretch(a, head, -1),
  };
}

/**
 * The stretch with the strongest sustained headwind (sign 1) or tailwind (sign −1): the best
 * average over a window of about a twentieth of the moving time (1–10 minutes).
 */
function stretch(a: Analysis, head: Float64Array, sign: 1 | -1): WindStretch | null {
  const { n, t, moving } = a;
  const total = a.summary.moving;
  const span = Math.min(600, Math.max(60, total / 20));
  // Moving-time prefix sums of the (signed) headwind.
  const mt = new Float64Array(n);
  const sum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const dt = moving[i - 1] && Number.isFinite(head[i - 1]) ? Math.min(t[i] - t[i - 1], 30) : 0;
    mt[i] = mt[i - 1] + dt;
    sum[i] = sum[i - 1] + (dt ? head[i - 1] * dt : 0);
  }
  if (mt[n - 1] < span) return null;
  let best = -Infinity;
  let at: [number, number] = [0, 0];
  let lo = 0;
  for (let hi = 1; hi < n; hi++) {
    while (lo < hi && mt[hi] - mt[lo + 1] >= span) lo++;
    if (mt[hi] - mt[lo] < span) continue;
    const avg = (sign * (sum[hi] - sum[lo])) / (mt[hi] - mt[lo]);
    if (avg > best) {
      best = avg;
      at = [lo, hi];
    }
  }
  if (best < CALM) return null;
  return { startIdx: at[0], endIdx: at[1], head: sign * best, seconds: mt[at[1]] - mt[at[0]] };
}

/** "Headwind" / "Tailwind" / "Crosswind" for a sample, from its components. */
export function windLabel(head: number, cross: number): "Headwind" | "Tailwind" | "Crosswind" | "Calm" {
  if (!Number.isFinite(head)) return "Calm";
  const speed = Math.hypot(head, cross);
  if (speed < CALM) return "Calm";
  if (head > speed * 0.5) return "Headwind";
  if (head < -speed * 0.5) return "Tailwind";
  return "Crosswind";
}
