// New ground: how much of each activity went where none of your earlier ones had. The world is
// cut into ~30 m cells; a stretch is new when no cell around it was touched before.

import { haversine } from "../geo/geo";
import type { LibraryRecord } from "./types";

const CELL = 30;
const STEP = 10;
const M_PER_DEG = 111_320;
/** Within one activity, ground passed this many steps ago counts as covered (so an out-and-back is new once). */
const SELF_LAG = 15;
/** Faster than this between two kept points is a GPS gap or a ride in a car, not ground covered. */
const JUMP_SPEED = 15;

export interface Exploration {
  /** New ground per activity id, meters. */
  newDistance: Map<string, number>;
  /** Unique ground over everything so far, meters, after each activity in time order. */
  cumulative: { id: string; startTime: number; total: number }[];
}

const cellOf = (lat: number, lon: number) => {
  const iy = Math.floor((lat * M_PER_DEG) / CELL);
  const ix = Math.floor((lon * M_PER_DEG * Math.cos((lat * Math.PI) / 180)) / CELL);
  return { ix, iy };
};
const key = (ix: number, iy: number) => ix * 1_000_000 + iy + 500_000;

function near(set: Set<number>, ix: number, iy: number): boolean {
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (set.has(key(ix + dx, iy + dy))) return true;
  return false;
}

/** Walks every activity with a route, oldest first, across all sports: a street walked isn't new on a run. */
export function explore(records: LibraryRecord[]): Exploration {
  const seen = new Set<number>();
  const newDistance = new Map<string, number>();
  const cumulative: Exploration["cumulative"] = [];
  let total = 0;
  for (const r of [...records].sort((a, b) => a.startTime - b.startTime)) {
    const t = r.track;
    if (!t || t.lon.length < 2) continue;
    const own = new Set<number>();
    const pending: number[] = [];
    let fresh = 0;
    const visit = (lat: number, lon: number, len: number) => {
      const { ix, iy } = cellOf(lat, lon);
      if (pending.length >= SELF_LAG) own.add(pending.shift()!);
      pending.push(key(ix, iy));
      if (!near(seen, ix, iy) && !near(own, ix, iy)) fresh += len;
    };
    for (let i = 1; i < t.lon.length; i++) {
      const d = haversine(t.lat[i - 1], t.lon[i - 1], t.lat[i], t.lon[i]);
      const dt = t.moving[i] - t.moving[i - 1];
      if (d > 200 && d > dt * JUMP_SPEED) continue;
      const n = Math.max(1, Math.ceil(d / STEP));
      for (let k = 1; k <= n; k++) {
        const f = k / n;
        visit(t.lat[i - 1] + f * (t.lat[i] - t.lat[i - 1]), t.lon[i - 1] + f * (t.lon[i] - t.lon[i - 1]), d / n);
      }
    }
    for (const c of pending) own.add(c);
    for (const c of own) seen.add(c);
    // Never more new ground than the activity's own distance (the simplified track runs a little short or long).
    const n = Math.min(fresh, r.distance);
    newDistance.set(r.id, n);
    total += n;
    cumulative.push({ id: r.id, startTime: r.startTime, total });
  }
  return { newDistance, cumulative };
}
