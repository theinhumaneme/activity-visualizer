import { haversine } from "../geo/geo";
import type { Track } from "./types";

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320;

/** Equirectangular projection to meters around a reference point; accurate enough within a few km. */
export function projector(lat0: number, lon0: number) {
  const k = Math.cos((lat0 * Math.PI) / 180) * M_PER_DEG_LON;
  return (lat: number, lon: number): [number, number] => [(lon - lon0) * k, (lat - lat0) * M_PER_DEG_LAT];
}

/**
 * Douglas–Peucker on points in (x, y, z) meters. Returns the kept indices, sorted, always
 * including the first and the last. Iterative, so long recordings can't overflow the stack.
 */
export function douglasPeucker(x: ArrayLike<number>, y: ArrayLike<number>, z: ArrayLike<number> | null, epsilon: number): number[] {
  const n = x.length;
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const eps2 = epsilon * epsilon;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = x[a], ay = y[a], az = z ? z[a] : 0;
    const dx = x[b] - ax, dy = y[b] - ay, dz = z ? z[b] - az : 0;
    const len2 = dx * dx + dy * dy + dz * dz;
    let worst = -1;
    let worstD = eps2;
    for (let i = a + 1; i < b; i++) {
      const px = x[i] - ax, py = y[i] - ay, pz = z ? z[i] - az : 0;
      let u = len2 > 0 ? (px * dx + py * dy + pz * dz) / len2 : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const ex = px - u * dx, ey = py - u * dy, ez = pz - u * dz;
      const d2 = ex * ex + ey * ey + ez * ez;
      if (d2 > worstD) {
        worstD = d2;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

export interface TrackInput {
  lat: number;
  lon: number;
  dist: number;
  moving: number;
}

/** Weight of moving time in the simplification: a 1 s timing error counts like 0.5 m off the line. */
const TIME_WEIGHT = 0.5;

/**
 * Simplifies a recording to at most `maxPoints`, keeping both its shape and its timing (moving
 * time is a third dimension in Douglas–Peucker), so ghost runners still speed up and slow
 * down where you did. The tolerance starts at 2 m and grows until the budget is met.
 */
export function simplifyTrack(points: TrackInput[], maxPoints = 600): Track {
  const n = points.length;
  const p0 = points[0];
  const proj = projector(p0.lat, p0.lon);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const [px, py] = proj(points[i].lat, points[i].lon);
    x[i] = px;
    y[i] = py;
    z[i] = points[i].moving * TIME_WEIGHT;
  }
  let eps = 2;
  let kept = douglasPeucker(x, y, z, eps);
  while (kept.length > maxPoints) {
    eps *= 1.6;
    kept = douglasPeucker(x, y, z, eps);
  }
  const m = kept.length;
  const track: Track = { lon: new Float64Array(m), lat: new Float64Array(m), dist: new Float32Array(m), moving: new Float32Array(m) };
  kept.forEach((i, k) => {
    track.lon[k] = points[i].lon;
    track.lat[k] = points[i].lat;
    track.dist[k] = points[i].dist;
    track.moving[k] = points[i].moving;
  });
  return track;
}

/** Largest index with arr[i] <= v (arr non-decreasing); -1 when v < arr[0]. */
export function lastAtOrBelow(arr: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  if (!(v >= arr[0])) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid] <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Position at a cumulative value (distance or moving time) along the track, interpolated. */
export function interpolateAlong(track: Track, key: ArrayLike<number>, v: number): [number, number] {
  const n = key.length;
  const i = lastAtOrBelow(key, v);
  if (i < 0) return [track.lon[0], track.lat[0]];
  if (i >= n - 1) return [track.lon[n - 1], track.lat[n - 1]];
  const span = key[i + 1] - key[i];
  const u = span > 0 ? (v - key[i]) / span : 0;
  return [track.lon[i] + u * (track.lon[i + 1] - track.lon[i]), track.lat[i] + u * (track.lat[i + 1] - track.lat[i])];
}

/** Track length along its geometry (meters), which can differ slightly from the file's distance. */
export function trackLength(track: Track): number {
  let d = 0;
  for (let i = 1; i < track.lon.length; i++) d += haversine(track.lat[i - 1], track.lon[i - 1], track.lat[i], track.lon[i]);
  return d;
}

/** `count` points evenly spaced by distance along the track, as [lon, lat]. */
export function resampleByDistance(track: Track, count: number): [number, number][] {
  const n = track.lon.length;
  const total = track.dist[n - 1];
  const out: [number, number][] = [];
  for (let k = 0; k < count; k++) out.push(interpolateAlong(track, track.dist, count === 1 ? 0 : (total * k) / (count - 1)));
  return out;
}
