// Race-time predictions from your best efforts with Riegel's formula, T₂ = T₁ × (D₂ / D₁)^1.06.
// It assumes you've trained for the distance: marathon times from short efforts read optimistic.

import type { PersonalRecord } from "./records";

export const RACES = [
  { label: "5K", distance: 5000 },
  { label: "10K", distance: 10000 },
  { label: "Half marathon", distance: 21097.5 },
  { label: "Marathon", distance: 42195 },
];
const RIEGEL = 1.06;
/** Efforts more than this many times shorter or longer than the race don't predict it. */
const MAX_RATIO = 4.5;
/** Shorter efforts than this say more about speed than endurance. */
const MIN_EFFORT = 3000;

export interface Prediction {
  label: string;
  distance: number;
  seconds: number;
  /** The best effort it's predicted from. */
  from: PersonalRecord;
  /** The effort is the race distance itself: this is your record, not a prediction. */
  actual: boolean;
}

export const riegel = (seconds: number, from: number, to: number) => seconds * (to / from) ** RIEGEL;

/**
 * For each race, the fastest prediction from a run best effort of 3 km or more within 4.5× of
 * the distance (an easy long run's 10K would otherwise drag the estimate down).
 */
export function predictRaces(prs: PersonalRecord[]): Prediction[] {
  const efforts = prs.filter((p) => p.kind === "run" && p.distance >= MIN_EFFORT && p.seconds > 0);
  const out: Prediction[] = [];
  for (const race of RACES) {
    let best: Prediction | null = null;
    for (const p of efforts) {
      const ratio = race.distance / p.distance;
      if (ratio > MAX_RATIO || ratio < 1 / MAX_RATIO) continue;
      const actual = Math.abs(p.distance - race.distance) < 1;
      const seconds = actual ? p.seconds : riegel(p.seconds, p.distance, race.distance);
      if (!best || seconds < best.seconds) best = { ...race, seconds, from: p, actual };
    }
    if (best) out.push(best);
  }
  return out;
}
