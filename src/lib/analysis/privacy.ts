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
  const centers = [0, n - 1, ...breaks.flatMap((b) => (b > 0 && b < n ? [b - 1, b] : []))].map((i) => samples[i]);
  for (let i = 0; i < n; i++) {
    const p = samples[i];
    if (centers.some((c) => haversine(c.lat, c.lon, p.lat, p.lon) < radius)) visible[i] = 0;
  }
  let from = visible.indexOf(1);
  let to = visible.lastIndexOf(1);
  // A route that never leaves the circle: show nothing rather than leak it.
  const empty = from < 0;
  if (empty) from = to = 0;
  return { radius, visible, from, to, empty };
}
