import { haversine } from "../geo/geo";
import {
  formatDate,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatElevation,
  formatMotion,
  formatPace,
  formatSpeed,
  formatUtcOffset,
  unitLabel,
  usesPace,
} from "../format/format";
import { SPORTS } from "../sport";
import { speedCeiling } from "./clean";
import type { Analysis, Insight, QualityItem } from "./types";

/**
 * The data audit shown before any visuals (≤ 12 lines): what's in the file, what's wrong with
 * it, what we fixed and how, and what's missing (and how the design adapts).
 */
export function buildQuality(a: Analysis, fileOffset: number | undefined): QualityItem[] {
  const { activity, samples, t, n, settings, cleaning } = a;
  const items: QualityItem[] = [];
  const u = settings.units;
  const trimmed = settings.trimStart > 0 || settings.trimEnd > 0;

  // 1. Format and device
  items.push({
    level: "ok",
    title: `${activity.source.toUpperCase()} file${activity.device ? ` from ${activity.device}` : ""}`,
    detail:
      `${activity.sport}${activity.multisport ? " (one leg of a multisport session)" : ""}, started ${formatDateTime(activity.startTime, activity.utcOffsetMin)}` +
      (activity.utcOffsetMin !== undefined
        ? ` local time (${formatUtcOffset(activity.utcOffsetMin)}, from the file).`
        : ". The file doesn't record its time zone, so times are in your browser's zone."),
  });

  if (activity.routeOnly) {
    items.push({
      level: "warn",
      title: "Route only: no timestamps",
      detail:
        "This file is a route or an untimed track, so there's no pace, heart rate or time. The flyover animates by distance at a steady speed, and time-based stats are hidden.",
    });
  }

  // 2. Sampling
  const gaps = new Map<number, number>();
  let longGaps = 0;
  let longest = 0;
  for (let i = 0; i < n - 1; i++) {
    const dt = Math.round(t[i + 1] - t[i]);
    gaps.set(dt, (gaps.get(dt) ?? 0) + 1);
    if (dt > 10) longGaps++;
    longest = Math.max(longest, dt);
  }
  const common = [...gaps.entries()].sort((x, y) => y[1] - x[1]);
  const smart = common[0][0] > 1 || common[0][1] / (n - 1) < 0.7;
  const others = common
    .slice(1, 4)
    .map(([dt, c]) => `${c.toLocaleString()} × ${dt} s`)
    .join(", ");
  const segments = new Set(samples.map((s) => s.seg)).size;
  if (!activity.routeOnly) {
    items.push({
      level: longGaps ? "info" : "ok",
      title: `${n.toLocaleString()} points, ${smart ? "smart recording (variable interval)" : `every ${common[0][0]} s`}`,
      detail:
        (others ? `Intervals: ${common[0][1].toLocaleString()} × ${common[0][0]} s, ${others}${common.length > 4 ? ", …" : ""}. ` : "") +
        (longGaps
          ? `${longGaps} gap${longGaps === 1 ? "" : "s"} over 10 s (longest ${formatDuration(longest)}): auto-pause or lost signal.`
          : "No gaps over 10 s.") +
        (segments > 1 ? ` ${segments} track segments (pauses or signal loss); segment breaks over 30 m aren't joined by a line.` : ""),
    });
  }

  // 3. Channels
  const has = (k: "hr" | "cad" | "power" | "alt") => samples.filter((s) => s[k] !== undefined && s[k] !== 0).length / n > 0.5;
  const ch: [string, boolean][] = [
    ["GPS", true],
    ["elevation", has("alt")],
    ["heart rate", !!a.zones.length],
    ["cadence", !!a.cadence],
    ["power", has("power")],
  ];
  const missing = ch.filter(([, ok]) => !ok).map(([k]) => k);
  const adapt: string[] = [];
  if (!a.zones.length && !activity.routeOnly) adapt.push("no HR zones, zone coloring or training load");
  if (!a.cadence && !activity.routeOnly) adapt.push("no cadence chart");
  if (!has("alt")) adapt.push(a.elev ? "elevation comes from the terrain model" : "no elevation profile until terrain data loads");
  items.push({
    level: missing.length > 2 ? "info" : "ok",
    title: `Channels: ${ch
      .filter(([, ok]) => ok)
      .map(([k]) => k)
      .join(", ")}`,
    detail: missing.length ? `Missing ${missing.join(", ")}: ${adapt.join("; ") || "nothing depends on it"}.` : "Everything the analysis can use is present.",
  });

  // 4. Distance: file vs GPS
  let gpsDist = 0;
  for (let i = 1; i < n; i++) gpsDist += haversine(samples[i - 1].lat, samples[i - 1].lon, samples[i].lat, samples[i].lon);
  const trackDist = a.dist[n - 1];
  const lapDist = activity.fileTotals.distance;
  if (activity.hasFileDistance && !trimmed) {
    const vsGps = ((trackDist - gpsDist) / gpsDist) * 100;
    const vsLap = lapDist ? ((trackDist - lapDist) / lapDist) * 100 : undefined;
    items.push({
      level: Math.abs(vsGps) > 3 || (vsLap !== undefined && Math.abs(vsLap) > 3) ? "warn" : "info",
      title: `Distance ${formatDistance(trackDist, u)} (device) vs ${formatDistance(gpsDist, u)} (GPS, ${vsGps >= 0 ? "+" : "−"}${Math.abs(vsGps).toFixed(1)}%)`,
      detail:
        (lapDist ? `The lap summary says ${formatDistance(lapDist, u)} (${Math.abs(vsLap!).toFixed(1)}% off the track; devices filter the summary separately). ` : "") +
        "Totals and splits use the device's distance; the map uses GPS for the shape.",
    });
  } else if (!activity.routeOnly) {
    items.push({
      level: "info",
      title: `Distance ${formatDistance(trackDist, u)}, measured from GPS`,
      detail: `The file has no distance channel, so it's summed point to point${cleaning.distanceRecomputed ? " after cleaning" : ""}.`,
    });
  }

  // 5. Moving vs elapsed, pauses
  if (!activity.routeOnly) {
    const devTime = activity.fileTotals.time;
    items.push({
      level: "ok",
      title: `Moving ${formatDuration(a.summary.moving)} of ${formatDuration(a.summary.elapsed)} elapsed`,
      detail:
        `${a.stops.length ? `${a.stops.length} pause${a.stops.length === 1 ? "" : "s"} (${formatDuration(a.stops.reduce((x, s) => x + s.duration, 0))}) excluded, and fast-forwarded in the flyover. ` : "No pauses of 10 s or more. "}` +
        (devTime && !trimmed ? `The device reports ${formatDuration(devTime)} moving; ` : "") +
        `moving means averaging ≥ ${SPORTS[activity.kind].movingSpeed} m/s over 10 s.`,
    });
  }

  // 6. GPS anomalies and the fixes made
  const fixes: string[] = [];
  if (cleaning.teleports) fixes.push(`${cleaning.teleports} teleport spike${cleaning.teleports === 1 ? "" : "s"} moved back onto the track`);
  if (cleaning.driftStart) fixes.push(`${cleaning.driftStart} drifting points before the start pinned`);
  if (cleaning.driftEnd) fixes.push(`${cleaning.driftEnd} after the finish pinned`);
  if (activity.interpolatedPoints) fixes.push(`${activity.interpolatedPoints} points without a GPS fix placed by interpolation`);
  if (!activity.routeOnly) {
    items.push({
      level: fixes.length ? "info" : "ok",
      title: fixes.length ? "GPS cleaned" : "GPS track looks clean",
      detail: fixes.length
        ? `${capitalize(fixes.join("; "))}. Pace is averaged over 20 s of distance, so no single point can fake a sprint.`
        : `No teleports (over ${speedCeiling(activity.kind)} m/s), drift clusters or missing fixes.`,
    });
  }

  // 7. Heart rate
  if (a.zones.length) {
    const hrFix = cleaning.hrDropouts + cleaning.hrSpikes;
    items.push({
      level: hrFix ? "info" : "ok",
      title: `Heart rate ${a.summary.minHr !== undefined ? Math.round(a.summary.minHr) : "—"}–${a.summary.maxHr !== undefined ? Math.round(a.summary.maxHr) : "—"} bpm`,
      detail:
        (hrFix
          ? `${cleaning.hrDropouts ? `${cleaning.hrDropouts} dropout${cleaning.hrDropouts === 1 ? "" : "s"} (under 30 bpm)` : ""}${cleaning.hrDropouts && cleaning.hrSpikes ? " and " : ""}${cleaning.hrSpikes ? `${cleaning.hrSpikes} spike${cleaning.hrSpikes === 1 ? "" : "s"} (over 25 bpm/s)` : ""} removed. `
          : "No dropouts or spikes. ") +
        (settings.maxHrEstimated
          ? `Zones are estimated from max HR ${settings.maxHr} bpm; enter your own in Settings.`
          : `Zones use your max HR ${settings.maxHr} bpm.`),
    });
  }

  // 8. Cadence
  if (a.cadence && activity.cadenceDoubled) {
    items.push({ level: "info", title: "Cadence doubled to steps/min", detail: "The file records cadence per leg (strides/min, median under 120), so it's doubled." });
  }

  // 9. Elevation
  const src = a.elevationSource;
  const offset = fileOffset !== undefined ? `${Math.abs(Math.round(fileOffset))} m ${fileOffset < 0 ? "below" : "above"}` : "";
  const method = a.summary.elevMethod ? ` Gain and loss: ${a.summary.elevMethod}.` : "";
  items.push(
    src === "terrain" && fileOffset !== undefined
      ? {
          level: "warn",
          title: "File altitude looks wrong, using terrain data",
          detail: `Altitude in the file sits about ${offset} the terrain model${a.samples.some((s) => (s.alt ?? 0) < 0) ? " and dips below sea level" : ""}. Elevation comes from terrain tiles instead.${method}`,
        }
      : src === "terrain"
        ? { level: "info", title: "Elevation from terrain data", detail: `The file has no altitude, so elevation comes from terrain tiles.${method}` }
        : src === "file"
          ? {
              level: "ok",
              title: "File altitude matches terrain",
              detail: `Within ${Math.abs(Math.round(fileOffset ?? 0))} m of the terrain model, so the file's altitude is used.${method}`,
            }
          : src === "file-unverified"
            ? { level: "info", title: "Using file altitude (not verified)", detail: `Terrain data couldn't be loaded to cross-check it.${method}` }
            : { level: "info", title: "No elevation data", detail: "The file has no altitude and terrain data couldn't be loaded." },
  );

  if (trimmed) {
    items.push({
      level: "info",
      title: "Recording trimmed",
      detail: `Removed ${formatDuration(settings.trimStart)} from the start and ${formatDuration(settings.trimEnd)} from the end. File totals (lap distance, calories) still describe the full recording.`,
    });
  }
  return items.slice(0, 12);
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function buildInsights(a: Analysis): { insights: Insight[]; headline: string } {
  const { summary: s, settings, activity } = a;
  const u = settings.units;
  const unit = unitLabel(u);
  const unitName = u === "metric" ? "km" : "mile";
  const kind = activity.kind;
  const pace = usesPace(kind);
  const out: Insight[] = [];

  const full = a.splits.filter((x) => Math.abs(x.distance - a.splits[0].distance) < 1);
  if (full.length >= 2) {
    const fastest = full.reduce((x, y) => (y.pace < x.pace ? y : x));
    const slowest = full.reduce((x, y) => (y.pace > x.pace ? y : x));
    if (fastest !== slowest) {
      out.push({
        title: `Fastest ${unitName}`,
        value: pace ? formatPace(fastest.pace, u) : formatSpeed(1000 / fastest.pace, u),
        text: pace
          ? `Split ${fastest.index}, ${Math.round(scale(slowest.pace - fastest.pace, u))} s/${unit} quicker than split ${slowest.index}.`
          : `Split ${fastest.index}, ${formatSpeed(1000 / fastest.pace - 1000 / slowest.pace, u)} faster than split ${slowest.index}.`,
        weight: 70,
      });
    }
  }

  const halfDiff = scale(s.secondHalfPace - s.firstHalfPace, u);
  if (pace && Number.isFinite(halfDiff)) {
    if (halfDiff < -3)
      out.push({ title: "Negative split", value: `−${Math.round(-halfDiff)} s/${unit}`, text: "The second half was faster than the first.", weight: 80 });
    else if (halfDiff > 3)
      out.push({ title: "Second-half slowdown", value: `+${Math.round(halfDiff)} s/${unit}`, text: "You slowed in the second half compared with the first.", weight: 75 });
    else
      out.push({
        title: "Even pacing",
        value: `±${Math.max(1, Math.round(Math.abs(halfDiff)))} s/${unit}`,
        text: "Both halves within a few seconds of each other.",
        weight: 60,
      });
  }

  if (a.zones.length) {
    const total = a.zones.reduce((x, z) => x + z.seconds, 0);
    const hard = (a.zones[3].seconds + a.zones[4].seconds) / total;
    const easy = (a.zones[0].seconds + a.zones[1].seconds) / total;
    if (hard > 0.5) out.push({ title: "Hard effort", value: `${Math.round(hard * 100)}%`, text: "of the time in zones 4–5, threshold and above.", weight: 85 });
    else if (easy > 0.7) out.push({ title: "Easy aerobic session", value: `${Math.round(easy * 100)}%`, text: "of the time in zones 1–2.", weight: 65 });
    else {
      const top = [...a.zones].sort((x, y) => y.seconds - x.seconds)[0];
      out.push({ title: `Mostly zone ${top.zone}`, value: `${Math.round((top.seconds / total) * 100)}%`, text: `of the time in zone ${top.zone} (${top.name.toLowerCase()}).`, weight: 50 });
    }
    let peak = 0;
    for (let i = 1; i < a.n; i++) if (a.hr[i] > a.hr[peak] || Number.isNaN(a.hr[peak])) peak = i;
    const at = a.t[peak] / s.elapsed;
    if (at > 0.85) out.push({ title: "Strong finish", value: `${s.maxHr} bpm`, text: "Heart rate peaked in the final stretch.", weight: 55 });
    else if (at < 0.25)
      out.push({ title: "Early peak", value: `${s.maxHr} bpm`, text: "Heart rate peaked in the first quarter, so the start may have been too fast.", weight: 60 });
  }

  if (s.decoupling !== undefined && s.moving >= 20 * 60) {
    const steady = Math.abs(s.decoupling) < 5;
    out.push({
      title: steady ? "Steady aerobic effort" : "Heart-rate drift",
      value: `${s.decoupling.toFixed(1)}%`,
      text: steady
        ? "Aerobic decoupling: heart rate stayed in step with pace, a sign of good aerobic fitness for this effort."
        : `Aerobic decoupling: heart rate ${s.decoupling > 0 ? "drifted up" : "dropped"} relative to pace in the second half.`,
      weight: steady ? 45 : 65,
    });
  }

  const p = a.power;
  if (p) {
    out.push({
      title: "Normalized power",
      value: `${Math.round(p.np)} W`,
      text:
        p.intensity !== undefined
          ? `${Math.round(p.intensity * 100)}% of ${p.ftpEstimated ? "an estimated " : ""}FTP (${p.ftp} W) for ${Math.round(p.tss!)} training stress; average ${Math.round(p.avg)} W.`
          : `Average ${Math.round(p.avg)} W, ${Math.round(p.work).toLocaleString("en-US")} kJ of work.`,
      weight: 72,
    });
    const best20 = p.curve.find((c) => c.seconds === 1200);
    if (best20) out.push({ title: "Best 20 minutes", value: `${Math.round(best20.watts)} W`, text: "your highest 20-minute average power in this ride.", weight: 58 });
  }

  const longest = a.bestEfforts[a.bestEfforts.length - 1];
  if (longest)
    out.push({
      title: `Fastest ${longest.label}`,
      value: formatDuration(longest.seconds),
      text: `${pace ? formatPace(longest.pace, u) : formatMotion(longest.distance / longest.seconds, kind, u)}, anywhere in the activity.`,
      weight: 50,
    });

  if (a.slowdowns.length >= 2 && SPORTS[kind].footCadence) {
    const sd = a.slowdowns;
    const k = sd.length;
    const mean = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length;
    const every = mean(sd.slice(1).map((s, i) => a.t[s.startIdx] - a.t[sd[i].startIdx]));
    const everyDist = mean(sd.slice(1).map((s, i) => a.dist[s.startIdx] - a.dist[sd[i].startIdx]));
    const cv = Math.sqrt(mean(sd.slice(1).map((s, i) => (a.t[s.startIdx] - a.t[sd[i].startIdx] - every) ** 2))) / every;
    const avgDur = mean(sd.map((s) => s.duration));
    const walking = mean(sd.map((s) => s.speed)) < 2;
    const hrDrops = sd
      .map((s) => {
        let low = a.hr[s.startIdx];
        for (let i = s.startIdx; i <= Math.min(a.n - 1, s.endIdx + 5); i++) if (a.hr[i] < low) low = a.hr[i];
        return a.hr[s.startIdx] - low;
      })
      .filter(Number.isFinite);
    const hrNote = hrDrops.length && mean(hrDrops) >= 5 ? ` Heart rate dropped about ${Math.round(mean(hrDrops))} bpm in each.` : "";
    const what = walking ? "walk breaks" : "slowdowns";
    const rhythm = k >= 3 && cv < 0.25;
    out.push({
      title: rhythm ? "Run/walk rhythm" : walking ? "Walk breaks" : "Slowdowns",
      value: `${k} ${what}`,
      text: rhythm
        ? `About ${Math.round(avgDur)} s each, every ${formatDuration(every)} (≈${formatDistance(everyDist, u, 2)}).${hrNote}`
        : `${Math.round(avgDur)} s on average.${hrNote}`,
      weight: rhythm ? 78 : 40,
    });
  }

  if (a.stops.length) {
    const total = a.stops.reduce((x, st) => x + st.duration, 0);
    out.push({
      title: a.stops.length === 1 ? "One stop" : "Stops",
      value: formatDuration(total),
      text: `${a.stops.length} stop${a.stops.length === 1 ? "" : "s"} in total; they're fast-forwarded in the flyover.`,
      weight: 20,
    });
  }

  if (s.elevGain !== undefined && a.grade) {
    let steepest = 0;
    for (const g of a.grade) if (g > steepest) steepest = g;
    out.push(
      s.elevGain < 15
        ? { title: "Mostly flat", value: formatElevation(s.elevGain, u), text: "of climbing.", weight: 15 }
        : { title: "Climbing", value: formatElevation(s.elevGain, u), text: `of climbing, steepest grade about ${Math.round(steepest * 100)}%.`, weight: 40 },
    );
  }

  if (s.avgCadence && SPORTS[kind].footCadence) {
    out.push({
      title: "Cadence",
      value: `${Math.round(s.avgCadence)} spm`,
      text: `Average steps per minute${s.strideLength ? `, stride about ${s.strideLength.toFixed(2)} m` : ""}.`,
      weight: 25,
    });
  }

  out.sort((x, y) => y.weight - x.weight);
  return { insights: out, headline: headlineFor(a) };
}

/** One-line summary; the only part of the analysis that depends on the activity's name. */
export function headlineFor(a: Analysis): string {
  const { summary: s, settings, activity } = a;
  const u = settings.units;
  const hrPart = s.avgHr ? `, average heart rate ${Math.round(s.avgHr)} bpm` : "";
  return `${settings.name} on ${formatDate(activity.startTime, activity.utcOffsetMin)}: ${formatDistance(s.distance, u)} in ${formatDuration(s.elapsed)} (${formatDuration(s.moving)} moving) at ${formatMotion(s.avgSpeed, activity.kind, u)}${hrPart}.`;
}

/** Converts a per-km quantity to per-unit. */
const scale = (secPerKm: number, u: "metric" | "imperial") => (u === "metric" ? secPerKm : secPerKm * 1.609344);
