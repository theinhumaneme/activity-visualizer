import { describe, expect, it } from "vitest";
import { bucketMinMax, clippedRange, consistencyLabel, driftSeries, quantile, rawSpeed, shares, splitOffsets, timelineSpans, withAlpha } from "./math";

describe("analysis view math", () => {
  it("takes nearest-rank quantiles", () => {
    expect(quantile([1, 2, 3, 4, 5], 0)).toBe(1);
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4, 5], 1)).toBe(5);
    expect(quantile([], 0.5)).toBeNaN();
  });

  it("clips the axis to percentiles and counts what falls off", () => {
    const v = [...Array.from({ length: 98 }, (_, i) => 100 + (i % 10)), 1000, NaN, -500];
    const r = clippedRange(v, 0.02, 0.98, 0)!;
    expect(r.range[0]).toBe(100);
    expect(r.range[1]).toBe(109);
    expect(r.outliers).toBe(2);
    expect(clippedRange([NaN], 0, 1)).toBeNull();
    // A reference value stays on the axis.
    expect(clippedRange([5, 6, 7], 0, 1, 0, [10])!.range[1]).toBe(10);
  });

  it("measures raw speed over a short window and skips stopped samples", () => {
    const t = [0, 1, 2, 3, 4, 5, 6];
    const d = [0, 3, 6, 9, 12, 15, 18];
    const s = rawSpeed(t, d, [1, 1, 1, 0, 1, 1, 1], 3);
    expect(s[0]).toBeCloseTo(3);
    expect(s[3]).toBeNaN();
    expect(s[6]).toBeNaN(); // window runs past the end
  });

  it("buckets min and max by x", () => {
    const b = bucketMinMax([0, 1, 2, 3], [5, 7, 1, NaN], 2);
    expect(Array.from(b.lo)).toEqual([5, 1]);
    expect(Array.from(b.hi)).toEqual([7, 1]);
    expect(b.x[0]).toBeCloseTo(0.75);
  });

  it("centers split bars on the average, faster positive", () => {
    const o = splitOffsets([300, 330, 315], 315);
    expect(o[0]).toBeCloseTo(1);
    expect(o[1]).toBeCloseTo(-1);
    expect(o[2]).toBeCloseTo(0);
  });

  it("reads consistency in plain words", () => {
    expect(consistencyLabel(0.02)).toBe("very consistent");
    expect(consistencyLabel(0.047)).toBe("consistent");
    expect(consistencyLabel(0.2)).toBe("wide spread");
  });

  it("lays blocks out along time", () => {
    const t = [0, 10, 20, 30, 40];
    const s = timelineSpans(
      [
        { startIdx: 0, endIdx: 1 },
        { startIdx: 1, endIdx: 4 },
      ],
      t,
    );
    expect(s[0]).toEqual({ start: 0, width: 0.25 });
    expect(s[1]).toEqual({ start: 0.25, width: 0.75 });
    expect(shares([1, 3])).toEqual([0.25, 0.75]);
    expect(shares([0, 0])).toEqual([0, 0]);
  });

  it("adds alpha to hex and rgb colors", () => {
    expect(withAlpha("#ff0000", 0.5)).toBe("rgba(255,0,0,0.5)");
    expect(withAlpha("#fff", 1)).toBe("rgba(255,255,255,1)");
    expect(withAlpha("rgb(1, 2, 3)", 0.2)).toBe("rgba(1,2,3,0.2)");
  });

  it("reads cardiac drift as falling distance per heartbeat at the same pace", () => {
    // 40 min at 3 m/s, HR rising steadily from 140 to 160.
    const n = 2401;
    const t = Array.from({ length: n }, (_, i) => i);
    const d = t.map((x) => x * 3);
    const hr = t.map((x) => 140 + (20 * x) / (n - 1));
    const moving = t.map(() => 1);
    const r = driftSeries(t, d, hr, moving)!;
    expect(r.firstHalf).toBeGreaterThan(r.secondHalf);
    expect(r.drift).toBeGreaterThan(5);
    expect(r.drift).toBeLessThan(9);
    // The window needs room on both sides.
    expect(r.values[10]).toBeNaN();
    expect(r.values[1200]).toBeCloseTo(180 / 150, 2);
    // Under ten minutes there's nothing to read.
    expect(driftSeries(t.slice(0, 500), d.slice(0, 500), hr.slice(0, 500), moving.slice(0, 500))).toBeNull();
  });
});
