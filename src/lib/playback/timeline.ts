// The flyover as a pure function of video time: frame(T) → camera, marker, and overlay cues.
// Live playback and video export both call it, so what you preview is exactly what you export.
//
// Shot list: establish (high drop over the region) → reveal (settle behind the start) → chase
// (the bulk; dwells on moments) → finish (ease to a stop) → pull-back (rise and rotate to the
// whole route) → end card. The camera never follows raw GPS: it faces along a heavily smoothed
// rail, and every shot's pose goes through critically damped springs with rate limits. Because
// the springs see every handoff, velocities always match: no stop-start, no whip pans. The
// look-at point is derived from the pose the springs actually reached, so however they lag, the
// athlete stays at the same spot on screen, and the marker's pace is smoothed so it never lurches.
// The whole camera path is baked once at 60 Hz, which also makes export frame-exact.

import type { Moment } from "../analysis/moments";
import type { Analysis } from "../analysis/types";
import { atIndex, indexAtDist, interpAt, movingAverage } from "../analysis/series";
import { type Bounds, type LngLat, boundsCenter, boundsOf, fitZoom, toDeg, toRad } from "../geo/geo";
import type { ElevationAt } from "../geo/terrainGrid";
import { SPORTS } from "../sport";

export type CameraMode = "cinematic" | "chase" | "overhead";

export interface Camera {
  center: LngLat;
  zoom: number;
  pitch: number;
  bearing: number;
  /** Ground elevation at the center, meters (already exaggerated). */
  elevation: number;
}

export type Shot = "establish" | "reveal" | "chase" | "finish" | "pullback" | "end";

export interface FrameState {
  T: number;
  shot: Shot;
  camera: Camera;
  /** Fractional sample index of the athlete marker. */
  index: number;
  head: LngLat;
  /** Marker index sampled at 10 Hz, for HUD numbers (steady digits even at 60 fps). */
  statsIndex: number;
  /** Activity seconds per video second right now (the time compression, shown on screen). */
  rate: number;
  moment: { m: Moment; alpha: number } | null;
  /** Overlay cues, 0 → 1. */
  fx: {
    title: number;
    marker: number;
    start: number;
    hud: number;
    finish: number;
    burst: number;
    summary: number;
    /** Halo phase in [0, 1), a 1.2 s loop. */
    pulse: number;
  };
}

export interface TimelineOptions {
  /** Seconds of video spent on the chase (including moment dwells). */
  followSeconds: number;
  /** Viewport size in CSS pixels; framing depends on aspect ratio. */
  width: number;
  height: number;
  mode?: CameraMode;
  exaggeration?: number;
  /** Top-down camera, no orbits or swoops. */
  reducedMotion?: boolean;
  /** Seconds to hold on the end card. */
  endSeconds?: number;
  /** Whether an end card covers the lower part of the final frame (default true). */
  endCard?: boolean;
  /** Terrain elevation lookup (meters, not exaggerated) for camera clearance. */
  elevationAt?: ElevationAt | null;
  /** Vertical field of view, degrees (MapLibre's default). */
  fov?: number;
  /** Where the athlete sits on screen, as a fraction of the height from the top (clear of the HUD). */
  subjectY?: number;
}

export interface Timeline {
  duration: number;
  marks: { reveal: number; chase: number; finish: number; pullback: number; end: number };
  bounds: Bounds;
  mode: CameraMode;
  exaggeration: number;
  /** Average activity seconds per video second during the chase. */
  compression: number;
  moments: { m: Moment; T: number }[];
  frame(T: number): FrameState;
  /** Video time at which the marker reaches sample index i (for the scrubber). */
  timeAtIndex(i: number): number;
}

// --- Tunables --------------------------------------------------------------------------------

