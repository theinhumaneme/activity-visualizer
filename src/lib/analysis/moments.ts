// "Moments": the beats the flyover dwells on and the copy talks about. Each one is
// label · number · context ("FASTEST KM · 4:38 /km · 22 s under average"), anchored to a point
// on the route. Exactly one is the hero: the single most dramatic beat of the activity.

import { formatDuration, formatElevation, formatPace, formatSpeed, unitLabel, unitLength, usesPace } from "../format/format";
import { climbLabel } from "./climbs";
import type { Analysis } from "./types";

export type MomentKind = "climb" | "high-point" | "fastest-split" | "rep" | "final-kick";

export interface Moment {
  id: string;
  kind: MomentKind;
  /** Fractional sample index the callout anchors to. */
  at: number;
  /** Sample range the moment covers (highlighted on the map). */
  from: number;
  to: number;
  label: string;
  value: string;
  context: string;
  hero: boolean;
  /** Pace for pace-based moments, seconds per km (used to rank reps). */
  pace?: number;
  /** Seconds of screen time the flyover gives this moment. */
  dwell: number;
}

type Input = Omit<Analysis, "moments" | "quality" | "insights" | "headline">;

export function findMoments(a: Input): Moment[] {
  if (a.activity.routeOnly) return climbMoments(a);
  const u = a.settings.units;
  const kind = a.activity.kind;
  const pace = usesPace(kind);
  const unit = unitLabel(u);
  const perUnit = (secPerKm: number) => (u === "metric" ? secPerKm : secPerKm * (unitLength(u) / 1000));
  const motion = (secPerKm: number) => (pace ? formatPace(secPerKm, u) : formatSpeed(1000 / secPerKm, u));
  const out: Moment[] = [];

  out.push(...climbMoments(a));

  // Fastest full split, if it stands out from the average.
  const full = a.splits.filter((s) => Math.abs(s.distance - unitLength(u)) < 1);
  if (full.length >= 2 && !a.intervals) {
    const best = full.reduce((x, y) => (y.pace < x.pace ? y : x));
    const under = perUnit(a.summary.avgPace - best.pace);
    if (under >= 3) {
      out.push({
        id: "fastest-split",
        kind: "fastest-split",
        at: best.endIdx,
        from: best.startIdx,
        to: best.endIdx,
        label: `FASTEST ${unit.toUpperCase()}`,
        value: motion(best.pace),
        context: pace ? `${Math.round(under)} s under average` : `${unit} ${best.index}`,
        hero: false,
        dwell: 1.8,
      });
    }
  }

  // Interval reps.
  if (a.intervals) {
    const reps = a.intervals.reps;
    const dwell = reps.length > 6 ? 1.1 : 1.5;
    for (const r of reps) {
      const rec = r.recovery;
      const hrPart =
        rec?.hrFrom !== undefined && rec.hrTo !== undefined && rec.hrFrom - rec.hrTo >= 3
          ? `HR ${Math.round(rec.hrFrom)} → ${Math.round(rec.hrTo)} in ${Math.round(rec.window)} s`
          : r.peakHr !== undefined
            ? `HR peak ${Math.round(r.peakHr)}`
            : formatDuration(r.duration);
      out.push({
        id: `rep-${r.n}`,
        kind: "rep",
        at: r.endIdx,
        from: r.startIdx,
        to: r.endIdx,
        label: `REP ${r.n} OF ${reps.length}`,
        value: motion(r.pace),
        context: hrPart,
        pace: r.pace,
        hero: false,
        dwell,
      });
    }
  }

  // Final kick: the closing stretch clearly faster than the moving average.
  const total = a.dist[a.n - 1];
  const kickLen = Math.max(200, Math.min(400, total * 0.15));
  if (total > 1500) {
    let i0 = a.n - 1;
    while (i0 > 0 && total - a.dist[i0] < kickLen) i0--;
    const movingSecs = a.movingTime[a.n - 1] - a.movingTime[i0];
    const v = movingSecs > 0 ? (total - a.dist[i0]) / movingSecs : 0;
    if (v > a.summary.avgSpeed * 1.06) {
      const p = 1000 / v;
      out.push({
        id: "final-kick",
        kind: "final-kick",
        at: a.n - 1,
        from: i0,
        to: a.n - 1,
        label: "FINAL KICK",
        value: motion(p),
        context: pace ? `last ${Math.round(kickLen)} m, ${Math.round(perUnit(a.summary.avgPace - p))} s under average` : `last ${Math.round(kickLen)} m`,
        hero: false,
        dwell: 1.6,
      });
    }
  }

  // Never anchor a callout inside the privacy zone: slide it to the nearest visible point of
  // its range, or drop it when the whole range is hidden.
  const vis = a.privacy.visible;
  const visible = a.privacy.empty
    ? []
    : out.filter((m) => {
        const at = Math.round(m.at);
        if (vis[at]) return true;
        let best = -1;
        for (let i = Math.round(m.from); i <= Math.round(m.to); i++) if (vis[i] && (best < 0 || Math.abs(i - at) < Math.abs(best - at))) best = i;
        if (best < 0) return false;
        m.at = best;
        return true;
      });
  pickHero(visible);
  return visible.sort((x, y) => x.at - y.at);
}

function climbMoments(a: Input): Moment[] {
  const out: Moment[] = [];
  const u = a.settings.units;
  if (!a.elev) return out;
  const climbs = [...a.climbs].sort((x, y) => y.gain - x.gain).slice(0, 3);
  for (const c of climbs) {
    out.push({
      id: `climb-${c.startIdx}`,
      kind: "climb",
      at: c.endIdx,
      from: c.startIdx,
      to: c.endIdx,
      label: climbLabel(c).toUpperCase(),
      value: `+${formatElevation(c.gain, u)}`,
      context: `${Math.round(c.grade * 100)}% average over ${c.length >= 1000 ? `${(c.length / 1000).toFixed(1)} km` : `${Math.round(c.length)} m`}`,
      hero: false,
      dwell: 2,
    });
  }
  // The high point, unless a climb already ends there.
  const gain = a.summary.elevGain ?? 0;
  if (gain >= 15) {
    let hi = 0;
    for (let i = 1; i < a.n; i++) if (a.elev[i] > a.elev[hi]) hi = i;
    if (!out.some((m) => Math.abs(a.dist[m.to] - a.dist[hi]) < 150)) {
      out.push({
        id: "high-point",
        kind: "high-point",
        at: hi,
        from: hi,
        to: hi,
        label: "HIGH POINT",
        value: formatElevation(a.elev[hi], u),
        context: `${formatElevation(a.elev[hi] - (a.summary.elevMin ?? a.elev[hi]), u)} above the low point`,
        hero: false,
        dwell: 1.6,
      });
    }
  }
  return out;
}

/** Biggest climb › best interval rep › fastest split › final kick › high point. */
function pickHero(ms: Moment[]) {
  if (!ms.length) return;
  const by = (k: string) => ms.filter((m) => m.kind === k);
  const climbs = by("climb");
  const reps = by("rep");
  let hero =
    climbs.find((m) => m.label !== "CLIMB") ??
    (reps.length ? reps.reduce((x, y) => ((y.pace ?? Infinity) < (x.pace ?? Infinity) ? y : x)) : undefined) ??
    by("fastest-split")[0] ??
    by("final-kick")[0] ??
    climbs[0] ??
    by("high-point")[0];
  hero ??= ms[0];
  hero.hero = true;
  hero.dwell = Math.max(hero.dwell, 2.6);
}

