// The flyover HUD, drawn on a 2D canvas. The same function draws the live preview overlay and
// every exported video frame and poster, so what you see is what you share.
//
// Rules: 1–2 focal motions plus the HUD; numbers in tabular figures, updated at 10 Hz;
// labels uppercase with +0.08em tracking; time compression and terrain exaggeration always
// disclosed; on 9:16 the top 12% and bottom 18% stay clear of key content.

import type { Analysis } from "../analysis/types";
import { atIndex } from "../analysis/series";
import { type GhostRunner, gapWords, ghostsAt } from "../playback/ghosts";
import type { PhotoPage } from "../playback/photoStops";
import { type Rect, photoLayout } from "./photoLayout";
import {
  formatClock,
  formatDate,
  formatDistance,
  formatDuration,
  formatElevation,
  formatMotion,
  formatPace,
  formatSpeed,
  motionLabel,
  unitLabel,
  usesPace,
} from "../format/format";
import type { LngLat } from "../geo/geo";
import { RAMPS, zoneIndex } from "../map/route";
import type { Look } from "../map/style";
import type { FrameState } from "../playback/timeline";
import { SPORTS } from "../sport";
import { DEFAULT_END, DEFAULT_LIVE, type EndStat, type LiveStat, pickEnd, pickLive } from "./stats";
import { type Weather, formatTemp, weatherAt, weatherSummary, weatherText } from "../weather";

// The app's typeface, so overlays and exports match the interface. Titles are Inter at a heavier weight.
export const FONT_SANS = '"Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
export const FONT_DISPLAY = FONT_SANS;
export const FONT_SERIF = '"Fraunces Variable", Fraunces, Georgia, "Times New Roman", serif';
/** Fraunces ships one weight (600); Inter titles are set heavy. */
const titleWeight = (family: string) => (family === FONT_SERIF ? 600 : 800);

/**
 * Fonts the HUD needs; await before exporting so the first frames don't use a fallback. With a
 * look, Fraunces (only used by serif looks) is skipped unless that look needs it.
 */
export async function loadHudFonts(look?: Look) {
  if (typeof document === "undefined" || !document.fonts) return;
  await Promise.allSettled([
    document.fonts.load(`600 40px "Inter Variable"`),
    document.fonts.load(`500 20px "Inter Variable"`),
    document.fonts.load(`800 80px "Inter Variable"`),
    ...(!look || look.titleFont === "serif" ? [document.fonts.load(`600 60px "Fraunces Variable"`)] : []),
  ]);
}

export interface HudOptions {
  look: Look;
  /** Route accent (progress, rules). */
  accent: string;
  stats: boolean;
  endCard: boolean;
  attribution: string;
  /** Terrain exaggeration in use (disclosed when ≠ 1). */
  exaggeration: number;
  /** Route point → canvas pixels (null when off-screen). */
  project?: (at: LngLat) => [number, number] | null;
  /** Draw the poster layout (end card only, larger) instead of the live HUD. */
  poster?: boolean;
  /** Canvas pixels to keep clear at the bottom (e.g. the live map's attribution control). */
  bottomInset?: number;
  /** Values in the live panel and on the end card (defaults: DEFAULT_LIVE / DEFAULT_END). */
  liveStats?: readonly LiveStat[];
  endStats?: readonly EndStat[];
  /** Label highlights (fastest mile, climbs…) on the map as the athlete passes them (default on). */
  highlights?: boolean;
  /** Weather during the activity, for the temperature / weather stats (when the user turned it on). */
  weather?: Weather | null;
  /** Earlier runs of the route to race (ghost race). */
  ghosts?: readonly GhostRunner[] | null;
  /** Photo stops: pages of photos that take over the screen while the flyover holds. */
  photoPages?: readonly PhotoPage[] | null;
}

interface Palette {
  hi: string;
  mid: string;
  lo: string;
  panel: string;
  panelLine: string;
  scrim: string;
}

const PALETTES: Record<"dark" | "light", Palette> = {
  dark: { hi: "#f4f5f6", mid: "#a0a6ae", lo: "#5b6068", panel: "rgba(14,16,20,0.72)", panelLine: "rgba(255,255,255,0.08)", scrim: "7,8,10" },
  light: { hi: "#121314", mid: "#55524a", lo: "#9a958a", panel: "rgba(255,255,255,0.82)", panelLine: "rgba(0,0,0,0.08)", scrim: "244,241,234" },
};

export function drawHud(ctx: CanvasRenderingContext2D, W: number, H: number, a: Analysis, f: FrameState, o: HudOptions) {
  const P = PALETTES[o.look.hud];
  const s = Math.min(W, H) / 1080;
  const portrait = H > W * 1.2;
  const pad = 48 * s;
  // 9:16 safe areas: keep key content between 12% and 82% of the height, and above any
  // attribution drawn by the map underneath (bottomInset).
  const safeTop = portrait ? H * 0.12 : pad;
  const safeBottom = Math.min(portrait ? H * 0.82 : H - pad, H - (o.bottomInset ?? 0));
  const titleFont = o.look.titleFont === "serif" ? FONT_SERIF : FONT_DISPLAY;
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";

  if (o.poster) {
    drawEndCard(ctx, W, H, s, a, 1, o, P, titleFont, portrait, safeTop, safeBottom, true);
    drawFooter(ctx, W, H, s, o, P);
    ctx.restore();
    return;
  }

  // No full-frame scrims (they read as a black border): numbers sit on glass panels, and loose
  // text gets a soft shadow so it holds up on any basemap.
  if (o.project && o.ghosts?.length && !a.privacy.empty) drawGhosts(ctx, s, a, f, o, P);
  if (o.project && !a.privacy.empty) drawMarkers(ctx, s, a, f, o);
  if (f.fx.title > 0) drawTitle(ctx, W, H, s, a, f.fx.title, o, P, titleFont, portrait, safeTop, safeBottom);
  if (f.fx.start > 0 && o.project) {
    const p = o.project(start(a));
    if (p) chip(ctx, p, "START", f.fx.start, s, P, o.accent);
  }
  if (o.stats && f.fx.hud > 0 && !a.privacy.empty) drawStats(ctx, W, H, s, a, f, o, P, portrait, pad, safeBottom);
  if (f.moment && f.fx.hud > 0 && o.highlights !== false) drawMoment(ctx, W, s, a, f, o, P);
  if (f.fx.finish > 0) drawFinish(ctx, W, s, a, f.fx.finish, o, P, titleFont, safeTop, portrait);
  if (f.shot === "chase" || f.shot === "reveal") drawDisclosure(ctx, W, s, f, o, P, pad, safeTop, portrait);
  if (o.endCard && f.fx.summary > 0) drawEndCard(ctx, W, H, s, a, f.fx.summary, o, P, titleFont, portrait, safeTop, safeBottom, false);
  if (o.photoPages?.length) drawPhotoStop(ctx, W, H, s, a, f.T, o.photoPages, portrait, pad, safeTop, safeBottom);
  drawFooter(ctx, W, H, s, o, P);
  ctx.restore();
}

