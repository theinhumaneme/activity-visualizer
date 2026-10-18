import { describe, expect, it } from "vitest";
import type { Analysis } from "./analysis/types";
import type { Weather } from "./weather";
import { windAlong, windLabel } from "./wind";

/** 20 min north at 5 m/s, then 20 min back south, one sample a second. */
function outAndBack(): Analysis {
  const n = 2401;
  const samples: unknown[] = [];
  const t = new Float64Array(n);
  const dist = new Float64Array(n);
  const t0 = Date.UTC(2026, 9, 17, 12);
  for (let i = 0; i < n; i++) {
    const d = i <= 1200 ? i * 5 : (2400 - i) * 5;
    samples.push({ lat: 42 + d / 111_320, lon: -71, time: t0 + i * 1000, t: i, dist: i * 5 } as never);
    t[i] = i;
    dist[i] = i * 5;
  }
  return {
    n,
    samples,
    t,
    dist,
    moving: new Uint8Array(n).fill(1),
    activity: { routeOnly: false },
    summary: { moving: 2400 },
  } as unknown as Analysis;
}

const hours = [0, 1, 2].map((h) => Date.UTC(2026, 9, 17, 11 + h));
/** 20 km/h from the north the whole time. */
const north: Weather = {
  time: hours,
  temp: [10, 10, 10],
  feelsLike: [10, 10, 10],
  humidity: [50, 50, 50],
  precip: [0, 0, 0],
  windSpeed: [20, 20, 20],
  windDir: [0, 0, 0],
  code: [0, 0, 0],
};

describe("windAlong", () => {
  it("is headwind going north into a north wind and tailwind coming back", () => {
    const w = windAlong(outAndBack(), north)!;
    expect(w.head[300]).toBeCloseTo(20, 0);
    expect(w.head[2000]).toBeCloseTo(-20, 0);
    expect(w.cross[300]).toBeLessThan(1);
    expect(w.headShare).toBeCloseTo(0.5, 1);
    expect(w.tailShare).toBeCloseTo(0.5, 1);
    expect(w.hardest!.head).toBeCloseTo(20, 0);
    expect(w.hardest!.endIdx).toBeLessThanOrEqual(1200);
    expect(w.kindest!.head).toBeCloseTo(-20, 0);
    // Direction of travel is read 25 m ahead, so the turn shows a few samples early.
    expect(w.kindest!.startIdx).toBeGreaterThanOrEqual(1190);
  });

  it("names the wind from its components", () => {
    expect(windLabel(15, 2)).toBe("Headwind");
    expect(windLabel(-15, 2)).toBe("Tailwind");
    expect(windLabel(2, 15)).toBe("Crosswind");
    expect(windLabel(1, 1)).toBe("Calm");
  });

  it("needs the weather", () => {
    expect(windAlong(outAndBack(), null)).toBeNull();
  });
});
