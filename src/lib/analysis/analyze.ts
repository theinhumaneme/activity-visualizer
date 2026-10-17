import type { Activity, Sample } from "../parse/types";
import { formatEffortDistance, unitLength } from "../format/format";
import { SPORTS } from "../sport";
import { cleanHeartRate, cleanSamples } from "./clean";
import { detectClimbs } from "./climbs";
import { ELEV_SMOOTH_HALF, resolveElevation } from "./elevation";
import { detectIntervals } from "./intervals";
import { findMoments } from "./moments";
import { computePrivacy } from "./privacy";
import { buildInsights, buildQuality } from "./report";
import { atIndex, indexAtDist, indexAtDistCursor, interpCursor } from "./series";
import type { Analysis, BestEffort, Settings, Slowdown, Split, Stop, Summary, Units, Zone } from "./types";

export const ZONE_NAMES = ["Recovery", "Endurance", "Tempo", "Threshold", "Maximum"];
const ZONE_PCTS = [0.6, 0.7, 0.8, 0.9];

/** Longest gap (s) that still counts towards time-weighted averages. */
const MAX_DT = 10;
/** Elevation changes smaller than this (m) are treated as noise when adding up gain and loss. */
export const ELEV_HYSTERESIS = 2.5;

/**
 * Minetti et al. (2002) metabolic cost of running, J/(kg·m), at grade g (fraction, valid ±0.45).
 * GAP = speed × C(g) / C(0): what the same effort would have been worth on the flat.
 */
export const minetti = (g: number) => 155.4 * g ** 5 - 30.4 * g ** 4 - 43.3 * g ** 3 + 46.3 * g ** 2 + 19.5 * g + 3.6;

export function defaultSettings(activity: Activity, units: Units, privacyRadius = 0): Settings {
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
  };
}

/** Applies the start/end trim and rebases time and distance to zero. */
function trim(activity: Activity, settings: Settings, dem: Float64Array | null) {
  const all = activity.samples;
  const total = all[all.length - 1].t;
  const from = Math.max(0, settings.trimStart);
  const to = total - Math.max(0, settings.trimEnd);
  if (to - from < 30 || (from === 0 && to === total)) return { samples: all, dem, offset: 0 };
  let i0 = all.findIndex((s) => s.t >= from);
  let i1 = all.length - 1;
  while (i1 > 0 && all[i1].t > to) i1--;
  if (i0 < 0) i0 = 0;
  const base = all[i0];
  const samples: Sample[] = all.slice(i0, i1 + 1).map((s) => ({ ...s, t: s.t - base.t, dist: s.dist - base.dist }));
  return { samples, dem: dem ? dem.slice(i0, i1 + 1) : null, offset: i0 };
}

/** Device laps re-indexed into the trimmed samples (laps entirely outside the trim are dropped). */
function lapsIn(activity: Activity, offset: number, n: number) {
  return activity.laps
    .map((l) => ({ ...l, startIndex: l.startIndex - offset, endIndex: Math.min(n - 1, l.endIndex - offset) }))
    .filter((l) => l.endIndex > 0 && l.startIndex < n - 1)
    .map((l) => ({ ...l, startIndex: Math.max(0, l.startIndex) }));
}