/**
 * A still for the export settings preview: title, the live stats (when enabled) and the footer,
 * all at once. On wide frames the title is lifted above the stats panel so both read.
 */
export function drawPreviewHud(ctx: CanvasRenderingContext2D, W: number, H: number, a: Analysis, f: FrameState, o: HudOptions) {
  const P = PALETTES[o.look.hud];
  const s = Math.min(W, H) / 1080;
  const portrait = H > W * 1.2;
  const pad = 48 * s;
  const safeTop = portrait ? H * 0.12 : pad;
  const safeBottom = portrait ? H * 0.82 : H - pad;
  const titleFont = o.look.titleFont === "serif" ? FONT_SERIF : FONT_DISPLAY;
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  // Portrait: the title moves up to the top of the safe area, leaving the middle to the route.
  let lift = portrait ? (safeBottom - safeTop) * 0.36 - 110 * s : 0;
  if (o.stats && !a.privacy.empty) {
    drawStats(ctx, W, H, s, a, f, o, P, portrait, pad, safeBottom);
    if (!portrait) {
      const items = liveItems(a, f.statsIndex, o.liveStats, o.weather).length;
      const cols = W < H * 1.3 ? 3 : items;
      const panelTop = safeBottom - (Math.ceil(items / cols) * 108 * s + 74 * s + 40 * s);
      lift = Math.max(0, H - 129 * s - (panelTop - 28 * s));
    }
  }
  ctx.save();
  ctx.translate(0, -lift);
  drawTitle(ctx, W, H, s, a, 1, o, P, titleFont, portrait, safeTop, safeBottom);
  ctx.restore();
  drawDisclosure(ctx, W, s, f, o, P, pad, safeTop, portrait);
  drawFooter(ctx, W, H, s, o, P);
  ctx.restore();
}

// --- Pieces ------------------------------------------------------------------------------------

const HALO = "#3db8ff";
const START_PIN = "#57c785";

/**
 * Map markers, drawn here rather than as map layers so a frame never waits on map data updates:
 * start and finish pins, the moment pin, the athlete marker with its 1.2 s halo pulse, and the
 * finish burst. Sizes match the old map layers (7 CSS px core at 1080p ≈ 14 canvas px).
 */
