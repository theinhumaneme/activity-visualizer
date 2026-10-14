import { interpolateAlong, lastAtOrBelow } from "./simplify";
import type { Track } from "./types";

/**
 * Ghost race: every run of a route starts at once and is replayed by its own MOVING time, so a
 * stop at a crossing doesn't cost a ghost anything (it didn't in your moving time either).
 */
export interface Runner {
  id: string;
  track: Track;
}

const last = (a: ArrayLike<number>) => a[a.length - 1];
export const finishTime = (t: Track) => last(t.moving);

/** Distance covered after `tau` moving seconds. */
export function distanceAt(t: Track, tau: number): number {
  const i = lastAtOrBelow(t.moving, tau);
  const n = t.moving.length;
  if (i < 0) return 0;
  if (i >= n - 1) return last(t.dist);
  const span = t.moving[i + 1] - t.moving[i];
  const u = span > 0 ? (tau - t.moving[i]) / span : 0;
  return t.dist[i] + u * (t.dist[i + 1] - t.dist[i]);
}

/** Moving seconds this run took to reach fraction `p` (0–1) of its own length. */
export function timeAtProgress(t: Track, p: number): number {
  const target = Math.max(0, Math.min(1, p)) * last(t.dist);
  const i = lastAtOrBelow(t.dist, target);
  const n = t.dist.length;
  if (i < 0) return 0;
  if (i >= n - 1) return finishTime(t);
  // Several points can share one distance (standing still); take the first time it was reached.
  let j = i;
  while (j > 0 && t.dist[j - 1] === t.dist[i]) j--;
  const span = t.dist[i + 1] - t.dist[i];
  if (span <= 0 || target === t.dist[i]) return t.moving[j];
  return t.moving[i] + ((target - t.dist[i]) / span) * (t.moving[i + 1] - t.moving[i]);
}

export const positionAt = (t: Track, tau: number) => interpolateAlong(t, t.moving, tau);

export interface Standing {
  id: string;
  rank: number;
  /** Fraction of the route covered (each run against its own recorded length, so GPS differences don't decide the race). */
  progress: number;
  done: boolean;
  /** Seconds behind the leader at the same point of the route (0 for the leader). */
  gap: number;
  distance: number;
  at: [number, number];
}

/** Live leaderboard at race time `tau` (moving seconds since the gun). */
export function standings(runners: Runner[], tau: number): Standing[] {
  const rows = runners.map((r) => {
    const fin = finishTime(r.track);
    const done = tau >= fin;
    const distance = distanceAt(r.track, tau);
    const length = last(r.track.dist);
    return { r, fin, done, distance, progress: done ? 1 : length > 0 ? distance / length : 0 };
  });
  rows.sort((a, b) => (a.done && b.done ? a.fin - b.fin : b.progress - a.progress || a.fin - b.fin));
  const leader = rows[0];
  return rows.map((x, k) => {
    let gap = 0;
    if (k > 0) {
      if (x.done) gap = x.fin - leader.fin;
      else gap = tau - timeAtProgress(leader.r.track, x.progress);
    }
    return { id: x.r.id, rank: k + 1, progress: x.progress, done: x.done, gap: Math.max(0, gap), distance: x.distance, at: positionAt(x.r.track, tau) };
  });
}

/**
 * The last `seconds` of a ghost's path, split into `parts` pieces oldest → newest, so each piece
 * can be drawn a little more opaque than the one before (a fading trail).
 */
export function trail(t: Track, tau: number, seconds: number, parts = 4, perPart = 4): [number, number][][] {
  const end = Math.min(tau, finishTime(t));
  const start = Math.max(0, end - seconds);
  if (end <= start) return [];
  const out: [number, number][][] = [];
  for (let p = 0; p < parts; p++) {
    const a = start + ((end - start) * p) / parts;
    const b = start + ((end - start) * (p + 1)) / parts;
    const piece: [number, number][] = [];
    for (let k = 0; k <= perPart; k++) piece.push(positionAt(t, a + ((b - a) * k) / perPart));
    out.push(piece);
  }
  return out;
}
