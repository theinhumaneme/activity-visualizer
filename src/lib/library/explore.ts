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

const cellX = (lat: number, lon: number) => Math.floor((lon * M_PER_DEG * Math.cos((lat * Math.PI) / 180)) / CELL);
const cellY = (lat: number) => Math.floor((lat * M_PER_DEG) / CELL);

/**
 * A set of (ix, iy) cells: open addressing over typed arrays. A library walks millions of cells,
 * and a Set<number> keyed by ix·10⁶ + iy is about twice as slow: keys that big aren't small
 * integers in V8, so every lookup boxes and hashes a double.
 */
class CellSet {
  private xs = new Int32Array(1024);
  private ys = new Int32Array(1024);
  private used = new Uint8Array(1024);
  private size = 0;

  private slot(x: number, y: number): number {
    const mask = this.used.length - 1;
    let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77)) & mask;
    while (this.used[h] && (this.xs[h] !== x || this.ys[h] !== y)) h = (h + 1) & mask;
    return h;
  }

  add(x: number, y: number): void {
    const h = this.slot(x, y);
    if (this.used[h]) return;
    this.used[h] = 1;
    this.xs[h] = x;
    this.ys[h] = y;
    if (++this.size * 2 > this.used.length) this.grow();
  }

  /** Whether this cell or one of its eight neighbors is in the set. */
  near(x: number, y: number): boolean {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (this.used[this.slot(x + dx, y + dy)]) return true;
    return false;
  }

  /** Adds every cell of `other`. */
  addAll(other: CellSet): void {
    for (let h = 0; h < other.used.length; h++) if (other.used[h]) this.add(other.xs[h], other.ys[h]);
  }

  private grow(): void {
    const { xs, ys, used } = this;
    this.xs = new Int32Array(used.length * 2);
    this.ys = new Int32Array(used.length * 2);
    this.used = new Uint8Array(used.length * 2);
    this.size = 0;
    for (let h = 0; h < used.length; h++) if (used[h]) this.add(xs[h], ys[h]);
  }
}

/** Walks every activity with a route, oldest first, across all sports: a street walked isn't new on a run. */
export function explore(records: LibraryRecord[]): Exploration {
  const seen = new CellSet();
  const newDistance = new Map<string, number>();
  const cumulative: Exploration["cumulative"] = [];
  let total = 0;
  for (const r of [...records].sort((a, b) => a.startTime - b.startTime)) {
    const t = r.track;
    if (!t || t.lon.length < 2) continue;
    const own = new CellSet();
    // The last SELF_LAG cells visited, oldest at `head`: they join `own` once they're that far behind.
    const lagX = new Int32Array(SELF_LAG);
    const lagY = new Int32Array(SELF_LAG);
    let lagged = 0;
    let head = 0;
    let fresh = 0;
    const visit = (lat: number, lon: number, len: number) => {
      const ix = cellX(lat, lon);
      const iy = cellY(lat);
      if (lagged === SELF_LAG) own.add(lagX[head], lagY[head]);
      else lagged++;
      lagX[head] = ix;
      lagY[head] = iy;
      head = (head + 1) % SELF_LAG;
      if (!seen.near(ix, iy) && !own.near(ix, iy)) fresh += len;
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
    for (let k = 0; k < lagged; k++) own.add(lagX[k], lagY[k]);
    seen.addAll(own);
    // Never more new ground than the activity's own distance (the simplified track runs a little short or long).
    const n = Math.min(fresh, r.distance);
    newDistance.set(r.id, n);
    total += n;
    cumulative.push({ id: r.id, startTime: r.startTime, total });
  }
  return { newDistance, cumulative };
}
