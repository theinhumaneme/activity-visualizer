import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseActivityFile } from "../parse";
import { analyze, defaultSettings } from "./analyze";

const PRIVATE_TCX = "tests/fixtures/private/Lunch_Run.tcx";
const load = (path: string) => parseActivityFile(readFileSync(path, "utf8"), path)[0];

describe.skipIf(!existsSync(PRIVATE_TCX))("analysis of the Google Health run", () => {
  const activity = existsSync(PRIVATE_TCX) ? load(PRIVATE_TCX) : null!;
  const settings = { ...defaultSettings(activity, "metric"), maxHr: 190 };
  const a = analyze(activity, settings, null);

  it("summarizes distance and time", () => {
    expect(a.summary.distance).toBeCloseTo(2381.76, 1);
    expect(a.summary.elapsed).toBe(1184);
    // Device reports 1100 s moving; our detector should land close.
    expect(Math.abs(a.summary.moving - 1100)).toBeLessThan(40);
  });

  it("computes km splits matching the raw data", () => {
    expect(a.splits).toHaveLength(3);
    expect(a.splits[0].elapsed).toBeGreaterThan(461);
    expect(a.splits[0].elapsed).toBeLessThan(465); // 7:43
    expect(a.splits[1].elapsed).toBeGreaterThan(455);
    expect(a.splits[1].elapsed).toBeLessThan(459); // 7:37
    expect(a.splits[2].distance).toBeCloseTo(381.76, 1);
  });

  it("puts heart rate into zones that add up to the recording", () => {
    const total = a.zones.reduce((s, z) => s + z.seconds, 0);
    expect(Math.abs(total - 1184)).toBeLessThan(2);
    expect(a.summary.maxHr).toBe(185);
    expect(a.summary.avgHr).toBeGreaterThan(155);
    expect(a.summary.avgHr).toBeLessThan(170);
    expect(a.zones[4].low).toBe(171); // 90% of 190
  });

  it("finds best efforts no slower than whole splits", () => {
    const km = a.bestEfforts.find((b) => b.distance === 1000)!;
    expect(km.seconds).toBeLessThanOrEqual(Math.min(a.splits[0].elapsed, a.splits[1].elapsed) + 0.01);
    expect(a.bestEfforts.map((b) => b.label)).toEqual(["400 m", "800 m", "1 km", "1 mile"]);
  });

  it("finds the run/walk rhythm", () => {
    expect(a.slowdowns.length).toBe(4);
    expect(a.insights.some((i) => i.title === "Run/walk rhythm" && i.value === "4 walk breaks")).toBe(true);
  });

  it("flags the bogus altitude once terrain is known", () => {
    const dem = new Float64Array(activity.samples.length).fill(21);
    const withDem = analyze(activity, settings, dem);
    expect(withDem.elevationSource).toBe("terrain");
    expect(withDem.quality.some((q) => q.title.startsWith("File altitude looks wrong"))).toBe(true);
    expect(analyze(activity, settings, null).elevationSource).toBe("file-unverified");
  });

  it("trims and rebases", () => {
    const tr = analyze(activity, { ...settings, trimStart: 60, trimEnd: 60 }, null);
    expect(tr.t[0]).toBe(0);
    expect(tr.dist[0]).toBe(0);
    expect(tr.summary.elapsed).toBeLessThanOrEqual(1184 - 120);
  });

  it("prints a report", () => {
    console.log(
      JSON.stringify(
        {
          summary: a.summary,
          splits: a.splits.map((s) => [s.elapsed, s.moving, s.pace, s.avgHr]),
          zones: a.zones.map((z) => [z.zone, Math.round(z.seconds)]),
          efforts: a.bestEfforts.map((b) => [b.label, b.seconds]),
          stops: a.stops.map((s) => [s.startIdx, s.duration]),
        },
        null,
        1,
      ),
    );
    console.log(a.headline);
    console.log(a.insights.map((i) => `${i.title} · ${i.value ?? ""} · ${i.text}`).join("\n"));
    console.log(a.quality.map((q) => `[${q.level}] ${q.title} — ${q.detail}`).join("\n"));
  });
});

describe("sample run", () => {
  const activity = load("public/samples/reservoir-loop.tcx");
  const a = analyze(activity, defaultSettings(activity, "imperial"), null);
  it("analyzes in miles with cadence", () => {
    expect(a.splits[0].distance).toBeCloseTo(1609.344, 1);
    expect(a.summary.avgCadence).toBeGreaterThan(150);
    expect(a.summary.strideLength).toBeGreaterThan(0.5);
    expect(a.elevationSource).toBe("file-unverified");
  });
});
