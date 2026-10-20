// Climbing and recovery metrics that build on the core pass: VAM for each climb, the steepest
// stretches of the route, and how far heart rate falls in the minute after you stop.

import type { Climb } from "./climbs";
import { atIndex, indexAtDistCursor, lowerIndex } from "./series";

/** A fixed-length stretch picked for its grade. */
export interface GradeStretch {
  startIdx: number;
  endIdx: number;
  /** Meters. */
  length: number;
  /** Average grade, fraction (negative downhill). */
  grade: number;
  /** Moving speed over it, m/s (absent without timestamps). */
  speed?: number;
}

export interface Steepest {
  up100?: GradeStretch;
  up1k?: GradeStretch;
  down1k?: GradeStretch;
}

export interface HrRecovery {
  /** Average over the last 5 s before stopping, bpm. */
  from: number;
  /** One minute later, bpm. */
  to: number;
  /** from − to. */
  drop: number;
  /** Sample index where you stopped. */
  atIdx: number;
  /** After the finish, or at the longest stop along the way. */
  source: "finish" | "stop";
}

/** Climbs shorter than this in moving time get no VAM: a few seconds' rise reads absurdly fast. */
const MIN_VAM_SECONDS = 60;

/**
 * VAM (vertical meters per hour) for each climb, over the moving time spent on it, and the
 * climbing VAM across all of them (total climb gain ÷ total climb time).
 */
export function withVam(climbs: Climb[], movingTime: Float64Array): { climbs: Climb[]; vam?: number } {
  let gain = 0;
  let secs = 0;
  const out = climbs.map((c) => {
    const duration = movingTime[c.endIdx] - movingTime[c.startIdx];
    if (!(duration >= MIN_VAM_SECONDS)) return c;
    gain += c.gain;
    secs += duration;
    return { ...c, duration, vam: (c.gain / duration) * 3600 };
  });
  return { climbs: out, vam: secs > 0 ? (gain / secs) * 3600 : undefined };
}

/**
 * The steepest 100 m and 1 km uphill and the steepest 1 km downhill, on the smoothed elevation.
 * Stretches too gentle to be worth naming (under 3% for 100 m, 2% for 1 km) are left out.
 */
export function steepest(dist: Float64Array, elev: Float64Array, movingTime: Float64Array | null): Steepest {
  const total = dist[dist.length - 1];
  const out: Steepest = {};
  const scan = (length: number) => {
    let up: GradeStretch | undefined;
    let down: GradeStretch | undefined;
    if (total < length * 1.5) return { up, down };
    const endAt = indexAtDistCursor(dist);
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] + length > total) break;
      const j = endAt(dist[i] + length);
      const grade = (atIndex(elev, j) - elev[i]) / length;
      if (!up || grade > up.grade) up = { startIdx: i, endIdx: Math.ceil(j), length, grade };
      if (!down || grade < down.grade) down = { startIdx: i, endIdx: Math.ceil(j), length, grade };
    }
    const timed = (s: GradeStretch | undefined) => {
      if (!s || !movingTime) return s;
      const secs = movingTime[s.endIdx] - movingTime[s.startIdx];
      return secs > 0 ? { ...s, speed: length / secs } : s;
    };
    return { up: timed(up), down: timed(down) };
  };
  const short = scan(100);
  const long = scan(1000);
  if (short.up && short.up.grade >= 0.03) out.up100 = short.up;
  if (long.up && long.up.grade >= 0.02) out.up1k = long.up;
  if (long.down && long.down.grade <= -0.02) out.down1k = long.down;
  return out;
}

/** Heart rate at a moment, from the nearest reading within 5 s (NaN if none). */
function hrAt(t: Float64Array, hr: Float64Array, time: number): number {
  const i = lowerIndex(t, time);
  for (let k = 0; k <= 5; k++) {
    for (const j of [i + k, i - k]) if (j >= 0 && j < t.length && Math.abs(t[j] - time) <= 5 && Number.isFinite(hr[j])) return hr[j];
  }
  return NaN;
}

function recoveryAt(t: Float64Array, hr: Float64Array, idx: number, source: HrRecovery["source"]): HrRecovery | undefined {
  const t0 = t[idx];
  let sum = 0;
  let cnt = 0;
  for (let i = idx; i >= 0 && t0 - t[i] <= 5; i--) {
    if (Number.isFinite(hr[i])) {
      sum += hr[i];
      cnt++;
    }
  }
  const from = cnt ? sum / cnt : NaN;
  const to = hrAt(t, hr, t0 + 60);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return undefined;
  return { from, to, drop: from - to, atIdx: idx, source };
}

/**
 * Heart-rate recovery: the drop in the minute after you stop. Uses the time after the finish when
 * the recording kept going for a minute, otherwise the longest stop of at least a minute that
 * came after 10 minutes of moving.
 */
export function hrRecovery(
  t: Float64Array,
  hr: Float64Array,
  moving: Uint8Array,
  movingTime: Float64Array,
  stops: { startIdx: number; endIdx: number; duration: number }[],
): HrRecovery | undefined {
  const n = t.length;
  let last = -1;
  for (let i = n - 2; i >= 0; i--) {
    if (moving[i]) {
      last = i + 1;
      break;
    }
  }
  if (last > 0 && t[n - 1] - t[last] >= 60 && movingTime[last] >= 600) {
    const r = recoveryAt(t, hr, last, "finish");
    if (r) return r;
  }
  const longest = stops
    .filter((s) => s.duration >= 60 && movingTime[s.startIdx] >= 600)
    .reduce<(typeof stops)[number] | null>((best, s) => (!best || s.duration > best.duration ? s : best), null);
  return longest ? recoveryAt(t, hr, longest.startIdx, "stop") : undefined;
}
