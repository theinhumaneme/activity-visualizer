// Climb detection on smoothed elevation, categorized like the big cycling tours / Strava:
// score = length (m) × average grade (%). Short urban rises get "Climb" with no category.

export interface Climb {
  startIdx: number;
  endIdx: number;
  length: number;
  gain: number;
  /** Average grade, fraction. */
  grade: number;
  /** "HC", "1"…"4", or null when it doesn't reach category 4. */
  category: string | null;
  /** Moving seconds spent on it (timed activities, climbs of a minute or more). */
  duration?: number;
  /** Vertical meters per hour over that time. */
  vam?: number;
}

const CATEGORIES: [string, number][] = [
  ["HC", 80000],
  ["1", 64000],
  ["2", 32000],
  ["3", 16000],
  ["4", 8000],
];

/**
 * Scans for rises: a climb runs from a low point to the highest point reached before the
 * elevation falls back by more than max(3 m, 25% of the gain so far). Keeps climbs with
 * ≥ 8 m gain, ≥ 100 m length and ≥ 2.5% average grade.
 */
export function detectClimbs(dist: Float64Array, elev: Float64Array): Climb[] {
  const n = elev.length;
  const out: Climb[] = [];
  let lo = 0;
  let hi = 0;
  for (let i = 1; i < n; i++) {
    if (elev[i] > elev[hi]) hi = i;
    const gain = elev[hi] - elev[lo];
    if (elev[i] < elev[lo]) {
      lo = hi = i;
      continue;
    }
    const fallback = elev[hi] - elev[i];
    if (hi > lo && fallback > Math.max(3, gain * 0.25)) {
      push(lo, hi);
      lo = hi = i;
    }
  }
  if (hi > lo) push(lo, hi);
  return out;

  function push(a: number, b: number) {
    const length = dist[b] - dist[a];
    const gain = elev[b] - elev[a];
    if (gain < 8 || length < 100) return;
    const grade = gain / length;
    if (grade < 0.025) return;
    const score = length * grade * 100;
    const category = CATEGORIES.find(([, min]) => score >= min)?.[0] ?? null;
    out.push({ startIdx: a, endIdx: b, length, gain, grade, category });
  }
}

export const climbLabel = (c: Climb) => (c.category === "HC" ? "HC climb" : c.category ? `Cat ${c.category} climb` : "Climb");