/** Stopped stretches get this fraction of their real duration on screen. */
const STOP_WEIGHT = 0.03;
/** On-screen pace is smoothed over about this much video time (no GPS speed flicker). */
const PACE_SMOOTH_S = 0.8;
/** How much of the real speed variation reaches the screen: 0 = constant pace, 1 = real. */
const PACE_CONTRAST = 0.5;
/** On-screen pace stays within this factor of the average, either way. */
const PACE_RANGE = 2;
/** Moments may take at most this share of the chase, and slow the marker at most this much. */
const MAX_DWELL_SHARE = 0.3;
const MAX_SLOWDOWN = 2.5;
const RAIL_STEP = 5; // m
/** Camera clearance above terrain at the camera, m; tapers to 0 at the look-at point. */
const CLEARANCE = 110;
const BAKE_HZ = 60;
const EARTH = 40075016.686;
const R = 6371008.8;

/** Critically damped springs: ω in rad/s, rate limits per the camera rules. */
const SPRING = {
  bearing: { w: 2.4, vmax: 25 }, // °/s
  pitch: { w: 2.0, vmax: 12 }, // °/s ("about 10")
  logD: { w: 2.2, vmax: 1.8 }, // ln(m)/s
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
/** cubic-bezier(0.65, 0, 0.35, 1)-like ease-in-out for camera blends. */
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const easeOutExpo = (x: number) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x));
const smooth = (x: number) => x * x * (3 - 2 * x);
/** 0 → 1 over [a, a + d]. */
const ramp = (T: number, a: number, d: number) => clamp01((T - a) / d);
/** Fade in over [a, a+inD], hold, fade out over [b, b+outD]. */
const window_ = (T: number, a: number, inD: number, b: number, outD: number) => Math.min(easeOutExpo(ramp(T, a, inD)), 1 - smooth(ramp(T, b, outD)));

/** Terrain exaggeration: depth for flat city runs, restraint in the mountains. */
export function autoExaggeration(a: Analysis): number {
  if (!a.elev) return 1.5;
  let lo = Infinity;
  let hi = -Infinity;
  for (const e of a.elev) {
    lo = Math.min(lo, e);
    hi = Math.max(hi, e);
  }
  const range = hi - lo;
  return range < 60 ? 1.5 : range < 300 ? 1.3 : 1.15;
}

