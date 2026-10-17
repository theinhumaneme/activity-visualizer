// The flyover HUD, drawn on a 2D canvas. The same function draws the live preview overlay and
// every exported video frame and poster, so what you see is what you share.
//
// Rules: 1–2 focal motions plus the HUD; numbers in tabular figures, updated at 10 Hz;
// labels uppercase with +0.08em tracking; time compression and terrain exaggeration always
// disclosed; on 9:16 the top 12% and bottom 18% stay clear of key content.

import type { Analysis } from "../analysis/types";
import { atIndex } from "../analysis/series";
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
  if (o.project && !a.privacy.empty) drawMarkers(ctx, s, a, f, o);
  if (f.fx.title > 0) drawTitle(ctx, W, H, s, a, f.fx.title, o, P, titleFont, portrait, safeTop, safeBottom);
  if (f.fx.start > 0 && o.project) {
    const p = o.project(start(a));
    if (p) chip(ctx, p, "START", f.fx.start, s, P, o.accent);
  }
  if (o.stats && f.fx.hud > 0 && !a.privacy.empty) drawStats(ctx, W, H, s, a, f, o, P, portrait, pad, safeBottom);
  if (f.moment && f.fx.hud > 0) drawMoment(ctx, W, s, a, f, o, P, portrait, pad, safeTop);
  if (f.fx.finish > 0) drawFinish(ctx, W, s, a, f.fx.finish, o, P, titleFont, safeTop, portrait);
  if (f.shot === "chase" || f.shot === "reveal") drawDisclosure(ctx, W, s, f, o, P, pad, safeTop, portrait);
  if (o.endCard && f.fx.summary > 0) drawEndCard(ctx, W, H, s, a, f.fx.summary, o, P, titleFont, portrait, safeTop, safeBottom, false);
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
      const items = liveItems(a, f.statsIndex).length;
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
  if (f.moment) pin(momentPoint(a, f.moment.m.at), o.accent, 5, f.moment.alpha);

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
  const items = liveItems(a, f.statsIndex);
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

/** Live HUD values at a (10 Hz) marker index: real elapsed time, distance, pace, HR, elevation, grade. */
function liveItems(a: Analysis, i: number): Item[] {
  const u = a.settings.units;
  const kind = a.activity.kind;
  const out: Item[] = [];
  const unit = unitLabel(u);
  if (!a.activity.routeOnly) out.push({ label: "TIME", value: formatDuration(atIndex(a.t, i)) });
  out.push({ label: "DISTANCE", value: (atIndex(a.dist, i) / (u === "metric" ? 1000 : 1609.344)).toFixed(2), unit });
  if (!a.activity.routeOnly) {
    const v = atIndex(a.speedLive, i);
    const moving = a.moving[Math.min(a.n - 2, Math.floor(i))] === 1 && v > 0.5;
    const pace = usesPace(kind);
    out.push({
      label: motionLabel(kind).toUpperCase(),
      value: !moving || i <= a.privacy.from ? "—" : pace ? formatPace(1000 / v, u, false) : formatSpeed(v, u, false),
      unit: !moving && i > a.privacy.from ? "paused" : pace ? `/${unit}` : u === "metric" ? "km/h" : "mph",
    });
  }
  if (a.zones.length) {
    const hr = atIndex(a.hr, i);
    const z = Number.isFinite(hr) ? zoneIndex(a, hr) : -1;
    out.push({
      label: z >= 0 ? `HR · Z${z + 1}` : "HR",
      value: Number.isFinite(hr) ? String(Math.round(hr)) : "—",
      unit: "bpm",
      dot: z >= 0 ? RAMPS.zone.dark[z] : undefined,
    });
  }
  if (a.elev) {
    const e = atIndex(a.elev, i);
    out.push({ label: "ELEV", value: formatElevation(e, u).split(" ")[0], unit: u === "metric" ? "m" : "ft" });
  }
  if (a.grade) {
    const g = atIndex(a.grade, i) * 100;
    out.push({ label: "GRADE", value: `${g > 0.5 ? "+" : g < -0.5 ? "−" : ""}${Math.abs(Math.round(g))}`, unit: "%" });
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

function drawMoment(ctx: CanvasRenderingContext2D, W: number, s: number, a: Analysis, f: FrameState, o: HudOptions, P: Palette, portrait: boolean, pad: number, safeTop: number) {
  const { m, alpha } = f.moment!;
  const cardW = Math.min(W - 2 * pad, 560 * s);
  const cardH = 150 * s;
  const x0 = pad;
  const y0 = safeTop + (portrait ? 40 : 90) * s - (1 - alpha) * 14 * s;
  ctx.save();
  ctx.globalAlpha = alpha * f.fx.hud;
  // Leader line to the map point, drawn first so the card sits on top.
  const p = o.project?.(momentPoint(a, m.at));
  if (p) {
    ctx.strokeStyle = m.hero ? o.accent : P.hi;
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    const sx = Math.min(Math.max(p[0], x0 + 24 * s), x0 + cardW - 24 * s);
    ctx.moveTo(sx, y0 + cardH);
    ctx.lineTo(p[0], p[1]);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p[0], p[1], 6 * s, 0, Math.PI * 2);
    ctx.fillStyle = m.hero ? o.accent : P.hi;
    ctx.fill();
  }
  panel(ctx, x0, y0, cardW, cardH, 18 * s, P);
  ctx.fillStyle = m.hero ? o.accent : P.hi;
  ctx.fillRect(x0, y0 + 18 * s, 5 * s, cardH - 36 * s);
  spaced(ctx, m.label, x0 + 30 * s, y0 + 40 * s, 17 * s, m.hero ? o.accent : P.mid, 700);
  ctx.fillStyle = P.hi;
  ctx.font = `600 ${50 * s}px ${FONT_SANS}`;
  tabular(ctx, m.value, x0 + 30 * s, y0 + 96 * s);
  ctx.font = `500 ${20 * s}px ${FONT_SANS}`;
  ctx.fillStyle = P.mid;
  ctx.fillText(truncate(ctx, m.context, cardW - 60 * s), x0 + 30 * s, y0 + 128 * s);
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

  const stats = endStats(a);
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

/** Distance · moving time · avg pace · elev gain · avg HR (only what the data has). */
function endStats(a: Analysis): Item[] {
  const sm = a.summary;
  const u = a.settings.units;
  const kind = a.activity.kind;
  const out: Item[] = [{ label: "DISTANCE", value: (sm.distance / (u === "metric" ? 1000 : 1609.344)).toFixed(2), unit: unitLabel(u) }];
  if (!a.activity.routeOnly) {
    out.push({ label: "MOVING TIME", value: formatDuration(sm.moving) });
    const m = formatMotion(sm.avgSpeed, kind, u);
    const [v, ...rest] = m.split(" ");
    out.push({ label: `AVG ${motionLabel(kind).toUpperCase()}`, value: v, unit: rest.join(" ") });
  }
  if (sm.elevGain !== undefined) {
    const [v, unit] = formatElevation(sm.elevGain, u).split(" ");
    out.push({ label: "ELEV GAIN", value: v, unit });
  }
  if (sm.avgHr !== undefined) out.push({ label: "AVG HR", value: String(Math.round(sm.avgHr)), unit: "bpm" });
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
