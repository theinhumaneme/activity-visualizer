import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze, defaultSettings } from "../analysis/analyze";
import { computePrivacy } from "../analysis/privacy";
import { haversine } from "../geo/geo";
import { parseActivityFile } from "../parse";
import { buckets, inPeriod, localHour, periodOptions, recap, rollingMean, weekStart } from "./aggregate";
import { focusBounds, heatmapData } from "./heatmap";
import { trackVisibility } from "./privacy";
import { personalRecords, recordsByActivity } from "./records";
import { buildRecord, isDuplicate } from "./record";
import { distanceAt, standings, timeAtProgress, trail } from "./race";
import { groupRoutes, hausdorff, routeShape, sameRoute } from "./similarity";
import { douglasPeucker, simplifyTrack, type TrackInput } from "./simplify";
import type { EffortRecord, LibraryRecord, Track } from "./types";

// --- Synthetic activities ------------------------------------------------------

const HOME: [number, number] = [-71.12, 42.33]; // lon, lat
const M_LAT = 110540;
const M_LON = 111320 * Math.cos((HOME[1] * Math.PI) / 180);
const at = (east: number, north: number, origin = HOME): [number, number] => [origin[0] + east / M_LON, origin[1] + north / M_LAT];

/** Circle of radius r starting and ending at `origin` (the bottom of the circle). */
function loopPath(r: number, n = 400, dir = 1, origin = HOME): [number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = -Math.PI / 2 + dir * ((2 * Math.PI * i) / n);
    return at(r * Math.cos(a), r * Math.sin(a) + r, origin);
  });
}

/** Square loop of side s starting at `origin`, counterclockwise. */
function squarePath(s: number, perSide = 100): [number, number][] {
  const corners = [
    [0, 0],
    [s, 0],
    [s, s],
    [0, s],
    [0, 0],
  ];
  const out: [number, number][] = [];
  for (let c = 0; c < 4; c++)
    for (let k = 0; k < perSide; k++) {
      const u = k / perSide;
      out.push(at(corners[c][0] + u * (corners[c + 1][0] - corners[c][0]), corners[c][1] + u * (corners[c + 1][1] - corners[c][1])));
    }
  out.push(at(0, 0));
  return out;
}

/** Walks a path at constant speed, 1 s per sample, optionally standing still for `stop` seconds at `stopAt` meters. */
function walk(path: [number, number][], speed: number, jitter = 0, stop?: { at: number; seconds: number }, seed = 1): TrackInput[] {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + haversine(path[i - 1][1], path[i - 1][0], path[i][1], path[i][0]));
  const total = cum[cum.length - 1];
  const out: TrackInput[] = [];
  let d = 0;
  let moving = 0;
  let stopped = 0;
  let j = 0;
  while (d <= total) {
    while (j < cum.length - 2 && cum[j + 1] < d) j++;
    const u = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
    const lon = path[j][0] + u * (path[j + 1][0] - path[j][0]) + (jitter * rand()) / M_LON;
    const lat = path[j][1] + u * (path[j + 1][1] - path[j][1]) + (jitter * rand()) / M_LAT;
    out.push({ lon, lat, dist: d, moving });
    if (stop && d >= stop.at && stopped < stop.seconds) {
      stopped++;
      continue;
    }
    d += speed;
    moving += 1;
  }
  const last = path[path.length - 1];
  out.push({ lon: last[0], lat: last[1], dist: total, moving: moving - 1 + (total - (d - speed)) / speed });
  return out;
}

let nextId = 0;
function record(over: Partial<LibraryRecord> & { input?: TrackInput[] } = {}): LibraryRecord {
  const { input, ...rest } = over;
  const track: Track | null = input ? simplifyTrack(input) : null;
  const distance = input ? input[input.length - 1].dist : 5000;
  const moving = input ? input[input.length - 1].moving : 1500;
  return {
    id: `r${++nextId}`,
    fileName: "x.tcx",
    activityIndex: 0,
    name: "Morning Run",
    sport: "Running",
    kind: "run",
    startTime: Date.UTC(2026, 3, 1, 10),
    utcOffsetMin: -240,
    distance,
    elapsed: moving,
    moving,
    avgSpeed: distance / moving,
    elevSource: "none",
    bestEfforts: [],
    track,
    ...rest,
  };
}

const effort = (distance: number, seconds: number): EffortRecord => ({ distance, label: `${distance} m`, seconds });

// --- Simplification ----------------------------------------------------------------

