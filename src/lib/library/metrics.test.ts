import { describe, expect, it } from "vitest";
import { DAY_MS, eddington, streaks } from "./aggregate";
import { FATIGUE_DAYS, FITNESS_DAYS, activityLoad, formWord, trainingLoad } from "./load";
import { predictRaces, riegel } from "./predict";
import type { PersonalRecord } from "./records";
import type { LibraryRecord } from "./types";

/** A run on local day `day` (UTC offset 0, so the local day is the UTC day). */
function onDay(day: number, over: Partial<LibraryRecord> = {}): LibraryRecord {
  return {
    id: `d${day}-${Math.random()}`,
    fileName: "x.tcx",
    activityIndex: 0,
    name: "Run",
    sport: "Running",
    kind: "run",
    startTime: day * DAY_MS + 8 * 3600_000,
    utcOffsetMin: 0,
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

const pr = (distance: number, seconds: number): PersonalRecord => ({ kind: "run", distance, label: `${distance} m`, activityId: "a", seconds, startTime: 0 });

describe("fitness, fatigue and form", () => {
  it("prefers heart-rate load and falls back to power", () => {
    expect(activityLoad({ trimp: 80, tss: 60 })).toBe(80);
    expect(activityLoad({ tss: 60 })).toBe(60);
    expect(activityLoad({})).toBeUndefined();
  });

  it("builds up with steady training and decays over a break", () => {
    const recs = Array.from({ length: 84 }, (_, d) => onDay(20000 + d, { trimp: 100 }));
    const days = trainingLoad(recs, 20000 + 84 + 13);
    expect(days).toHaveLength(84 + 14);
    const end = days[83];
    // Twelve weeks at 100 a day: fatigue has caught up, fitness is most of the way there.
    expect(end.fatigue).toBeCloseTo(100 * (1 - (1 - 1 / FATIGUE_DAYS) ** 84), 3);
    expect(end.fitness).toBeCloseTo(100 * (1 - (1 - 1 / FITNESS_DAYS) ** 84), 3);
    expect(end.form).toBeLessThan(0);
    // Two weeks off: fatigue falls faster than fitness, so form turns positive.
    const after = days[days.length - 1];
    expect(after.load).toBe(0);
    expect(after.fatigue).toBeLessThan(after.fitness);
    expect(after.form).toBeGreaterThan(0);
    // Activities without a load don't count.
    expect(trainingLoad([onDay(1)])).toEqual([]);
  });

  it("reads form relative to fitness, whatever the load scale", () => {
    expect(formWord(-20, 100)).toBe("training hard");
    expect(formWord(-40, 200)).toBe("training hard");
    expect(formWord(-40, 100)).toBe("very tired: time to back off");
    expect(formWord(10, 100)).toBe("fresh");
    expect(formWord(0, 0)).toBe("neutral");
  });

  it("adds up two activities on the same day", () => {
    const days = trainingLoad([onDay(5, { trimp: 50 }), onDay(5, { tss: 30 })]);
    expect(days).toHaveLength(1);
    expect(days[0].load).toBe(80);
  });
});

describe("race predictions", () => {
  it("uses Riegel's formula from the best nearby effort", () => {
    expect(riegel(1200, 5000, 10000)).toBeCloseTo(1200 * 2 ** 1.06, 6);
    const p = predictRaces([pr(5000, 1200), pr(10000, 2700), pr(21097.5, 6600)]);
    const tenK = p.find((x) => x.label === "10K")!;
    // The 5K predicts a faster 10K (≈ 41:41) than the 45:00 logged, so it wins.
    expect(tenK.from.distance).toBe(5000);
    expect(tenK.actual).toBe(false);
    expect(p.find((x) => x.label === "5K")!.actual).toBe(true);
    // A 5K is too short to predict a marathon (over 4.5× shorter); the 10K gives the fastest of the rest.
    expect(p.find((x) => x.label === "Marathon")!.from.distance).toBe(10000);
  });

  it("ignores short efforts and other sports", () => {
    expect(predictRaces([pr(1000, 200), { ...pr(10000, 1500), kind: "ride" }])).toEqual([]);
  });
});

describe("streaks", () => {
  it("counts daily and weekly runs, current ones ending today or yesterday", () => {
    // Days 102–106 (Monday to Friday: 1970-01-05, day 4, was a Monday), then 110 and 111 the next week.
    const recs = [102, 103, 104, 105, 106, 110, 111].map((d) => onDay(d));
    const s = streaks(recs, 112);
    expect(s.longestDays).toBe(5);
    expect(s.longestDaysEnd).toBe(106);
    expect(s.currentDays).toBe(2);
    expect(s.longestWeeks).toBe(2);
    expect(s.currentWeeks).toBe(2);
    // The daily streak ends after a day off; the weekly one lasts while last week counts.
    expect(streaks(recs, 120).currentDays).toBe(0);
    expect(streaks(recs, 120).currentWeeks).toBe(2);
    expect(streaks(recs, 130).currentWeeks).toBe(0);
  });
});

describe("Eddington number", () => {
  it("is the largest E with E days of at least E units", () => {
    // Daily km: 10, 8, 6, 5, 5, 3, and two runs on one day adding up to 7.
    const recs = [10, 8, 6, 5, 5, 3].map((km, i) => onDay(i * 2, { distance: km * 1000 }));
    recs.push(onDay(50, { distance: 4000 }), onDay(50, { distance: 3000 }));
    const e = eddington(recs, 1000);
    expect(e.e).toBe(5);
    // Needs 6 days of 6 km; has 4 (10, 8, 7, 6).
    expect(e.toNext).toBe(2);
    expect(eddington([], 1000)).toEqual({ e: 0, toNext: 1 });
  });
});
