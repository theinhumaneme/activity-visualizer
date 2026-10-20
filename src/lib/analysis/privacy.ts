import { haversine } from "../geo/geo";
import type { Sample } from "../parse/types";

export interface Privacy {
  /** Radius in meters around the start and the finish; 0 = off. */
  radius: number;
  /** visible[i] = 0 when sample i lies inside a privacy circle. */
  visible: Uint8Array;
  /** First and last visible sample (the flyover plays only this range). */
  from: number;
  to: number;
  /** The whole route is inside the circles, so nothing may be drawn. */
  empty: boolean;
}

/**
 * Hides everything within `radius` of the start and the finish, wherever the route passes
 * through those circles (a loop that comes home mid-run is hidden there too). Stats still use
 * the full data; only drawing, the camera and exports respect this. `breaks` are the first
 * samples of the later activities in a combined day: each of those starts and the finish before
 * it get a circle too, since they're as telling as the day's own start and finish.
 */
export function computePrivacy(samples: Sample[], radius: number, breaks: readonly number[] = []): Privacy {
  const n = samples.length;
  const visible = new Uint8Array(n).fill(1);
  if (radius <= 0 || n < 2) return { radius: 0, visible, from: 0, to: n - 1, empty: false };
  const s0 = samples[0];
  const s1 = samples[n - 1];
  // A combined day's inner finishes and starts (none for a single activity). A day can have dozens:
  // a box around each rules most points out before the exact distance.
  const inner = breaks.flatMap((b) => (b > 0 && b < n ? [samples[b - 1], samples[b]] : []));
  const m = inner.length;
  const cLat = Float64Array.from(inner, (c) => c.lat);
  const cLon = Float64Array.from(inner, (c) => c.lon);
  const dLat = (radius / 110_540) * 1.01;
  const dLon = Float64Array.from(inner, (c) => dLat / Math.max(0.01, Math.cos((c.lat * Math.PI) / 180)));
  const nearInner = (lat: number, lon: number) => {
    for (let k = 0; k < m; k++) {
      if (Math.abs(lat - cLat[k]) < dLat && Math.abs(lon - cLon[k]) < dLon[k] && haversine(cLat[k], cLon[k], lat, lon) < radius) return true;
    }
    return false;
  };
  for (let i = 0; i < n; i++) {
    const p = samples[i];
    if (haversine(s0.lat, s0.lon, p.lat, p.lon) < radius || haversine(s1.lat, s1.lon, p.lat, p.lon) < radius || (m > 0 && nearInner(p.lat, p.lon))) visible[i] = 0;
  }
  let from = visible.indexOf(1);
  let to = visible.lastIndexOf(1);
  // A route that never leaves the circle: show nothing rather than leak it.
  const empty = from < 0;
  if (empty) from = to = 0;
  return { radius, visible, from, to, empty };
}
