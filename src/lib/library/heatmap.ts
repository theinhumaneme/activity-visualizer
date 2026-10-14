import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import { haversine } from "../geo/geo";
import { localDay } from "./aggregate";
import { privacyTest } from "./privacy";
import type { LibraryRecord } from "./types";

export interface HeatmapData {
  /** Densified points (every `step` m) with a `day` property, for the heatmap layer. */
  points: FeatureCollection<Point, { day: number }>;
  /** Visible stretches of each route, with `day`, for the thin lines on top. */
  lines: FeatureCollection<LineString, { day: number; id: string }>;
  /** [west, south, east, north] of everything drawn, or null when nothing is. */
  bounds: [number, number, number, number] | null;
  step: number;
  /** First and last day (days since epoch, local) among drawn routes. */
  days: [number, number] | null;
}

/**
 * Builds the heatmap's GeoJSON with every point inside a privacy circle (radius around each
 * run's own start and finish) removed. Lines break wherever the route enters a circle, so no
 * segment is ever drawn across one. Spacing grows when the library is huge, to stay under
 * `maxPoints`.
 */
export function heatmapData(records: LibraryRecord[], radius: number, opts: { step?: number; maxPoints?: number } = {}): HeatmapData {
  const maxPoints = opts.maxPoints ?? 150_000;
  const withTrack = records.filter((r) => r.track && r.track.lon.length >= 2);
  const total = withTrack.reduce((s, r) => s + r.distance, 0);
  const step = Math.max(opts.step ?? 15, total / maxPoints);
  const points: Feature<Point, { day: number }>[] = [];
  const lines: Feature<LineString, { day: number; id: string }>[] = [];
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  let d0 = Infinity, d1 = -Infinity;

  for (const r of withTrack) {
    const t = r.track!;
    const ok = privacyTest(t, radius);
    const day = localDay(r);
    let line: [number, number][] = [];
    const flush = () => {
      if (line.length >= 2) lines.push({ type: "Feature", properties: { day, id: r.id }, geometry: { type: "LineString", coordinates: line } });
      line = [];
    };
    const add = (lon: number, lat: number) => {
      points.push({ type: "Feature", properties: { day }, geometry: { type: "Point", coordinates: [lon, lat] } });
      if (lon < w) w = lon;
      if (lon > e) e = lon;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    };
    let carry = 0; // meters since the last emitted heatmap point
    let drew = false;
    for (let i = 0; i < t.lon.length; i++) {
      const lon = t.lon[i], lat = t.lat[i];
      const vis = ok(lon, lat);
      if (i > 0) {
        const plon = t.lon[i - 1], plat = t.lat[i - 1];
        const seg = haversine(plat, plon, lat, lon);
        // Walk the segment at `step` spacing; any hidden interior point breaks the line.
        let broken = false;
        let u = step - carry;
        while (u < seg) {
          const f = u / seg;
          const x = plon + f * (lon - plon);
          const y = plat + f * (lat - plat);
          if (ok(x, y)) {
            add(x, y);
            drew = true;
          } else broken = true;
          u += step;
        }
        carry = seg - (u - step);
        if (broken) flush();
      }
      if (vis) line.push([lon, lat]);
      else flush();
    }
    flush();
    if (drew) {
      d0 = Math.min(d0, day);
      d1 = Math.max(d1, day);
    }
  }

  return {
    points: { type: "FeatureCollection", features: points },
    lines: { type: "FeatureCollection", features: lines },
    bounds: points.length ? [w, s, e, n] : null,
    step,
    days: d0 <= d1 ? [d0, d1] : null,
  };
}

/**
 * Bounds that frame where you usually run: route centers are clustered (30 km), and the
 * cluster with the most runs wins, so one holiday run abroad doesn't zoom the map out to a
 * continent. Uses only points that survive the privacy circles.
 */
export function focusBounds(lines: HeatmapData["lines"]): { bounds: [number, number, number, number]; elsewhere: number } | null {
  const byRun = new Map<string, [number, number][]>();
  for (const f of lines.features) {
    let pts = byRun.get(f.properties.id);
    if (!pts) byRun.set(f.properties.id, (pts = []));
    for (const c of f.geometry.coordinates) pts.push([c[0], c[1]]);
  }
  if (!byRun.size) return null;
  const runs = [...byRun.values()].map((pts) => {
    const c: [number, number] = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
    return { pts, c };
  });
  const clusters: { c: [number, number]; runs: typeof runs }[] = [];
  for (const r of runs) {
    const cl = clusters.find((k) => haversine(k.c[1], k.c[0], r.c[1], r.c[0]) < 30_000);
    if (cl) cl.runs.push(r);
    else clusters.push({ c: r.c, runs: [r] });
  }
  clusters.sort((a, b) => b.runs.length - a.runs.length);
  const main = clusters[0];
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const r of main.runs)
    for (const [lon, lat] of r.pts) {
      if (lon < w) w = lon;
      if (lon > e) e = lon;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
  return { bounds: [w, s, e, n], elsewhere: runs.length - main.runs.length };
}
