// Which numbers the video shows: the live panel during the chase and the summary on the end card.
// Each stat is offered only when the activity has the data for it.

import type { Analysis } from "../analysis/types";
import { motionLabel, usesPace } from "../format/format";

export type LiveStat = "time" | "moving" | "distance" | "motion" | "hr" | "elev" | "grade" | "cadence" | "power";
export type EndStat = "distance" | "total" | "moving" | "stopped" | "avg" | "best" | "gain" | "loss" | "high" | "avgHr" | "maxHr" | "cadence" | "power" | "calories";

export const DEFAULT_LIVE: LiveStat[] = ["time", "distance", "motion", "hr", "elev", "grade"];
export const DEFAULT_END: EndStat[] = ["distance", "total", "avg", "gain", "avgHr"];
/** More than this crowds the panels (six live values fit two rows of three on a phone). */
export const MAX_LIVE = 6;
export const MAX_END = 8;

const timed = (a: Analysis) => !a.activity.routeOnly;
const pace = (a: Analysis) => usesPace(a.activity.kind);
const hasPower = (a: Analysis) => a.summary.avgPower !== undefined;

const LIVE: { key: LiveStat; label: (a: Analysis) => string; has: (a: Analysis) => boolean }[] = [
  { key: "time", label: () => "Total time", has: timed },
  { key: "moving", label: () => "Moving time", has: timed },
  { key: "distance", label: () => "Distance", has: () => true },
  { key: "motion", label: (a) => motionLabel(a.activity.kind), has: timed },
  { key: "hr", label: () => "Heart rate", has: (a) => a.zones.length > 0 },
  { key: "elev", label: () => "Elevation", has: (a) => !!a.elev },
  { key: "grade", label: () => "Grade", has: (a) => !!a.grade },
  { key: "cadence", label: () => "Cadence", has: (a) => !!a.cadence },
  { key: "power", label: () => "Power", has: hasPower },
];

const END: { key: EndStat; label: (a: Analysis) => string; has: (a: Analysis) => boolean }[] = [
  { key: "distance", label: () => "Distance", has: () => true },
  { key: "total", label: () => "Total time", has: timed },
  { key: "moving", label: () => "Moving time", has: timed },
  { key: "stopped", label: () => "Stopped time", has: (a) => timed(a) && a.summary.stoppedTime >= 1 },
  { key: "avg", label: (a) => `Avg ${motionLabel(a.activity.kind).toLowerCase()}`, has: timed },
  { key: "best", label: (a) => (pace(a) ? "Best pace" : "Max speed"), has: timed },
  { key: "gain", label: () => "Elevation gain", has: (a) => a.summary.elevGain !== undefined },
  { key: "loss", label: () => "Elevation loss", has: (a) => a.summary.elevLoss !== undefined },
  { key: "high", label: () => "High point", has: (a) => a.summary.elevMax !== undefined },
  { key: "avgHr", label: () => "Avg heart rate", has: (a) => a.summary.avgHr !== undefined },
  { key: "maxHr", label: () => "Max heart rate", has: (a) => a.summary.maxHr !== undefined },
  { key: "cadence", label: () => "Avg cadence", has: (a) => a.summary.avgCadence !== undefined },
  { key: "power", label: () => "Avg power", has: hasPower },
  { key: "calories", label: () => "Calories", has: (a) => a.summary.calories !== undefined },
];

/** The live stats this activity can show, as picker options (catalog order). */
export const liveOptions = (a: Analysis) => LIVE.filter((s) => s.has(a)).map((s) => ({ value: s.key, label: s.label(a) }));
export const endOptions = (a: Analysis) => END.filter((s) => s.has(a)).map((s) => ({ value: s.key, label: s.label(a) }));

/** The chosen stats this activity has, in catalog order (so panels read the same way every time). */
export const pickLive = (a: Analysis, chosen: readonly LiveStat[]) => LIVE.filter((s) => chosen.includes(s.key) && s.has(a)).map((s) => s.key);
export const pickEnd = (a: Analysis, chosen: readonly EndStat[]) => END.filter((s) => chosen.includes(s.key) && s.has(a)).map((s) => s.key);
