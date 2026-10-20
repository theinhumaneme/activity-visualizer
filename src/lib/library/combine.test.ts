import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze, defaultSettings } from "../analysis/analyze";
import { haversine } from "../geo/geo";
import { partAt, partStarts } from "../analysis/bridges";
import { liveItems } from "../hud/hud";
import { drawable } from "../map/route";
import { parseActivityFile } from "../parse";
import type { Activity } from "../parse/types";
import { buildTimeline } from "../playback/timeline";
import { combineActivities, combinedKind, combinedName, countText, dateSpan } from "./combine";

const M_LAT = 110540;
const mLon = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

/** A GPX loop of radius r around (lon, lat), one point a second at `speed`, starting at `start`. */
function loopGpx(name: string, type: string, lon: number, lat: number, start: number, opts: { r?: number; speed?: number; segments?: number } = {}): string {
  const r = opts.r ?? 600;
  const speed = opts.speed ?? 6;
  const n = Math.round((2 * Math.PI * r) / speed);
  const per = Math.ceil(n / (opts.segments ?? 1));
  const pts: string[] = [];
  for (let i = 0; i <= n; i++) {
    if (i > 0 && i < n && i % per === 0) pts.push("</trkseg><trkseg>");
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const y = lat + (r * Math.sin(a) + r) / M_LAT;
    const x = lon + (r * Math.cos(a)) / mLon(lat);
    pts.push(
      `<trkpt lat="${y.toFixed(7)}" lon="${x.toFixed(7)}"><ele>${(20 + 5 * Math.sin(a)).toFixed(1)}</ele><time>${new Date(start + i * 1000).toISOString()}</time></trkpt>`,
    );
  }
  return `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><type>${type}</type><trkseg>${pts.join("")}</trkseg></trk></gpx>`;
}

const parse = (gpx: string, file: string) => parseActivityFile(gpx, file)[0];
const DAY = Date.UTC(2026, 9, 20);
// Two rides 8 km apart: one at 7:00 UTC, the other at 15:00 UTC, given out of order.
const morning = parse(loopGpx("Morning Ride", "cycling", -71.11, 42.32, DAY + 7 * 3600_000), "Morning_Ride.gpx");
const afternoon = parse(loopGpx("Afternoon Ride", "cycling", -71.02, 42.36, DAY + 15 * 3600_000, { r: 900, segments: 2 }), "Afternoon_Ride.gpx");
const day = combineActivities([afternoon, morning]);
const k = day.parts![1].startIndex;

