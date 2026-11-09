import { describe, expect, it } from "vitest";
import type { Analysis } from "../analysis/types";
import type { Track } from "../library/types";
import { type GhostRunner, gapWords, ghostsAt } from "./ghosts";

const M_PER_DEG = 111_195;
const LENGTH = 1000;

/** A straight 1 km route due north, run at an even pace in `seconds` of moving time (10 m points). */
function track(seconds: number, scale = 1): Track {
  const k = LENGTH / 10 + 1;
  return {
    lon: new Float64Array(k).fill(-71),
    lat: Float64Array.from({ length: k }, (_, i) => 42 + (i * 10) / M_PER_DEG),
    // A different GPS unit can measure the same route a little longer or shorter.
    dist: Float32Array.from({ length: k }, (_, i) => i * 10 * scale),
    moving: Float32Array.from({ length: k }, (_, i) => (i * seconds) / (k - 1)),
  };
}

const ghost = (id: string, t: Track): GhostRunner => ({ id, label: id, color: "#fff", track: t });

/**
 * The athlete: the same 1 km at 2.5 m/s (400 s moving), one sample a second, optionally standing
 * still for `stop` seconds halfway (moving time doesn't advance while stopped).
 */
function athlete(o: { stop?: number; privacyRadius?: number } = {}): Analysis {
  const stop = o.stop ?? 0;
  const n = 400 + stop + 1;
  const dist = new Float64Array(n);
  const movingTime = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const moved = i <= 200 ? i : Math.max(200, i - stop);
    movingTime[i] = moved;
    dist[i] = moved * 2.5;
  }
  return { n, dist, movingTime, settings: { privacyRadius: o.privacyRadius ?? 0 }, summary: { moving: 400 } } as unknown as Analysis;
}

/** Index where the athlete has covered `m` meters (no stop). */
const at = (m: number) => m / 2.5;

describe("ghostsAt", () => {
  const fast = ghost("fast", track(360));
  const slow = ghost("slow", track(440));

  it("says how far behind or ahead you are at the same point of the route", () => {
    const [f, s] = ghostsAt(athlete(), [fast, slow], at(500));
    // Halfway: you took 200 s, the fast ghost 180 s, the slow one 220 s.
    expect(f.gap).toBeCloseTo(20, 3);
    expect(s.gap).toBeCloseTo(-20, 3);
    expect(gapWords(f.gap)).toBe("20 s ahead");
    expect(gapWords(s.gap)).toBe("20 s behind");
  });

  it("places each ghost where it was after the same moving time", () => {
    const [f, s] = ghostsAt(athlete(), [fast, slow], at(500));
    // After 200 s the fast ghost had run 555.6 m and the slow one 454.5 m.
    expect((f.at![1] - 42) * M_PER_DEG).toBeCloseTo((200 / 360) * 1000, 0);
    expect((s.at![1] - 42) * M_PER_DEG).toBeCloseTo((200 / 440) * 1000, 0);
    expect(f.at![0]).toBe(-71);
  });

  it("doesn't count a stop against you", () => {
    const stopped = athlete({ stop: 60 });
    // Mid-stop and after it, the gap is what it was when you stopped and at the same place without one.
    expect(ghostsAt(stopped, [fast], 230)[0].gap).toBeCloseTo(20, 3);
    expect(ghostsAt(stopped, [fast], at(800) + 60)[0].gap).toBeCloseTo(ghostsAt(athlete(), [fast], at(800))[0].gap, 6);
  });

  it("compares against each run's own length, so GPS differences don't decide it", () => {
    // Same moving times, but this unit measured the route 3 % longer.
    const twin = ghost("twin", track(400, 1.03));
    for (const m of [100, 500, 900]) expect(ghostsAt(athlete(), [twin], at(m))[0].gap).toBeCloseTo(0, 3);
  });

  it("interpolates between samples", () => {
    const a = ghostsAt(athlete(), [fast], 100)[0].gap;
    const b = ghostsAt(athlete(), [fast], 101)[0].gap;
    const mid = ghostsAt(athlete(), [fast], 100.5)[0].gap;
    expect(mid).toBeCloseTo((a + b) / 2, 6);
  });

  it("uses the finish times once you've finished, and parks finished ghosts at the end", () => {
    const a = athlete();
    const [f, s] = ghostsAt(a, [fast, slow], a.n - 1);
    expect(f.gap).toBe(40);
    expect(s.gap).toBe(-40);
    expect((f.at![1] - 42) * M_PER_DEG).toBeCloseTo(1000, 3);
  });

  it("hides ghosts inside the privacy circle", () => {
    const a = athlete({ privacyRadius: 200 });
    // At 40 s the fast ghost is ~111 m from the start; at 200 s it's well clear of both ends.
    expect(ghostsAt(a, [fast], 40)[0].at).toBeNull();
    expect(ghostsAt(a, [fast], 200)[0].at).not.toBeNull();
    // Finished: parked on the finish line, inside the circle.
    expect(ghostsAt(a, [fast], a.n - 1)[0].at).toBeNull();
  });
});

describe("gapWords", () => {
  it("rounds to whole seconds and switches to m:ss from a minute", () => {
    expect(gapWords(0)).toBe("level");
    expect(gapWords(-0.4)).toBe("level");
    expect(gapWords(12.3)).toBe("12 s ahead");
    expect(gapWords(-65)).toBe("1:05 behind");
    expect(gapWords(59.6)).toBe("1:00 ahead");
    expect(gapWords(-3725)).toBe("62:05 behind");
  });
});
