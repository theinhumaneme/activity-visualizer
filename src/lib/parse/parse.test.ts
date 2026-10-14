import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { haversine } from "../geo/geo";
import { parseActivityFile } from "./index";

const PRIVATE_TCX = "tests/fixtures/private/Lunch_Run.tcx";
const PRIVATE_GPX = "tests/fixtures/private/Lunch_Run.gpx";
const SAMPLE = "public/samples/reservoir-loop.tcx";
const hasPrivate = existsSync(PRIVATE_TCX) && existsSync(PRIVATE_GPX);

describe.skipIf(!hasPrivate)("Google Health TCX (private fixture)", () => {
  const [a] = hasPrivate ? parseActivityFile(readFileSync(PRIVATE_TCX, "utf8"), "Lunch_Run.tcx") : [];

  it("reads every trackpoint", () => {
    expect(a.samples).toHaveLength(1150);
    expect(a.droppedPoints).toBe(0);
    expect(a.kind).toBe("run");
    expect(a.device).toBe("Fitbit Air");
  });

  it("uses file distance and elapsed time", () => {
    expect(a.hasFileDistance).toBe(true);
    expect(a.samples.at(-1)!.dist).toBeCloseTo(2381.76, 1);
    expect(a.samples.at(-1)!.t).toBe(1184);
    expect(a.fileTotals).toEqual({ distance: 2370.219, time: 1100, calories: 264 });
  });

  it("reads heart rate", () => {
    const hr = a.samples.map((s) => s.hr!);
    expect(Math.min(...hr)).toBe(105);
    expect(Math.max(...hr)).toBe(185);
  });

  it("agrees with Strava's GPX export of the same run", () => {
    const [g] = parseActivityFile(readFileSync(PRIVATE_GPX, "utf8"), "Lunch_Run.gpx");
    expect(g.samples).toHaveLength(a.samples.length);
    let worst = 0;
    for (let i = 0; i < a.samples.length; i++) {
      const p = a.samples[i];
      const q = g.samples[i];
      expect(q.time).toBe(p.time);
      expect(q.hr).toBe(p.hr);
      worst = Math.max(worst, haversine(p.lat, p.lon, q.lat, q.lon));
    }
    expect(worst).toBeLessThan(1);
  });
});

describe("sample run", () => {
  const [a] = parseActivityFile(readFileSync(SAMPLE, "utf8"), "reservoir-loop.tcx");
  it("parses with namespaced cadence extension", () => {
    expect(a.samples.length).toBe(1150);
    const cad = a.samples.map((s) => s.cad ?? 0).filter((c) => c > 0);
    expect(cad.length).toBeGreaterThan(900);
    expect(cad[10]).toBeGreaterThan(150); // RunCadence is per foot; we store steps/min
  });
});

describe("bad input", () => {
  it("rejects non-activity files", () => {
    expect(() => parseActivityFile("hello", "notes.txt")).toThrow(/Unsupported/);
    expect(() => parseActivityFile("<TrainingCenterDatabase></TrainingCenterDatabase>", "x.tcx")).toThrow(/no activities/);
  });
  it("explains indoor activities", () => {
    const xml = `<TrainingCenterDatabase><Activities><Activity Sport="Running"><Lap StartTime="2026-01-01T00:00:00Z"><Track>
      <Trackpoint><Time>2026-01-01T00:00:00Z</Time><HeartRateBpm><Value>100</Value></HeartRateBpm></Trackpoint>
      <Trackpoint><Time>2026-01-01T00:00:01Z</Time><HeartRateBpm><Value>101</Value></HeartRateBpm></Trackpoint>
    </Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
    expect(() => parseActivityFile(xml, "x.tcx")).toThrow(/treadmill/);
  });
});
