// A Strava bulk export comes with activities.csv: the name, sport, description and gear you gave
// each activity on Strava. Dropping the export folder (or the file on its own) brings those in.

import { footSport } from "./aggregate";
import { sportKind } from "../sport";
import type { LibraryRecord } from "./types";

/** What Strava knows about an activity that its file doesn't say. */
export interface StravaDetails {
  name: string;
  /** Strava's sport ("Run", "Weight Training"…). */
  type: string;
  description?: string;
  /** Shoes or bike, as named on Strava. */
  gear?: string;
}

/** RFC 4180 CSV: quoted fields may hold commas, doubled quotes and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') field += text[i++];
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** The file an activity came from, as both the CSV and the library name it: "21857591762.tcx". */
export const fileKey = (name: string) => (name.split("/").pop() ?? name).replace(/\.gz$/i, "").toLowerCase();

/** Activities in the CSV by the file they were recorded in (activities without a file are left out). */
export function readActivitiesCsv(text: string): Map<string, StravaDetails> {
  const [head, ...rows] = parseCsv(text);
  const out = new Map<string, StravaDetails>();
  if (!head) return out;
  // Columns by name; the export repeats some ("Distance", "Elapsed Time"), so take the first.
  const col = (name: string) => head.indexOf(name);
  const file = col("Filename");
  const name = col("Activity Name");
  const type = col("Activity Type");
  const desc = col("Activity Description");
  const gear = col("Activity Gear");
  if (file < 0 || name < 0) return out;
  for (const r of rows) {
    const f = r[file]?.trim();
    if (!f) continue;
    out.set(fileKey(f), {
      name: r[name]?.trim() || "",
      type: r[type]?.trim() ?? "",
      description: r[desc]?.trim() || undefined,
      gear: r[gear]?.trim() || undefined,
    });
  }
  return out;
}

/**
 * The record with Strava's name, gear and description. Strava's sport replaces the file's when the
 * file didn't know it, or when both are on foot (a "run" you relabeled a walk); a file that says
 * it's a ride stays a ride, since its efforts and limits were worked out as one.
 */
export function withStrava<T extends LibraryRecord>(r: T, d: StravaDetails | undefined): T {
  if (!d) return r;
  const k = d.type ? sportKind(d.type) : "other";
  const kind = k !== "other" && (r.kind === "other" || (footSport(r.kind) && footSport(k))) ? k : r.kind;
  return { ...r, strava: d, name: d.name || r.name, kind };
}

export interface GearTotal {
  name: string;
  distance: number;
  moving: number;
  count: number;
  first: LibraryRecord;
  last: LibraryRecord;
  /** Mostly walked, run or hiked in: wears like a shoe. */
  shoe: boolean;
}

/** Distance and time on each piece of gear named in Strava, most used first. */
export function gearTotals(records: LibraryRecord[]): GearTotal[] {
  const by = new Map<string, { t: GearTotal; foot: number }>();
  for (const r of [...records].sort((a, b) => a.startTime - b.startTime)) {
    const name = r.strava?.gear;
    if (!name) continue;
    let g = by.get(name);
    if (!g) by.set(name, (g = { t: { name, distance: 0, moving: 0, count: 0, first: r, last: r, shoe: false }, foot: 0 }));
    g.t.distance += r.distance;
    g.t.moving += r.moving;
    g.t.count++;
    g.t.last = r;
    if (footSport(r.kind)) g.foot += r.distance;
  }
  return [...by.values()].map(({ t, foot }) => ({ ...t, shoe: foot > t.distance / 2 })).sort((a, b) => b.distance - a.distance);
}