export function analyze(activity: Activity, settings: Settings, demAll: Float64Array | null): Analysis {
  const trimmed = trim(activity, settings, demAll);
  const dem = trimmed.dem;
  const kind = activity.kind;
  const cleaned = cleanSamples(trimmed.samples, kind, activity.hasFileDistance, activity.routeOnly);
  const samples = cleaned.samples;
  const n = samples.length;
  const t = Float64Array.from(samples, (s) => s.t);
  const dist = Float64Array.from(samples, (s) => s.dist);
  const elapsed = t[n - 1];
  const distance = dist[n - 1];

  // Both window edges only move forward, so each gets its own cursor instead of a binary search.
  const windowSpeed = (half: number) => {
    const distLo = interpCursor(t, dist);
    const distHi = interpCursor(t, dist);
    return Float64Array.from(t, (ti) => {
      const lo = Math.max(0, ti - half);
      const hi = Math.min(elapsed, ti + half);
      return hi > lo ? (distHi(hi) - distLo(lo)) / (hi - lo) : 0;
    });
  };
  const speed = windowSpeed(10);
  const speedBest = windowSpeed(15);
  const speedMove = windowSpeed(5);
  const speedLive = windowSpeed(6);

  // Moving detection: average speed over ~10 s, so GPS jitter while standing doesn't count.
  const profile = SPORTS[kind];
  const threshold = profile.movingSpeed;
  const moving = new Uint8Array(n);
  const movingTime = new Float64Array(n);
  for (let i = 0; i < n - 1; i++) {
    const dt = t[i + 1] - t[i];
    const dd = dist[i + 1] - dist[i];
    const v = (speedMove[i] + speedMove[i + 1]) / 2;
    // A gap over 10 s (auto-pause, lost signal) only counts as moving if you covered ground at a plausible pace.
    moving[i] = activity.routeOnly || (v >= threshold && !(dt > MAX_DT && dd / dt < threshold)) ? 1 : 0;
    movingTime[i + 1] = movingTime[i] + (moving[i] ? dt : 0);
  }
  const movingTotal = movingTime[n - 1];
  const isMovingSample = (i: number) => moving[i] === 1 || (i > 0 && moving[i - 1] === 1);
  const dtAt = (i: number) => (i < n - 1 ? Math.min(t[i + 1] - t[i], MAX_DT) : 0);

  const hrClean = cleanHeartRate(samples);
  const hr = hrClean.hr;
  const hrCount = hr.reduce((c, v) => c + (Number.isNaN(v) ? 0 : 1), 0);
  const hasHr = hrCount / n > 0.5;
  const cadCount = samples.reduce((c, s) => c + (s.cad !== undefined ? 1 : 0), 0);
  const cadence = cadCount / n > 0.5 ? Float64Array.from(samples, (s) => s.cad ?? NaN) : null;

  const elevation = resolveElevation(samples, dem, dist);
  const elev = elevation.elev;
  let grade: Float64Array | null = null;
  let gap: Float64Array | null = null;
  if (elev) {
    // Grade over an 80 m window of smoothed elevation, clamped to ±40%.
    const fromA = indexAtDistCursor(dist);
    const fromB = indexAtDistCursor(dist);
    grade = Float64Array.from(dist, (d) => {
      const a = Math.max(0, d - 40);
      const b = Math.min(distance, d + 40);
      const g = b - a > 20 ? (atIndex(elev, fromB(b)) - atIndex(elev, fromA(a))) / (b - a) : 0;
      return Math.max(-0.4, Math.min(0.4, g));
    });
    if (profile.gap) gap = Float64Array.from(speed, (v, i) => (v * minetti(grade![i])) / minetti(0));
  }

  // --- Heart rate & zones ---------------------------------------------------
  const zoneLow = (pct: number) => (settings.zoneMethod === "max" ? pct * settings.maxHr : settings.restingHr + pct * (settings.maxHr - settings.restingHr));
  const bounds = [0, ...ZONE_PCTS.map(zoneLow), Infinity];
  const zones: Zone[] = ZONE_NAMES.map((name, z) => ({ zone: z + 1, name, low: bounds[z], high: bounds[z + 1], seconds: 0 }));
  let hrSum = 0;
  let hrTime = 0;
  let hrMax = -Infinity;
  let hrMin = Infinity;
  if (hasHr) {
    for (let i = 0; i < n; i++) {
      const v = hr[i];
      if (Number.isNaN(v)) continue;
      const dt = dtAt(i);
      hrSum += v * dt;
      hrTime += dt;
      hrMax = Math.max(hrMax, v);
      hrMin = Math.min(hrMin, v);
      let z = 0;
      while (z < 4 && v >= bounds[z + 1]) z++;
      zones[z].seconds += dt;
    }
  }
  const avgHr = hasHr && hrTime > 0 ? hrSum / hrTime : undefined;
  const trimp = hasHr ? zones.reduce((s, z) => s + (z.seconds / 60) * z.zone, 0) : undefined;

  // --- Pace & efficiency ------------------------------------------------------
  let maxSpeed = 0;
  let sMean = 0;
  let sCount = 0;
  for (let i = 0; i < n; i++) {
    if (!isMovingSample(i)) continue;
    maxSpeed = Math.max(maxSpeed, speedBest[i]);
    sMean += speed[i];
    sCount++;
  }
  sMean = sCount ? sMean / sCount : 0;
  let sVar = 0;
  for (let i = 0; i < n; i++) if (isMovingSample(i)) sVar += (speed[i] - sMean) ** 2;
  const paceCv = sCount > 10 && sMean > 0 ? Math.sqrt(sVar / sCount) / sMean : undefined;

  const avgSpeed = movingTotal > 0 ? distance / movingTotal : 0;

  let gapPace: number | undefined;
  if (grade && profile.gap) {
    let eq = 0;
    for (let i = 0; i < n - 1; i++) if (moving[i]) eq += ((dist[i + 1] - dist[i]) * minetti(grade[i])) / 3.6;
    if (eq > 0) gapPace = (movingTotal / eq) * 1000;
  }

  let movHrSum = 0;
  let movHrTime = 0;
  let cadSum = 0;
  let cadTime = 0;
  let powSum = 0;
  let powTime = 0;
  for (let i = 0; i < n - 1; i++) {
    if (!moving[i]) continue;
    const dt = Math.min(t[i + 1] - t[i], MAX_DT);
    if (!Number.isNaN(hr[i])) {
      movHrSum += hr[i] * dt;
      movHrTime += dt;
    }
    const c = cadence?.[i];
    if (c !== undefined && c > 0) {
      cadSum += c * dt;
      cadTime += dt;
    }
    const p = samples[i].power;
    if (p !== undefined) {
      powSum += p * dt;
      powTime += dt;
    }
  }
  const avgMovingHr = movHrTime > 0 ? movHrSum / movHrTime : undefined;
  const avgCadence = cadTime > 0 ? cadSum / cadTime : undefined;

  // Aerobic decoupling: efficiency (speed / HR) in the first vs second half of moving time.
  let decoupling: number | undefined;
  if (hasHr && movingTotal >= 600) {
    const half = movingTotal / 2;
    const acc = [
      { d: 0, tm: 0, hr: 0, ht: 0 },
      { d: 0, tm: 0, hr: 0, ht: 0 },
    ];
    for (let i = 0; i < n - 1; i++) {
      if (!moving[i]) continue;
      const h = acc[movingTime[i] < half ? 0 : 1];
      const dt = t[i + 1] - t[i];
      h.d += dist[i + 1] - dist[i];
      h.tm += dt;
      if (!Number.isNaN(hr[i])) {
        h.hr += hr[i] * dt;
        h.ht += dt;
      }
    }
    const ef = acc.map((h) => (h.tm > 0 && h.ht > 0 ? h.d / h.tm / (h.hr / h.ht) : NaN));
    if (ef.every(Number.isFinite)) decoupling = ((ef[0] - ef[1]) / ef[0]) * 100;
  }

  const fHalf = indexAtDist(dist, distance / 2);
  const mHalf = atIndex(movingTime, fHalf);

  let elevGain: number | undefined;
  let elevLoss: number | undefined;
  let elevMin: number | undefined;
  let elevMax: number | undefined;
  if (elev) {
    elevGain = 0;
    elevLoss = 0;
    let ref = elev[0];
    elevMin = Infinity;
    elevMax = -Infinity;
    for (const e of elev) {
      elevMin = Math.min(elevMin, e);
      elevMax = Math.max(elevMax, e);
      if (e - ref > ELEV_HYSTERESIS) {
        elevGain += e - ref;
        ref = e;
      } else if (ref - e > ELEV_HYSTERESIS) {
        elevLoss += ref - e;
        ref = e;
      }
    }
  }

  const summary: Summary = {
    distance,
    elapsed,
    moving: movingTotal,
    avgSpeed,
    maxSpeed,
    avgPace: avgSpeed > 0 ? 1000 / avgSpeed : NaN,
    bestPace: maxSpeed > 0 ? 1000 / maxSpeed : NaN,
    gapPace,
    avgHr,
    maxHr: hasHr ? hrMax : undefined,
    minHr: hasHr ? hrMin : undefined,
    calories: activity.fileTotals.calories,
    elevGain,
    elevLoss,
    elevMin,
    elevMax,
    elevMethod: elev
      ? `${elevation.source === "terrain" ? "terrain model" : "device altitude"}, smoothed over ${ELEV_SMOOTH_HALF * 2} m, ${ELEV_HYSTERESIS} m threshold`
      : undefined,
    avgCadence,
    strideLength: avgCadence && profile.footCadence ? avgSpeed / (avgCadence / 60) : undefined,
    avgPower: powTime > 0 ? powSum / powTime : undefined,
    efficiency: avgMovingHr ? (avgSpeed * 60) / avgMovingHr : undefined,
    decoupling,
    trimp,
    paceCv,
    firstHalfPace: (mHalf / (distance / 2)) * 1000,
    secondHalfPace: ((movingTotal - mHalf) / (distance / 2)) * 1000,
    stoppedTime: elapsed - movingTotal,
  };

  const splits = computeSplits(unitLength(settings.units), t, dist, movingTime, hr, elev, cadence, profile.gap ? grade : null, moving);
  const bestEfforts = computeBestEfforts(profile.efforts, t, dist);
  const stops = computeStops(samples, t, moving);
  // Slowing into or out of a stop isn't a separate slowdown.
  const slowdowns = computeSlowdowns(t, dist, speedMove, moving).filter(
    (sd) => !stops.some((st) => t[st.startIdx] - t[sd.endIdx] < 10 && t[sd.startIdx] - t[st.endIdx] < 10),
  );
  const paceHistogram = computePaceHistogram(settings.units, !profile.pace, speed, t, moving);
  const intervals = activity.routeOnly ? null : detectIntervals({ t, dist, speed: speedMove, hr, moving }, lapsIn(activity, trimmed.offset, n));
  const climbs = elev ? detectClimbs(dist, elev) : [];
  const privacy = computePrivacy(samples, settings.privacyRadius);

  const analysis: Analysis = {
    activity,
    settings,
    samples,
    n,
    t,
    dist,
    speed,
    speedLive,
    gap,
    hr,
    cadence,
    elev,
    grade,
    elevationSource: elevation.source,
    moving,
    movingTime,
    summary,
    splits,
    zones: hasHr ? zones : [],
    bestEfforts,
    stops,
    slowdowns,
    intervals,
    climbs,
    moments: [],
    privacy,
    cleaning: {
      teleports: cleaned.teleports,
      driftStart: cleaned.driftStart,
      driftEnd: cleaned.driftEnd,
      hrDropouts: hrClean.dropouts,
      hrSpikes: hrClean.spikes,
      distanceRecomputed: cleaned.distanceRecomputed,
    },
    paceHistogram,
    quality: [],
    insights: [],
    headline: "",
  };
  analysis.moments = findMoments(analysis);
  analysis.quality = buildQuality(analysis, elevation.fileOffset);
  const report = buildInsights(analysis);
  analysis.insights = report.insights;
  analysis.headline = report.headline;
  return analysis;
}