describe("simplifyTrack", () => {
  it("keeps a long recording under the point budget, with both ends and accurate shape", () => {
    const input = walk(loopPath(800, 2000), 3, 2); // ~5 km, ~1700 samples with GPS noise
    const t = simplifyTrack(input, 600);
    expect(t.lon.length).toBeLessThanOrEqual(600);
    expect(t.lon.length).toBeGreaterThan(20);
    expect(t.lon[0]).toBe(input[0].lon);
    expect(t.lat[t.lat.length - 1]).toBe(input[input.length - 1].lat);
    // Every original point stays within ~15 m of the simplified line's vertices' circle.
    for (let i = 0; i < input.length; i += 37) {
      let best = Infinity;
      for (let k = 0; k < t.lon.length; k++) best = Math.min(best, haversine(input[i].lat, input[i].lon, t.lat[k], t.lon[k]));
      expect(best).toBeLessThan(40);
    }
    for (let k = 1; k < t.moving.length; k++) expect(t.moving[k]).toBeGreaterThanOrEqual(t.moving[k - 1]);
  });

  it("reduces a straight constant-speed line to its two ends", () => {
    const input = walk([at(0, 0), at(2000, 0)], 3);
    expect(simplifyTrack(input).lon.length).toBe(2);
  });

  it("keeps a vertex where the speed changes on a straight line (timing matters for the race)", () => {
    const fast = walk([at(0, 0), at(1000, 0)], 4);
    const slow = walk([at(1000, 0), at(2000, 0)], 2).map((p) => ({ ...p, dist: p.dist + 1000, moving: p.moving + fast[fast.length - 1].moving }));
    const t = simplifyTrack([...fast, ...slow.slice(1)]);
    expect(t.lon.length).toBeGreaterThan(2);
    expect(distanceAt(t, 250)).toBeCloseTo(1000, -1);
  });

  it("douglasPeucker keeps the corner of an L", () => {
    expect(douglasPeucker([0, 5, 10, 10, 10], [0, 0, 0, 5, 10], null, 1)).toEqual([0, 2, 4]);
  });
});

// --- Route similarity and grouping -----------------------------------------------------------

describe("same-route detection", () => {
  const a = routeShape(record({ input: walk(loopPath(500), 3, 4, undefined, 1) }))!;
  it("matches two noisy runs of the same loop", () => {
    const b = routeShape(record({ input: walk(loopPath(500, 300), 2.5, 4, undefined, 7) }))!;
    expect(hausdorff(a.points, b.points)).toBeLessThan(40);
    expect(sameRoute(a, b)).toBe(true);
  });
  it("rejects the same loop run the other way round", () => {
    const rev = routeShape(record({ input: walk(loopPath(500, 400, -1), 3) }))!;
    expect(hausdorff(a.points, rev.points)).toBeLessThan(40); // same shape…
    expect(sameRoute(a, rev)).toBe(false); // …but a different race
  });
  it("rejects a start more than 150 m away", () => {
    const moved = routeShape(record({ input: walk(loopPath(500, 400, 1, at(0, -200)), 3) }))!;
    expect(sameRoute(a, moved)).toBe(false);
  });
  it("rejects a route more than 10% longer", () => {
    const bigger = routeShape(record({ input: walk(loopPath(570), 3) }))!;
    expect(sameRoute(a, bigger)).toBe(false);
  });
  it("rejects a different shape of similar length from the same door", () => {
    // Square with the circle's perimeter (2π·500 ≈ 3142 m → side 785 m).
    const square = routeShape(record({ input: walk(squarePath(785), 3) }))!;
    expect(Math.abs(square.length - a.length) / a.length).toBeLessThan(0.1);
    expect(sameRoute(a, square)).toBe(false);
  });
  it("rejects a run of a different sport", () => {
    const ride = routeShape(record({ kind: "ride", input: walk(loopPath(500), 6) }))!;
    expect(sameRoute(a, ride)).toBe(false);
  });
});

