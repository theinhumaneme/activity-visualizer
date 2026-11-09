import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseActivityFile } from "../parse";
import type { Lap } from "../parse/types";
import { analyze, defaultSettings } from "./analyze";
import { detectIntervals, otsu } from "./intervals";

/** Deterministic noise in [-1, 1). */
function rng(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return (x / 4294967296) * 2 - 1;
  };
}

/**
 * A 1 Hz series from [seconds, m/s] pieces (speed 0 = stopped), with a little stride noise. Heart
 * rate climbs toward 175 while fast and falls toward 120 while slow, about a beat a second.
 */
function series(pieces: [number, number][], seed = 1) {
  const noise = rng(seed);
  const speeds: number[] = [];
  for (const [secs, v] of pieces) for (let k = 0; k < secs; k++) speeds.push(v > 0 ? v + noise() * 0.15 : 0);
  const n = speeds.length + 1;
  const t = Float64Array.from({ length: n }, (_, i) => i);
  const speed = Float64Array.from({ length: n }, (_, i) => speeds[Math.min(i, n - 2)]);
  const dist = new Float64Array(n);
  const hr = new Float64Array(n);
  const moving = new Uint8Array(n);
  hr[0] = 120;
  for (let i = 1; i < n; i++) {
    dist[i] = dist[i - 1] + speeds[i - 1];
    hr[i] = hr[i - 1] + Math.sign((speeds[i - 1] > 3.5 ? 175 : 120) - hr[i - 1]);
  }
  for (let i = 0; i < n; i++) moving[i] = speed[i] > 0.5 ? 1 : 0;
  return { t, dist, speed, hr, moving };
}

const reps = (count: number, work: [number, number], rest: [number, number]) => Array.from({ length: count }, () => [work, rest]).flat();

describe("detectIntervals from the data", () => {
  it("finds a clean 6 × (2 min fast / 1 min easy) between a warm-up and a cool-down", () => {
    const s = series([[600, 2.8], ...reps(6, [120, 4.5], [60, 2.2]), [600, 2.8]]);
    const iv = detectIntervals(s, [])!;
    expect(iv).not.toBeNull();
    expect(iv.source).toBe("detected");
    expect(iv.reps).toHaveLength(6);
    expect(iv.blocks[0].kind).toBe("warmup");
    expect(iv.blocks.at(-1)!.kind).toBe("cooldown");
    expect(iv.blocks.filter((b) => b.kind === "work")).toHaveLength(6);
    for (const r of iv.reps) {
      expect(r.duration).toBeGreaterThan(110);
      expect(r.duration).toBeLessThan(130);
      // 4.5 m/s ≈ 222 s/km.
      expect(r.pace).toBeGreaterThan(205);
      expect(r.pace).toBeLessThan(240);
    }
    expect(iv.reps.map((r) => r.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(iv.repDuration).toBeCloseTo(120, -1);
    expect(iv.paceCv).toBeLessThan(0.05);
    // Recoveries are about a minute and heart rate falls during them.
    for (const r of iv.reps.slice(0, 5)) {
      expect(r.recovery!.duration).toBeGreaterThan(50);
      expect(r.recovery!.duration).toBeLessThan(70);
      expect(r.recovery!.hrTo!).toBeLessThan(r.recovery!.hrFrom!);
      expect(r.peakHr!).toBeGreaterThan(r.avgHr!);
    }
  });

  it("finds nothing in a steady run with one long traffic stop", () => {
    const s = series([
      [900, 3],
      [90, 0],
      [900, 3],
    ]);
    expect(detectIntervals(s, [])).toBeNull();
  });

  it("finds nothing in a steady run with a slow uphill stretch", () => {
    // One block of each kind at most: no repeating structure.
    const s = series([
      [900, 3.2],
      [240, 2.2],
      [900, 3.2],
    ]);
    expect(detectIntervals(s, [])).toBeNull();
  });

  it("finds nothing in stop-and-go riding through town, where fast and slow come at random lengths", () => {
    const noise = rng(7);
    const pieces: [number, number][] = [];
    for (let k = 0; k < 12; k++) pieces.push([Math.round(90 + 150 * (noise() + 1)), 8], [Math.round(25 + 60 * (noise() + 1)), 0]);
    expect(detectIntervals(series(pieces, 3), [])).toBeNull();
  });

  it("needs at least three reps", () => {
    const s = series([[300, 2.8], ...reps(2, [120, 4.5], [60, 2.2]), [300, 2.8]]);
    expect(detectIntervals(s, [])).toBeNull();
  });
});

describe("detectIntervals from laps", () => {
  it("uses Active/Resting laps as the workout", () => {
    const s = series([[300, 2.8], ...reps(4, [180, 4.2], [90, 2.4]), [300, 2.8]]);
    const bounds = [0, 300, ...Array.from({ length: 8 }, (_, k) => 300 + Math.ceil((k + 1) / 2) * 180 + Math.floor((k + 1) / 2) * 90), 300 + 4 * 270 + 300];
    const laps: Lap[] = bounds.slice(0, -1).map((a, k) => ({
      startIndex: a,
      endIndex: bounds[k + 1],
      startTime: a * 1000,
      intensity: k === 0 || k === bounds.length - 2 || k % 2 === 0 ? "Resting" : "Active",
    }));
    const iv = detectIntervals(s, laps)!;
    expect(iv.source).toBe("laps");
    expect(iv.reps).toHaveLength(4);
    expect(iv.reps.map((r) => r.startIdx)).toEqual([300, 570, 840, 1110]);
    expect(iv.reps.every((r) => Math.abs(r.duration - 180) < 1e-9)).toBe(true);
    expect(iv.blocks[0].kind).toBe("warmup");
    expect(iv.blocks.at(-1)!.kind).toBe("cooldown");
  });

  it("ignores evenly paced auto-laps and falls back to the data", () => {
    const s = series([[2400, 3]]);
    const laps: Lap[] = Array.from({ length: 8 }, (_, k) => ({ startIndex: k * 300, endIndex: (k + 1) * 300, startTime: k * 300_000 }));
    expect(detectIntervals(s, laps)).toBeNull();
  });
});

describe("otsu", () => {
  it("splits a two-level sample between the levels", () => {
    const noise = rng(5);
    const v = [...Array.from({ length: 200 }, () => 2 + noise() * 0.2), ...Array.from({ length: 100 }, () => 5 + noise() * 0.2)];
    const thr = otsu(v)!;
    expect(thr).toBeGreaterThan(2.2);
    expect(thr).toBeLessThan(4.8);
  });

  it("has no threshold for a constant or tiny sample", () => {
    expect(otsu(Array(50).fill(3))).toBeNull();
    expect(otsu([1, 2, 3])).toBeNull();
    expect(otsu([1, NaN, 2, Infinity, 3])).toBeNull();
  });
});

describe("the public sample", () => {
  it("is a six-rep workout", () => {
    const activity = parseActivityFile(readFileSync("public/samples/reservoir-loop.tcx.xml", "utf8"), "reservoir-loop.tcx")[0];
    const a = analyze(activity, defaultSettings(activity, "metric"), null);
    expect(a.intervals?.reps).toHaveLength(6);
  });
});
