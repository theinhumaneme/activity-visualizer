import type { Activity } from "../parse/types";
import type { Settings, Units } from "./types";

/** Initial settings without loading the analysis engine into the page. */
export function defaultSettings(activity: Activity, units: Units, privacyRadius = 0, ftp = 0, weight = 0, wPrime = 0): Settings {
  let observed = 0;
  for (const s of activity.samples) if (s.hr && s.hr > observed) observed = s.hr;
  return {
    name: activity.name,
    units,
    // The highest HR in one run is only a lower bound on max HR, so don't go below a typical value.
    maxHr: Math.max(190, observed),
    restingHr: 60,
    zoneMethod: "max",
    trimStart: 0,
    trimEnd: 0,
    maxHrEstimated: true,
    privacyRadius,
    ftp,
    weight,
    wPrime,
  };
}
