// One profile per sport: everything sport-specific (cleaning limits, moving detection, pace vs
// speed, which efforts mean something, how far the flyover camera sits back) lives here, so the
// rest of the pipeline works for any activity a GPX or TCX file can hold.

import type { SportKind } from "./parse/types";

export interface SportProfile {
  label: string;
  plural: string;
  /** Show pace (time per distance) rather than speed. */
  pace: boolean;
  /** Pace per 100 m / 100 yd (swimming) instead of per km / mi. */
  paceShort?: boolean;
  /** Plausible top speed, m/s; GPS implying more is a teleport. */
  ceiling: number;
  /** Moving when averaging at least this over ~10 s, m/s. */
  movingSpeed: number;
  /** Synthesized speed for untimed routes, m/s. */
  nominalSpeed: number;
  /** Grade-adjusted pace (Minetti) applies: foot sports only. */
  gap: boolean;
  /** Cadence may be per leg and need doubling. */
  footCadence: boolean;
  /** Best-effort distances, meters. */
  efforts: number[];
  /** Base chase-camera distance, m. */
  cameraDistance: number;
}

const MILE = 1609.344;

export const SPORTS: Record<SportKind, SportProfile> = {
  run: {
    label: "Run",
    plural: "runs",
    pace: true,
    ceiling: 8,
    movingSpeed: 0.5,
    nominalSpeed: 2.78,
    gap: true,
    footCadence: true,
    efforts: [400, 800, 1000, MILE, 3000, 5000, 10000, 15000, 21097.5, 42195],
    cameraDistance: 700,
  },
  walk: {
    label: "Walk",
    plural: "walks",
    pace: true,
    ceiling: 4,
    movingSpeed: 0.3,
    nominalSpeed: 1.4,
    gap: true,
    footCadence: true,
    efforts: [1000, MILE, 5000, 10000],
    cameraDistance: 600,
  },
  hike: {
    label: "Hike",
    plural: "hikes",
    pace: true,
    ceiling: 5,
    movingSpeed: 0.3,
    nominalSpeed: 1.2,
    gap: true,
    footCadence: true,
    efforts: [1000, MILE, 5000, 10000, 21097.5],
    cameraDistance: 700,
  },
  ride: {
    label: "Ride",
    plural: "rides",
    pace: false,
    ceiling: 25,
    movingSpeed: 1.0,
    nominalSpeed: 6.5,
    gap: false,
    footCadence: false,
    efforts: [5000, 10000, 20000, 40000, 50000, 100000],
    cameraDistance: 800,
  },
  ski: {
    label: "Ski",
    plural: "ski days",
    pace: false,
    ceiling: 40,
    movingSpeed: 0.8,
    nominalSpeed: 5,
    gap: false,
    footCadence: false,
    efforts: [1000, 5000, 10000],
    cameraDistance: 760,
  },
  paddle: {
    label: "Paddle",
    plural: "paddles",
    pace: false,
    ceiling: 9,
    movingSpeed: 0.4,
    nominalSpeed: 2,
    gap: false,
    footCadence: false,
    efforts: [500, 1000, 2000, 5000, 10000],
    cameraDistance: 600,
  },
  swim: {
    label: "Swim",
    plural: "swims",
    pace: true,
    paceShort: true,
    ceiling: 3,
    movingSpeed: 0.2,
    nominalSpeed: 0.9,
    gap: false,
    footCadence: false,
    efforts: [100, 400, 1000, 1500, 3800],
    cameraDistance: 420,
  },
  other: {
    label: "Activity",
    plural: "activities",
    pace: false,
    // Unknown sports (drives, flights, sailing…) get a lenient limit; see speedCeiling().
    ceiling: 80,
    movingSpeed: 0.5,
    nominalSpeed: 2.78,
    gap: false,
    footCadence: false,
    efforts: [1000, 5000, 10000, 50000],
    cameraDistance: 650,
  },
};

/** Maps a file's sport string (TCX Sport, GPX type, Strava/Garmin names) to a kind. */
export function sportKind(sport: string): SportKind {
  const s = sport.toLowerCase();
  if (/swim/.test(s)) return "swim";
  if (/hik|trek|mountaineer|backpack/.test(s)) return "hike";
  if (/walk/.test(s)) return "walk";
  if (/run|jog|trail/.test(s)) return "run";
  if (/bik|cycl|ride|gravel|mtb|velo/.test(s)) return "ride";
  if (/ski|snowboard|nordic/.test(s)) return "ski";
  if (/kayak|canoe|paddl|row|sup\b|surf/.test(s)) return "paddle";
  return "other";
}

/**
 * For "other" (no sport in the file, or one we don't know) guess from the median moving speed.
 * Returns null when it's too fast to be human-powered: it stays "other" with lenient limits.
 */
export function inferKind(medianMovingSpeed: number): SportKind | null {
  const v = medianMovingSpeed;
  if (!Number.isFinite(v) || v <= 0) return null;
  if (v < 1.9) return "walk";
  if (v < 5.2) return "run";
  if (v < 14) return "ride";
  return null;
}