describe("groupRoutes", () => {
  it("groups repeats, names them, and drops one-offs", () => {
    const day = (d: number) => Date.UTC(2026, 3, d, 10);
    const lake = [1, 2, 3].map((d) => record({ name: "Reservoir loop", startTime: day(d), input: walk(loopPath(500), 3, 4, undefined, d) }));
    const river = [4, 5].map((d) => record({ startTime: day(d), input: walk([at(0, 0), at(3000, 0), at(3000, 1500)], 3, 3, undefined, d) }));
    const once = record({ startTime: day(6), input: walk(loopPath(1200), 3) });
    const groups = groupRoutes([...river, once, ...lake]);
    expect(groups).toHaveLength(2);
    expect(groups[0].members).toEqual(lake.map((r) => r.id));
    expect(groups[0].label).toBe("Reservoir loop");
    expect(groups[0].loop).toBe(true);
    expect(groups[1].members).toEqual(river.map((r) => r.id));
    expect(groups[1].label).toBe("4.5 km route"); // "Morning Run" is too generic to name a route
    expect(groups[1].loop).toBe(false);
  });
});

// --- Records -------------------------------------------------------------------------------

describe("personalRecords", () => {
  it("returns the fastest effort per distance and sport, earlier run on ties", () => {
    const a = record({ startTime: 1, bestEfforts: [effort(1000, 300), effort(5000, 1600)] });
    const b = record({ startTime: 2, bestEfforts: [effort(1000, 290), effort(5000, 1600)] });
    const c = record({ startTime: 3, bestEfforts: [effort(1000, 280), effort(10000, 3400)], kind: "walk" });
    const prs = personalRecords([b, c, a]);
    const run1k = prs.find((p) => p.kind === "run" && p.distance === 1000)!;
    expect(run1k).toMatchObject({ activityId: b.id, seconds: 290 });
    expect(prs.find((p) => p.kind === "run" && p.distance === 5000)!.activityId).toBe(a.id);
    expect(prs.find((p) => p.kind === "walk" && p.distance === 1000)!.seconds).toBe(280);
    expect(prs.some((p) => p.kind === "run" && p.distance === 10000)).toBe(false);
    expect(recordsByActivity(prs).get(b.id)!.map((p) => p.distance)).toEqual([1000]);
  });
});

// --- Aggregation -----------------------------------------------------------------------------

describe("weekly and monthly totals", () => {
  it("buckets by Monday-start local weeks, with empty weeks in between", () => {
    // 2026-04-05 is a Sunday. 23:30 local (UTC−4) is already Monday in UTC: it must count as Sunday.
    const sunLate = record({ startTime: Date.UTC(2026, 3, 6, 3, 30), utcOffsetMin: -240, distance: 5000 });
    const mon = record({ startTime: Date.UTC(2026, 3, 6, 14), utcOffsetMin: -240, distance: 8000 });
    const later = record({ startTime: Date.UTC(2026, 3, 22, 14), utcOffsetMin: -240, distance: 3000 });
    const weeks = buckets([mon, later, sunLate], "week");
    expect(weeks.map((w) => new Date(w.start * 86_400_000).toISOString().slice(0, 10))).toEqual(["2026-03-30", "2026-04-06", "2026-04-13", "2026-04-20"]);
    expect(weeks.map((w) => w.distance)).toEqual([5000, 8000, 0, 3000]);
    expect(weeks[1]).toMatchObject({ count: 1, longest: 8000, longestId: mon.id });
    const months = buckets([mon, later, sunLate], "month");
    expect(months).toHaveLength(1);
    expect(months[0].distance).toBe(16000);
  });

  it("weekStart lands on Mondays", () => {
    for (let d = 20000; d < 20014; d++) expect(new Date(weekStart(d) * 86_400_000).getUTCDay()).toBe(1);
  });

  it("rollingMean trails and skips gaps", () => {
    expect(rollingMean([1, 2, 3, NaN, 5], 3)).toEqual([1, 1.5, 2, 2.5, 4]);
  });

  it("filters by period", () => {
    const now = Date.UTC(2026, 9, 14);
    const old = record({ startTime: Date.UTC(2024, 5, 1) });
    const recent = record({ startTime: Date.UTC(2026, 1, 1) });
    expect(periodOptions([old, recent], now).map((p) => p.value)).toEqual(["all", "12m", "2026", "2024"]);
    expect(inPeriod(old, "12m", now)).toBe(false);
    expect(inPeriod(recent, "12m", now)).toBe(true);
    expect(inPeriod(old, "2024", now)).toBe(true);
  });
});

