import type { Analysis } from "../../lib/analysis/types";
import { formatDistance, formatDuration, formatPace, formatSpeed, MILE, unitLength, usesPace } from "../../lib/format/format";

/**
 * Pace (seconds per display unit, for runs/walks) or speed (display unit per hour, for rides),
 * the values the motion charts plot, with converters back to the shared formatters.
 */
export function motionUnits(a: Analysis) {
  const u = a.settings.units;
  const L = unitLength(u);
  const pace = usesPace(a.activity.kind);
  return {
    pace,
    /** m/s → chart value. */
    toChart: (mps: number) => (pace ? (mps > 0.05 ? L / mps : NaN) : (mps * 3600) / L),
    /** Seconds per km → chart value. */
    paceToChart: (secPerKm: number) => (pace ? (secPerKm * L) / 1000 : (3600 * 1000) / secPerKm / L),
    format: (v: number, withUnit = true) => (pace ? formatPace((v / L) * 1000, u, withUnit) : formatSpeed((v * L) / 3600, u, withUnit)),
    tick: (v: number) => (pace ? formatDuration(v) : v.toFixed(0)),
  };
}

/** Pace for runs, speed for rides, from seconds per km. */
export function formatSplitMotion(secPerKm: number, a: Analysis, withUnit = true): string {
  const u = a.settings.units;
  return usesPace(a.activity.kind) ? formatPace(secPerKm, u, withUnit) : formatSpeed(1000 / secPerKm, u, withUnit);
}

/** Short distances in meters / feet-free miles: "337 m" or "0.21 mi"; longer ones as usual. */
export function formatShortDistance(m: number, a: Analysis): string {
  if (a.settings.units === "metric") return m < 1000 ? `${Math.round(m)} m` : formatDistance(m, "metric", 2);
  return m < MILE / 10 ? `${(m / MILE).toFixed(3)} mi` : formatDistance(m, "imperial", 2);
}

/** Splits "7:08 /km" or "2.56 km" into number and unit for two-size display. */
export function splitUnit(text: string): [string, string] {
  const m = text.match(/^(.*?\d)\s+([^\d\s].*)$/);
  return m ? [m[1], m[2]] : [text, ""];
}
