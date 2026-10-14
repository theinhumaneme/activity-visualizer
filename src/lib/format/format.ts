import type { Units } from "../analysis/types";
import type { SportKind } from "../parse/types";
import { SPORTS } from "../sport";

export const MILE = 1609.344;
export const unitLength = (u: Units) => (u === "metric" ? 1000 : MILE);
export const unitLabel = (u: Units) => (u === "metric" ? "km" : "mi");

export function formatDistance(m: number, u: Units, digits = 2): string {
  return `${(m / unitLength(u)).toFixed(digits)} ${unitLabel(u)}`;
}

/** Short distance for best-effort labels and splits ("400 m", "1 mi"). */
export function formatEffortDistance(m: number): string {
  if (Math.abs(m - MILE) < 1) return "1 mile";
  if (Math.abs(m - 21097.5) < 1) return "Half marathon";
  if (Math.abs(m - 42195) < 1) return "Marathon";
  return m < 1000 ? `${m} m` : `${m / 1000} km`;
}

export function formatDuration(s: number): string {
  if (!Number.isFinite(s)) return "—";
  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** Pace given in seconds per kilometer. */
export function formatPace(secPerKm: number, u: Units, withUnit = true): string {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 60 * 60) return "—";
  const s = u === "metric" ? secPerKm : secPerKm * (MILE / 1000);
  return `${formatDuration(s)}${withUnit ? ` /${unitLabel(u)}` : ""}`;
}

export function formatSpeed(mps: number, u: Units, withUnit = true): string {
  if (!Number.isFinite(mps)) return "—";
  const v = u === "metric" ? mps * 3.6 : mps * 2.236936;
  return `${v.toFixed(1)}${withUnit ? (u === "metric" ? " km/h" : " mph") : ""}`;
}

export const usesPace = (kind: SportKind) => SPORTS[kind].pace;

/** Pace for foot sports and swims (per 100 m / 100 yd), speed for everything else; input in m/s. */
export function formatMotion(mps: number, kind: SportKind, u: Units, withUnit = true): string {
  const p = SPORTS[kind];
  if (p.pace && p.paceShort) {
    if (!(mps > 0.05)) return "—";
    const per = u === "metric" ? 100 : 91.44;
    return `${formatDuration(per / mps)}${withUnit ? (u === "metric" ? " /100m" : " /100yd") : ""}`;
  }
  if (p.pace) return formatPace(mps > 0.05 ? 1000 / mps : NaN, u, withUnit);
  return formatSpeed(mps, u, withUnit);
}

export const motionLabel = (kind: SportKind) => (usesPace(kind) ? "Pace" : "Speed");

export function formatElevation(m: number, u: Units): string {
  if (!Number.isFinite(m)) return "—";
  return u === "metric" ? `${Math.round(m)} m` : `${Math.round(m * 3.28084)} ft`;
}

/**
 * Activity times are shown in the activity's own local time when the file records its UTC
 * offset (so an activity in Boston reads 11:06 wherever you open it); otherwise in your browser's zone.
 */
function localParts(ms: number, utcOffsetMin?: number): [Date, Intl.DateTimeFormatOptions] {
  return utcOffsetMin === undefined ? [new Date(ms), {}] : [new Date(ms + utcOffsetMin * 60000), { timeZone: "UTC" }];
}

export function formatDateTime(ms: number, utcOffsetMin?: number): string {
  const [d, tz] = localParts(ms, utcOffsetMin);
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", ...tz });
}

export function formatDate(ms: number, utcOffsetMin?: number): string {
  const [d, tz] = localParts(ms, utcOffsetMin);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", ...tz });
}

/** Wall-clock time of day ("11:24 AM") at an epoch ms, in the activity's local time when known. */
export function formatClock(ms: number, utcOffsetMin?: number, seconds = false): string {
  const [d, tz] = localParts(ms, utcOffsetMin);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), ...tz });
}

/** "UTC−04:00". */
export function formatUtcOffset(min: number): string {
  const sign = min < 0 ? "−" : "+";
  const a = Math.abs(min);
  return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

export function defaultUnits(): Units {
  const lang = typeof navigator === "undefined" ? "" : navigator.language;
  return /^en-(US|LR)|^my/.test(lang) ? "imperial" : "metric";
}