describe("recap", () => {
  it("adds up totals and reads the time of day in each activity's local time", () => {
    const morning = record({ startTime: Date.UTC(2026, 3, 1, 11), utcOffsetMin: -240, distance: 5200, moving: 1600, elevGain: 40, elevSource: "file-unverified", bestEfforts: [effort(5000, 1500)] });
    const tokyo = record({ startTime: Date.UTC(2026, 3, 2, 22), utcOffsetMin: 540, distance: 10500, moving: 3300, bestEfforts: [effort(5000, 1550), effort(10000, 3200)] });
    expect(localHour(morning)).toBe(7);
    expect(localHour(tokyo)).toBe(7);
    const r = recap([morning, tokyo], []);
    expect(r.count).toBe(2);
    expect(r.distance).toBe(15700);
    expect(r.moving).toBe(4900);
    expect(r.elevation).toEqual({ gain: 40, withData: 1 });
    expect(r.longest!.id).toBe(tokyo.id);
    expect(r.fastest5k!.activityId).toBe(morning.id);
    expect(r.fastest10k!.seconds).toBe(3200);
    expect(r.peakHour).toBe(7);
    expect(r.activeDays).toBe(2);
  });

  it("leaves out what the data can't support", () => {
    const short = record({ distance: 3000, bestEfforts: [effort(1000, 300)] });
    const r = recap([short], []);
    expect(r.fastest5k).toBeNull();
    expect(r.elevation).toBeNull();
    expect(r.mostRun).toBeNull();
  });
});

// --- Heatmap & privacy -------------------------------------------------------------------------------

describe("heatmapData", () => {
  const radius = 200;
  const runs = [1, 2].map((d) => record({ startTime: Date.UTC(2026, 3, d, 10), input: walk(loopPath(600), 3, 2, undefined, d) }));
  const out = walk([at(0, 0), at(4000, 0)], 3); // out-and-away: start and finish far apart
  const away = record({ startTime: Date.UTC(2026, 3, 5, 10), input: out });
  const data = heatmapData([...runs, away], radius, { step: 15 });

  it("draws nothing within the privacy radius of any run's start or finish", () => {
    const homes = [...runs, away].flatMap((r) => {
      const t = r.track!;
      return [
        [t.lon[0], t.lat[0]],
        [t.lon[t.lon.length - 1], t.lat[t.lat.length - 1]],
      ];
    });
    const coords = [...data.points.features.map((f) => f.geometry.coordinates), ...data.lines.features.flatMap((f) => f.geometry.coordinates)];
    expect(coords.length).toBeGreaterThan(100);
    for (const [lon, lat] of coords) for (const [hlon, hlat] of homes) expect(haversine(hlat, hlon, lat, lon)).toBeGreaterThanOrEqual(radius - 0.01);
  });

  it("densifies at the requested spacing and tags each point with its day", () => {
    const aways = data.points.features.filter((f) => f.properties.day === Math.floor((Date.UTC(2026, 3, 5, 10) - 240 * 60000) / 86_400_000));
    // 4 km minus 200 m at each end, every 15 m.
    expect(aways.length).toBeGreaterThan(235);
    expect(aways.length).toBeLessThan(250);
    expect(data.days![1] - data.days![0]).toBe(4);
  });

  it("caps the point count for huge libraries by spacing points further apart", () => {
    const capped = heatmapData([...runs, away], radius, { maxPoints: 200 });
    expect(capped.step).toBeGreaterThan(15);
    expect(capped.points.features.length).toBeLessThanOrEqual(200);
  });

  it("frames the cluster where most runs are", () => {
    const far = record({ input: walk(loopPath(600, 400, 1, [2.35, 48.85]), 3) }); // Paris
    const d = heatmapData([...runs, away, far], radius);
    const f = focusBounds(d.lines)!;
    expect(f.elsewhere).toBe(1);
    expect(f.bounds[0]).toBeLessThan(-71);
    expect(f.bounds[2]).toBeLessThan(-70);
  });
});

// --- Race -----------------------------------------------------------------------------------------------

