import { XMLParser } from "fast-xml-parser";
import { type RawSample, asArray, cadenceIsPerLeg, finalizeSamples, num, resolveKind, sportKind, utcOffsetOf } from "./common";
import type { Activity, Lap } from "./types";

// Any node may repeat in real-world files, so force arrays where it matters.
const ARRAYS = new Set(["Activity", "Lap", "Track", "Trackpoint", "FirstSport", "NextSport"]);

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = Record<string, any>;

export function parseTcx(xml: string, fileName = "Activity"): Activity[] {
  // removeNSPrefix makes "ns3:TPX" and "TPX" the same key, so namespace prefixes never matter.
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    // Values stay strings: `num()` converts the numeric ones, and skipping the parser's own
    // number detection on every text node makes large files parse ~15% faster.
    parseTagValue: false,
    isArray: (name) => ARRAYS.has(name),
  });
  const doc = parser.parse(xml) as Node;
  if (!("TrainingCenterDatabase" in doc)) throw new Error("This doesn't look like a TCX file (no TrainingCenterDatabase element).");
  const root: Node = doc.TrainingCenterDatabase || {};
  const activities = asArray<Node>(root.Activities?.Activity).map((a) => ({ a, multisport: false }));
  // Multisport sessions nest each leg's Activity under FirstSport / NextSport.
  for (const ms of asArray<Node>(root.Activities?.MultiSportSession)) {
    for (const leg of [...asArray<Node>(ms.FirstSport), ...asArray<Node>(ms.NextSport)]) {
      for (const a of asArray<Node>(leg.Activity)) activities.push({ a, multisport: true });
    }
  }
  if (!activities.length) throw new Error("The TCX file contains no activities.");

  return activities.map(({ a, multisport }, i) => {
    const act = parseActivity(a, activities.length > 1 ? `${fileName} (${i + 1})` : fileName);
    if (multisport) act.multisport = true;
    return act;
  });
}

function parseActivity(a: Node, fallbackName: string): Activity {
  const sport = String(a["@_Sport"] ?? "Other");
  const kind = sportKind(sport);
  const raw: (RawSample & { runCad?: number })[] = [];
  const lapRanges: Omit<Lap, "startIndex" | "endIndex">[] = [];
  const lapFirstTime: number[] = [];
  let dropped = 0;
  let distCount = 0;
  let total = 0;
  let firstIso: string | undefined;
  let seg = 0;

  for (const lap of asArray<Node>(a.Lap)) {
    const startTime = Date.parse(lap["@_StartTime"] ?? "");
    lapRanges.push({
      startTime,
      totalTime: num(lap.TotalTimeSeconds),
      distance: num(lap.DistanceMeters),
      calories: num(lap.Calories),
      avgHr: num(lap.AverageHeartRateBpm?.Value),
      maxHr: num(lap.MaximumHeartRateBpm?.Value),
      intensity: typeof lap.Intensity === "string" ? lap.Intensity : undefined,
      trigger: typeof lap.TriggerMethod === "string" ? lap.TriggerMethod : undefined,
    });
    let first = NaN;
    for (const track of asArray<Node>(lap.Track)) {
      for (const tp of asArray<Node>(track.Trackpoint)) {
        total++;
        const iso = String(tp.Time ?? "");
        const time = Date.parse(iso);
        if (!Number.isFinite(time)) {
          dropped++;
          continue;
        }
        firstIso ??= iso;
        let lat = num(tp.Position?.LatitudeDegrees);
        let lon = num(tp.Position?.LongitudeDegrees);
        // 0,0 is "no fix" on some devices, not a run off the coast of Africa.
        if (lat === undefined || lon === undefined || (lat === 0 && lon === 0)) lat = lon = NaN;
        if (Number.isNaN(first)) first = time;
        const tpx = tp.Extensions?.TPX ?? {};
        const dist = num(tp.DistanceMeters);
        if (dist !== undefined) distCount++;
        const runCad = num(tpx.RunCadence);
        raw.push({
          time,
          lat,
          lon,
          dist: dist ?? NaN,
          alt: num(tp.AltitudeMeters),
          hr: num(tp.HeartRateBpm?.Value),
          cad: runCad ?? num(tp.Cadence),
          runCad,
          speed: num(tpx.Speed),
          power: num(tpx.Watts),
          seg,
        });
      }
      seg++;
    }
    lapFirstTime.push(Number.isNaN(first) ? startTime : first);
  }

  const doubled = cadenceIsPerLeg(
    raw.map((r) => r.cad),
    kind,
    raw.some((r) => r.runCad !== undefined),
  );
  for (const r of raw) {
    if (r.cad !== undefined && r.cad <= 0) r.cad = r.cad === 0 ? 0 : undefined;
    else if (r.cad !== undefined && doubled) r.cad *= 2;
    delete r.runCad;
  }

  const hasFileDistance = raw.length > 0 && distCount / raw.length > 0.95;
  const done = finalizeSamples(raw, hasFileDistance);
  if (!done || done.samples.length < 2) {
    throw new Error(
      total > 0
        ? "None of the trackpoints have GPS positions, so there's no route to draw (treadmill or indoor activity?)."
        : "The activity has no trackpoints.",
    );
  }
  const { samples, interpolated } = done;
  const resolved = resolveKind(kind, samples, false);

  const laps: Lap[] = lapRanges.map((l, i) => {
    const from = lapFirstTime[i];
    const to = i + 1 < lapFirstTime.length ? lapFirstTime[i + 1] : Infinity;
    let startIndex = samples.findIndex((s) => s.time >= from);
    if (startIndex < 0) startIndex = samples.length - 1;
    let endIndex = samples.findIndex((s) => s.time >= to) - 1;
    if (endIndex < 0) endIndex = samples.length - 1;
    return { ...l, startIndex, endIndex: Math.max(startIndex, endIndex) };
  });

  const sum = (k: "totalTime" | "distance" | "calories") => {
    const vals = lapRanges.map((l) => l[k]).filter((v): v is number => v !== undefined);
    return vals.length ? vals.reduce((x, y) => x + y, 0) : undefined;
  };

  const notes = typeof a.Notes === "string" ? a.Notes : undefined;
  return {
    name: fallbackName,
    sport,
    kind: resolved.kind,
    kindInferred: resolved.inferred || undefined,
    startTime: samples[0].time,
    utcOffsetMin: utcOffsetOf(firstIso),
    device: a.Creator?.Name ? String(a.Creator.Name) : undefined,
    notes,
    source: "tcx",
    laps,
    samples,
    fileTotals: { distance: sum("distance"), time: sum("totalTime"), calories: sum("calories") },
    droppedPoints: dropped,
    interpolatedPoints: interpolated,
    hasFileDistance,
    cadenceDoubled: doubled,
    routeOnly: false,
  };
}