function computeSplits(
  unit: number,
  t: Float64Array,
  dist: Float64Array,
  movingTime: Float64Array,
  hr: Float64Array,
  elev: Float64Array | null,
  cadence: Float64Array | null,
  grade: Float64Array | null,
  isMoving: Uint8Array,
): Split[] {
  const total = dist[dist.length - 1];
  const splits: Split[] = [];
  for (let k = 0; k * unit < total; k++) {
    const dA = k * unit;
    const dB = Math.min((k + 1) * unit, total);
    if (dB - dA < 20 && k > 0) break;
    const fA = indexAtDist(dist, dA);
    const fB = indexAtDist(dist, dB);
    const moving = atIndex(movingTime, fB) - atIndex(movingTime, fA);
    let hs = 0;
    let ht = 0;
    let cs = 0;
    let ct = 0;
    let eq = 0;
    for (let i = Math.floor(fA); i < Math.ceil(fB); i++) {
      const dt = Math.min(t[i + 1] - t[i], MAX_DT);
      if (!Number.isNaN(hr[i])) {
        hs += hr[i] * dt;
        ht += dt;
      }
      if (cadence && isMoving[i] && cadence[i] > 0) {
        cs += cadence[i] * dt;
        ct += dt;
      }
      if (grade && isMoving[i]) eq += ((dist[i + 1] - dist[i]) * minetti(grade[i])) / minetti(0);
    }
    splits.push({
      index: k + 1,
      distance: dB - dA,
      elapsed: atIndex(t, fB) - atIndex(t, fA),
      moving,
      pace: (moving / (dB - dA)) * 1000,
      gapPace: grade && eq > 0 ? (moving / eq) * 1000 : undefined,
      avgHr: ht > 0 ? hs / ht : undefined,
      avgCadence: ct > 0 ? cs / ct : undefined,
      elevDelta: elev ? atIndex(elev, fB) - atIndex(elev, fA) : undefined,
      startIdx: Math.floor(fA),
      endIdx: Math.ceil(fB),
    });
  }
  return splits;
}