describe("combining activities", () => {
  it("puts the activities in start-time order", () => {
    expect(day.parts!.map((p) => p.name)).toEqual(["Morning Ride", "Afternoon Ride"]);
    expect(day.startTime).toBe(morning.samples[0].time);
    expect(day.samples.length).toBe(morning.samples.length + afternoon.samples.length);
    expect(k).toBe(morning.samples.length);
    for (let i = 1; i < day.samples.length; i++) {
      expect(day.samples[i].time).toBeGreaterThan(day.samples[i - 1].time);
      expect(day.samples[i].t).toBeGreaterThan(day.samples[i - 1].t);
    }
    expect(day.samples[k].t).toBeCloseTo(8 * 3600, 0);
  });

  it("carries distance on from the last finish, never across the gap", () => {
    const d1 = morning.samples[morning.samples.length - 1].dist;
    const d2 = afternoon.samples[afternoon.samples.length - 1].dist;
    expect(day.samples[k].dist).toBeCloseTo(d1, 6);
    expect(day.samples[day.samples.length - 1].dist).toBeCloseTo(d1 + d2, 6);
    for (let i = 1; i < day.samples.length; i++) expect(day.samples[i].dist).toBeGreaterThanOrEqual(day.samples[i - 1].dist);
  });

  it("starts a new track segment at each hand-off, keeping each activity's own segments", () => {
    expect(day.samples[k].seg).not.toBe(day.samples[k - 1].seg);
    const segs = new Set(day.samples.map((s) => s.seg));
    expect(segs.size).toBe(1 + 2);
  });

  it("counts the time between activities as a stop, not moving time", () => {
    const settings = (act: Activity) => defaultSettings(act, "metric", 0);
    const a = analyze(day, settings(day), null);
    const m1 = analyze(morning, settings(morning), null).summary;
    const m2 = analyze(afternoon, settings(afternoon), null).summary;
    expect(a.moving[k - 1]).toBe(0);
    expect(a.summary.moving).toBeCloseTo(m1.moving + m2.moving, -1);
    expect(a.summary.distance).toBeCloseTo(m1.distance + m2.distance, 0);
    expect(a.summary.stoppedTime).toBeGreaterThan(7.5 * 3600);
  });

  it("draws no line across the hand-off and bridges it in the flyover", () => {
    const a = analyze(day, defaultSettings(day, "metric", 0), null);
    expect(drawable(a)[k - 1]).toBe(0);
    expect(a.bridges).toEqual([{ from: k - 1, to: k }]);
  });

  it("hides every start and finish behind a privacy circle, and bridges around them", () => {
    const a = analyze(day, defaultSettings(day, "metric", 200), null);
    const near = (i: number, j: number) => haversine(a.samples[i].lat, a.samples[i].lon, a.samples[j].lat, a.samples[j].lon) < 200;
    for (let i = 0; i < a.n; i++) if (near(i, k - 1) || near(i, k)) expect(a.privacy.visible[i]).toBe(0);
    expect(a.bridges).toHaveLength(1);
    const b = a.bridges[0];
    expect(b.from).toBeLessThan(k - 1);
    expect(b.to).toBeGreaterThan(k);
    expect(a.privacy.visible[b.from]).toBe(1);
    expect(a.privacy.visible[b.to]).toBe(1);
  });

  it("names the day and its activities", () => {
    expect(dateSpan(DAY + 7 * 3600_000, DAY + 15 * 3600_000, 0)).toBe("Oct 20, 2026");
    expect(day.name).toMatch(/^Oct 20, 2026 · 2 rides$/);
    expect(dateSpan(Date.UTC(2026, 9, 18, 12), Date.UTC(2026, 9, 20, 12), 0)).toBe("Oct 18 – 20, 2026");
    expect(dateSpan(Date.UTC(2026, 8, 30, 12), Date.UTC(2026, 9, 2, 12), 0)).toBe("Sep 30 – Oct 2, 2026");
    expect(dateSpan(Date.UTC(2025, 11, 30, 12), Date.UTC(2026, 0, 2, 12), 0)).toBe("Dec 30, 2025 – Jan 2, 2026");
    expect(countText(["run", "ride", "run"])).toBe("2 runs + 1 ride");
    expect(
      combinedName([
        { kind: "run", startTime: Date.UTC(2026, 9, 20, 12), utcOffsetMin: -240 },
        { kind: "ride", startTime: Date.UTC(2026, 9, 20, 18), utcOffsetMin: -240 },
      ]),
    ).toBe("Oct 20, 2026 · 1 run + 1 ride");
  });

  it("keeps one sport, and treats mixed sports as 'other'", () => {
    expect(day.kind).toBe("ride");
    expect(combinedKind(["run", "run"])).toBe("run");
    const run = parse(loopGpx("Lunch Run", "running", -71.05, 42.34, DAY + 11 * 3600_000, { speed: 3 }), "Lunch_Run.gpx");
    const mixed = combineActivities([morning, run]);
    expect(mixed.kind).toBe("other");
    expect(mixed.sport).toBe("Ride + Run");
    expect(mixed.name).toContain("1 ride + 1 run");
  });

  it("refuses activities that overlap in time, or routes without times", () => {
    const again = parse(loopGpx("Same Ride", "cycling", -71.11, 42.32, DAY + 7 * 3600_000 + 300_000), "again.gpx");
    expect(() => combineActivities([morning, again])).toThrow(/overlap/);
    expect(() => combineActivities([morning])).toThrow(/at least two/);
    expect(() => combineActivities([morning, { ...afternoon, routeOnly: true }])).toThrow(/no timestamps/);
  });
});

