export type SportKind = "run" | "walk" | "hike" | "ride" | "ski" | "paddle" | "swim" | "other";

export interface Sample {
  /** Seconds since the first sample. */
  t: number;
  /** Epoch milliseconds. */
  time: number;
  lat: number;
  lon: number;
  /** Cumulative distance in meters (from the file when present, otherwise computed). */
  dist: number;
  hr?: number;
  /** Steps per minute for runs/walks, revolutions per minute for rides. */
  cad?: number;
  /** Altitude from the file, in meters. May be unreliable; see analysis/elevation.ts. */
  alt?: number;
  /** Device-reported speed in m/s. */
  speed?: number;
  power?: number;
  /** Track segment (GPX trkseg / TCX Track). A new segment usually means a pause or signal loss. */
  seg: number;
  /**
   * Where the position came from: "gps" (recorded), "interp" (no fix in the file; interpolated
   * between the GPS points on either side) or "none" (before the first / after the last fix:
   * held at the nearest fix, kept for charts only).
   */
  pos: "gps" | "interp" | "none";
}

export interface Lap {
  startIndex: number;
  endIndex: number;
  startTime: number;
  totalTime?: number;
  distance?: number;
  calories?: number;
  avgHr?: number;
  maxHr?: number;
  /** TCX Intensity: "Active" or "Resting". */
  intensity?: string;
  /** TCX TriggerMethod: Manual, Distance, Location, Time, HeartRate. */
  trigger?: string;
}

export interface Activity {
  name: string;
  sport: string;
  kind: SportKind;
  /** The file didn't name a known sport, so `kind` was inferred from the speed. */
  kindInferred?: boolean;
  startTime: number;
  /** Offset of the recording's local time from UTC in minutes, when the file says (e.g. "-04:00" → -240). */
  utcOffsetMin?: number;
  device?: string;
  notes?: string;
  source: "tcx" | "gpx" | "fit";
  laps: Lap[];
  samples: Sample[];
  /** Totals as written by the device, for comparison with what we compute. */
  fileTotals: { distance?: number; time?: number; calories?: number };
  /** Trackpoints dropped entirely (no usable time). */
  droppedPoints: number;
  /** Trackpoints without a GPS fix whose position was interpolated (or held, at the ends). */
  interpolatedPoints: number;
  /** Whether the file supplied cumulative distance (vs. computed from GPS). */
  hasFileDistance: boolean;
  /** Running cadence was per-leg (strides/min) and has been doubled to steps/min. */
  cadenceDoubled: boolean;
  /**
   * No timestamps in the file (a planned route or bare track). Time is synthesized from distance
   * at a nominal pace so the route can still be animated, and every time-based stat is hidden.
   */
  routeOnly: boolean;
  /** The file was a multisport session; this is one leg of it. */
  multisport?: boolean;
  /**
   * Several activities stitched into this one (a combined day; see library/combine.ts), in order.
   * Each starts a new track segment, and the time between them is a stop.
   */
  parts?: ActivityPart[];
}

/** One activity inside a combined one. */
export interface ActivityPart {
  name: string;
  kind: SportKind;
  startTime: number;
  /** Index of its first sample in the combined activity. */
  startIndex: number;
}
