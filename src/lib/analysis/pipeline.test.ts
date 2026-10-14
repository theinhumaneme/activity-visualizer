import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { haversine } from "../geo/geo";
import { parseActivityFile } from "../parse";
import type { Sample } from "../parse/types";
import { analyze, defaultSettings } from "./analyze";
import { cleanHeartRate, pinDrift, removeTeleports } from "./clean";
import { computePrivacy } from "./privacy";

const iso = (s: number) => new Date(Date.UTC(2026, 0, 1, 7, 0, s)).toISOString();

describe("parsing edge cases", () => {
  it("interpolates TCX trackpoints that have heart rate but no position", () => {
    const tp = (s: number, pos: boolean) => `<Trackpoint><Time>${iso(s)}</Time>${
      pos ? `<Position><LatitudeDegrees>${42 + s * 0.00002}</LatitudeDegrees><LongitudeDegrees>-71</LongitudeDegrees></Position>` : ""
    }<HeartRateBpm><Value>${120 + s}</Value></HeartRateBpm><Extensions><ns3:TPX xmlns:ns3="x"><ns3:RunCadence>85</ns3:RunCadence></ns3:TPX></Extensions></Trackpoint>`;
    const pts = [tp(0, false), tp(1, true), tp(2, false), tp(3, false), tp(4, true), tp(5, false)].join("");
    const xml = `<TrainingCenterDatabase><Activities><Activity Sport="Running"><Lap StartTime="${iso(0)}"><Track>${pts}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
    const [a] = parseActivityFile(xml, "x.tcx");
    expect(a.samples.map((s) => s.pos)).toEqual(["none", "gps", "interp", "interp", "gps", "none"]);
    expect(a.samples[2].lat).toBeCloseTo(42 + 0.00002 * 2, 7);
    expect(a.samples[0].hr).toBe(120);
    // Namespaced per-leg RunCadence is doubled to steps/min.
    expect(a.cadenceDoubled).toBe(true);
    expect(a.samples[1].cad).toBe(170);
    expect(a.interpolatedPoints).toBe(4);
    expect(a.utcOffsetMin).toBeUndefined(); // "Z": UTC, local zone unknown
  });

  it("keeps GPX segments and reads Garmin extensions by local name", () => {
    const pt = (s: number, lat: number) =>
      `<trkpt lat="${lat}" lon="-71"><ele>10</ele><time>${iso(s)}</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>140</gpxtpx:hr><gpxtpx:cad>88</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>`;
    const xml = `<gpx creator="Garmin"><trk><type>running</type><trkseg>${pt(0, 42)}${pt(1, 42.00003)}</trkseg><trkseg>${pt(60, 42.002)}${pt(61, 42.00203)}</trkseg></trk></gpx>`;
    const [a] = parseActivityFile(xml, "x.gpx");
    expect(a.samples.map((s) => s.seg)).toEqual([0, 0, 1, 1]);
    expect(a.samples[0].hr).toBe(140);
    expect(a.samples[0].cad).toBe(176);
    expect(a.routeOnly).toBe(false);
  });

  it("animates untimed routes by distance and says so", () => {
    const xml = `<gpx><rte><name>Planned</name>${[0, 1, 2, 3].map((k) => `<rtept lat="${42 + k * 0.001}" lon="-71"/>`).join("")}</rte></gpx>`;
    const [a] = parseActivityFile(xml, "x.gpx");
    expect(a.routeOnly).toBe(true);
    expect(a.samples.at(-1)!.t).toBeGreaterThan(100);
    const an = analyze(a, defaultSettings(a, "metric"), null);
    expect(an.quality.some((q) => q.title.startsWith("Route only"))).toBe(true);
  });
});

const line = (n: number, step = 3): Sample[] =>
  Array.from({ length: n }, (_, i) => ({ t: i, time: i * 1000, lat: 42 + (i * step) / 111000, lon: -71, dist: i * step, seg: 0, pos: "gps" as const }));

describe("cleaning", () => {
  it("moves teleport spikes back onto the track", () => {
    const s = line(60);
    s[30] = { ...s[30], lon: -71.01 }; // ~800 m sideways for one second
    expect(removeTeleports(s, "run")).toBe(1);
    expect(haversine(s[29].lat, s[29].lon, s[30].lat, s[30].lon)).toBeLessThan(10);
  });

  it("pins GPS drift before the start", () => {
    const s = line(80);
    for (let i = 0; i < 20; i++) s[i] = { ...s[i], lat: 42 + Math.sin(i) * 0.00005, lon: -71 + Math.cos(i) * 0.00005 };
    for (let i = 20; i < 80; i++) s[i] = { ...s[i], lat: 42 + ((i - 20) * 3) / 111000 };
    const { start } = pinDrift(s);
    expect(start).toBeGreaterThan(10);
    expect(new Set(s.slice(0, start).map((p) => p.lat)).size).toBe(1);
  });

  it("blanks heart-rate dropouts and spikes", () => {
    const s = line(10).map((p, i) => ({ ...p, hr: [140, 141, 0, 142, 190, 143, 144, 145, 146, 147][i] }));
    const { hr, dropouts, spikes } = cleanHeartRate(s);
    expect(dropouts).toBe(1);
    expect(spikes).toBe(1);
    expect(hr[2]).toBeGreaterThan(140); // bridged
    expect(hr[4]).toBeLessThan(150);
  });

  it("hides the start and finish inside the privacy radius", () => {
    const s = line(400); // 1.2 km straight line
    const p = computePrivacy(s, 200);
    expect(haversine(s[0].lat, s[0].lon, s[p.from].lat, s[p.from].lon)).toBeGreaterThanOrEqual(200);
    expect(haversine(s.at(-1)!.lat, s.at(-1)!.lon, s[p.to].lat, s[p.to].lon)).toBeGreaterThanOrEqual(200);
    expect(p.visible[0]).toBe(0);
    expect(computePrivacy(line(20), 500).empty).toBe(true);
  });
});

const PRIVATE_TCX = "tests/fixtures/private/Lunch_Run.tcx";
describe.skipIf(!existsSync(PRIVATE_TCX))("intervals in the Google Health run", () => {
  it("finds the 2-min run / 1-min walk reps", () => {
    const act = parseActivityFile(readFileSync(PRIVATE_TCX, "utf8"), "Lunch_Run.tcx")[0];
    const a = analyze(act, defaultSettings(act, "metric"), null);
    expect(a.intervals?.reps.length).toBe(6);
    const mid = a.intervals!.reps.slice(1, 5);
    for (const r of mid) {
      expect(r.duration).toBeGreaterThan(110);
      expect(r.duration).toBeLessThan(135);
    }
    expect(a.intervals!.paceCv).toBeLessThan(0.05);
    expect(a.moments.filter((m) => m.hero)).toHaveLength(1);
  });
});

describe("interval detection", () => {
  it("doesn't mistake stop-and-go traffic for a workout", () => {
    // A ride through town: fast/slow blocks of random length (seeded, so the test is stable).
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const samples: Sample[] = [];
    let d = 0;
    let t = 0;
    while (t < 3600) {
      const fast = samples.length === 0 || rnd() > 0.4;
      const len = fast ? 30 + rnd() * 300 : 20 + rnd() * 90;
      const v = fast ? 7 + rnd() * 2 : 1 + rnd();
      for (let k = 0; k < len; k++, t++) {
        d += v;
        samples.push({ t, time: t * 1000, lat: 42 + d / 111000, lon: -71, dist: d, seg: 0, pos: "gps" });
      }
    }
    const act = {
      name: "Evening Ride", sport: "Biking", kind: "ride" as const, startTime: 0, source: "gpx" as const,
      laps: [{ startIndex: 0, endIndex: samples.length - 1, startTime: 0 }], samples, fileTotals: {},
      droppedPoints: 0, interpolatedPoints: 0, hasFileDistance: true, cadenceDoubled: false, routeOnly: false,
    };
    const a = analyze(act, defaultSettings(act, "metric"), null);
    expect(a.intervals).toBeNull();
  });
});
