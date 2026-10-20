import type { SportKind } from "../parse/types";
import { SPORTS, type SportProfile } from "../sport";
import { type PersonalRecord, personalRecords } from "./records";
import type { RouteGroup } from "./similarity";
import type { LibraryRecord } from "./types";

export const DAY_MS = 86_400_000;

/**
 * Wall-clock time of the activity's start, as epoch ms whose UTC fields read as the local time
 * where it was recorded (the file's UTC offset; your browser's zone when the file doesn't say).
 */
export function localMs(startTime: number, utcOffsetMin?: number): number {
  const off = utcOffsetMin ?? -new Date(startTime).getTimezoneOffset();
  return startTime + off * 60_000;
}

/** Days since 1970-01-01 in the activity's local time. */
export const localDay = (r: Pick<LibraryRecord, "startTime" | "utcOffsetMin">) => Math.floor(localMs(r.startTime, r.utcOffsetMin) / DAY_MS);

/** Local hour of day (0–23) the activity started. */
export const localHour = (r: Pick<LibraryRecord, "startTime" | "utcOffsetMin">) => new Date(localMs(r.startTime, r.utcOffsetMin)).getUTCHours();

export const localYear = (r: Pick<LibraryRecord, "startTime" | "utcOffsetMin">) => new Date(localMs(r.startTime, r.utcOffsetMin)).getUTCFullYear();

/** Monday of the week containing `day` (1970-01-01 was a Thursday). */
export const weekStart = (day: number) => day - ((((day + 3) % 7) + 7) % 7);

export interface Bucket {
  /** First day of the bucket (days since epoch). */
  start: number;
  distance: number;
  moving: number;
  count: number;
  /** Longest single activity in the bucket, meters (0 when empty). */
  longest: number;
  longestId?: string;
}

function monthIndex(day: number) {
  const d = new Date(day * DAY_MS);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}
const monthStartDay = (m: number) => Date.UTC(Math.floor(m / 12), m % 12, 1) / DAY_MS;

/** Weekly (Monday-start) or monthly totals, contiguous from the first to the last activity (empty buckets included). */
export function buckets(records: LibraryRecord[], unit: "week" | "month"): Bucket[] {
  if (!records.length) return [];
  const keyOf = (r: LibraryRecord) => (unit === "week" ? weekStart(localDay(r)) : monthIndex(localDay(r)));
  const keys = records.map(keyOf);
  const lo = Math.min(...keys);
  const hi = Math.max(...keys);
  const step = unit === "week" ? 7 : 1;
  const out: Bucket[] = [];
  const index = new Map<number, Bucket>();
  for (let k = lo; k <= hi; k += step) {
    const b: Bucket = { start: unit === "week" ? k : monthStartDay(k), distance: 0, moving: 0, count: 0, longest: 0 };
    out.push(b);
    index.set(k, b);
  }
  records.forEach((r, i) => {
    const b = index.get(keys[i])!;
    b.distance += r.distance;
    b.moving += r.moving;
    b.count++;
    if (r.distance > b.longest) {
      b.longest = r.distance;
      b.longestId = r.id;
    }
  });
  return out;
}

export type Period = string; // "all" | "12m" | "2025" …

export function periodOptions(records: LibraryRecord[], now = Date.now()): { value: Period; label: string }[] {
  const thisYear = new Date(now).getFullYear();
  const years = [...new Set(records.map(localYear))].sort((a, b) => b - a);
  return [
    { value: "all", label: "All time" },
    { value: "12m", label: "Last 12 months" },
    ...years.map((y) => ({ value: String(y), label: y === thisYear ? "This year" : String(y) })),
  ];
}

export function inPeriod(r: LibraryRecord, period: Period, now = Date.now()): boolean {
  if (period === "all") return true;
  if (period === "12m") return r.startTime >= now - 365 * DAY_MS && r.startTime <= now + DAY_MS;
  return String(localYear(r)) === period;
}

/** The period runs up to now (all time, the last 12 months, this year). */
export const periodIncludesNow = (period: Period, now = Date.now()) => inPeriod({ startTime: now } as LibraryRecord, period, now);

/** Trailing mean over the last `n` values (fewer at the start). NaN values are skipped. */
export function rollingMean(values: number[], n: number): number[] {
  return values.map((_, i) => {
    let sum = 0;
    let c = 0;
    for (let j = Math.max(0, i - n + 1); j <= i; j++) {
      if (Number.isFinite(values[j])) {
        sum += values[j];
        c++;
      }
    }
    return c ? sum / c : NaN;
  });
}

/** Number of activities started in each local hour, 0–23. */
export function timeOfDay(records: LibraryRecord[]): number[] {
  const hours = new Array<number>(24).fill(0);
  for (const r of records) hours[localHour(r)]++;
  return hours;
}

