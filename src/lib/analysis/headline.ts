import { formatDate, formatDistance, formatDuration, formatMotion } from "../format/format";
import type { Analysis } from "./types";

/** One-line summary; renaming an activity doesn't need the worker's full report builder. */
export function headlineFor(a: Analysis): string {
  const { summary: s, settings, activity } = a;
  const u = settings.units;
  const hrPart = s.avgHr ? `, average heart rate ${Math.round(s.avgHr)} bpm` : "";
  return `${settings.name} on ${formatDate(activity.startTime, activity.utcOffsetMin)}: ${formatDistance(s.distance, u)} in ${formatDuration(s.elapsed)} (${formatDuration(s.moving)} moving) at ${formatMotion(s.avgSpeed, activity.kind, u)}${hrPart}.`;
}
