// Ghost race in the flyover: earlier runs of the same route (from the library) replayed beside
// you by moving time, as in the library's 2D race, so stops cost nobody anything.

import { atIndex } from "../analysis/series";
import type { Analysis } from "../analysis/types";
import type { LngLat } from "../geo/geo";
import { privacyTest } from "../library/privacy";
import { finishTime, positionAt, timeAtProgress } from "../library/race";
import type { Track } from "../library/types";

export interface GhostRunner {
  id: string;
  /** "Best · Jul 26", "Jul 12"… */
  label: string;
  color: string;
  track: Track;
}

export interface GhostAt {
  g: GhostRunner;
  /** Where the ghost is (null inside a privacy circle). */
  at: LngLat | null;
  /** Seconds you are behind this ghost at the same point of the route (negative: ahead). */
  gap: number;
}

/** Every ghost at the athlete's fractional sample index. */
export function ghostsAt(a: Analysis, ghosts: readonly GhostRunner[], index: number): GhostAt[] {
  const tau = atIndex(a.movingTime, index);
  const length = a.dist[a.n - 1];
  const progress = length > 0 ? atIndex(a.dist, index) / length : 0;
  const finished = index >= a.n - 1;
  return ghosts.map((g) => {
    const fin = finishTime(g.track);
    const at = positionAt(g.track, Math.min(tau, fin)) as LngLat;
    const ok = privacyTest(g.track, a.settings.privacyRadius);
    // Compared at the same fraction of each run's own length, so GPS differences don't decide it.
    const gap = finished ? a.summary.moving - fin : tau - timeAtProgress(g.track, progress);
    return { g, at: ok(at[0], at[1]) ? at : null, gap };
  });
}

/** "12 s ahead", "1:05 behind", "level". */
export function gapWords(gap: number): string {
  const s = Math.round(Math.abs(gap));
  if (s < 1) return "level";
  const t = s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  // gap > 0: you're behind the ghost, so the ghost is ahead.
  return gap > 0 ? `${t} ahead` : `${t} behind`;
}
