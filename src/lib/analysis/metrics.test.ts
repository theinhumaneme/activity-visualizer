import { describe, expect, it } from "vitest";
import type { Climb } from "./climbs";
import { hrRecovery, steepest, withVam } from "./metrics";

const range = (n: number, f: (i: number) => number) => Float64Array.from({ length: n }, (_, i) => f(i));

describe("climbing metrics", () => {
  it("works out VAM per climb from moving time", () => {
    const movingTime = range(1001, (i) => i);
    const climbs: Climb[] = [
      { startIdx: 0, endIdx: 600, length: 2000, gain: 150, grade: 0.075, category: "4" },
      // Too short in time to rate.
      { startIdx: 700, endIdx: 730, length: 120, gain: 10, grade: 0.08, category: null },
    ];
    const r = withVam(climbs, movingTime);
    expect(r.climbs[0].vam).toBeCloseTo(900);
    expect(r.climbs[0].duration).toBe(600);
    expect(r.climbs[1].vam).toBeUndefined();
    expect(r.vam).toBeCloseTo(900);
    expect(withVam([], movingTime).vam).toBeUndefined();
  });

  it("finds the steepest stretches up and down", () => {
    // 3 km at 10 m spacing: flat, a 12% wall from 1000 to 1100 m, 4% from 1100 to 2000 m, then down at 6%.
    const dist = range(301, (i) => i * 10);
    const elev = Float64Array.from(dist, (d) => {
      if (d <= 1000) return 100;
      if (d <= 1100) return 100 + (d - 1000) * 0.12;
      if (d <= 2000) return 112 + (d - 1100) * 0.04;
      return 148 - (d - 2000) * 0.06;
    });
    const s = steepest(dist, elev, range(301, (i) => i * 4));
    expect(s.up100!.grade).toBeCloseTo(0.12, 3);
    expect(dist[s.up100!.startIdx]).toBe(1000);
    expect(s.up100!.speed).toBeCloseTo(2.5);
    expect(s.up1k!.grade).toBeGreaterThan(0.04);
    expect(s.down1k!.grade).toBeCloseTo(-0.06, 3);
    // A flat route has nothing steep worth naming.
    expect(steepest(dist, range(301, () => 50), null)).toEqual({});
  });
});

describe("heart-rate recovery", () => {
  it("measures the drop in the minute after the finish", () => {
    // 20 min moving at 170 bpm, then 2 min stopped with HR falling 0.5 bpm/s.
    const n = 1321;
    const t = range(n, (i) => i);
    const moving = Uint8Array.from({ length: n }, (_, i) => (i < 1200 ? 1 : 0));
    const movingTime = range(n, (i) => Math.min(i, 1200));
    const hr = range(n, (i) => (i <= 1200 ? 170 : 170 - (i - 1200) * 0.5));
    const r = hrRecovery(t, hr, moving, movingTime, [])!;
    expect(r.source).toBe("finish");
    expect(r.from).toBeCloseTo(170);
    expect(r.to).toBeCloseTo(140);
    expect(r.drop).toBeCloseTo(30);
  });

  it("falls back to the longest stop when the recording ends on the move", () => {
    const n = 2000;
    const t = range(n, (i) => i);
    const stop = { startIdx: 900, endIdx: 1000, duration: 100 };
    const moving = Uint8Array.from({ length: n }, (_, i) => (i >= 900 && i < 1000 ? 0 : 1));
    const movingTime = new Float64Array(n);
    for (let i = 1; i < n; i++) movingTime[i] = movingTime[i - 1] + moving[i - 1];
    const hr = range(n, (i) => (i > 900 && i < 1000 ? 160 - (i - 900) * 0.4 : 160));
    const r = hrRecovery(t, hr, moving, movingTime, [stop])!;
    expect(r.source).toBe("stop");
    expect(r.drop).toBeCloseTo(24);
    // No stop long enough and no time after the finish: nothing to say.
    expect(hrRecovery(t, range(n, () => 150), new Uint8Array(n).fill(1), range(n, (i) => i), [])).toBeUndefined();
  });
});
