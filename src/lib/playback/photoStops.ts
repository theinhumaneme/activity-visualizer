// Photo stops: when the athlete reaches a photo, the flyover holds still and the photo takes over
// the screen long enough to see it. Photos taken close together share one stop, laid out as a
// collage (up to four per page); more than that becomes a slideshow of pages.
//
// Implemented as a wrapper around a finished timeline: held time is inserted at each stop and
// everything after it shifts, so the camera path itself is untouched.

import type { FrameState, Timeline } from "./timeline";

export interface StopPhoto {
  image: CanvasImageSource & { width: number; height: number };
  /** Sample index the photo belongs to. */
  index: number;
}

export interface PhotoPage {
  photos: StopPhoto[];
  /** Video time the page starts (on the wrapped timeline). */
  start: number;
  duration: number;
  /** Position of this page in its stop (for "2 / 3"). */
  page: number;
  pages: number;
  /** Sample index the stop is at (for its caption). */
  index: number;
}

/** One photo on screen: long enough to take it in. */
const SINGLE = 2.2;
/** A collage page: more to look at. */
const COLLAGE = 2.9;
const PER_PAGE = 4;
/** Photos passed within this much video time of a stop's first photo join that stop. */
const GROUP_WINDOW = 1.2;

const pageSeconds = (n: number) => (n === 1 ? SINGLE : COLLAGE);

/** Splits a group into pages of at most four, as evenly as possible (5 → 3 + 2, not 4 + 1). */
function paginate<T>(items: T[]): T[][] {
  const pages = Math.ceil(items.length / PER_PAGE);
  const out: T[][] = [];
  let k = 0;
  for (let p = 0; p < pages; p++) {
    const n = Math.ceil((items.length - k) / (pages - p));
    out.push(items.slice(k, k + n));
    k += n;
  }
  return out;
}

/**
 * Roughly how much video time the stops add, before there's a timeline (export length estimate):
 * photos within 2% of the route of each other count as one stop.
 */
export function estimatePhotoSeconds(indices: readonly number[], n: number): number {
  const sorted = [...indices].sort((x, y) => x - y);
  const groups: number[][] = [];
  for (const i of sorted) {
    const g = groups[groups.length - 1];
    if (g && i - g[0] <= n * 0.02) g.push(i);
    else groups.push([i]);
  }
  return groups.reduce((t, g) => t + paginate(g).reduce((u, page) => u + pageSeconds(page.length), 0), 0);
}

/**
 * The timeline with a hold at each photo stop, and the pages to show. The frame during a hold is
 * the frozen frame at the stop.
 */
export function withPhotoStops(base: Timeline, photos: readonly StopPhoto[]): { timeline: Timeline; pages: PhotoPage[] } {
  if (!photos.length) return { timeline: base, pages: [] };
  const sorted = [...photos].sort((x, y) => x.index - y.index);
  // Group by when the marker passes them (base video time), keeping them inside the chase.
  const groups: { T: number; index: number; photos: StopPhoto[] }[] = [];
  for (const p of sorted) {
    const T = Math.min(Math.max(base.timeAtIndex(p.index), base.marks.chase), base.marks.finish);
    const last = groups[groups.length - 1];
    if (last && T - last.T <= GROUP_WINDOW) last.photos.push(p);
    else groups.push({ T, index: p.index, photos: [p] });
  }
  // Holds in base time order; `shift` is the held time inserted before each.
  const holds: { T: number; dur: number; shift: number }[] = [];
  const pages: PhotoPage[] = [];
  let shift = 0;
  for (const g of groups) {
    const split = paginate(g.photos);
    let start = g.T + shift;
    let dur = 0;
    split.forEach((ps, k) => {
      const d = pageSeconds(ps.length);
      pages.push({ photos: ps, start, duration: d, page: k + 1, pages: split.length, index: g.index });
      start += d;
      dur += d;
    });
    holds.push({ T: g.T, dur, shift });
    shift += dur;
  }
  const total = shift;

  /** Wrapped time → base time (frozen during a hold). */
  const toBase = (T: number) => {
    for (const h of holds) {
      const s = h.T + h.shift;
      if (T < s) return T - h.shift;
      if (T < s + h.dur) return h.T;
    }
    return T - total;
  };
  /** Base time → wrapped time (a stop's own moment maps to the start of its hold). */
  const fromBase = (T: number) => {
    let add = 0;
    for (const h of holds) if (T > h.T) add += h.dur;
    return T + add;
  };

  const timeline: Timeline = {
    ...base,
    duration: base.duration + total,
    marks: {
      reveal: fromBase(base.marks.reveal),
      chase: fromBase(base.marks.chase),
      finish: fromBase(base.marks.finish),
      pullback: fromBase(base.marks.pullback),
      end: fromBase(base.marks.end),
    },
    moments: base.moments.map((m) => ({ m: m.m, T: fromBase(m.T) })),
    frame(T: number): FrameState {
      const f = base.frame(toBase(T));
      return { ...f, T };
    },
    timeAtIndex: (i: number) => fromBase(base.timeAtIndex(i)),
  };
  return { timeline, pages };
}