export function buildTimeline(a: Analysis, opts: TimelineOptions): Timeline {
  const reduced = !!opts.reducedMotion;
  const mode: CameraMode = reduced ? "overhead" : (opts.mode ?? "cinematic");
  const cinematic = mode === "cinematic";
  const overhead = mode === "overhead";
  const exag = opts.exaggeration ?? 1;
  const fov = opts.fov ?? 36.87;
  const W_PX = Math.max(1, opts.width);
  const H_PX = Math.max(1, opts.height);
  const camToCenterPx = (0.5 * H_PX) / Math.tan(toRad(fov) / 2);

  const INTRO = reduced ? 1.2 : 3.0;
  const REVEAL = 1.2;
  const FOLLOW = Math.max(4, opts.followSeconds);
  const FINISH = 1.6;
  const PULLBACK = reduced ? 2.4 : 3.2;
  const END = opts.endSeconds ?? 2;
  const Tr = INTRO;
  const Tc = Tr + REVEAL;
  const Tf = Tc + FOLLOW;
  const Tp = Tf + FINISH;
  const Te = Tp + PULLBACK;
  const duration = Te + END;

  const { n, t, dist, moving } = a;
  const { from, to } = a.privacy;
  const lon = Float64Array.from(a.samples, (s) => s.lon);
  const lat = Float64Array.from(a.samples, (s) => s.lat);
  const headAt = (f: number): LngLat => [atIndex(lon, f), atIndex(lat, f)];

  // Local east/north meters around the route, for camera geometry.
  const visible = a.samples.slice(from, to + 1);
  const bounds = boundsOf(visible.length ? visible : a.samples);
  const [lon0, lat0] = boundsCenter(bounds);
  const kx = R * toRad(1) * Math.cos(toRad(lat0));
  const ky = R * toRad(1);
  const toXY = (lo: number, la: number): [number, number] => [(lo - lon0) * kx, (la - lat0) * ky];
  const toLL = (x: number, y: number): LngLat => [lon0 + x / kx, lat0 + y / ky];

  let routeTop = 0;
  if (a.elev) for (let i = from; i <= to; i++) routeTop = Math.max(routeTop, a.elev[i]);
  const ground = opts.elevationAt ?? (() => routeTop);
  const groundAt = (x: number, y: number) => {
    const [lo, la] = toLL(x, y);
    const g = ground(lo, la);
    return (Number.isFinite(g) ? g : routeTop) * exag;
  };

  // --- Camera rail: the route resampled every 5 m -------------------------------------------
  // Two versions: lightly smoothed (±10 m) for where the athlete is, heavily smoothed (~±60 m)
  // for which way the camera faces, so switchbacks don't swing it.
  const d0 = dist[from];
  const d1 = Math.max(d0 + 1, dist[to]);
  const K = Math.max(2, Math.ceil((d1 - d0) / RAIL_STEP) + 1);
  const railD = new Float64Array(K);
  let rx: Float64Array = new Float64Array(K);
  let ry: Float64Array = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    railD[k] = Math.min(d1, d0 + k * RAIL_STEP);
    const f = Math.min(to, Math.max(from, indexAtDist(dist, railD[k])));
    [rx[k], ry[k]] = toXY(atIndex(lon, f), atIndex(lat, f));
  }
  const mx = movingAverage(rx, 2);
  const my = movingAverage(ry, 2);
  for (let pass = 0; pass < 3; pass++) {
    rx = movingAverage(rx, 8);
    ry = movingAverage(ry, 8);
  }
  const railAt = (d: number): [number, number] => {
    const c = Math.min(d1, Math.max(d0, d));
    return [interpAt(railD, rx, c), interpAt(railD, ry, c)];
  };
  /** Where the athlete is (the route itself, minus GPS jitter). */
  const markerXY = (d: number): [number, number] => {
    const c = Math.min(d1, Math.max(d0, d));
    return [interpAt(railD, mx, c), interpAt(railD, my, c)];
  };
  /** Heading of the rail from d toward a look-ahead point (prevents cutting corners on switchbacks). */
  const headingAt = (d: number, ahead: number) => {
    let a0 = railAt(d);
    let a1 = railAt(d + ahead);
    if (Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) < 5) {
      a0 = railAt(d - ahead);
      a1 = railAt(d);
    }
    return toDeg(Math.atan2(a1[0] - a0[0], a1[1] - a0[1]));
  };

  // --- Pace: distance along the route → video time ------------------------------------------
  // Screen time per meter starts from real time while moving (stops get almost none, climbs get
  // extra), spread onto the 5 m rail. Raw GPS speed is noisy and city rides stop-start, so the
  // pace is smoothed over ~PACE_SMOOTH_S of video and its contrast reduced: the marker speeds up
  // and slows down gently instead of crawling and then racing. Moments add a capped slow-down.
  const bins = K - 1;
  const binW = new Float64Array(bins);
  const binOf = (d: number) => Math.min(bins - 1, Math.max(0, Math.floor((d - d0) / RAIL_STEP)));
  const climb = new Float64Array(n).fill(1);
  if (cinematic && a.grade) for (let i = 0; i < n; i++) climb[i] = 1 + 2.5 * Math.max(0, a.grade[i]);
  const climbSmooth = movingAverage(climb, 15);
  for (let i = from; i < to; i++) {
    const w = (t[i + 1] - t[i]) * (moving[i] ? 1 : STOP_WEIGHT) * climbSmooth[i];
    if (!(w > 0)) continue;
    const da = dist[i];
    const db = dist[i + 1];
    if (db - da < 0.5) {
      binW[binOf(da)] += w;
      continue;
    }
    for (let k = binOf(da); k <= binOf(db); k++) {
      const overlap = Math.min(db, railD[k + 1]) - Math.max(da, railD[k]);
      if (overlap > 0) binW[k] += (w * overlap) / (db - da);
    }
  }
  const binLen = new Float64Array(bins);
  let rate0: Float64Array = new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
    binLen[k] = Math.max(1e-6, railD[k + 1] - railD[k]);
    rate0[k] = binW[k] / binLen[k];
  }
  const smoothR = Math.max(1, Math.round((PACE_SMOOTH_S * (d1 - d0)) / FOLLOW / RAIL_STEP / 2));
  for (let pass = 0; pass < 3; pass++) rate0 = movingAverage(rate0, smoothR);
  let logSum = 0;
  for (let k = 0; k < bins; k++) logSum += Math.log(Math.max(1e-9, rate0[k])) * binLen[k];
  const geo = Math.exp(logSum / (d1 - d0));
  const rate1 = new Float64Array(bins);
  let Wb = 0;
  for (let k = 0; k < bins; k++) {
    const rel = (Math.max(1e-9, rate0[k]) / geo) ** PACE_CONTRAST;
    rate1[k] = geo * Math.min(PACE_RANGE, Math.max(1 / PACE_RANGE, rel));
    Wb += rate1[k] * binLen[k];
  }
  const rbar = Wb / (d1 - d0);

  // Moments: a raised-cosine slow-down around each, sized so the callout holds ≥ its dwell.
  const moments = cinematic ? a.moments.filter((m) => m.at >= from && m.at <= to) : [];
  const hwm = Math.max(2 * RAIL_STEP, 0.025 * (d1 - d0));
  const half = moments.map(() => hwm * rbar);
  const centers = moments.map((m) => atIndex(dist, m.at));
  let dwell = moments.map((m) => m.dwell);
  const totalDwell = dwell.reduce((x, y) => x + y, 0);
  if (totalDwell > FOLLOW * MAX_DWELL_SHARE) dwell = dwell.map((d) => (d * FOLLOW * MAX_DWELL_SHARE) / totalDwell);
  const gain = moments.map(() => 0);
  for (let it = 0; it < 30; it++) {
    const S = Wb + gain.reduce((acc, g, k) => acc + g * half[k], 0);
    for (let k = 0; k < moments.length; k++) gain[k] = Math.min(MAX_SLOWDOWN - 1, Math.max(0, (dwell[k] * S) / FOLLOW - 2 * half[k]) / half[k]);
  }
  const bump = (d: number) => {
    let m = 0;
    for (let k = 0; k < moments.length; k++) {
      const u = (d - centers[k]) / hwm;
      if (Math.abs(u) < 1) m = Math.max(m, gain[k] * 0.5 * (1 + Math.cos(Math.PI * u)));
    }
    return m;
  };
  // Cumulative screen weight at each rail point: strictly increasing, so it inverts cleanly.
  const C = new Float64Array(K);
  for (let k = 0; k < bins; k++) C[k + 1] = C[k] + (rate1[k] + rbar * bump((railD[k] + railD[k + 1]) / 2)) * binLen[k];
  const Wm = C[K - 1] || 1;

  // Trapezoidal velocity profile: the marker eases from rest at the start and to rest at the finish.
  const ACC = Math.min(0.2, 1.1 / FOLLOW);
  const rampInt = (s: number) => (s - (ACC / Math.PI) * Math.sin((Math.PI * s) / ACC)) / 2;
  const progress = (tau: number) => {
    const x = clamp01(tau);
    const r = x < ACC ? rampInt(x) : x > 1 - ACC ? 1 - ACC - rampInt(1 - x) : ACC / 2 + (x - ACC);
    return r / (1 - ACC);
  };
  /** Distance along the route of the athlete marker at video time T. */
  const distAtT = (T: number) => {
    if (T <= Tc) return d0;
    if (T >= Tf) return d1;
    return atIndex(railD, indexAtDist(C, progress((T - Tc) / FOLLOW) * Wm));
  };
  const indexAtT = (T: number) => {
    if (T <= Tc) return from;
    if (T >= Tf) return to;
    return Math.min(to, Math.max(from, indexAtDist(dist, distAtT(T))));
  };
  function timeAtIndex(i: number): number {
    const target = interpAt(railD, C, atIndex(dist, Math.min(to, Math.max(from, i)))) / Wm;
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (progress(mid) < target) lo = mid;
      else hi = mid;
    }
    return Tc + ((lo + hi) / 2) * FOLLOW;
  }
  const momentTimes = moments.map((m, k) => ({ m, T: timeAtIndex(m.at), hw: dwell[k] / 2 }));

  // --- Poses ---------------------------------------------------------------------------------
  // A pose is where the camera looks from (bearing, pitch, distance). Where it looks *at* is
  // derived after the springs (see `lookAt`), so framing always matches the zoom actually shown.
  interface Pose {
    bearing: number;
    pitch: number;
    logD: number;
  }
  const extent = Math.max(200, Math.hypot((bounds.east - bounds.west) * kx, (bounds.north - bounds.south) * ky));
  const portrait = H_PX > W_PX * 1.05;
  // Camera distance suits the sport: close for a swim or a walk, further back for a ride.
  const baseD = SPORTS[a.activity.kind].cameraDistance * Math.min(4, Math.max(1, Math.sqrt(extent / 3000))) * (portrait ? 1.12 : 1);
  const chasePitch = overhead ? 0 : 60;
  const lookAhead = Math.min(400, Math.max(150, baseD * 0.45));
  // The athlete sits on the vertical centerline at this height: above the stats panel, never under it.
  const subjectY = opts.subjectY ?? (portrait ? 0.54 : 0.58);
  const subjectTilt = Math.atan(2 * (subjectY - 0.5) * Math.tan(toRad(fov) / 2));
  /** Ground distance from the athlete to the look-at point that puts them at `subjectY`. */
  const leadFor = (D: number, pitch: number) => {
    const p = toRad(pitch);
    return D * (Math.sin(p) - Math.cos(p) * Math.tan(p - subjectTilt));
  };

  /** Screen speed (meters of route per video second) widens the shot when things move fast. */
  const screenSpeed = (T: number) => Math.abs(distAtT(T + 0.5) - distAtT(T - 0.5));

  const momentBump = (T: number) => {
    let push = 0;
    let orbit = 0;
    for (const { m, T: Tk, hw } of momentTimes) {
      const b = Math.min(smooth(ramp(T, Tk - hw - 0.9, 0.9)), 1 - smooth(ramp(T, Tk + hw, 0.9)));
      if (b <= 0) continue;
      push = Math.max(push, b * (m.hero ? 0.32 : 0.2));
      if (m.hero && !overhead) orbit = Math.max(orbit, b);
    }
    return { push, orbit };
  };

  const chasePose = (T: number): Pose => {
    const d = distAtT(T);
    // Top-down needs more height to show the same stretch of route as an oblique chase.
    const D = baseD * (overhead ? 2.6 : 1) * (1 + Math.min(0.8, screenSpeed(T) / 1100));
    const { push, orbit } = momentBump(T);
    return {
      bearing: overhead ? 0 : headingAt(d, lookAhead) + orbit * 50,
      pitch: chasePitch - orbit * 6,
      logD: Math.log(D * (1 - push)),
    };
  };

  const startPose = chasePose(Tc);
  const endPose = chasePose(Tf);
  const [cx, cy] = toXY(lon0, lat0);
  const minSide = Math.min(W_PX, H_PX);
  // Final framing: the whole visible route with ~12% padding, fitted into the part of the frame
  // the end card leaves clear (the top ~half), a little looser when oblique.
  const clearH = opts.endCard === false ? H_PX : H_PX * (portrait ? 0.5 : 0.52);
  const fitZ = fitZoom(bounds, W_PX, clearH, Math.max(24, minSide * 0.1)) - (overhead ? 0 : 0.2);
  const metersPerPx = (z: number) => (EARTH * Math.cos(toRad(lat0))) / (512 * 2 ** z);
  const overviewBearing = overhead ? 0 : endPose.bearing + 30;
  // Look at a point "below" the route on screen so the route sits in the clear upper area.
  const shift = (((H_PX - clearH) / 2) * metersPerPx(fitZ)) / Math.cos(toRad(overhead ? 0 : 30));
  const overview: Pose = { bearing: overviewBearing, pitch: overhead ? 0 : 30, logD: Math.log(camToCenterPx * metersPerPx(fitZ)) };
  const overviewXY: [number, number] = [cx - Math.sin(toRad(overviewBearing)) * shift, cy - Math.cos(toRad(overviewBearing)) * shift];
  const establishD = (extent > 20000 ? 30000 : 15000) / Math.cos(toRad(20));
  const establish: Pose = reduced ? overview : { bearing: startPose.bearing - 35, pitch: overhead ? 0 : 20, logD: Math.log(establishD) };
  const startXY = markerXY(d0);
  const establishXY: [number, number] = reduced ? overviewXY : [lerp(cx, startXY[0], 0.5), lerp(cy, startXY[1], 0.5)];

  const blend = (p: Pose, q: Pose, f: number, fp = f): Pose => ({
    bearing: p.bearing + wrap180(q.bearing - p.bearing) * f,
    pitch: lerp(p.pitch, q.pitch, fp),
    logD: lerp(p.logD, q.logD, f),
  });

  /** The composed, pre-spring camera pose for each shot. */
  function desired(T: number): Pose {
    if (T < Tc) {
      // Establishing drop, landing behind the start partway through the reveal.
      const e = easeInOut(clamp01(T / (INTRO + REVEAL * 0.55)));
      const p = blend(establish, startPose, e, e ** 1.6);
      // A slow push during the reveal so the camera never fully stops before the chase.
      p.logD += Math.log(1 - 0.04 * ramp(T, Tr, REVEAL));
      return p;
    }
    if (T <= Tf) {
      const p = chasePose(T);
      p.logD += Math.log(0.96);
      return p;
    }
    // Finish: the marker has stopped; the camera keeps a faint drift into the pull-back.
    const drift = overhead ? 0 : 4 * Math.min(T - Tf, FINISH);
    const fin = { ...endPose, bearing: endPose.bearing + drift, logD: endPose.logD + Math.log(0.96) };
    if (T < Tp) return fin;
    return blend(fin, overview, easeInOut(clamp01((T - Tp) / PULLBACK)));
  }

  /** How far a zoom move has got, by camera distance actually reached (linear in meters). */
  const zoomProgress = (D: number, from_: number, to_: number, fallback: number) =>
    Math.abs(to_ - from_) < 1e-3 * to_ ? fallback : clamp01((D - from_) / (to_ - from_));
  /** Look-at point that keeps the athlete (at route distance d) on screen at `subjectY`. */
  const follow = (d: number, D: number, pitch: number, bearing: number): [number, number] => {
    const [x, y] = markerXY(d);
    const s = leadFor(D, pitch);
    const br = toRad(bearing);
    return [x + Math.sin(br) * s, y + Math.cos(br) * s];
  };

  // --- Bake: springs + rate limits, then the look-at point, then terrain clearance -----------
  const steps = Math.ceil(duration * BAKE_HZ) + 2;
  const dt = 1 / BAKE_HZ;
  const bx = new Float64Array(steps);
  const by = new Float64Array(steps);
  const bb = new Float64Array(steps);
  const bp = new Float64Array(steps);
  const bd = new Float64Array(steps);
  let prevRaw = NaN;
  let unwrapped = 0;
  const st = { b: 0, bv: 0, p: 0, pv: 0, d: 0, dv: 0 };
  const springStep = (x: number, v: number, u: number, s: { w: number; vmax: number }) => {
    const acc = s.w * s.w * (u - x) - 2 * s.w * v;
    let nv = v + acc * dt;
    nv = Math.max(-s.vmax, Math.min(s.vmax, nv));
    return [x + nv * dt, nv];
  };
  const establishDist = Math.exp(establish.logD);
  const startDist = Math.exp(startPose.logD) * 0.96;
  const overviewDist = Math.exp(overview.logD);
  let finishDist = NaN;
  for (let k = 0; k < steps; k++) {
    const T = k * dt;
    const p = desired(T);
    // Unwrap the desired bearing against the previous desired value, so a turnaround swings
    // the way the route turns instead of flipping at ±180°.
    unwrapped = Number.isNaN(prevRaw) ? p.bearing : unwrapped + wrap180(p.bearing - prevRaw);
    prevRaw = p.bearing;
    if (k === 0) {
      st.b = unwrapped;
      st.p = p.pitch;
      st.d = p.logD;
    } else {
      [st.b, st.bv] = springStep(st.b, st.bv, unwrapped, SPRING.bearing);
      [st.p, st.pv] = springStep(st.p, st.pv, p.pitch, SPRING.pitch);
      [st.d, st.dv] = springStep(st.d, st.dv, p.logD, SPRING.logD);
    }
    // The look-at point follows the athlete using the bearing, pitch and distance the camera has
    // actually reached, so the athlete stays put on screen however the springs lag. During the
    // drop-in and the pull-back it slides between the athlete and the wide view in step with the
    // zoom, so the route never leaves the frame before the camera is high enough to show it.
    const D = Math.exp(st.d);
    const chase = follow(distAtT(T), D, st.p, st.b);
    let x = chase[0];
    let y = chase[1];
    if (T < Tc) {
      // The spring is still a hair short of its target at the handoff, so the slide also completes
      // by time, over the reveal: the chase then starts exactly on the athlete, without a step.
      const u = Math.max(zoomProgress(D, establishDist, startDist, 0), smooth(ramp(T, Tr, REVEAL)));
      x = lerp(establishXY[0], chase[0], u);
      y = lerp(establishXY[1], chase[1], u);
    } else if (T >= Tp) {
      if (Number.isNaN(finishDist)) finishDist = D;
      const u = zoomProgress(D, finishDist, overviewDist, easeInOut(clamp01((T - Tp) / PULLBACK)));
      x = lerp(chase[0], overviewXY[0], u);
      y = lerp(chase[1], overviewXY[1], u);
    }
    bx[k] = x;
    by[k] = y;
    bb[k] = st.b;
    bp[k] = st.p;
    bd[k] = st.d;
  }

  // Terrain clearance: the altitude each pose needs (camera ≥ CLEARANCE above the ground at its
  // own position and along the line of sight), max-filtered ±1.2 s and smoothed so the camera
  // rises ahead of a ridge rather than bouncing off it.
  const need = new Float64Array(steps);
  const camAlt = new Float64Array(steps);
  const groundT = new Float64Array(steps);
  for (let k = 0; k < steps; k++) {
    const D = Math.exp(bd[k]);
    const pr = toRad(bp[k]);
    const dh = D * Math.sin(pr);
    const br = toRad(bb[k]);
    const camX = bx[k] - Math.sin(br) * dh;
    const camY = by[k] - Math.cos(br) * dh;
    const Et = groundAt(bx[k], by[k]);
    groundT[k] = Et;
    camAlt[k] = Et + D * Math.cos(pr);
    let req = -Infinity;
    for (const f of [0, 0.2, 0.4, 0.6, 0.8]) {
      const g = groundAt(lerp(camX, bx[k], f), lerp(camY, by[k], f));
      req = Math.max(req, (g + CLEARANCE * (1 - f) - Et * f) / (1 - f));
    }
    need[k] = req;
  }
  const R_MAX = Math.round(1.2 * BAKE_HZ);
  const needMax = new Float64Array(steps);
  for (let k = 0; k < steps; k++) {
    let m = -Infinity;
    for (let j = Math.max(0, k - R_MAX); j <= Math.min(steps - 1, k + R_MAX); j++) m = Math.max(m, need[j]);
    needMax[k] = m;
  }
  const needSmooth = movingAverage(needMax, 30);
  for (let k = 0; k < steps; k++) {
    const A = Math.max(camAlt[k], needSmooth[k], needMax[k] - 20);
    if (A <= camAlt[k] + 0.01) continue;
    const D = Math.exp(bd[k]);
    const dh = D * Math.sin(toRad(bp[k]));
    const h = A - groundT[k];
    bp[k] = toDeg(Math.atan2(dh, h));
    bd[k] = Math.log(Math.hypot(dh, h));
  }

  const sampleBake = (arr: Float64Array, T: number) => {
    const f = Math.min(steps - 1, Math.max(0, T * BAKE_HZ));
    const i = Math.floor(f);
    const j = Math.min(steps - 1, i + 1);
    return arr[i] + (arr[j] - arr[i]) * (f - i);
  };

  function cameraAt(T: number): Camera {
    const x = sampleBake(bx, T);
    const y = sampleBake(by, T);
    const D = Math.exp(sampleBake(bd, T));
    const center = toLL(x, y);
    const dMerc = D / (EARTH * Math.cos(toRad(center[1])));
    return {
      center,
      zoom: Math.log2(camToCenterPx / (dMerc * 512)),
      pitch: Math.min(85, Math.max(0, sampleBake(bp, T))),
      bearing: ((sampleBake(bb, T) % 360) + 360) % 360,
      elevation: sampleBake(groundT, T),
    };
  }

  const activityAt = (T: number) => atIndex(t, indexAtT(T));
  const compression = (atIndex(t, to) - atIndex(t, from)) / FOLLOW;

  function frame(T0: number): FrameState {
    const T = Math.min(Math.max(T0, 0), duration);
    const index = indexAtT(T);
    const shot: Shot = T < Tr ? "establish" : T < Tc ? "reveal" : T < Tf ? "chase" : T < Tp ? "finish" : T < Te ? "pullback" : "end";
    let moment: FrameState["moment"] = null;
    for (const { m, T: Tk, hw } of momentTimes) {
      const alpha = window_(T, Tk - hw - 0.25, 0.45, Tk + hw, 0.32);
      if (alpha > 0 && (!moment || alpha > moment.alpha)) moment = { m, alpha };
    }
    const Tq = Math.floor(T * 10) / 10;
    return {
      T,
      shot,
      camera: cameraAt(T),
      index,
      head: headAt(index),
      statsIndex: indexAtT(Tq),
      rate: T > Tc && T < Tf ? Math.abs(activityAt(T + 0.5) - activityAt(T - 0.5)) : 0,
      moment,
      fx: {
        title: window_(T, 0.2, 0.6, INTRO - 0.55, 0.4),
        marker: easeOutExpo(ramp(T, Tr, 0.5)),
        start: window_(T, Tr + 0.1, 0.45, Tc + 0.9, 0.32),
        // The live HUD gives way to the FINISH card, which carries the final time.
        hud: window_(T, Tr + 0.3, 0.45, Tf - 0.1, 0.32),
        finish: window_(T, Tf, 0.45, Tp + 0.9, 0.32),
        burst: T >= Tf ? clamp01((T - Tf) / 1.0) : 0,
        summary: easeOutExpo(ramp(T, Tp + PULLBACK * 0.55, 0.6)),
        pulse: (T % 1.2) / 1.2,
      },
    };
  }

  return {
    duration,
    marks: { reveal: Tr, chase: Tc, finish: Tf, pullback: Tp, end: Te },
    bounds,
    mode,
    exaggeration: exag,
    compression,
    moments: momentTimes.map(({ m, T }) => ({ m, T })),
    frame,
    timeAtIndex,
  };
}
