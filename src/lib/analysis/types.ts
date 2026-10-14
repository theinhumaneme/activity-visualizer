import type { Activity, Sample } from "../parse/types";
import type { CleaningReport } from "./clean";
import type { Climb } from "./climbs";
import type { Intervals } from "./intervals";
import type { Moment } from "./moments";
import type { Privacy } from "./privacy";

export type Units = "metric" | "imperial";

export interface Settings {
  name: string;
  units: Units;
  maxHr: number;
  restingHr: number;
  /** "max": zones as % of max HR. "reserve": Karvonen, % of (max − resting). */
  zoneMethod: "max" | "reserve";
  /** Seconds trimmed from the start / end of the recording. */
  trimStart: number;
  trimEnd: number;
  /** True until the athlete enters their own max HR; zones are then labeled "estimated". */
  maxHrEstimated: boolean;
  /** Privacy circle around start and finish, meters (0 = off). Hides geometry, never stats. */
  privacyRadius: number;
}

export interface Split {
  index: number;
  /** Meters covered (the last split may be partial). */
  distance: number;
  elapsed: number;
  moving: number;
  /** Seconds per kilometer, from moving time. */
  pace: number;
  /** Grade-adjusted pace for the split, seconds per km. */
  gapPace?: number;
  avgHr?: number;
  avgCadence?: number;
  elevDelta?: number;
  startIdx: number;
  endIdx: number;
}

export interface Zone {
  zone: number;
  name: string;
  low: number;
  high: number;
  seconds: number;
}

export interface BestEffort {
  label: string;
  distance: number;
  seconds: number;
  pace: number;
  startIdx: number;
  endIdx: number;
}

/** A stretch of moving well below your typical pace (e.g. a walk break). */
export interface Slowdown {
  startIdx: number;
  endIdx: number;
  duration: number;
  /** Average speed during the slowdown, m/s. */
  speed: number;
}

export interface Stop {
  startIdx: number;
  endIdx: number;
  duration: number;
  lat: number;
  lon: number;
}

export type QualityLevel = "ok" | "info" | "warn";
export interface QualityItem {
  level: QualityLevel;
  title: string;
  detail: string;
}

export type ElevationSource = "file" | "terrain" | "file-unverified" | "none";

export interface Summary {
  distance: number;
  elapsed: number;
  moving: number;
  avgSpeed: number;
  maxSpeed: number;
  /** Seconds per km. */
  avgPace: number;
  bestPace: number;
  gapPace?: number;
  avgHr?: number;
  maxHr?: number;
  minHr?: number;
  calories?: number;
  elevGain?: number;
  elevLoss?: number;
  elevMin?: number;
  elevMax?: number;
  /** How gain/loss were measured, for display next to the numbers. */
  elevMethod?: string;
  avgCadence?: number;
  strideLength?: number;
  avgPower?: number;
  /** Meters per heartbeat (speed / HR). */
  efficiency?: number;
  /** Aerobic decoupling, % (positive = HR drifted up relative to pace). */
  decoupling?: number;
  trimp?: number;
  paceCv?: number;
  /** Seconds per km, first and second half by distance. */
  firstHalfPace: number;
  secondHalfPace: number;
  stoppedTime: number;
}

export interface Analysis {
  activity: Activity;
  settings: Settings;
  samples: Sample[];
  n: number;
  t: Float64Array;
  dist: Float64Array;
  /** Smoothed speed, m/s (20 s centered window). */
  speed: Float64Array;
  /** Speed over a 12 s window, for the live HUD (closer to what a watch shows). */
  speedLive: Float64Array;
  /** Grade-adjusted speed, m/s (null without elevation). */
  gap: Float64Array | null;
  hr: Float64Array;
  cadence: Float64Array | null;
  elev: Float64Array | null;
  grade: Float64Array | null;
  elevationSource: ElevationSource;
  /** moving[i] describes the interval from sample i to i+1. */
  moving: Uint8Array;
  /** Cumulative moving seconds at each sample. */
  movingTime: Float64Array;
  summary: Summary;
  splits: Split[];
  zones: Zone[];
  bestEfforts: BestEffort[];
  stops: Stop[];
  slowdowns: Slowdown[];
  intervals: Intervals | null;
  climbs: Climb[];
  /** Notable points for the flyover and copy (fastest split, high point, reps…). */
  moments: Moment[];
  privacy: Privacy;
  cleaning: CleaningReport;
  paceHistogram: { from: number; to: number; seconds: number }[];
  quality: QualityItem[];
  insights: Insight[];
  headline: string;
}

/** One finding for the overview: a short title, the number it's about, and a sentence of context. */
export interface Insight {
  title: string;
  value?: string;
  text: string;
  /** Higher is more notable; the top few are featured. */
  weight: number;
}
