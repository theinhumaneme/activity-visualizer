import { describe, expect, it } from "vitest";
import { parseActivityFile } from "../parse";
import { analyze, defaultSettings } from "./analyze";
import { minetti } from "./gap";

/** Grade-adjusted speed for running at `v` m/s up grade `g`, as the pipeline computes it. */
const gapSpeed = (v: number, g: number) => (v * minetti(g)) / minetti(0);

/** A GPX run due north at `v` m/s, one point a second, climbing `grade` (rise/run) the whole way. */
function hillRun(grade: number, v = 3, seconds = 900) {
  const t0 = Date.UTC(2026, 5, 1, 7);
  const pts = Array.from({ length: seconds + 1 }, (_, i) => {
    const d = i * v;
    return `<trkpt lat="${(42 + d / 111_195).toFixed(7)}" lon="-71"><ele>${(100 + d * grade).toFixed(2)}</ele><time>${new Date(t0 + i * 1000).toISOString()}</time></trkpt>`;
  }).join("");
  const [act] = parseActivityFile(`<gpx><trk><type>running</type><trkseg>${pts}</trkseg></trk></gpx>`, "hill.gpx");
  return analyze(act, defaultSettings(act, "metric"), null);
}

describe("Minetti cost of running", () => {
  it("is 3.6 J/(kg·m) on the flat, as in the paper", () => {
    expect(minetti(0)).toBeCloseTo(3.6, 6);
  });

  it("matches Minetti et al. (2002) measured costs at the extremes of the fit", () => {
    // Published means: 18.93 at +45 %, 3.92 at −45 %; the minimum (~1.7) is near −18 %. The
    // polynomial is a fit, so it lands within a few percent of the measurements.
    expect(Math.abs(minetti(0.45) / 18.93 - 1)).toBeLessThan(0.05);
    expect(Math.abs(minetti(-0.45) / 3.92 - 1)).toBeLessThan(0.05);
    let minG = 0;
    for (let g = -0.45; g <= 0.45; g += 0.005) if (minetti(g) < minetti(minG)) minG = g;
    expect(minG).toBeGreaterThan(-0.22);
    expect(minG).toBeLessThan(-0.15);
    expect(minetti(minG)).toBeGreaterThan(1.6);
    expect(minetti(minG)).toBeLessThan(1.9);
  });

  it("rises monotonically with grade uphill", () => {
    for (let g = 0; g < 0.45; g += 0.01) expect(minetti(g + 0.01)).toBeGreaterThan(minetti(g));
  });
});

describe("grade-adjusted pace", () => {
  it("equals pace on flat ground", () => {
    expect(gapSpeed(3.2, 0)).toBe(3.2);
  });

  it("is faster than pace uphill, slower on a gentle downhill, and faster again on a steep one", () => {
    const v = 3;
    expect(gapSpeed(v, 0.05)).toBeGreaterThan(v);
    expect(gapSpeed(v, 0.1)).toBeGreaterThan(gapSpeed(v, 0.05));
    // A 10 % climb costs about 1.66× the flat: 3 m/s up it is worth ~5 m/s on the flat.
    expect(gapSpeed(v, 0.1)).toBeCloseTo(4.97, 1);
    expect(gapSpeed(v, -0.05)).toBeLessThan(v);
    expect(gapSpeed(v, -0.1)).toBeLessThan(v);
    // Braking down a very steep slope costs more than the flat again.
    expect(gapSpeed(v, -0.45)).toBeGreaterThan(v);
  });

  it("comes out of the pipeline equal to pace on a flat run and faster on a steady climb", () => {
    const flat = hillRun(0);
    expect(flat.gap).not.toBeNull();
    expect(flat.summary.gapPace!).toBeCloseTo(flat.summary.avgPace!, 0);

    const climb = hillRun(0.06);
    expect(climb.summary.elevGain!).toBeGreaterThan(100);
    // 6 % costs ~1.37× the flat, so GAP is roughly pace / 1.37.
    const ratio = climb.summary.avgPace! / climb.summary.gapPace!;
    expect(ratio).toBeGreaterThan(1.25);
    expect(ratio).toBeLessThan(1.5);
  });
});
