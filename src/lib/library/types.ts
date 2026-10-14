import type { ElevationSource } from "../analysis/types";
import type { SportKind } from "../parse/types";

/**
 * Simplified route geometry (≤ ~600 points), with cumulative distance and cumulative moving
 * time at each kept point so a run can be replayed by moving time. The first and last points
 * are the recording's real first and last fixes (privacy circles are centered on them).
 */
export interface Track {
  lon: Float64Array;
  lat: Float64Array;
  /** Cumulative distance, meters. */
  dist: Float32Array;
  /** Cumulative moving time, seconds. */
  moving: Float32Array;
}

export interface EffortRecord {
  distance: number;
  label: string;
  seconds: number;
}

/** What the library keeps per activity: summary numbers only, never the full sample stream. */
export interface LibraryRecord {
  id: string;
  fileName: string;
  /** Index of this activity within its file (files can hold several). */
  activityIndex: number;
  name: string;
  sport: string;
  kind: SportKind;
  device?: string;
  startTime: number;
  utcOffsetMin?: number;
  distance: number;
  elapsed: number;
  moving: number;
  /** Moving average speed, m/s. */
  avgSpeed: number;
  avgHr?: number;
  maxHr?: number;
  avgCadence?: number;
  /** Meters per heartbeat (moving speed ÷ moving HR), from the analysis. */
  efficiency?: number;
  /** Gain from the file's altitude (not terrain-corrected in the library). */
  elevGain?: number;
  elevSource: ElevationSource;
  /** Only when the file says so. */
  calories?: number;
  bestEfforts: EffortRecord[];
  track: Track | null;
}

/** A record plus the file it came from, so it can be opened in the single-activity flow. */
export interface LibraryEntry extends LibraryRecord {
  file: File;
}
