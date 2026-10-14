import type { Analysis } from "../analysis/types";
import { formatEffortDistance } from "../format/format";
import type { Activity } from "../parse/types";
import { simplifyTrack } from "./simplify";
import type { LibraryRecord } from "./types";

export const TRACK_POINTS = 600;

/**
 * Reduces one analyzed activity to the light record the library keeps. Everything here comes
 * from the file or the analysis of it; nothing is estimated except where the field says so.
 */
export function buildRecord(activity: Activity, a: Analysis, meta: { id: string; fileName: string; activityIndex: number }): LibraryRecord {
  const s = a.summary;
  const hasGps = a.samples.some((p) => p.pos === "gps");
  const track = hasGps
    ? simplifyTrack(
        a.samples.map((p, i) => ({ lat: p.lat, lon: p.lon, dist: p.dist, moving: a.movingTime[i] })),
        TRACK_POINTS,
      )
    : null;
  return {
    id: meta.id,
    fileName: meta.fileName,
    activityIndex: meta.activityIndex,
    name: activity.name,
    sport: activity.sport,
    kind: activity.kind,
    device: activity.device,
    startTime: activity.startTime,
    utcOffsetMin: activity.utcOffsetMin,
    distance: s.distance,
    elapsed: s.elapsed,
    moving: s.moving,
    avgSpeed: s.avgSpeed,
    avgHr: s.avgHr,
    maxHr: s.maxHr,
    avgCadence: s.avgCadence,
    efficiency: s.efficiency,
    elevGain: a.elevationSource === "none" ? undefined : s.elevGain,
    elevSource: a.elevationSource,
    calories: activity.fileTotals.calories,
    bestEfforts: a.bestEfforts.map((b) => ({ distance: b.distance, label: formatEffortDistance(b.distance), seconds: b.seconds })),
    track,
  };
}

/** The same run imported twice (or as both TCX and GPX): same sport, start within a minute, distance within 5%. */
export function isDuplicate(a: LibraryRecord, b: LibraryRecord): boolean {
  return (
    a.kind === b.kind &&
    Math.abs(a.startTime - b.startTime) < 60_000 &&
    Math.abs(a.distance - b.distance) <= 0.05 * Math.max(a.distance, b.distance, 1)
  );
}
