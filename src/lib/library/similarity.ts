import { haversine } from "../geo/geo";
import type { SportKind } from "../parse/types";
import { projector, resampleByDistance } from "./simplify";
import type { LibraryRecord } from "./types";

/** Thresholds for "the same route". */
export const SAME_ROUTE = {
  /** Start points and end points each within this many meters. */
  endpoint: 150,
  /** Lengths within ±10%. */
  lengthRatio: 0.1,
  /** Symmetric Hausdorff distance (point to polyline) under this many meters. */
  hausdorff: 120,
  /** Points each route is resampled to for the shape comparison. */
  samples: 50,
};

export interface RouteShape {
  id: string;
  kind: SportKind;
  length: number;
  start: [number, number];
  end: [number, number];
  /** SAME_ROUTE.samples points evenly spaced by distance, [lon, lat]. */
  points: [number, number][];
}

export function routeShape(r: LibraryRecord): RouteShape | null {
  const t = r.track;
  if (!t || t.lon.length < 2 || r.distance < 200) return null;
  const n = t.lon.length;
  return {
    id: r.id,
    kind: r.kind,
    length: r.distance,
    start: [t.lon[0], t.lat[0]],
    end: [t.lon[n - 1], t.lat[n - 1]],
    points: resampleByDistance(t, SAME_ROUTE.samples),
  };
}

const dist = (p: [number, number], q: [number, number]) => haversine(p[1], p[0], q[1], q[0]);

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let u = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  return Math.hypot(px - ax - u * dx, py - ay - u * dy);
}

/** Directed Hausdorff: the farthest any point of A lies from the polyline B (meters, projected). */
function directed(a: [number, number][], b: [number, number][]) {
  let worst = 0;
  for (const [px, py] of a) {
    let best = Infinity;
    for (let j = 1; j < b.length && best > worst; j++) best = Math.min(best, segDist(px, py, b[j - 1][0], b[j - 1][1], b[j][0], b[j][1]));
    if (best > worst) worst = best;
  }
  return worst;
}

/** Symmetric Hausdorff distance in meters between two polylines given as [lon, lat]. */
export function hausdorff(a: [number, number][], b: [number, number][]): number {
  const proj = projector(a[0][1], a[0][0]);
  const pa = a.map(([lon, lat]) => proj(lat, lon));
  const pb = b.map(([lon, lat]) => proj(lat, lon));
  return Math.max(directed(pa, pb), directed(pb, pa));
}

/**
 * Hausdorff ignores direction, so a loop run clockwise matches the same loop run the other way.
 * For a race they're different routes: compare positions at the same fraction of the way round.
 */
function sameDirection(a: RouteShape, b: RouteShape): boolean {
  const n = a.points.length;
  const d: number[] = [];
  for (let k = 1; k <= 9; k++) {
    const i = Math.round((k / 10) * (n - 1));
    d.push(dist(a.points[i], b.points[i]));
  }
  d.sort((x, y) => x - y);
  return d[4] < Math.max(SAME_ROUTE.hausdorff, 0.08 * Math.max(a.length, b.length));
}

export function sameRoute(a: RouteShape, b: RouteShape): boolean {
  if (a.kind !== b.kind) return false;
  if (Math.abs(a.length - b.length) > SAME_ROUTE.lengthRatio * Math.max(a.length, b.length)) return false;
  if (dist(a.start, b.start) > SAME_ROUTE.endpoint || dist(a.end, b.end) > SAME_ROUTE.endpoint) return false;
  if (!sameDirection(a, b)) return false;
  return hausdorff(a.points, b.points) < SAME_ROUTE.hausdorff;
}

export interface RouteGroup {
  id: string;
  label: string;
  /** Record ids, oldest first. */
  members: string[];
  kind: SportKind;
  /** Median distance of the members, meters. */
  distance: number;
  loop: boolean;
}

const GENERIC_NAME =
  /^(?:(?:morning|lunch|afternoon|evening|night|early|late)\s+)?(?:run|running|ride|cycling|bike|walk|walking|hike|hiking|ski|skiing|paddle|kayak|swim|swimming|activity|workout|other)$/i;

/** A name shared by at least half the runs, unless it's a generic "Morning Run"; otherwise "5.2 km loop". */
export function groupLabel(records: LibraryRecord[], loop: boolean, distance: number, unitLen = 1000, unit = "km"): string {
  const counts = new Map<string, number>();
  for (const r of records) {
    const name = r.name.trim();
    if (name && !GENERIC_NAME.test(name)) counts.set(name.toLowerCase(), (counts.get(name.toLowerCase()) ?? 0) + 1);
  }
  const [top] = [...counts.entries()].sort((x, y) => y[1] - x[1]);
  if (top && top[1] * 2 >= records.length) {
    const original = records.find((r) => r.name.trim().toLowerCase() === top[0])!.name.trim();
    return original.charAt(0).toUpperCase() + original.slice(1);
  }
  return `${(distance / unitLen).toFixed(1)} ${unit} ${loop ? "loop" : "route"}`;
}

/**
 * Groups repeated routes. Greedy, in date order: each run joins the first group whose anchor
 * (its oldest run) it matches, so chains of slightly-drifting runs can't merge distinct routes.
 * Returns only routes run at least twice, most-run first.
 */
export function groupRoutes(records: LibraryRecord[], unitLen = 1000, unit = "km"): RouteGroup[] {
  const sorted = [...records].sort((a, b) => a.startTime - b.startTime);
  const groups: { anchor: RouteShape; members: LibraryRecord[] }[] = [];
  for (const r of sorted) {
    const shape = routeShape(r);
    if (!shape) continue;
    const g = groups.find((x) => sameRoute(x.anchor, shape));
    if (g) g.members.push(r);
    else groups.push({ anchor: shape, members: [r] });
  }
  return groups
    .filter((g) => g.members.length >= 2)
    .map((g) => {
      const ds = g.members.map((m) => m.distance).sort((a, b) => a - b);
      const distance = ds[Math.floor(ds.length / 2)];
      const loop = dist(g.anchor.start, g.anchor.end) <= SAME_ROUTE.endpoint;
      return {
        id: g.anchor.id,
        label: groupLabel(g.members, loop, distance, unitLen, unit),
        members: g.members.map((m) => m.id),
        kind: g.anchor.kind,
        distance,
        loop,
      };
    })
    .sort((a, b) => b.members.length - a.members.length || a.id.localeCompare(b.id));
}
