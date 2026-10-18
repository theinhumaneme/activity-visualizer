// Globe intro: the video opens on the whole Earth, turning towards the activity, then dives down
// into the flyover's own opening shot. The map draws as a globe at low zoom and flattens into the
// usual map as it closes in (MapLibre's globe projection does that by itself).
//
// A wrapper around a finished timeline, like the photo stops: the intro is prepended and
// everything else shifts later.

import type { Camera, FrameState, Timeline } from "./timeline";

/** Seconds the intro adds. */
export const GLOBE_SECONDS = 4.5;
/** Zoom that shows the whole globe with room around it. */
const GLOBE_ZOOM = 1.15;
/** The globe starts this far west of the activity and turns to it. */
const SPIN = 70;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const easeOut = (x: number) => 1 - (1 - x) ** 3;
/** Shortest turn from a to b, degrees. */
const turn = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;

/** The intro camera at u (0 → 1) towards the opening camera `to`. */
function introCamera(to: Camera, u: number): Camera {
  // The globe turns into place over the first part, the dive takes the rest; the camera only
  // tilts and turns to the opening shot's angle near the end.
  const spin = easeOut(clamp01(u / 0.65));
  const dive = easeInOut(clamp01((u - 0.15) / 0.85));
  const tilt = easeInOut(clamp01((u - 0.6) / 0.4));
  const lat0 = to.center[1] * 0.4;
  return {
    center: [to.center[0] - SPIN * (1 - spin), lat0 + (to.center[1] - lat0) * spin],
    zoom: GLOBE_ZOOM + (to.zoom - GLOBE_ZOOM) * dive,
    pitch: to.pitch * tilt,
    bearing: turn(0, to.bearing) * tilt,
    elevation: to.elevation * dive,
  };
}

export function withGlobeIntro(base: Timeline): Timeline {
  const D = GLOBE_SECONDS;
  const first = base.frame(0);
  const shift = (T: number) => T + D;
  return {
    ...base,
    duration: base.duration + D,
    marks: {
      reveal: shift(base.marks.reveal),
      chase: shift(base.marks.chase),
      finish: shift(base.marks.finish),
      pullback: shift(base.marks.pullback),
      end: shift(base.marks.end),
    },
    moments: base.moments.map((m) => ({ m: m.m, T: shift(m.T) })),
    frame(T: number): FrameState {
      if (T >= D) return { ...base.frame(T - D), T };
      // Nothing on screen yet but the Earth: the title and markers wait for the opening shot.
      return {
        ...first,
        T,
        camera: introCamera(first.camera, T / D),
        moment: null,
        fx: { ...first.fx, title: 0, marker: 0, start: 0, hud: 0, finish: 0, burst: 0, summary: 0 },
      };
    },
    timeAtIndex: (i: number) => shift(base.timeAtIndex(i)),
  };
}
