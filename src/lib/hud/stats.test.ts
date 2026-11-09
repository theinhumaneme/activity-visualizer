import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze, defaultSettings } from "../analysis/analyze";
import type { PowerAnalysis } from "../analysis/power";
import type { Analysis } from "../analysis/types";
import { parseActivityFile } from "../parse";
import type { Weather } from "../weather";
import { DEFAULT_END, DEFAULT_LIVE, MAX_END, MAX_LIVE, endOptions, liveOptions, pickEnd, pickLive, withWeather, withoutWeather } from "./stats";

// The public sample: a timed run with heart rate, cadence and device altitude, but no power.
const activity = parseActivityFile(readFileSync("public/samples/reservoir-loop.tcx.xml", "utf8"), "reservoir-loop.tcx")[0];
const run = analyze(activity, defaultSettings(activity, "metric", 200), null);
const weather = {} as Weather;

const keys = (opts: { value: string }[]) => opts.map((o) => o.value);
const label = (opts: { value: string; label: string }[], key: string) => opts.find((o) => o.value === key)?.label;

/** Variants of the sample with data taken away or added. */
const routeOnly = { ...run, activity: { ...run.activity, routeOnly: true } } as Analysis;
const ride = { ...run, activity: { ...run.activity, kind: "ride" } } as Analysis;
const noElevation = {
  ...run,
  elev: null,
  grade: null,
  gap: null,
  steepest: {},
  summary: { ...run.summary, gapPace: undefined, elevGain: undefined, elevLoss: undefined, elevMax: undefined, vam: undefined },
} as Analysis;
const withPower = { ...run, summary: { ...run.summary, avgPower: 210 }, power: { np: 225, work: 230, tss: 40 } as PowerAnalysis } as Analysis;

describe("stat catalogs", () => {
  it("offers a timed run's stats, but not power or weather it doesn't have", () => {
    const live = keys(liveOptions(run));
    expect(live).toEqual(["time", "moving", "distance", "motion", "gap", "hr", "elev", "grade", "cadence"]);
    expect(label(liveOptions(run), "motion")).toBe("Pace");
    const end = keys(endOptions(run));
    for (const k of ["distance", "total", "moving", "stopped", "avg", "gap", "best", "avgHr", "maxHr", "hrr", "cadence", "calories"]) expect(end).toContain(k);
    for (const k of ["power", "np", "work", "tss", "weather", "wind"]) expect(end).not.toContain(k);
    expect(label(endOptions(run), "best")).toBe("Best pace");
    expect(label(endOptions(run), "avg")).toBe("Avg pace");
  });

  it("adds temperature, wind and conditions when there's weather", () => {
    expect(keys(liveOptions(run, weather)).slice(-2)).toEqual(["temp", "wind"]);
    expect(keys(endOptions(run, weather)).slice(-2)).toEqual(["weather", "wind"]);
  });

  it("offers no time-based stats for an untimed route, even with weather", () => {
    const live = keys(liveOptions(routeOnly, weather));
    for (const k of ["time", "moving", "motion", "gap", "temp", "wind"]) expect(live).not.toContain(k);
    expect(live).toContain("distance");
    expect(live).toContain("elev");
    const end = keys(endOptions(routeOnly, weather));
    for (const k of ["total", "moving", "stopped", "avg", "gap", "best", "weather", "wind"]) expect(end).not.toContain(k);
    expect(end).toContain("distance");
  });

  it("speaks of speed for a ride", () => {
    expect(label(liveOptions(ride), "motion")).toBe("Speed");
    expect(label(endOptions(ride), "avg")).toBe("Avg speed");
    expect(label(endOptions(ride), "best")).toBe("Max speed");
  });

  it("drops elevation and grade-adjusted pace without elevation", () => {
    const live = keys(liveOptions(noElevation));
    for (const k of ["gap", "elev", "grade"]) expect(live).not.toContain(k);
    const end = keys(endOptions(noElevation));
    for (const k of ["gap", "gain", "loss", "high", "vam", "steep"]) expect(end).not.toContain(k);
  });

  it("offers power stats with a power meter", () => {
    expect(keys(liveOptions(withPower))).toContain("power");
    const end = keys(endOptions(withPower));
    for (const k of ["power", "np", "work", "tss"]) expect(end).toContain(k);
    // No FTP, no training stress.
    const noTss = { ...withPower, power: { np: 225, work: 230 } as PowerAnalysis } as Analysis;
    expect(keys(endOptions(noTss))).not.toContain("tss");
  });
});

describe("pickLive / pickEnd", () => {
  it("keeps the chosen stats the activity has, in catalog order", () => {
    expect(pickLive(run, ["grade", "power", "time", "hr"])).toEqual(["time", "hr", "grade"]);
    expect(pickEnd(run, ["avgHr", "distance", "np"])).toEqual(["distance", "avgHr"]);
    expect(pickLive(routeOnly, DEFAULT_LIVE)).toEqual(["distance", "hr", "elev", "grade"]);
  });

  it("only shows weather stats when the weather is there", () => {
    expect(pickLive(run, ["time", "temp"])).toEqual(["time"]);
    expect(pickLive(run, ["time", "temp"], weather)).toEqual(["time", "temp"]);
  });
});

describe("withWeather / withoutWeather", () => {
  it("adds temperature and conditions last, making room in full panels", () => {
    expect(DEFAULT_LIVE).toHaveLength(MAX_LIVE);
    const { liveStats, endStats } = withWeather(run, DEFAULT_LIVE, DEFAULT_END);
    expect(liveStats).toEqual(["time", "distance", "motion", "hr", "elev", "temp"]);
    expect(endStats).toEqual([...DEFAULT_END, "weather"]);
    expect(liveStats.length).toBeLessThanOrEqual(MAX_LIVE);
  });

  it("drops the last end stat when the end card is full", () => {
    const full = keys(endOptions(run)).slice(0, MAX_END) as typeof DEFAULT_END;
    const { endStats } = withWeather(run, [], full);
    expect(endStats).toHaveLength(MAX_END);
    expect(endStats.at(-1)).toBe("weather");
    expect(endStats.slice(0, -1)).toEqual(full.slice(0, MAX_END - 1));
  });

  it("doesn't add weather twice, and takes it out again", () => {
    const once = withWeather(run, ["time", "temp"], ["weather", "distance"]);
    expect(once).toEqual({ liveStats: ["time", "temp"], endStats: ["distance", "weather"] });
    expect(withWeather(run, once.liveStats, once.endStats)).toEqual(once);
    expect(withoutWeather(once.liveStats, once.endStats)).toEqual({ liveStats: ["time"], endStats: ["distance"] });
  });
});