describe("flying a combined day", () => {
  const a = analyze(day, defaultSettings(day, "metric", 200), null);
  const tl = buildTimeline(a, { followSeconds: 30, width: 540, height: 960, exaggeration: 1.5 });
  const b = a.bridges[0];
  const Ta = tl.timeAtIndex(b.from);
  const Tb = tl.timeAtIndex(b.to);
  const dt = 1 / 30;
  const frames = Array.from({ length: Math.ceil(tl.duration / dt) }, (_, i) => tl.frame(i * dt));

  it("gives the hand-off a short flight, not hours of screen time or none", () => {
    expect(Tb - Ta).toBeGreaterThan(1);
    expect(Tb - Ta).toBeLessThan(4.5);
  });

  it("hides the marker over the flight and flies straight from finish to start", () => {
    const mid = tl.frame((Ta + Tb) / 2);
    expect(mid.fx.marker).toBe(0);
    expect(tl.frame(Ta - 1).fx.marker).toBe(1);
    expect(tl.frame(Tb + 1).fx.marker).toBe(1);
    const p = a.samples[b.from];
    const q = a.samples[b.to];
    const along = haversine(p.lat, p.lon, mid.head[1], mid.head[0]) + haversine(mid.head[1], mid.head[0], q.lat, q.lon);
    expect(along).toBeLessThan(haversine(p.lat, p.lon, q.lat, q.lon) + 1);
  });

  it("climbs for the flight and comes back down", () => {
    const zoomAt = (T: number) => tl.frame(T).camera.zoom;
    expect(zoomAt((Ta + Tb) / 2)).toBeLessThan(zoomAt(Ta - 2) - 1);
    expect(Math.abs(zoomAt(Tb + 3) - zoomAt(Ta - 2))).toBeLessThan(1);
  });

  it("runs the marker, the distance and the clock forward through the day", () => {
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].index).toBeGreaterThanOrEqual(frames[i - 1].index - 1e-9);
      expect(Number.isFinite(frames[i].camera.zoom)).toBe(true);
    }
    // No time-compression readout while the clock skips the break.
    expect(tl.frame((Ta + Tb) / 2).rate).toBe(0);
  });
});

describe("each activity of a combined day", () => {
  const a = analyze(day, defaultSettings(day, "metric", 200), null);
  const tl = buildTimeline(a, { followSeconds: 30, width: 540, height: 960 });
  const b = a.bridges[0];

  it("knows where each activity starts", () => {
    expect(partStarts(a)).toEqual([0, k]);
    expect(partAt([0, k], k - 0.5)).toBe(0);
    expect(partAt([0, k], k)).toBe(1);
  });

  it("gets a title card as it begins: the first as the chase starts, the next over the flight into it", () => {
    expect(tl.frame(tl.marks.chase + 1).part).toEqual({ index: 0, alpha: 1 });
    expect(tl.frame(tl.timeAtIndex(b.to) + 0.5).part).toEqual({ index: 1, alpha: 1 });
    expect(tl.frame(1).part).toBeNull();
    expect(tl.frame(tl.marks.finish).part).toBeNull();
  });

  it("counts live time and distance from its own start, unless the day runs through", () => {
    const at = k + 120;
    const value = (perPart: boolean, label: string) => liveItems(a, at, ["time", "distance"], null, perPart).find((x) => x.label === label)!.value;
    expect(value(true, "DISTANCE")).toBe(((a.dist[at] - a.dist[k]) / 1000).toFixed(2));
    expect(value(false, "DISTANCE")).toBe((a.dist[at] / 1000).toFixed(2));
    expect(Number(value(true, "TIME").split(":").pop())).toBe((a.t[at] - a.t[k]) % 60);
    expect(value(false, "TIME").split(":").length).toBe(3);
  });

  it("shows each sport's own pace or speed in a mixed day", () => {
    const run = parse(loopGpx("Lunch Run", "running", -71.05, 42.34, DAY + 11 * 3600_000, { speed: 3 }), "Lunch_Run.gpx");
    const mixed = combineActivities([run, afternoon]);
    const m = analyze(mixed, defaultSettings(mixed, "metric", 0), null);
    const label = (i: number, perPart: boolean) => liveItems(m, i, ["motion"], null, perPart)[0].label;
    const second = partStarts(m)[1];
    expect(label(100, true)).toBe("PACE");
    expect(label(second + 100, true)).toBe("SPEED");
    expect(label(100, false)).toBe("SPEED");
  });
});

const FIXTURES = "tests/fixtures/private";
const real = ["Morning_Ride.gpx", "Afternoon_Ride.gpx"].map((f) => `${FIXTURES}/${f}`);

describe.skipIf(!real.every((f) => existsSync(f)))("combining the real rides of Oct 20, 2026", () => {
  it("plays them as one, with a bridge between", () => {
    const rides = real.map((f) => parseActivityFile(readFileSync(f, "utf8"), f.split("/").pop()!)[0]);
    const combined = combineActivities(rides);
    const a = analyze(combined, defaultSettings(combined, "metric", 200), null);
    expect(combined.name).toMatch(/· 2 rides$/);
    expect(a.bridges).toHaveLength(1);
    const k2 = combined.parts![1].startIndex;
    expect(drawable(a)[k2 - 1]).toBe(0);
    const tl = buildTimeline(a, { followSeconds: 30, width: 1280, height: 720 });
    const T = (tl.timeAtIndex(a.bridges[0].from) + tl.timeAtIndex(a.bridges[0].to)) / 2;
    expect(tl.frame(T).fx.marker).toBe(0);
  });
});
