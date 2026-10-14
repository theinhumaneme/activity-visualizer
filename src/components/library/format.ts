import type { Units } from "../../lib/analysis/types";
import { formatDate, unitLabel, unitLength } from "../../lib/format/format";
import type { SportKind } from "../../lib/parse/types";
import { SPORTS, type SportProfile } from "../../lib/sport";
import type { LibraryRecord } from "../../lib/library/types";

/** "312" in the unit (no decimals from 100 up, one below). */
export function distanceNumber(m: number, u: Units): string {
  const v = m / unitLength(u);
  return v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1);
}

export const distanceText = (m: number, u: Units) => `${distanceNumber(m, u)} ${unitLabel(u)}`;

/** "31 h 20 min" / "45 min". */
export function hoursText(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h.toLocaleString()} h ${m} min` : `${m} min`;
}

/** "+12 s", "+1:12". */
export function gapText(s: number): string {
  if (s < 0.5) return "±0 s";
  if (s < 60) return `+${Math.round(s)} s`;
  const r = Math.round(s);
  return `+${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`;
}

export const shortDate = (r: Pick<LibraryRecord, "startTime" | "utcOffsetMin">) => formatDate(r.startTime, r.utcOffsetMin);

/** One sport, or every sport together. */
export type SportFilter = SportKind | "all";

const profile = (kind: SportFilter) => (kind === "all" ? undefined : (SPORTS as Partial<Record<string, SportProfile>>)[kind]);

/** "runs", "rides", "ski days"… ("activities" for all sports). */
export const sportPlural = (kind: SportFilter) => profile(kind)?.plural ?? "activities";
/** "run", "ride", "hike"… ("activity" for all sports). */
export const sportSingular = (kind: SportFilter) => profile(kind)?.label.toLowerCase() ?? "activity";
/** "Run", "Ride"… */
export const sportLabel = (kind: SportFilter) => profile(kind)?.label ?? "All";
/** Walks, runs and hikes: the sports where a fastest 5K means something. */
export const isFootSport = (kind: SportFilter) => !!profile(kind)?.footCadence;
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