/** Groups restricted to the given records (members outside are dropped; groups under 2 runs vanish). */
export function groupsWithin(groups: RouteGroup[], ids: Set<string>): RouteGroup[] {
  return groups
    .map((g) => ({ ...g, members: g.members.filter((id) => ids.has(id)) }))
    .filter((g) => g.members.length >= 2)
    .sort((a, b) => b.members.length - a.members.length);
}

export interface Recap {
  count: number;
  distance: number;
  moving: number;
  activeDays: number;
  /** Gain summed over the activities whose file has altitude. */
  elevation: { gain: number; withData: number } | null;
  longest: LibraryRecord | null;
  fastest5k: PersonalRecord | null;
  fastest10k: PersonalRecord | null;
  mostRun: RouteGroup | null;
  hours: number[];
  /** Hour with the most starts. */
  peakHour: number | null;
  first: LibraryRecord | null;
  last: LibraryRecord | null;
}

/** Walks, runs, hikes: where a "fastest 5K" is a meaningful record. */
export const footSport = (kind: SportKind) => !!(SPORTS as Partial<Record<string, SportProfile>>)[kind]?.footCadence;

/**
 * Totals for a set of activities. `kind` is the sport they all share, or null for a mix of
 * sports, in which case no fastest-5K/10K is picked (a ride's 5K isn't a run's).
 */
export function recap(records: LibraryRecord[], groups: RouteGroup[], kind: SportKind | null = records[0]?.kind ?? null): Recap {
  const sorted = [...records].sort((a, b) => a.startTime - b.startTime);
  const withElev = records.filter((r) => r.elevGain !== undefined && Number.isFinite(r.elevGain));
  const prs = personalRecords(records);
  const pr = (d: number) => (kind && footSport(kind) ? (prs.find((p) => p.distance === d && p.kind === kind) ?? null) : null);
  const hours = timeOfDay(records);
  const peak = Math.max(...hours);
  return {
    count: records.length,
    distance: records.reduce((s, r) => s + r.distance, 0),
    moving: records.reduce((s, r) => s + r.moving, 0),
    activeDays: new Set(records.map(localDay)).size,
    elevation: withElev.length ? { gain: withElev.reduce((s, r) => s + r.elevGain!, 0), withData: withElev.length } : null,
    longest: records.reduce<LibraryRecord | null>((best, r) => (!best || r.distance > best.distance ? r : best), null),
    fastest5k: pr(5000),
    fastest10k: pr(10000),
    mostRun: groupsWithin(groups, new Set(records.map((r) => r.id)))[0] ?? null,
    hours,
    peakHour: peak > 0 ? hours.indexOf(peak) : null,
    first: sorted[0] ?? null,
    last: sorted[sorted.length - 1] ?? null,
  };
}

export interface Streaks {
  /** Consecutive days with an activity, ending today or yesterday (0 otherwise). */
  currentDays: number;
  longestDays: number;
  /** Last day of the longest daily streak. */
  longestDaysEnd: number | null;
  /** Consecutive Monday-start weeks with an activity, ending this week or last. */
  currentWeeks: number;
  longestWeeks: number;
}

/** Longest and current run of consecutive values `step` apart, in ascending unique values. */
function runs(sorted: number[], step: number, now: number) {
  let longest = 0;
  let longestEnd: number | null = null;
  let len = 0;
  for (let i = 0; i < sorted.length; i++) {
    len = i > 0 && sorted[i] - sorted[i - 1] === step ? len + 1 : 1;
    if (len > longest) {
      longest = len;
      longestEnd = sorted[i];
    }
  }
  const last = sorted[sorted.length - 1];
  const current = last !== undefined && now - last <= step ? len : 0;
  return { longest, longestEnd, current };
}

/** Daily and weekly streaks; "current" counts back from `todayDay` (a local day number). */
export function streaks(records: LibraryRecord[], todayDay: number): Streaks {
  const days = [...new Set(records.map(localDay))].sort((a, b) => a - b);
  const weeks = [...new Set(days.map(weekStart))].sort((a, b) => a - b);
  const d = runs(days, 1, todayDay);
  const w = runs(weeks, 7, weekStart(todayDay));
  return { currentDays: d.current, longestDays: d.longest, longestDaysEnd: d.longestEnd, currentWeeks: w.current, longestWeeks: w.longest };
}

export interface Eddington {
  /** The largest E with at least E days of at least E units. */
  e: number;
  /** Days of at least E + 1 units still needed to reach E + 1. */
  toNext: number;
}

/** Eddington number over daily distance totals, in `unit` meters (1000 for km, a mile for mi). */
export function eddington(records: LibraryRecord[], unit: number): Eddington {
  const byDay = new Map<number, number>();
  for (const r of records) byDay.set(localDay(r), (byDay.get(localDay(r)) ?? 0) + r.distance / unit);
  const totals = [...byDay.values()].sort((a, b) => b - a);
  let e = 0;
  while (e < totals.length && totals[e] >= e + 1) e++;
  const atNext = totals.filter((v) => v >= e + 1).length;
  return { e, toNext: e + 1 - atNext };
}

