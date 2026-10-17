import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze, defaultSettings } from "../analysis/analyze";
import { parseActivityFile } from "../parse";
import { atIndex } from "../analysis/series";
import { buildTimeline } from "./timeline";

const activity = parseActivityFile(readFileSync("public/samples/reservoir-loop.tcx", "utf8"), "reservoir-loop.tcx")[0];
const a = analyze(activity, defaultSettings(activity, "metric", 200), null);
const opts = { followSeconds: 25, width: 540, height: 960, exaggeration: 1.5 };
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

describe("flyover camera", () => {
  const tl = buildTimeline(a, opts);
  const dt = 1 / 30;
  const frames = Array.from({ length: Math.ceil(tl.duration / dt) }, (_, i) => tl.frame(i * dt));

  it("is deterministic", () => {
    const again = buildTimeline(a, opts);
    for (const T of [0, 1.7, 9.3, 21, tl.duration - 0.1]) expect(again.frame(T)).toEqual(tl.frame(T));
  });

  it("never whips the bearing (≤ 25°/s) and never flips", () => {
    let worst = 0;
    for (let i = 1; i < frames.length; i++) worst = Math.max(worst, Math.abs(wrap(frames[i].camera.bearing - frames[i - 1].camera.bearing)) / dt);
    expect(worst).toBeLessThanOrEqual(25.5);
  });

  it("keeps pitch changes gentle and within MapLibre's range", () => {
    let worst = 0;
    for (let i = 1; i < frames.length; i++) worst = Math.max(worst, Math.abs(frames[i].camera.pitch - frames[i - 1].camera.pitch) / dt);
    // Rate-limited at 12°/s; terrain clearance may add a little on top.
    expect(worst).toBeLessThan(16);
    for (const f of frames) {
      expect(f.camera.pitch).toBeGreaterThanOrEqual(0);
      expect(f.camera.pitch).toBeLessThanOrEqual(85);
      expect(Number.isFinite(f.camera.zoom)).toBe(true);
    }
  });

  it("zooms smoothly: no stop-start at shot handoffs", () => {
    // Velocity of zoom across each handoff stays continuous (no jump between neighbors).
    for (const T of [tl.marks.reveal, tl.marks.chase, tl.marks.finish, tl.marks.pullback, tl.marks.end]) {
      const z = [-2, -1, 0, 1, 2].map((k) => tl.frame(T + k * dt).camera.zoom);
      const v1 = z[1] - z[0];
      const v2 = z[3] - z[2];
      expect(Math.abs(v2 - v1)).toBeLessThan(0.02);
    }
  });

  it("never jumps the look-at point between frames, even at shot handoffs", () => {
    // A short chase at 60 fps: the drop-in's zoom spring has the least time to settle.
    const short = buildTimeline(a, { ...opts, followSeconds: 15 });
    const frames = Array.from({ length: Math.ceil(short.duration * 60) }, (_, i) => short.frame(i / 60));
    const step = (f: (typeof frames)[number], g: (typeof frames)[number]) => {
      const [dx, dy] = [(g.camera.center[0] - f.camera.center[0]) * 111320 * Math.cos((f.camera.center[1] * Math.PI) / 180), (g.camera.center[1] - f.camera.center[1]) * 110574];
      return [dx, dy];
    };
    for (let i = 2; i < frames.length; i++) {
      const [ax, ay] = step(frames[i - 2], frames[i - 1]);
      const [bx, by] = step(frames[i - 1], frames[i]);
      // Change in velocity between frames, relative to the camera distance (meters per meter).
      const D = (0.5 * opts.height) / Math.tan((36.87 * Math.PI) / 360) * ((40075016.686 * Math.cos((frames[i].camera.center[1] * Math.PI) / 180)) / (512 * 2 ** frames[i].camera.zoom));
      expect(Math.hypot(bx - ax, by - ay) / D).toBeLessThan(0.004);
    }
  });

  it("moves the marker from the start of the visible route to its end, monotonically", () => {
    expect(tl.frame(0).index).toBe(a.privacy.from);
    expect(tl.frame(tl.marks.finish).index).toBe(a.privacy.to);
    for (let i = 1; i < frames.length; i++) expect(frames[i].index).toBeGreaterThanOrEqual(frames[i - 1].index);
  });

  it("dwells on the hero moment for at least 1.5 s", () => {
    const hero = tl.moments.find((m) => m.m.hero)!;
    expect(hero).toBeTruthy();
    const shown = frames.filter((f) => f.moment?.m.id === hero.m.id && f.moment.alpha > 0.5).length * dt;
    expect(shown).toBeGreaterThanOrEqual(1.5);
  });

  it("discloses time compression during the chase", () => {
    const mid = tl.frame((tl.marks.chase + tl.marks.finish) / 2);
    expect(mid.rate).toBeGreaterThan(5);
    expect(tl.compression).toBeGreaterThan(10);
  });

  it("ends framing the whole route, top-down or oblique", () => {
    const end = tl.frame(tl.duration);
    expect(end.camera.pitch).toBeLessThanOrEqual(31);
    expect(end.camera.zoom).toBeLessThan(tl.frame((tl.marks.chase + tl.marks.finish) / 2).camera.zoom);
  });

  it("rises over terrain it would otherwise clip", () => {
    const flat = buildTimeline(a, { ...opts, elevationAt: () => 20 });
    const hill = buildTimeline(a, { ...opts, elevationAt: () => 20, mode: "chase" });
    // High ground everywhere more than ~150 m from the route: where a trailing camera sits.
    const pts = a.samples;
    const near = (lon: number, lat: number) =>
      pts.some((p, i) => i % 10 === 0 && Math.hypot((p.lon - lon) * 82000, (p.lat - lat) * 111000) < 150);
    const ridge = buildTimeline(a, { ...opts, mode: "chase", elevationAt: (lon, lat) => (near(lon, lat) ? 20 : 400) });
    const T = (flat.marks.chase + flat.marks.finish) / 2;
    expect(Number.isFinite(hill.frame(T).camera.zoom)).toBe(true);
    // Somewhere along the chase the ridge forces a higher (lower-zoom or steeper-down) camera.
    let raised = false;
    for (let x = ridge.marks.chase; x < ridge.marks.finish; x += 0.5) {
      const r = ridge.frame(x).camera;
      const h = hill.frame(x).camera;
      if (r.zoom < h.zoom - 0.05 || r.pitch < h.pitch - 1) raised = true;
    }
    expect(raised).toBe(true);
  });

  /** Screen position (fractions of width/height) of a ground point, for a flat-earth pinhole camera. */
  const screenAt = (cam: (typeof frames)[number]["camera"], [lon, lat]: [number, number]) => {
    const H = opts.height;
    const toCenter = (0.5 * H) / Math.tan((36.87 * Math.PI) / 360);
    const D = toCenter * ((40075016.686 * Math.cos((cam.center[1] * Math.PI) / 180)) / (512 * 2 ** cam.zoom));
    const e = (lon - cam.center[0]) * 111320 * Math.cos((cam.center[1] * Math.PI) / 180);
    const n = (lat - cam.center[1]) * 110574;
    const b = (cam.bearing * Math.PI) / 180;
    const p = (cam.pitch * Math.PI) / 180;
    const fwd = D * Math.sin(p) + e * Math.sin(b) + n * Math.cos(b);
    const right = e * Math.cos(b) - n * Math.sin(b);
    const h = D * Math.cos(p);
    const z = fwd * Math.sin(p) + h * Math.cos(p);
    const down = h * Math.sin(p) - fwd * Math.cos(p);
    return [0.5 + (right / z) * (toCenter / opts.width), 0.5 + (down / z) * (toCenter / H)];
  };

  it("keeps the athlete at the same spot on screen, clear of the stats panel", () => {
    let worstX = 0;
    let worstY = 0;
    for (const f of frames) {
      if (f.shot !== "chase") continue;
      const [x, y] = screenAt(f.camera, f.head);
      worstX = Math.max(worstX, Math.abs(x - 0.5));
      worstY = Math.max(worstY, Math.abs(y - 0.54));
    }
    expect(worstX).toBeLessThan(0.06);
    expect(worstY).toBeLessThan(0.05);
  });

  it("moves the marker at a steady pace: no crawling then racing, no lurches", () => {
    const d = frames.filter((f) => f.shot === "chase").map((f) => atIndex(a.dist, f.index));
    const v = d.slice(1).map((x, i) => x - d[i]);
    const mid = v.slice(Math.floor(v.length * 0.15), Math.floor(v.length * 0.85));
    const mean = mid.reduce((x, y) => x + y, 0) / mid.length;
    for (let i = 1; i < mid.length; i++) expect(Math.abs(mid[i] - mid[i - 1])).toBeLessThan(mean * 0.12);
    expect(Math.min(...mid)).toBeGreaterThan(mean / 6);
    expect(Math.max(...mid)).toBeLessThan(mean * 3);
  });

  it("keeps the finish in frame while pulling back to the whole route", () => {
    const last = a.samples[a.privacy.to];
    for (const f of frames) {
      if (f.T < tl.marks.finish) continue;
      const [x, y] = screenAt(f.camera, [last.lon, last.lat]);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(1);
    }
  });

  it("goes top-down with no orbits in reduced-motion mode", () => {
    const rm = buildTimeline(a, { ...opts, reducedMotion: true });
    expect(rm.mode).toBe("overhead");
    for (let T = 0; T < rm.duration; T += 0.5) {
      expect(rm.frame(T).camera.pitch).toBeLessThan(1);
      expect(Math.abs(wrap(rm.frame(T).camera.bearing))).toBeLessThan(1);
    }
  });
});
