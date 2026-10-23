import { describe, expect, it } from "vitest";
import { explore } from "./explore";
import { readableName } from "./record";
import { simplifyTrack } from "./simplify";
import { fileKey, gearTotals, parseCsv, readActivitiesCsv, withStrava } from "./strava";
import type { LibraryRecord } from "./types";

let nextId = 0;
function record(over: Partial<LibraryRecord> = {}): LibraryRecord {
  return {
    id: `r${++nextId}`,
    fileName: "x.tcx",
    activityIndex: 0,
    name: "Morning Run",
    sport: "Running",
    kind: "run",
    startTime: Date.UTC(2026, 3, 1, 10),
    utcOffsetMin: -240,
    distance: 5000,
    elapsed: 1500,
    moving: 1500,
    avgSpeed: 5000 / 1500,
    elevSource: "none",
    bestEfforts: [],
    track: null,
    ...over,
  };
}

/** A straight line north from (lat, lon), one point every 10 m, 2.5 m/s. */
function line(lat: number, lon: number, meters: number) {
  const pts = [];
  for (let d = 0; d <= meters; d += 10) pts.push({ lat: lat + d / 110_540, lon, dist: d, moving: d / 2.5 });
  return simplifyTrack(pts);
}

describe("Strava's activities.csv", () => {
  const csv = [
    "Activity ID,Activity Date,Activity Name,Activity Type,Activity Description,Elapsed Time,Distance,Activity Gear,Filename,Distance",
    '1,"Oct 22, 2026, 11:31:35 PM",Ride Around Charles,Ride,,1200,9.1,,activities/21856990961.tcx.gz,9100',
    '2,"Oct 21, 2026, 6:00:00 PM","Tempo, then ""easy""",Run,"Felt good.\nWindy on the bridge.",1500,5.0,Nike Pegasus 39 Nike Black,activities/2.fit.gz,5000',
    '3,"Oct 20, 2026, 7:00:00 AM",Weights,Weight Training,,3600,0,,,0',
  ].join("\r\n");

  it("parses quoted fields with commas, doubled quotes and line breaks", () => {
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(4);
    expect(rows[2][2]).toBe('Tempo, then "easy"');
    expect(rows[2][4]).toBe("Felt good.\nWindy on the bridge.");
  });

  it("keys activities by their file, without .gz, and skips ones with no file", () => {
    const d = readActivitiesCsv("﻿" + csv);
    expect([...d.keys()]).toEqual(["21856990961.tcx", "2.fit"]);
    expect(d.get("2.fit")).toEqual({
      name: 'Tempo, then "easy"',
      type: "Run",
      description: "Felt good.\nWindy on the bridge.",
      gear: "Nike Pegasus 39 Nike Black",
    });
    expect(fileKey("21856990961.tcx.gz")).toBe("21856990961.tcx");
    expect(fileKey("folder/2.FIT")).toBe("2.fit");
  });

  it("names the record and takes Strava's sport only where the file's can't be trusted more", () => {
    const d = { name: "Shakeout", type: "Walk", gear: "Shoes" };
    expect(withStrava(record({ kind: "run" }), d)).toMatchObject({ name: "Shakeout", kind: "walk", strava: d });
    expect(withStrava(record({ kind: "other" }), { ...d, type: "Ride" }).kind).toBe("ride");
    expect(withStrava(record({ kind: "ride" }), d).kind).toBe("ride");
    expect(withStrava(record({ name: "Kept" }), { name: "", type: "" }).name).toBe("Kept");
  });

  it("adds up gear, and tells shoes from bikes", () => {
    const shoes = { name: "x", type: "Run", gear: "Pegasus" };
    const bike = { name: "x", type: "Ride", gear: "Commuter" };
    const g = gearTotals([
      withStrava(record({ distance: 5000, startTime: 2 }), shoes),
      withStrava(record({ distance: 3000, startTime: 1 }), shoes),
      withStrava(record({ kind: "ride", distance: 20000 }), bike),
      record(),
    ]);
    expect(g.map((x) => [x.name, x.distance, x.count, x.shoe])).toEqual([
      ["Commuter", 20000, 1, false],
      ["Pegasus", 8000, 2, true],
    ]);
    expect(g[1].first.startTime).toBe(1);
  });
});

describe("readable names", () => {
  it("names id-only files by when they started, in local time", () => {
    const at = (h: number) => Date.UTC(2026, 3, 1, h + 4); // 4 h behind UTC
    expect(readableName({ name: "21857591762", kind: "walk", startTime: at(18), utcOffsetMin: -240 })).toBe("Evening Walk");
    expect(readableName({ name: "21857591762", kind: "run", startTime: at(7), utcOffsetMin: -240 })).toBe("Morning Run");
    expect(readableName({ name: "21857591762", kind: "ride", startTime: at(12), utcOffsetMin: -240 })).toBe("Lunch Ride");
    expect(readableName({ name: "123", kind: "other", startTime: at(23), utcOffsetMin: -240 })).toBe("Night Activity");
    expect(readableName({ name: "Lunch Run", kind: "run", startTime: at(1), utcOffsetMin: -240 })).toBe("Lunch Run");
  });
});

describe("new ground", () => {
  it("counts the first time over a street, not the repeats, across sports", () => {
    const a = record({ startTime: 1, distance: 1000, track: line(42.3, -71.1, 1000) });
    const b = record({ startTime: 2, kind: "walk", distance: 1000, track: line(42.3, -71.1, 1000) });
    // Overlaps the first kilometer, then goes 1 km further.
    const c = record({ startTime: 3, distance: 2000, track: line(42.3, -71.1, 2000) });
    const { newDistance, cumulative } = explore([c, b, a]);
    expect(newDistance.get(a.id)).toBeCloseTo(1000, -1);
    expect(newDistance.get(b.id)).toBe(0);
    expect(newDistance.get(c.id)! / 1000).toBeCloseTo(1, 1);
    expect(cumulative.map((x) => x.id)).toEqual([a.id, b.id, c.id]);
  });

  it("doesn't count the way back of an out-and-back as new", () => {
    const pts = [];
    for (let d = 0; d <= 2000; d += 10) {
      const along = d <= 1000 ? d : 2000 - d;
      pts.push({ lat: 42.3 + along / 110_540, lon: -71.1, dist: d, moving: d / 2.5 });
    }
    const r = record({ distance: 2000, track: simplifyTrack(pts) });
    // The first few steps back from the turn are too recent to count as covered: about 50 m.
    const n = explore([r]).newDistance.get(r.id)!;
    expect(n).toBeGreaterThan(1000);
    expect(n).toBeLessThan(1080);
  });

  it("ignores a GPS jump and activities without a route", () => {
    const track = simplifyTrack([
      { lat: 42.3, lon: -71.1, dist: 0, moving: 0 },
      { lat: 42.4, lon: -71.1, dist: 11_000, moving: 10 },
    ]);
    const jump = record({ distance: 11_000, track });
    const indoor = record({ track: null });
    const { newDistance } = explore([jump, indoor]);
    expect(newDistance.get(jump.id)).toBe(0);
    expect(newDistance.has(indoor.id)).toBe(false);
  });
});
