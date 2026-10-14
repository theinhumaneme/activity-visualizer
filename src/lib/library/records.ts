import type { SportKind } from "../parse/types";
import type { LibraryRecord } from "./types";

export interface PersonalRecord {
  kind: SportKind;
  distance: number;
  label: string;
  /** The activity holding the record. */
  activityId: string;
  seconds: number;
  startTime: number;
  utcOffsetMin?: number;
}

/**
 * Fastest best effort per distance (per sport: a 5K ride and a 5K run aren't the same record).
 * Ties go to the earlier activity, which set the mark first. Sorted by sport, then distance.
 */
export function personalRecords(records: LibraryRecord[]): PersonalRecord[] {
  const best = new Map<string, PersonalRecord>();
  const byDate = [...records].sort((a, b) => a.startTime - b.startTime);
  for (const r of byDate) {
    for (const e of r.bestEfforts) {
      if (!(e.seconds > 0)) continue;
      const key = `${r.kind}|${e.distance}`;
      const cur = best.get(key);
      if (!cur || e.seconds < cur.seconds) {
        best.set(key, {
          kind: r.kind,
          distance: e.distance,
          label: e.label,
          activityId: r.id,
          seconds: e.seconds,
          startTime: r.startTime,
          utcOffsetMin: r.utcOffsetMin,
        });
      }
    }
  }
  return [...best.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.distance - b.distance);
}

/** Activity id → the records it holds, for badges. */
export function recordsByActivity(prs: PersonalRecord[]): Map<string, PersonalRecord[]> {
  const out = new Map<string, PersonalRecord[]>();
  for (const pr of prs) out.set(pr.activityId, [...(out.get(pr.activityId) ?? []), pr]);
  return out;
}
