// Several activities as one: a morning and an afternoon ride (or a few days of a trip) stitched
// in start-time order, so the flyover and the video play them as one piece. Each activity keeps
// its own track segments, and the hand-off between two activities always starts a new segment:
// no line is drawn across it, and the flyover bridges it with a camera move (analysis/bridges.ts).
// Distance carries on from where the last activity ended, never across the gap, and the time in
// between is a stop (no ground covered), so it never counts as moving time.

import type { Activity, ActivityPart, Lap, Sample, SportKind } from "../parse/types";
import { SPORTS } from "../sport";
import { DAY_MS, localMs } from "./aggregate";

/** At most this many activities go into one flyover (each is a full sample stream). */
export const MAX_COMBINED = 20;
/** Activities may overlap by this much (a watch started a moment before the last one stopped). */
const OVERLAP_MS = 60_000;

const firstTime = (a: Activity) => a.samples[0]?.time ?? a.startTime;
const lastTime = (a: Activity) => a.samples[a.samples.length - 1]?.time ?? a.startTime;

/**
 * Mixed sports share the day as "other": one pace format can't describe a run and a ride, and
 * each sport's assumptions (a ride's moving threshold, a run's grade-adjusted pace) would be
 * wrong for the other. The same sport throughout keeps that sport.
 */
export function combinedKind(kinds: SportKind[]): SportKind {
  return kinds.every((k) => k === kinds[0]) ? (kinds[0] ?? "other") : "other";
}

const dayFmt = (ms: number, opts: Intl.DateTimeFormatOptions) => new Date(ms).toLocaleDateString(undefined, { ...opts, timeZone: "UTC" });

/** "Oct 20, 2026", "Oct 18 – 20, 2026", "Sep 30 – Oct 2, 2026", "Dec 30, 2025 – Jan 2, 2026". */
export function dateSpan(first: number, last: number, utcOffsetMin?: number): string {
  const a = localMs(first, utcOffsetMin);
  const b = localMs(last, utcOffsetMin);
  const full: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  if (Math.floor(a / DAY_MS) === Math.floor(b / DAY_MS)) return dayFmt(a, full);
  const da = new Date(a);
  const db = new Date(b);
  if (da.getUTCFullYear() !== db.getUTCFullYear()) return `${dayFmt(a, full)} – ${dayFmt(b, full)}`;
  const year = da.getUTCFullYear();
  if (da.getUTCMonth() !== db.getUTCMonth())
    return `${dayFmt(a, { month: "short", day: "numeric" })} – ${dayFmt(b, { month: "short", day: "numeric" })}, ${year}`;
  return `${dayFmt(a, { month: "short", day: "numeric" })} – ${db.getUTCDate()}, ${year}`;
}

/** "2 rides", "1 run + 1 ride" (sports in the order they first appear). */
export function countText(kinds: SportKind[]): string {
  const counts = new Map<SportKind, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts].map(([k, c]) => `${c} ${c === 1 ? SPORTS[k].label.toLowerCase() : SPORTS[k].plural}`).join(" + ");
}

/** "Oct 20, 2026 · 2 rides". */
export function combinedName(acts: Pick<Activity, "kind" | "startTime" | "utcOffsetMin">[], lastStart = acts[acts.length - 1]?.startTime ?? 0): string {
  return `${dateSpan(acts[0].startTime, lastStart, acts[0].utcOffsetMin)} · ${countText(acts.map((a) => a.kind))}`;
}

/**
 * Stitches activities into one, in start-time order. Throws (with a message for the user) when
 * they can't be: fewer than two, a route without timestamps, or two that overlap in time.
 */
export function combineActivities(input: Activity[]): Activity {
  if (input.length < 2) throw new Error("Pick at least two activities to fly together.");
  if (input.length > MAX_COMBINED) throw new Error(`Up to ${MAX_COMBINED} activities fly together; pick fewer.`);
  const acts = [...input].filter((a) => a.samples.length).sort((x, y) => firstTime(x) - firstTime(y));
  if (acts.length < 2) throw new Error("Pick at least two activities with a track.");
  const untimed = acts.find((a) => a.routeOnly);
  if (untimed) throw new Error(`“${untimed.name}” has no timestamps (a planned route), so it can't be placed in time with the others.`);
  for (let k = 1; k < acts.length; k++) {
    if (firstTime(acts[k]) < lastTime(acts[k - 1]) - OVERLAP_MS)
      throw new Error(`“${acts[k - 1].name}” and “${acts[k].name}” overlap in time (the same activity recorded twice?); pick one of them.`);
  }

  const t0 = firstTime(acts[0]);
  const samples: Sample[] = [];
  const laps: Lap[] = [];
  const parts: ActivityPart[] = [];
  let distBase = 0;
  let segBase = 0;
  for (const a of acts) {
    // Points the previous activity already covered (a small overlap) are left out.
    const prevTime = samples.length ? samples[samples.length - 1].time : -Infinity;
    const keep = a.samples.filter((s) => s.time > prevTime);
    if (!keep.length) continue;
    const startIndex = samples.length;
    const skipped = a.samples.length - keep.length;
    const d0 = keep[0].dist;
    let maxSeg = 0;
    for (const s of keep) {
      samples.push({ ...s, t: (s.time - t0) / 1000, dist: distBase + (s.dist - d0), seg: segBase + s.seg });
      maxSeg = Math.max(maxSeg, s.seg);
    }
    for (const l of a.laps) {
      const startI = l.startIndex - skipped;
      const endI = l.endIndex - skipped;
      if (endI < 0) continue;
      laps.push({ ...l, startIndex: startIndex + Math.max(0, startI), endIndex: startIndex + Math.min(keep.length - 1, endI) });
    }
    parts.push({ name: a.name, kind: a.kind, startTime: keep[0].time, startIndex });
    distBase = samples[samples.length - 1].dist;
    // The next activity always starts a new track segment.
    segBase += maxSeg + 1;
  }

  const kind = combinedKind(acts.map((a) => a.kind));
  const sum = (f: (a: Activity) => number | undefined) => {
    const v = acts.map(f);
    return v.every((x) => x !== undefined) ? v.reduce<number>((x, y) => x + y!, 0) : undefined;
  };
  return {
    name: combinedName(acts, parts[parts.length - 1].startTime),
    sport:
      kind === "other"
        ? acts
            .map((a) => SPORTS[a.kind].label)
            .filter((l, i, all) => all.indexOf(l) === i)
            .join(" + ")
        : acts[0].sport,
    kind,
    startTime: t0,
    utcOffsetMin: acts[0].utcOffsetMin,
    device: acts.every((a) => a.device === acts[0].device) ? acts[0].device : undefined,
    source: acts[0].source,
    laps,
    samples,
    fileTotals: {
      distance: sum((a) => a.fileTotals.distance),
      time: sum((a) => a.fileTotals.time),
      calories: sum((a) => a.fileTotals.calories),
    },
    droppedPoints: acts.reduce((x, a) => x + a.droppedPoints, 0),
    interpolatedPoints: acts.reduce((x, a) => x + a.interpolatedPoints, 0),
    // Distance is assembled per activity above; recomputing it from GPS would add the gaps.
    hasFileDistance: true,
    cadenceDoubled: acts.some((a) => a.cadenceDoubled),
    routeOnly: false,
    parts,
  };
}