function computeBestEfforts(distances: number[], t: Float64Array, dist: Float64Array): BestEffort[] {
  const total = dist[dist.length - 1];
  const out: BestEffort[] = [];
  for (const D of distances) {
    if (D > total) break;
    let best = Infinity;
    let si = 0;
    let ei = 0;
    const endAt = indexAtDistCursor(dist);
    for (let i = 0; i < dist.length; i++) {
      // Skip repeated points while stationary; the last one of each run is the best start.
      if (i + 1 < dist.length && dist[i + 1] === dist[i]) continue;
      const target = dist[i] + D;
      if (target > total) break;
      const f = endAt(target);
      const dur = atIndex(t, f) - t[i];
      if (dur < best) {
        best = dur;
        si = i;
        ei = Math.ceil(f);
      }
    }
    if (Number.isFinite(best)) {
      out.push({ label: formatEffortDistance(D), distance: D, seconds: best, pace: (best / D) * 1000, startIdx: si, endIdx: ei });
    }
  }
  return out;
}

function computeStops(samples: Sample[], t: Float64Array, moving: Uint8Array): Stop[] {
  const stops: Stop[] = [];
  let start = -1;
  for (let i = 0; i < samples.length; i++) {
    const still = i < samples.length - 1 && !moving[i];
    if (still && start < 0) start = i;
    if (!still && start >= 0) {
      const duration = t[i] - t[start];
      if (duration >= 10) {
        const mid = samples[Math.floor((start + i) / 2)];
        stops.push({ startIdx: start, endIdx: i, duration, lat: mid.lat, lon: mid.lon });
      }
      start = -1;
    }
  }
  return stops;
}