describe("ghost race", () => {
  const path = loopPath(500);
  const quick = { id: "quick", track: simplifyTrack(walk(path, 3.5)) };
  // Slower, and stands still for 60 s at 1 km: the stop doesn't count against moving time.
  const steady = { id: "steady", track: simplifyTrack(walk(path, 3, 0, { at: 1000, seconds: 60 })) };

  it("ranks by progress, then by finish time", () => {
    const mid = standings([steady, quick], 400);
    expect(mid.map((s) => s.id)).toEqual(["quick", "steady"]);
    expect(mid[0].gap).toBe(0);
    // At 400 s steady has covered 1200 m; quick passed there at ~343 s → ~57 s behind.
    expect(mid[1].distance).toBeCloseTo(1200, -1);
    expect(mid[1].gap).toBeGreaterThan(50);
    expect(mid[1].gap).toBeLessThan(64);
    const end = standings([steady, quick], 5000);
    expect(end.every((s) => s.done)).toBe(true);
    const len = steady.track.dist[steady.track.dist.length - 1];
    expect(end[1].gap).toBeCloseTo(len / 3 - len / 3.5, -1);
  });

  it("uses moving time, so a stop leaves no dent", () => {
    expect(distanceAt(steady.track, 600)).toBeCloseTo(1800, -1);
    expect(timeAtProgress(quick.track, 0.5)).toBeCloseTo(steady.track.dist[steady.track.dist.length - 1] / 2 / 3.5, -1);
  });

  it("builds a fading trail that ends at the runner", () => {
    const pieces = trail(quick.track, 300, 60, 4);
    expect(pieces).toHaveLength(4);
    const head = pieces[3][pieces[3].length - 1];
    const now = standings([quick], 300)[0].at;
    expect(haversine(head[1], head[0], now[1], now[0])).toBeLessThan(1);
    expect(trail(quick.track, 0, 60)).toEqual([]);
  });
});

// --- Real files --------------------------------------------------------------------------------------------

function fromFile(path: string, id: string) {
  const activity = parseActivityFile(readFileSync(path, "utf8"), path)[0];
  const a = analyze(activity, defaultSettings(activity, "metric", 0), null);
  return { activity, a, rec: buildRecord(activity, a, { id, fileName: path, activityIndex: 0 }) };
}

describe("records from the sample file", () => {
  const { a, rec } = fromFile("public/samples/reservoir-loop.tcx", "sample");

  it("keeps summary numbers and a small track", () => {
    expect(rec.distance).toBeCloseTo(a.summary.distance, 6);
    expect(rec.moving).toBe(a.summary.moving);
    expect(rec.track!.lon.length).toBeLessThanOrEqual(600);
    expect(rec.track!.dist[rec.track!.dist.length - 1]).toBeCloseTo(a.summary.distance, 0);
    expect(rec.bestEfforts.length).toBe(a.bestEfforts.length);
    expect(rec.avgCadence).toBeGreaterThan(100); // the sample has run cadence
  });

  it("hides the same points as computePrivacy", () => {
    const full = computePrivacy(a.samples, 200);
    const vis = trackVisibility(rec.track!, 200);
    // Kept vertices are original samples; map each back by position.
    let k = 0;
    for (let i = 0; i < a.samples.length && k < vis.length; i++) {
      if (a.samples[i].lon === rec.track!.lon[k] && a.samples[i].lat === rec.track!.lat[k]) {
        expect(vis[k]).toBe(full.visible[i]);
        k++;
      }
    }
    expect(k).toBe(vis.length);
  });

  it("spots the same run imported twice", () => {
    const again = { ...rec, id: "again" };
    expect(isDuplicate(rec, again)).toBe(true);
    expect(isDuplicate(rec, { ...again, startTime: rec.startTime + 3_600_000 })).toBe(false);
  });

  it("recognizes a repeat of the same route", () => {
    const repeat = { ...rec, id: "repeat", startTime: rec.startTime + 7 * 86_400_000 };
    expect(groupRoutes([rec, repeat])[0].members).toEqual(["sample", "repeat"]);
  });
});

const PRIVATE_TCX = "tests/fixtures/private/Lunch_Run.tcx";
describe.skipIf(!existsSync(PRIVATE_TCX))("records from the private Google Health run", () => {
  it("summarizes it without the full sample stream", () => {
    const { rec } = fromFile(PRIVATE_TCX, "lunch");
    expect(rec.distance).toBeCloseTo(2381.76, 0);
    expect(rec.avgHr).toBeGreaterThan(155);
    expect(rec.track!.lon.length).toBeLessThanOrEqual(600);
    expect(rec.calories).toBe(264);
    expect(rec.avgCadence).toBeUndefined();
  });
});

describe("recap across sports", () => {
  it("only picks a fastest 5K for foot sports, and none for a mix", () => {
    const ride = record({ kind: "ride", distance: 30000, bestEfforts: [effort(5000, 500), effort(10000, 1000)] });
    const run = record({ kind: "run", distance: 6000, bestEfforts: [effort(5000, 1500)] });
    expect(recap([ride], [], "ride").fastest5k).toBeNull();
    expect(recap([run], [], "run").fastest5k!.seconds).toBe(1500);
    const mixed = recap([ride, run], [], null);
    expect(mixed.fastest5k).toBeNull();
    expect(mixed.distance).toBe(36000);
  });
});
