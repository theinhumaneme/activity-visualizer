import { haversine } from "../geo/geo";
import { SPORTS, inferKind } from "../sport";
import type { Sample, SportKind } from "./types";

export { sportKind } from "../sport";

export const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** "2026-10-11T11:06:19.000-04:00" → -240. Undefined for "Z" (UTC, local zone unknown) or no offset. */
export function utcOffsetOf(iso: string | undefined): number | undefined {
  const m = iso?.match(/([+-])(\d\d):?(\d\d)$/);
  if (!m) return undefined;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** A parsed point before positions are filled in; lat/lon are NaN when the file had no fix. */
export type RawSample = Omit<Sample, "t" | "pos">;

/**
 * Sorts by time, drops duplicate timestamps, fills in missing positions, fills `t`, and makes
 * distance monotonic. Points with no GPS fix get a position interpolated in time between the
 * fixes on either side; before the first / after the last fix they're held at that fix
 * (charts still use their heart rate, but they add no distance).
 * When `useFileDistance` is false (or a value is missing) distance comes from GPS.
 * Returns null when there isn't a single GPS fix.
 */
export function finalizeSamples(raw: RawSample[], useFileDistance: boolean): { samples: Sample[]; interpolated: number } | null {
  raw.sort((a, b) => a.time - b.time);
  const out: Sample[] = [];
  for (const s of raw) {
    if (out.length && s.time <= out[out.length - 1].time) continue;
    const gps = Number.isFinite(s.lat) && Number.isFinite(s.lon);
    out.push({ ...s, t: 0, pos: gps ? "gps" : "none" });
  }
  const fixes = out.map((s, i) => (s.pos === "gps" ? i : -1)).filter((i) => i >= 0);
  if (!fixes.length) return null;

  let interpolated = 0;
  for (let k = 0; k < fixes.length; k++) {
    const i = fixes[k];
    const next = fixes[k + 1];
    if (k === 0) for (let j = 0; j < i; j++) hold(out[j], out[i]);
    if (next === undefined) for (let j = i + 1; j < out.length; j++) hold(out[j], out[i]);
    else if (next > i + 1) {
      const a = out[i];
      const b = out[next];
      for (let j = i + 1; j < next; j++) {
        const f = (out[j].time - a.time) / (b.time - a.time);
        out[j].lat = a.lat + f * (b.lat - a.lat);
        out[j].lon = a.lon + f * (b.lon - a.lon);
        out[j].pos = "interp";
      }
    }
  }
  for (const s of out) if (s.pos !== "gps") interpolated++;

  const t0 = out[0].time;
  let gps = 0;
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    s.t = (s.time - t0) / 1000;
    if (i > 0) {
      const p = out[i - 1];
      gps += haversine(p.lat, p.lon, s.lat, s.lon);
    }
    if (!useFileDistance || !Number.isFinite(s.dist)) s.dist = gps;
    if (i > 0 && s.dist < out[i - 1].dist) s.dist = out[i - 1].dist;
  }
  // File distance often starts at a non-zero offset; rebase to zero.
  const d0 = out[0].dist;
  if (d0 > 0) for (const s of out) s.dist -= d0;
  return { samples: out, interpolated };
}

function hold(s: Sample, fix: Sample) {
  s.lat = fix.lat;
  s.lon = fix.lon;
  s.pos = "none";
}

/**
 * Running cadence in TCX/GPX is often per leg (strides/min, ~75–100). Decide once per activity
 * from the median, so a genuinely slow cadence isn't doubled on its own. Returns whether to double.
 */
export function cadenceIsPerLeg(values: (number | undefined)[], kind: SportKind, declaredPerLeg: boolean): boolean {
  if (!SPORTS[kind].footCadence) return false;
  const v = values.filter((c): c is number => c !== undefined && c > 0).sort((a, b) => a - b);
  if (!v.length) return false;
  const med = v[v.length >> 1];
  // RunCadence is defined per leg; a median under 120 is per leg whatever the tag.
  return declaredPerLeg ? med < 130 : med < 120;
}

/**
 * When the file names no known sport, guess from the median speed over 10 s windows of moving
 * time (a walk, run or ride), and say it was inferred. Too fast to be human-powered stays "other".
 */
export function resolveKind(kind: SportKind, samples: Sample[], routeOnly: boolean): { kind: SportKind; inferred: boolean } {
  if (kind !== "other" || routeOnly || samples.length < 20) return { kind, inferred: false };
  const v: number[] = [];
  for (let i = 0, j = 0; i < samples.length; i++) {
    while (j < samples.length - 1 && samples[j].t - samples[i].t < 10) j++;
    const dt = samples[j].t - samples[i].t;
    if (dt >= 5) {
      const speed = (samples[j].dist - samples[i].dist) / dt;
      if (speed > 0.3) v.push(speed);
    }
  }
  v.sort((a, b) => a - b);
  const guess = inferKind(v[v.length >> 1]);
  return guess ? { kind: guess, inferred: true } : { kind, inferred: false };
}
