import { describe, expect, it } from "vitest";
import type { Sample } from "../parse/types";
import { computePower } from "./power";

function ride(watts: (s: number) => number | undefined, seconds: number, gapAt?: number) {
  const samples: Sample[] = [];
  const t: number[] = [];
  for (let s = 0; s <= seconds; s++) {
    const time = gapAt !== undefined && s >= gapAt ? s + 600 : s;
    samples.push({ lat: 0, lon: 0, t: time, time: time * 1000, dist: s * 8, power: watts(s) } as Sample);
    t.push(time);
  }
  return { samples, t: Float64Array.from(t) };
}

describe("computePower", () => {
  it("steady hour at 200 W", () => {
    const { samples, t } = ride(() => 200, 3600);
    const p = computePower(samples, t, 0)!;
    expect(p.avg).toBeCloseTo(200, 5);
    expect(p.np).toBeCloseTo(200, 5);
    expect(p.vi).toBeCloseTo(1, 5);
    expect(p.work).toBeCloseTo(720, 0);
    expect(p.ftp).toBe(190);
    expect(p.ftpEstimated).toBe(true);
    // An hour at 200/190 of FTP: IF² × 100.
    expect(p.tss!).toBeCloseTo((200 / 190) ** 2 * 100, 0);
    expect(p.zones[4].seconds).toBe(3600); // 105% of FTP: VO₂ max
    expect(p.curve.map((c) => c.seconds)).toEqual([1, 5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600]);
  });

  it("surges raise normalized power above the average", () => {
    const { samples, t } = ride((s) => (Math.floor(s / 60) % 2 ? 100 : 350), 2400);
    const p = computePower(samples, t, 250)!;
    expect(p.np).toBeGreaterThan(p.avg * 1.1);
    expect(p.ftpEstimated).toBe(false);
    expect(p.ftp).toBe(250);
    expect(p.curve.find((c) => c.seconds === 60)!.watts).toBeCloseTo(350, 5);
  });

  it("leaves pauses out and finds the best effort's samples", () => {
    const { samples, t } = ride((s) => (s >= 900 && s < 1200 ? 400 : 150), 1800, 1500);
    const p = computePower(samples, t, 0)!;
    expect(p.seconds).toBeLessThanOrEqual(1801);
    const best5 = p.curve.find((c) => c.seconds === 300)!;
    expect(best5.watts).toBeCloseTo(400, 5);
    expect(best5.startIdx).toBe(900);
    expect(best5.endIdx).toBe(1199);
  });

  it("needs power on most samples", () => {
    const { samples, t } = ride((s) => (s < 100 ? 200 : undefined), 1000);
    expect(computePower(samples, t, 0)).toBeNull();
  });

  it("drains W′ above FTP and refills it below", () => {
    // 10 min at 150 W, 2 min at 300 W, then 10 min easy, with FTP 250 W and W′ 20 kJ.
    const { samples, t } = ride((s) => (s >= 600 && s < 720 ? 300 : 150), 1320);
    const p = computePower(samples, t, 250)!;
    const wb = p.wbal!;
    expect(wb.wPrime).toBe(20000);
    expect(wb.wPrimeEstimated).toBe(true);
    // 120 s at 50 W over FTP: 6 kJ gone.
    expect(wb.min).toBeCloseTo(14000, -2);
    expect(t[wb.minIdx]).toBeGreaterThanOrEqual(715);
    expect(t[wb.minIdx]).toBeLessThanOrEqual(721);
    expect(wb.series[0]).toBe(20000);
    // Mostly refilled after 10 easy minutes.
    expect(wb.series[wb.series.length - 1]).toBeGreaterThan(19500);
    // A W′ you enter is used as is.
    expect(computePower(samples, t, 250, 15000)!.wbal!.min).toBeCloseTo(9000, -2);
  });

  it("has no W′ balance without an FTP", () => {
    const { samples, t } = ride(() => 200, 600);
    expect(computePower(samples, t, 0)!.wbal).toBeUndefined();
  });
});