function drawMarkers(ctx: CanvasRenderingContext2D, s: number, a: Analysis, f: FrameState, o: HudOptions) {
  const project = o.project!;
  const u = 2 * s; // one CSS px of the export map
  const pin = (at: LngLat, fill: string, r: number, alpha = 1) => {
    const p = project(at);
    if (!p || alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(p[0], p[1], r * u, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2 * u;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.restore();
  };
  const ended = f.shot === "finish" || f.shot === "pullback" || f.shot === "end";
  const first = a.samples[a.privacy.from];
  const last = a.samples[a.privacy.to];
  pin([first.lon, first.lat], START_PIN, 6);
  if (ended) pin([last.lon, last.lat], "#111111", 6);
  if (f.moment && o.highlights !== false) pin(momentPoint(a, f.moment.m.at), o.accent, 5, f.moment.alpha);

  if (f.fx.burst > 0 && f.fx.burst < 1) {
    const p = project([last.lon, last.lat]);
    if (p) {
      ctx.save();
      ctx.globalAlpha = 1 - f.fx.burst;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.arc(p[0], p[1], (8 + 52 * f.fx.burst) * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  const m = f.fx.marker;
  if (m <= 0 || f.shot === "pullback" || f.shot === "end" || !a.privacy.visible[Math.round(f.index)]) return;
  const p = project(f.head);
  if (!p) return;
  ctx.save();
  // Soft shadow, pulsing halo, then the white core.
  const shadow = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], 12 * u);
  shadow.addColorStop(0, "rgba(0,0,0,0.4)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(p[0], p[1], 12 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.5 * (1 - f.fx.pulse) * m;
  ctx.fillStyle = HALO;
  ctx.beginPath();
  ctx.arc(p[0], p[1], (9 + 17 * f.fx.pulse) * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = m;
  ctx.beginPath();
  ctx.arc(p[0], p[1], 7 * (0.4 + 0.6 * m) * u, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 1.5 * u;
  ctx.strokeStyle = "#07080a";
  ctx.stroke();
  ctx.restore();
}

/**
 * Ghost runners: a translucent dot per earlier run where it was at your moving time, with a small
 * label saying how far ahead or behind it is at the same point of the route.
 */
function drawGhosts(ctx: CanvasRenderingContext2D, s: number, a: Analysis, f: FrameState, o: HudOptions, P: Palette) {
  const m = f.fx.marker;
  if (m <= 0 || f.shot === "pullback" || f.shot === "end") return;
  const u = 2 * s;
  for (const { g, at, gap } of ghostsAt(a, o.ghosts!, f.index)) {
    const p = at && o.project!(at);
    if (!p) continue;
    ctx.save();
    ctx.globalAlpha = 0.85 * m;
    ctx.beginPath();
    ctx.arc(p[0], p[1], 6 * u, 0, Math.PI * 2);
    ctx.fillStyle = g.color;
    ctx.fill();
    ctx.lineWidth = 1.5 * u;
    ctx.strokeStyle = "#07080a";
    ctx.stroke();
    // Label to the right of the dot: the run, then the gap.
    const label = g.label.toUpperCase();
    const words = gapWords(gap);
    ctx.font = `700 ${13 * s}px ${FONT_SANS}`;
    const lw = ctx.measureText(label).width + label.length * 13 * s * 0.08;
    ctx.font = `600 ${17 * s}px ${FONT_SANS}`;
    const ww = ctx.measureText(words).width;
    const h = 34 * s;
    const w = 14 * s + lw + 10 * s + ww + 14 * s;
    const x = p[0] + 12 * u;
    const y = p[1] - h / 2;
    ctx.globalAlpha = 0.95 * m * f.fx.hud;
    panel(ctx, x, y, w, h, h / 2, P);
    spaced(ctx, label, x + 14 * s, y + h * 0.63, 13 * s, g.color, 700);
    ctx.fillStyle = P.hi;
    ctx.font = `600 ${17 * s}px ${FONT_SANS}`;
    ctx.textAlign = "left";
    ctx.fillText(words, x + 14 * s + lw + 10 * s, y + h * 0.67);
    ctx.restore();
  }
}

// --- Photo stops ----------------------------------------------------------------------------------

type Img = CanvasImageSource & { width: number; height: number };

/** Fade between pages, and in from / out to the map, seconds. */
const PAGE_FADE = 0.3;

/** Draws an image filling `r` (cropped to fit), slowly zooming in over `t` (0–1). */
function coverImage(ctx: CanvasRenderingContext2D, img: Img, r: Rect, radius: number, t: number) {
  const k = Math.max(r.w / img.width, r.h / img.height) * (1 + 0.04 * t);
  const w = img.width * k;
  const h = img.height * k;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, radius);
  ctx.clip();
  ctx.drawImage(img, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h);
  ctx.restore();
}

/** Layouts per page and frame size (the search runs once, not every frame). */
const layoutCache = new WeakMap<PhotoPage, { key: string; rects: Rect[] }>();

/** One page: the photos whole, laid out to fill the frame, over a blurred copy of the first. */
function drawPhotoPage(ctx: CanvasRenderingContext2D, W: number, H: number, s: number, page: PhotoPage, t: number, box: Rect) {
  const imgs = page.photos.map((p) => p.image);
  // Backdrop: the (first) photo blurred and dimmed, filling the frame; plain dark where the
  // browser can't filter a canvas.
  ctx.fillStyle = "#08090b";
  ctx.fillRect(0, 0, W, H);
  if ("filter" in ctx) {
    ctx.save();
    ctx.filter = `blur(${Math.round(40 * s)}px) brightness(${imgs.length > 1 ? 0.3 : 0.45})`;
    coverImage(ctx, imgs[0], { x: -60 * s, y: -60 * s, w: W + 120 * s, h: H + 120 * s }, 0, t);
    ctx.restore();
  }
  const key = `${box.x},${box.y},${box.w},${box.h}`;
  let cached = layoutCache.get(page);
  if (cached?.key !== key) {
    cached = { key, rects: photoLayout(imgs.map((im) => im.width / im.height), box, 14 * s) };
    layoutCache.set(page, cached);
  }
  const rects = cached.rects;
  rects.forEach((r, k) => {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 30 * s;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, 10 * s);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.restore();
    // A slow push-in inside each photo's own frame.
    coverImage(ctx, imgs[k], r, 10 * s, t * 0.6);
  });
}

/**
 * The photo stop at video time T, if any: the page full screen, cross-fading between pages and
 * in from (out to) the held map, with where and when it was taken underneath.
 */
function drawPhotoStop(ctx: CanvasRenderingContext2D, W: number, H: number, s: number, a: Analysis, T: number, pages: readonly PhotoPage[], portrait: boolean, pad: number, safeTop: number, safeBottom: number) {
  const k = pages.findIndex((p) => T >= p.start && T < p.start + p.duration);
  if (k < 0) return;
  const page = pages[k];
  const t = T - page.start;
  const caption = 68 * s;
  const box: Rect = portrait
    ? { x: pad * 0.6, y: safeTop, w: W - pad * 1.2, h: safeBottom - safeTop - caption }
    : { x: pad, y: pad, w: W - 2 * pad, h: H - 2 * pad - caption };
  const first = page.page === 1;
  const last = page.page === page.pages;
  const fadeIn = Math.min(1, t / PAGE_FADE);
  const fadeOut = last ? Math.min(1, (page.duration - t) / PAGE_FADE) : 1;
  ctx.save();
  // Cross-fade from the previous page of the same stop (it stays put underneath).
  if (!first && fadeIn < 1) drawPhotoPage(ctx, W, H, s, pages[k - 1], 1, box);
  ctx.globalAlpha = Math.min(fadeIn, fadeOut);
  drawPhotoPage(ctx, W, H, s, page, t / page.duration, box);
  // Caption: where on the route and when.
  const sample = a.samples[Math.min(a.n - 1, page.index)];
  const n = page.photos.length;
  const label = [n > 1 ? `${n} PHOTOS` : "PHOTO", formatDistance(a.dist[Math.min(a.n - 1, page.index)], a.settings.units).toUpperCase(), formatClock(sample.time, a.activity.utcOffsetMin).toUpperCase()].join("  ·  ");
  const y = box.y + box.h + caption * 0.68;
  spaced(ctx, label, box.x + 4 * s, y, 20 * s, "rgba(255,255,255,0.9)", 700);
  if (page.pages > 1) spaced(ctx, `${page.page} / ${page.pages}`, box.x + box.w - 4 * s, y, 20 * s, "rgba(255,255,255,0.6)", 700, "right");
  ctx.restore();
}

/** Soft shadow for text drawn straight on the map. */
function textShadow(ctx: CanvasRenderingContext2D, s: number, P: Palette) {
  ctx.shadowColor = `rgba(${P.scrim},0.75)`;
  ctx.shadowBlur = 14 * s;
  ctx.shadowOffsetY = 2 * s;
}

function drawTitle(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  s: number,
  a: Analysis,
  alpha: number,
  o: HudOptions,
  P: Palette,
  titleFont: string,
  portrait: boolean,
  safeTop: number,
  safeBottom: number,
) {
  ctx.save();
  textShadow(ctx, s, P);
  ctx.globalAlpha = alpha;
  const rise = (1 - alpha) * 24 * s;
  const x = portrait ? W / 2 : 64 * s;
  ctx.textAlign = portrait ? "center" : "left";
  const baseY = portrait ? safeTop + (safeBottom - safeTop) * 0.36 : H - 210 * s;
  const title = a.settings.name.toUpperCase();
  const size = fitSize(ctx, title, titleWeight(titleFont), (portrait ? 110 : 100) * s, 44 * s, W - 128 * s, titleFont);
  ctx.fillStyle = P.hi;
  ctx.font = `${titleWeight(titleFont)} ${size}px ${titleFont}`;
  ctx.fillText(truncate(ctx, title, W - 128 * s), x, baseY + rise);
  const act = a.activity;
  const line = act.routeOnly
    ? `ROUTE · ${formatDistance(a.summary.distance, a.settings.units)}`
    : `${formatDate(act.startTime, act.utcOffsetMin).toUpperCase()} · ${formatClock(act.startTime, act.utcOffsetMin)} · ${formatDistance(a.summary.distance, a.settings.units)}`;
  spaced(ctx, line, x, baseY + 52 * s + rise, 22 * s, P.mid, 600, portrait ? "center" : "left");
  ctx.fillStyle = o.accent;
  const rw = 72 * s;
  ctx.fillRect(portrait ? W / 2 - rw / 2 : x, baseY + 76 * s + rise, rw * alpha, 5 * s);
  ctx.restore();
}

function drawStats(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  s: number,
  a: Analysis,
  f: FrameState,
  o: HudOptions,
  P: Palette,
  portrait: boolean,
  pad: number,
  safeBottom: number,
) {
  const alpha = f.fx.hud;
  const items = liveItems(a, f.statsIndex, o.liveStats, o.weather);
  const square = !portrait && W < H * 1.3;
  const cols = portrait || square ? 3 : items.length;
  const rows = Math.ceil(items.length / cols);
  const cellH = 108 * s;
  const stripH = 74 * s;
  const panelW = portrait || square ? W - 2 * pad : Math.min(W - 2 * pad, 1280 * s);
  const panelH = rows * cellH + stripH + 40 * s;
  const x0 = pad;
  const slide = (1 - alpha) * 40 * s;
  const y0 = safeBottom - panelH + slide;
  ctx.save();
  ctx.globalAlpha = alpha;
  panel(ctx, x0, y0, panelW, panelH, 22 * s, P);
  const cellW = (panelW - 32 * s) / cols;
  items.forEach((it, k) => {
    const cx = x0 + 16 * s + (k % cols) * cellW + 16 * s;
    const cy = y0 + 20 * s + Math.floor(k / cols) * cellH;
    spaced(ctx, it.label, cx, cy + 26 * s, 17 * s, P.mid, 600);
    if (it.dot) {
      ctx.fillStyle = it.dot;
      ctx.beginPath();
      ctx.arc(cx + ctx.measureText(it.label).width + it.label.length * 1.4 * s + 14 * s, cy + 20 * s, 6 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = P.hi;
    ctx.font = `600 ${Math.min(52 * s, cellW / 4.4)}px ${FONT_SANS}`;
    const w = tabular(ctx, it.value, cx, cy + 82 * s);
    if (it.unit) {
      ctx.font = `500 ${20 * s}px ${FONT_SANS}`;
      ctx.fillStyle = P.mid;
      ctx.fillText(it.unit, cx + w + 6 * s, cy + 82 * s);
    }
  });
  drawStrip(ctx, a, f.index, x0 + 32 * s, y0 + rows * cellH + 24 * s, panelW - 64 * s, stripH - 10 * s, s, o.accent, P);
  ctx.restore();
}

interface Item {
  label: string;
  value: string;
  unit?: string;
  dot?: string;
}

/** Live HUD values at a (10 Hz) marker index, for the chosen stats the activity has. */
function liveItems(a: Analysis, i: number, chosen: readonly LiveStat[] = DEFAULT_LIVE, weather?: Weather | null): Item[] {
  const u = a.settings.units;
  const kind = a.activity.kind;
  const unit = unitLabel(u);
  const k = Math.min(a.n - 1, Math.max(0, Math.round(i)));
  const out: Item[] = [];
  for (const key of pickLive(a, chosen, weather)) {
    if (key === "time") out.push({ label: "TIME", value: formatDuration(atIndex(a.t, i)) });
    else if (key === "moving") out.push({ label: "MOVING", value: formatDuration(atIndex(a.movingTime, i)) });
    else if (key === "distance") out.push({ label: "DISTANCE", value: (atIndex(a.dist, i) / (u === "metric" ? 1000 : 1609.344)).toFixed(2), unit });
    else if (key === "motion") {
      const v = atIndex(a.speedLive, i);
      const moving = a.moving[Math.min(a.n - 2, Math.floor(i))] === 1 && v > 0.5;
      const pace = usesPace(kind);
      out.push({
        label: motionLabel(kind).toUpperCase(),
        value: !moving || i <= a.privacy.from ? "—" : pace ? formatPace(1000 / v, u, false) : formatSpeed(v, u, false),
        unit: !moving && i > a.privacy.from ? "paused" : pace ? `/${unit}` : u === "metric" ? "km/h" : "mph",
      });
    } else if (key === "hr") {
      const hr = atIndex(a.hr, i);
      const z = Number.isFinite(hr) ? zoneIndex(a, hr) : -1;
      out.push({
        label: z >= 0 ? `HR · Z${z + 1}` : "HR",
        value: Number.isFinite(hr) ? String(Math.round(hr)) : "—",
        unit: "bpm",
        dot: z >= 0 ? RAMPS.zone.dark[z] : undefined,
      });
    } else if (key === "elev") {
      out.push({ label: "ELEV", value: formatElevation(atIndex(a.elev!, i), u).split(" ")[0], unit: u === "metric" ? "m" : "ft" });
    } else if (key === "grade") {
      const g = atIndex(a.grade!, i) * 100;
      out.push({ label: "GRADE", value: `${g > 0.5 ? "+" : g < -0.5 ? "−" : ""}${Math.abs(Math.round(g))}`, unit: "%" });
    } else if (key === "cadence") {
      const c = atIndex(a.cadence!, i);
      out.push({ label: "CADENCE", value: Number.isFinite(c) && c > 0 ? String(Math.round(c)) : "—", unit: SPORTS[kind].footCadence ? "spm" : "rpm" });
    } else if (key === "power") {
      // A few seconds' average: single-second power jumps too much to read.
      let sum = 0;
      let cnt = 0;
      for (let j = Math.max(0, k - 3); j <= Math.min(a.n - 1, k + 3); j++) {
        const p = a.samples[j].power;
        if (p !== undefined) {
          sum += p;
          cnt++;
        }
      }
      out.push({ label: "POWER", value: cnt ? String(Math.round(sum / cnt)) : "—", unit: "W" });
    } else if (key === "temp" && weather) {
      const t = formatTemp(weatherAt(weather, a.samples[k].time).temp, u);
      out.push({ label: "TEMP", value: t.replace(/°[CF]$/, "°"), unit: t === "—" ? undefined : u === "metric" ? "C" : "F" });
    }
  }
  return out;
}

const rangeCache = new WeakMap<Analysis, { lo: number; hi: number }>();
const stripCache = new WeakMap<Analysis, { key: string; path: Path2D }>();

/** Elevation range for the profile strip (computed once per analysis). */
function elevRange(a: Analysis) {
  let r = rangeCache.get(a);
  if (r) return r;
  let lo = 0;
  let hi = 1;
  if (a.elev) {
    lo = Infinity;
    hi = -Infinity;
    for (const v of a.elev) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    // Small hills: keep at least 10 m of range so noise doesn't look like mountains.
    if (hi - lo < 10) {
      const mid = (hi + lo) / 2;
      lo = mid - 5;
      hi = mid + 5;
    }
  }
  r = { lo, hi };
  rangeCache.set(a, r);
  return r;
}

/** Elevation profile strip with the playhead; the y-range is labeled because it's truncated. */
function drawStrip(ctx: CanvasRenderingContext2D, a: Analysis, index: number, x: number, y: number, w: number, h: number, s: number, accent: string, P: Palette) {
  const total = a.dist[a.n - 1] || 1;
  const e = a.elev;
  const { lo, hi } = elevRange(a);
  const stride = Math.max(1, Math.floor(a.n / 400));
  const px = (i: number) => x + (a.dist[i] / total) * w;
  const py = (i: number) => (e ? y + h - ((e[i] - lo) / (hi - lo)) * h * 0.9 : y + h * 0.6);
  const path = (upTo: number) => {
    ctx.beginPath();
    ctx.moveTo(px(0), y + h);
    for (let i = 0; i <= upTo; i += stride) ctx.lineTo(px(i), py(i));
    ctx.lineTo(px(upTo), py(upTo));
    ctx.lineTo(px(upTo), y + h);
    ctx.closePath();
  };
  const now = Math.min(a.n - 1, Math.max(0, Math.round(index)));
  // The full-profile background never changes during playback: build its path once.
  const key = `${x}|${y}|${w}|${h}`;
  const cache = stripCache.get(a);
  let bg = cache?.key === key ? cache.path : null;
  if (!bg) {
    bg = new Path2D();
    bg.moveTo(px(0), y + h);
    for (let i = 0; i <= a.n - 1; i += stride) bg.lineTo(px(i), py(i));
    bg.lineTo(px(a.n - 1), py(a.n - 1));
    bg.lineTo(px(a.n - 1), y + h);
    bg.closePath();
    stripCache.set(a, { key, path: bg });
  }
  ctx.fillStyle = withAlpha(P.lo, 0.35);
  ctx.fill(bg);
  path(now);
  ctx.fillStyle = withAlpha(accent, 0.45);
  ctx.fill();
  // Playhead
  const hx = px(now);
  ctx.strokeStyle = P.hi;
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(hx, y - 4 * s);
  ctx.lineTo(hx, y + h);
  ctx.stroke();
  ctx.fillStyle = P.hi;
  ctx.beginPath();
  ctx.arc(hx, py(now), 5 * s, 0, Math.PI * 2);
  ctx.fill();
  if (e) {
    ctx.font = `500 ${15 * s}px ${FONT_SANS}`;
    ctx.fillStyle = P.mid;
    ctx.textAlign = "right";
    const u = a.settings.units;
    ctx.fillText(`${formatElevation(lo, u)}–${formatElevation(hi, u)}`, x + w, y - 6 * s);
    ctx.textAlign = "left";
  }
}

/**
 * A highlight (fastest mile, a climb, a rep…) as a compact label pinned just above its spot on the
 * map, with a short stem, instead of a card in the corner with a long leader line. Skipped while
 * the spot is off screen.
 */
function drawMoment(ctx: CanvasRenderingContext2D, W: number, s: number, a: Analysis, f: FrameState, o: HudOptions, P: Palette) {
  const { m, alpha } = f.moment!;
  const p = o.project?.(momentPoint(a, m.at));
  if (!p) return;
  const tone = m.hero ? o.accent : P.mid;
  ctx.save();
  ctx.globalAlpha = alpha * f.fx.hud;
  ctx.font = `700 ${15 * s}px ${FONT_SANS}`;
  const labelW = ctx.measureText(m.label).width + m.label.length * 15 * s * 0.08;
  ctx.font = `600 ${28 * s}px ${FONT_SANS}`;
  const valueW = ctx.measureText(m.value).width;
  const h = 52 * s;
  const w = 24 * s + labelW + 12 * s + valueW + 24 * s;
  const x = Math.min(Math.max(p[0] - w / 2, 16 * s), W - w - 16 * s);
  const rise = (1 - alpha) * 8 * s;
  // Above the spot, or below it when there's no room near the top of the frame.
  const above = p[1] - h - 40 * s > 16 * s;
  const y = (above ? p[1] - h - 40 * s : p[1] + 40 * s) + (above ? rise : -rise);
  ctx.strokeStyle = tone;
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(p[0], above ? y + h : y);
  ctx.lineTo(p[0], above ? p[1] - 8 * s : p[1] + 8 * s);
  ctx.stroke();
  panel(ctx, x, y, w, h, h / 2, P);
  spaced(ctx, m.label, x + 24 * s, y + h * 0.62, 15 * s, tone, 700);
  ctx.fillStyle = P.hi;
  ctx.font = `600 ${28 * s}px ${FONT_SANS}`;
  ctx.textAlign = "left";
  ctx.fillText(m.value, x + 24 * s + labelW + 12 * s, y + h * 0.68);
  ctx.restore();
}

function drawFinish(ctx: CanvasRenderingContext2D, W: number, s: number, a: Analysis, alpha: number, o: HudOptions, P: Palette, titleFont: string, safeTop: number, portrait: boolean) {
  ctx.save();
  textShadow(ctx, s, P);
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  const y = safeTop + (portrait ? 120 : 110) * s - (1 - alpha) * 16 * s;
  spaced(ctx, "FINISH", W / 2, y, 24 * s, o.accent, 700, "center");
  if (!a.activity.routeOnly) {
    ctx.fillStyle = P.hi;
    ctx.font = `${titleWeight(titleFont)} ${88 * s}px ${titleFont}`;
    tabular(ctx, formatDuration(a.summary.elapsed), W / 2, y + 92 * s, "center");
    spaced(ctx, `${formatDuration(a.summary.moving)} MOVING`, W / 2, y + 128 * s, 17 * s, P.mid, 600, "center");
    // Ghost race result, one line per ghost, by moving time.
    if (o.ghosts?.length) {
      ghostsAt(a, o.ghosts, a.n - 1).forEach(({ g, gap }, k) => {
        const secs = Math.round(Math.abs(gap));
        const t = secs < 60 ? `${secs} S` : formatDuration(secs);
        const text = secs < 1 ? `LEVEL WITH ${g.label.toUpperCase()}` : `${t} ${gap < 0 ? "FASTER" : "SLOWER"} THAN ${g.label.toUpperCase()}`;
        spaced(ctx, text, W / 2, y + (160 + 28 * k) * s, 17 * s, g.color, 700, "center");
      });
    }
  }
  ctx.restore();
}

function drawDisclosure(ctx: CanvasRenderingContext2D, W: number, s: number, f: FrameState, o: HudOptions, P: Palette, pad: number, safeTop: number, portrait: boolean) {
  const parts: string[] = [];
  if (f.rate > 1.5) parts.push(`TIME ×${Math.round(f.rate)}`);
  if (Math.abs(o.exaggeration - 1) > 0.01) parts.push(`TERRAIN ×${o.exaggeration.toFixed(1)}`);
  if (!parts.length) return;
  const text = parts.join("  ·  ");
  const y = portrait ? safeTop - 16 * s : pad + 14 * s;
  const top = Math.floor(y - 40 * s);
  ctx.save();
  ctx.globalAlpha = f.fx.hud * 0.9;
  // The text changes only when the rounded rate does: stamp a cached rendering (shadow included).
  stamp(ctx, `disclosure|${W}|${text}|${y}|${P.mid}|${P.scrim}`, 0, top, W, Math.ceil(70 * s), (c) => {
    c.save();
    textShadow(c, s, P);
    spaced(c, text, W - pad, y, 15 * s, P.mid, 600, "right");
    c.restore();
  });
  ctx.restore();
}

function drawEndCard(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  s: number,
  a: Analysis,
  alpha: number,
  o: HudOptions,
  P: Palette,
  titleFont: string,
  portrait: boolean,
  safeTop: number,
  safeBottom: number,
  poster: boolean,
) {
  ctx.save();
  ctx.globalAlpha = alpha;

  const stats = endStats(a, o.endStats, o.weather);
  const cols = portrait ? 2 : Math.min(stats.length, W > H * 1.3 ? 5 : 3);
  const rows = Math.ceil(stats.length / cols);
  const pad = 64 * s;
  const cellW = (W - 2 * pad) / cols;
  const cellH = 118 * s;
  const stripH = 90 * s;
  const blockH = 210 * s + rows * cellH + stripH;
  const top = Math.max(safeTop, safeBottom - blockH);
  const lift = (1 - alpha) * 30 * s;

  ctx.textAlign = "left";
  ctx.fillStyle = P.hi;
  const size = (portrait ? 76 : 68) * s * (poster ? 1.1 : 1);
  ctx.font = `${titleWeight(titleFont)} ${size}px ${titleFont}`;
  // The activity's own title leads; the stats below tell the story.
  const lines = wrap(ctx, a.settings.name, W - 2 * pad, 2);
  // One glass card behind the summary: the lit route stays fully visible above it.
  const cardTop = top - 30 * s + lift;
  const cardBottom = top + size * lines.length + 90 * s + rows * cellH + stripH + lift;
  panel(ctx, pad * 0.5, cardTop, W - pad, cardBottom - cardTop, 26 * s, P);
  ctx.fillStyle = P.hi;
  ctx.font = `${titleWeight(titleFont)} ${size}px ${titleFont}`;
  lines.forEach((l, k) => ctx.fillText(l, pad, top + size * (k + 0.9) + lift));
  const subY = top + size * lines.length + 34 * s + lift;
  const act = a.activity;
  spaced(
    ctx,
    act.routeOnly ? "ROUTE" : `${formatDate(act.startTime, act.utcOffsetMin).toUpperCase()} · ${formatClock(act.startTime, act.utcOffsetMin)}`,
    pad,
    subY,
    18 * s,
    P.mid,
    600,
  );
  ctx.fillStyle = o.accent;
  ctx.fillRect(pad, subY + 20 * s, 72 * s, 5 * s);

  const gy = subY + 56 * s;
  stats.forEach((st, k) => {
    const cx = pad + (k % cols) * cellW;
    const cy = gy + Math.floor(k / cols) * cellH;
    spaced(ctx, st.label, cx, cy + 22 * s, 16 * s, P.mid, 600);
    ctx.fillStyle = P.hi;
    ctx.font = `600 ${Math.min(58 * s, cellW / 4.2)}px ${FONT_SANS}`;
    const w = tabular(ctx, st.value, cx, cy + 82 * s);
    if (st.unit) {
      ctx.font = `500 ${20 * s}px ${FONT_SANS}`;
      ctx.fillStyle = P.mid;
      ctx.fillText(st.unit, cx + w + 6 * s, cy + 82 * s);
    }
  });
  drawStrip(ctx, a, a.n - 1, pad, gy + rows * cellH + 10 * s, W - 2 * pad, stripH - 30 * s, s, o.accent, P);
  ctx.restore();
}

/** End-card summary, for the chosen stats the activity has (default: distance, total time, avg pace, gain, avg HR). */
function endStats(a: Analysis, chosen: readonly EndStat[] = DEFAULT_END, weather?: Weather | null): Item[] {
  const sm = a.summary;
  const u = a.settings.units;
  const kind = a.activity.kind;
  const split = (text: string) => {
    const [value, ...rest] = text.split(" ");
    return { value, unit: rest.join(" ") || undefined };
  };
  const out: Item[] = [];
  for (const key of pickEnd(a, chosen, weather)) {
    if (key === "distance") out.push({ label: "DISTANCE", value: (sm.distance / (u === "metric" ? 1000 : 1609.344)).toFixed(2), unit: unitLabel(u) });
    else if (key === "total") out.push({ label: "TOTAL TIME", value: formatDuration(sm.elapsed) });
    else if (key === "moving") out.push({ label: "MOVING TIME", value: formatDuration(sm.moving) });
    else if (key === "stopped") out.push({ label: "STOPPED", value: formatDuration(sm.stoppedTime) });
    else if (key === "avg") out.push({ label: `AVG ${motionLabel(kind).toUpperCase()}`, ...split(formatMotion(sm.avgSpeed, kind, u)) });
    else if (key === "best")
      out.push(
        usesPace(kind)
          ? { label: "BEST PACE", value: formatPace(sm.bestPace, u, false), unit: `/${unitLabel(u)}` }
          : { label: "MAX SPEED", value: formatSpeed(sm.maxSpeed, u, false), unit: u === "metric" ? "km/h" : "mph" },
      );
    else if (key === "gain") out.push({ label: "ELEV GAIN", ...split(formatElevation(sm.elevGain!, u)) });
    else if (key === "loss") out.push({ label: "ELEV LOSS", ...split(formatElevation(sm.elevLoss!, u)) });
    else if (key === "high") out.push({ label: "HIGH POINT", ...split(formatElevation(sm.elevMax!, u)) });
    else if (key === "avgHr") out.push({ label: "AVG HR", value: String(Math.round(sm.avgHr!)), unit: "bpm" });
    else if (key === "maxHr") out.push({ label: "MAX HR", value: String(Math.round(sm.maxHr!)), unit: "bpm" });
    else if (key === "cadence") out.push({ label: "AVG CADENCE", value: String(Math.round(sm.avgCadence!)), unit: SPORTS[kind].footCadence ? "spm" : "rpm" });
    else if (key === "power") out.push({ label: "AVG POWER", value: String(Math.round(sm.avgPower!)), unit: "W" });
    else if (key === "np") out.push({ label: "NORM POWER", value: String(Math.round(a.power!.np)), unit: "W" });
    else if (key === "work") out.push({ label: "WORK", value: Math.round(a.power!.work).toLocaleString("en-US"), unit: "kJ" });
    else if (key === "tss") out.push({ label: "TSS", value: String(Math.round(a.power!.tss!)) });
    else if (key === "calories") out.push({ label: "CALORIES", value: Math.round(sm.calories!).toLocaleString("en-US"), unit: "kcal" });
    else if (key === "weather" && weather) {
      const w = weatherSummary(weather, a.samples[0].time, a.samples[a.n - 1].time);
      out.push({ label: "WEATHER", value: formatTemp(w.temp, u), unit: weatherText(w.code).toLowerCase() });
    }
  }
  return out;
}

function drawFooter(ctx: CanvasRenderingContext2D, W: number, H: number, s: number, o: HudOptions, P: Palette) {
  // Identical on every frame: drawn once (shadow and all) and stamped.
  const top = H - 50 * s;
  stamp(ctx, `footer|${W}|${H}|${o.attribution}|${P.mid}|${P.scrim}`, 0, top, W, H - top, (c) => drawFooterText(c, W, H, s, o, P));
}

function drawFooterText(ctx: CanvasRenderingContext2D, W: number, H: number, s: number, o: HudOptions, P: Palette) {
  ctx.save();
  textShadow(ctx, s, P);
  ctx.font = `500 ${14 * s}px ${FONT_SANS}`;
  ctx.fillStyle = withAlpha(P.mid, 0.85);
  ctx.textAlign = "right";
  ctx.fillText(truncate(ctx, o.attribution, W * 0.66), W - 16 * s, H - 16 * s);
  ctx.textAlign = "left";
  spaced(ctx, "ACTIVITY VISUALIZER", 16 * s, H - 16 * s, 13 * s, P.mid, 700);
  ctx.restore();
}

// --- Primitives -------------------------------------------------------------------------------

const start = (a: Analysis): LngLat => {
  const p = a.samples[a.privacy.from];
  return [p.lon, p.lat];
};

function momentPoint(a: Analysis, f: number): LngLat {
  const i = Math.floor(f);
  const j = Math.min(a.n - 1, i + 1);
  const u = f - i;
  return [a.samples[i].lon + (a.samples[j].lon - a.samples[i].lon) * u, a.samples[i].lat + (a.samples[j].lat - a.samples[i].lat) * u];
}

function chip(ctx: CanvasRenderingContext2D, p: [number, number], text: string, alpha: number, s: number, P: Palette, accent: string) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `700 ${16 * s}px ${FONT_SANS}`;
  const w = ctx.measureText(text).width + text.length * 1.3 * s + 28 * s;
  const h = 34 * s;
  const x = p[0] - w / 2;
  const y = p[1] - h - 34 * s - (1 - alpha) * 10 * s;
  ctx.strokeStyle = P.hi;
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(p[0], y + h);
  ctx.lineTo(p[0], p[1] - 10 * s);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  spaced(ctx, text, p[0], y + h * 0.68, 16 * s, "#ffffff", 700, "center");
  ctx.restore();
}

/** Largest font size ≤ max (and ≥ min) at which `text` fits in maxW. */
function fitSize(ctx: CanvasRenderingContext2D, text: string, weight: number, max: number, min: number, maxW: number, family: string) {
  ctx.font = `${weight} ${max}px ${family}`;
  const w = ctx.measureText(text).width;
  return w <= maxW ? max : Math.max(min, (max * maxW) / w);
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, P: Palette) {
  ctx.save();
  ctx.fillStyle = P.panel;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.strokeStyle = P.panelLine;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}


/**
 * Canvas has no font-variant-numeric, so digits are drawn on a fixed advance (the widest digit)
 * to keep numbers from jittering as they change. Returns the drawn width.
 */
export function tabular(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, align: "left" | "center" | "right" = "left"): number {
  const adv = digitAdvance(ctx);
  const widths = [...text].map((ch) => (ch >= "0" && ch <= "9" ? adv : glyphWidth(ctx, ch)));
  const total = widths.reduce((p, q) => p + q, 0);
  let cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
  const prev = ctx.textAlign;
  ctx.textAlign = "left";
  [...text].forEach((ch, k) => {
    const w = widths[k];
    const cw = glyphWidth(ctx, ch);
    ctx.fillText(ch, cx + (w - cw) / 2, y);
    cx += w;
  });
  ctx.textAlign = prev;
  return total;
}

/** Uppercase label with +0.08em tracking, drawn glyph by glyph (letterSpacing isn't everywhere). */
export function spaced(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  weight = 600,
  align: "left" | "center" | "right" = "left",
) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT_SANS}`;
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  const track = size * 0.08;
  const chars = [...text];
  const widths = chars.map((c) => glyphWidth(ctx, c));
  const total = widths.reduce((p, q) => p + q, 0) + track * (chars.length - 1);
  let cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
  chars.forEach((c, k) => {
    ctx.fillText(c, cx, y);
    cx += widths[k] + track;
  });
  ctx.restore();
}

// Glyph widths per font, measured once: the HUD draws the same few characters every frame.
const widthCache = new Map<string, number>();
function glyphWidth(ctx: CanvasRenderingContext2D, ch: string) {
  const key = `${ctx.font}|${ch}`;
  let w = widthCache.get(key);
  if (w === undefined) {
    w = ctx.measureText(ch).width;
    widthCache.set(key, w);
  }
  return w;
}

/** The widest digit in the current font (the fixed advance for tabular figures). */
function digitAdvance(ctx: CanvasRenderingContext2D) {
  const key = `${ctx.font}|#digits`;
  let adv = widthCache.get(key);
  if (adv === undefined) {
    adv = 0;
    for (const d of "0123456789") adv = Math.max(adv, glyphWidth(ctx, d));
    widthCache.set(key, adv);
  }
  return adv;
}

/** Cached renderings of HUD pieces that don't change between frames, keyed by what they show. */
const stamps = new Map<string, HTMLCanvasElement | OffscreenCanvas>();
const MAX_STAMPS = 24;

/**
 * Draws `draw` (in canvas coordinates) once into a cached w×h canvas covering (x, y), then copies
 * that onto ctx: shadow-blurred text costs one image copy per frame instead of a blur per glyph.
 */
function stamp(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const X = Math.floor(x);
  const Y = Math.floor(y);
  const cw = Math.max(1, Math.ceil(w));
  const ch = Math.max(1, Math.ceil(h));
  let canvas = stamps.get(key);
  if (!canvas) {
    canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(cw, ch) : Object.assign(document.createElement("canvas"), { width: cw, height: ch });
    const c = canvas.getContext("2d") as CanvasRenderingContext2D | null;
    if (!c) {
      // No 2D context (out of memory): draw directly.
      draw(ctx);
      return;
    }
    c.translate(-X, -Y);
    c.textBaseline = ctx.textBaseline;
    c.lineJoin = ctx.lineJoin;
    draw(c);
    if (stamps.size >= MAX_STAMPS) stamps.delete(stamps.keys().next().value!);
    stamps.set(key, canvas);
  }
  ctx.drawImage(canvas, X, Y);
}

function truncate(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, maxLines: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > max && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const head = lines.slice(0, maxLines - 1);
    return [...head, truncate(ctx, lines.slice(maxLines - 1).join(" "), max)];
  }
  return lines;
}

function withAlpha(color: string, alpha: number) {
  if (color.startsWith("#") && color.length === 7) {
    const n = parseInt(color.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  return color;
}
