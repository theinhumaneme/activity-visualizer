// Fitness, fatigue and form from each activity's training load (the TrainingPeaks / Strava
// "Fitness & Freshness" model): fitness is a 42-day exponential average of daily load, fatigue a
// 7-day one, and form is yesterday's fitness minus yesterday's fatigue.

import { DAY_MS, localDay, localMs } from "./aggregate";
import type { LibraryRecord } from "./types";

export const FITNESS_DAYS = 42;
export const FATIGUE_DAYS = 7;

/** Heart-rate TRIMP when the activity has heart rate, otherwise power TSS; none without either. */
export const activityLoad = (r: Pick<LibraryRecord, "trimp" | "tss">): number | undefined => r.trimp ?? r.tss;

export interface LoadDay {
  /** Days since 1970-01-01, local time. */
  day: number;
  /** Load recorded that day. */
  load: number;
  fitness: number;
  fatigue: number;
  form: number;
}

/** Today as a local day number (the browser's time zone). */
export const today = (now = Date.now()) => Math.floor(localMs(now) / DAY_MS);

/**
 * One entry per day from the first activity with a load through `through` (default: the last
 * one). Days without an activity have zero load, so fitness and fatigue decay over breaks.
 */
export function trainingLoad(records: LibraryRecord[], through?: number): LoadDay[] {
  const byDay = new Map<number, number>();
  for (const r of records) {
    const load = activityLoad(r);
    if (load === undefined || !Number.isFinite(load)) continue;
    const d = localDay(r);
    byDay.set(d, (byDay.get(d) ?? 0) + load);
  }
  if (!byDay.size) return [];
  const days = [...byDay.keys()];
  const first = Math.min(...days);
  const last = Math.max(Math.max(...days), through ?? -Infinity);
  const out: LoadDay[] = [];
  let fitness = 0;
  let fatigue = 0;
  for (let d = first; d <= last; d++) {
    const load = byDay.get(d) ?? 0;
    const form = fitness - fatigue;
    fitness += (load - fitness) / FITNESS_DAYS;
    fatigue += (load - fatigue) / FATIGUE_DAYS;
    out.push({ day: d, load, fitness, fatigue, form });
  }
  return out;
}

/**
 * A word for form, judged as a share of fitness (as Intervals.icu does) so it reads the same
 * whether load is heart-rate TRIMP or power TSS, which run on different scales.
 */
export function formWord(form: number, fitness: number): string {
  const pct = fitness > 0 ? (form / fitness) * 100 : 0;
  if (pct > 20) return "very fresh, maybe losing fitness";
  if (pct > 5) return "fresh";
  if (pct >= -10) return "neutral";
  if (pct >= -30) return "training hard";
  return "very tired: time to back off";
}