/**
 * Stretches of ≥ 8 s while still moving at under 70% of the median moving speed:
 * walk breaks, traffic lights you jogged through, steep climbs.
 */
function computeSlowdowns(t: Float64Array, dist: Float64Array, speed: Float64Array, moving: Uint8Array): Slowdown[] {
  const n = t.length;
  const moved: number[] = [];
  for (let i = 0; i < n - 1; i++) if (moving[i]) moved.push(speed[i]);
  if (moved.length < 60) return [];
  // A typed array sorts numerically without a comparator call per comparison.
  const v = Float64Array.from(moved).sort();
  const limit = v[v.length >> 1] * 0.7;
  const out: Slowdown[] = [];
  let start = -1;
  for (let i = 0; i <= n - 1; i++) {
    const slow = i < n - 1 && moving[i] === 1 && speed[i] < limit;
    if (slow && start < 0) start = i;
    if (!slow && start >= 0) {
      const prev = out[out.length - 1];
      if (prev && t[start] - t[prev.endIdx] < 5)
        prev.endIdx = i; // merge brief recoveries
      else out.push({ startIdx: start, endIdx: i, duration: 0, speed: 0 });
      start = -1;
    }
  }
  return out
    .map((s) => {
      const duration = t[s.endIdx] - t[s.startIdx];
      return { ...s, duration, speed: duration > 0 ? (dist[s.endIdx] - dist[s.startIdx]) / duration : 0 };
    })
    .filter((s) => s.duration >= 8);
}

/** Moving time per pace bin (runs: seconds per unit, 15 s bins) or speed bin (rides: unit/h, 2-wide bins). */
function computePaceHistogram(units: Units, isRide: boolean, speed: Float64Array, t: Float64Array, moving: Uint8Array) {
  const u = unitLength(units);
  const value = (v: number) => (isRide ? (v * 3600) / u : u / v);
  const width = isRide ? 2 : 15;
  const bins = new Map<number, number>();
  for (let i = 0; i < speed.length - 1; i++) {
    if (!moving[i] || speed[i] <= 0.3) continue;
    const b = Math.floor(value(speed[i]) / width);
    bins.set(b, (bins.get(b) ?? 0) + Math.min(t[i + 1] - t[i], MAX_DT));
  }
  const total = [...bins.values()].reduce((a, b) => a + b, 0);
  // Drop sparse tails (<1% of time) so a few GPS outliers don't stretch the axis.
  const keys = [...bins.keys()].filter((k) => (bins.get(k) ?? 0) / total >= 0.01).sort((a, b) => a - b);
  if (!keys.length) return [];
  const out = [];
  for (let k = keys[0]; k <= keys[keys.length - 1]; k++) out.push({ from: k * width, to: (k + 1) * width, seconds: bins.get(k) ?? 0 });
  return out;
}
