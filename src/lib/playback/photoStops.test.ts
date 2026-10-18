import { describe, expect, it } from "vitest";
import { photoLayout } from "../hud/photoLayout";
import { estimatePhotoSeconds, withPhotoStops } from "./photoStops";
import type { FrameState, Timeline } from "./timeline";

// A stand-in timeline: 20 s long, the chase from 4 to 16 s, and the marker at index = T.
const base = {
  duration: 20,
  marks: { reveal: 2, chase: 4, finish: 16, pullback: 17, end: 18 },
  moments: [],
  frame: (T: number) => ({ T, index: T }) as unknown as FrameState,
  timeAtIndex: (i: number) => i,
} as unknown as Timeline;

const img = { width: 4, height: 3 } as unknown as ImageBitmap;
const photo = (index: number) => ({ image: img, index });

describe("withPhotoStops", () => {
  it("holds the flyover at each stop and shifts what follows", () => {
    const { timeline, pages } = withPhotoStops(base, [photo(12), photo(8), photo(8.5)]);
    // 8 and 8.5 share a stop (a 2-photo collage page, 2.9 s); 12 is a single (2.2 s).
    expect(pages.map((p) => [p.photos.length, p.start, p.duration])).toEqual([
      [2, 8, 2.9],
      [1, 12 + 2.9, 2.2],
    ]);
    expect(timeline.duration).toBeCloseTo(20 + 5.1);
    // Frozen during the first hold, then 2.9 s behind.
    expect(timeline.frame(9).index).toBe(8);
    expect(timeline.frame(10.9).index).toBeCloseTo(8);
    expect(timeline.frame(11.9).index).toBeCloseTo(9);
    expect(timeline.marks.finish).toBeCloseTo(16 + 5.1);
    expect(timeline.timeAtIndex(14)).toBeCloseTo(14 + 5.1);
  });

  it("pages big groups into collages of at most four, evenly", () => {
    const { pages } = withPhotoStops(base, [10, 10.1, 10.2, 10.3, 10.4].map(photo));
    expect(pages.map((p) => [p.photos.length, p.page, p.pages])).toEqual([
      [3, 1, 2],
      [2, 2, 2],
    ]);
  });

  it("estimates the added time before there's a timeline", () => {
    expect(estimatePhotoSeconds([100, 101, 5000], 10000)).toBeCloseTo(2.9 + 2.2);
  });
});

describe("photoLayout", () => {
  const box = { x: 0, y: 0, w: 1800, h: 900 };
  const cases: number[][] = [[4 / 3], [3 / 4, 3 / 4], [4 / 3, 3 / 4, 16 / 9], [4 / 3, 4 / 3, 3 / 4, 1]];
  for (const aspects of cases)
    it(`keeps ${aspects.length} photo(s) whole, inside the box and apart`, () => {
      const r = photoLayout(aspects, box, 10);
      r.forEach((c, k) => {
        expect(c.w / c.h).toBeCloseTo(aspects[k], 5);
        expect(c.x).toBeGreaterThanOrEqual(-1e-6);
        expect(c.y).toBeGreaterThanOrEqual(-1e-6);
        expect(c.x + c.w).toBeLessThanOrEqual(box.w + 1e-6);
        expect(c.y + c.h).toBeLessThanOrEqual(box.h + 1e-6);
        for (const d of r.slice(k + 1)) expect(c.x + c.w <= d.x + 1e-6 || d.x + d.w <= c.x + 1e-6 || c.y + c.h <= d.y + 1e-6 || d.y + d.h <= c.y + 1e-6).toBe(true);
      });
      // A good layout fills a fair share of the box.
      expect(r.reduce((t, c) => t + c.w * c.h, 0) / (box.w * box.h)).toBeGreaterThan(aspects.length === 1 ? 0.6 : 0.5);
    });
});
