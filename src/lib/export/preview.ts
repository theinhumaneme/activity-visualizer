// The export page's preview before anything is rendered: the route drawn flat over a ground
// tone for the chosen look, with the same HUD the video uses (title, live stats, footer), at the
// chosen aspect ratio. It needs no map tiles, so it updates instantly as options change.

import type { Analysis } from "../analysis/types";
import { mercX, mercY } from "../geo/geo";
import { drawPreviewHud } from "../hud/hud";
import { ACCENT, type ColorMode, buildChunks, drawable, sampleColors } from "../map/route";
import { LOOKS, type LookId } from "../map/style";
import type { FrameState } from "../playback/timeline";

/** How far along the route the preview frame sits. */
const PROGRESS = 0.62;

const GROUND: Record<LookId, [string, string]> = {
  night: ["#1a2129", "#07080a"],
  golden: ["#3d2814", "#120a05"],
  editorial: ["#f6f2ea", "#e4ddcf"],
  satellite: ["#2a3a2e", "#0e1510"],
};

/** A moving sample near PROGRESS whose speed is closest to the average, so the stats look typical. */
function representativeIndex(a: Analysis): number {
  const target = Math.floor((a.n - 1) * PROGRESS);
  if (a.activity.routeOnly) return target;
  const span = Math.floor(a.n * 0.15);
  let best = target;
  let bestD = Infinity;
  for (let i = Math.max(0, target - span); i <= Math.min(a.n - 2, target + span); i++) {
    if (!a.moving[i] || !a.privacy.visible[i]) continue;
    const d = Math.abs(a.speedLive[i] - a.summary.avgSpeed) + Math.abs(i - target) * 1e-4;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export interface PreviewOptions {
  look: LookId;
  routeColor: string;
  colorMode: ColorMode;
  stats: boolean;
  exaggeration: number;
  followSeconds: number;
}

export function drawExportPreview(ctx: CanvasRenderingContext2D, W: number, H: number, a: Analysis, o: PreviewOptions) {
  const look = LOOKS[o.look];
  const s = Math.min(W, H) / 1080;
  const portrait = H > W * 1.2;

  // Ground: a soft vignette in the look's tone, with faint contour rings for texture.
  const [inner, outer] = GROUND[o.look];
  const bg = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.75);
  bg.addColorStop(0, inner);
  bg.addColorStop(1, outer);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = look.hud === "light" ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1.5 * s;
  for (let k = 1; k <= 9; k++) {
    ctx.beginPath();
    ctx.ellipse(W / 2, H * 0.42, k * 90 * s * (W / Math.min(W, H)) * 0.6, k * 70 * s, -0.2, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Fit the visible route into the space the HUD leaves free.
  const vis = a.privacy.visible;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const xs = new Float64Array(a.n);
  const ys = new Float64Array(a.n);
  for (let i = 0; i < a.n; i++) {
    xs[i] = mercX(a.samples[i].lon);
    ys[i] = mercY(a.samples[i].lat);
    if (!vis[i]) continue;
    x0 = Math.min(x0, xs[i]);
    x1 = Math.max(x1, xs[i]);
    y0 = Math.min(y0, ys[i]);
    y1 = Math.max(y1, ys[i]);
  }
  const wide = W > H * 1.3;
  const box = portrait
    ? { left: W * 0.1, right: W * 0.9, top: H * 0.27, bottom: H * (o.stats ? 0.62 : 0.76) }
    : wide
      ? { left: W * 0.08, right: W * 0.6, top: H * 0.1, bottom: H * (o.stats ? 0.5 : 0.62) }
      : { left: W * 0.1, right: W * 0.9, top: H * 0.1, bottom: H * (o.stats ? 0.4 : 0.6) };
  const k = Math.min((box.right - box.left) / (x1 - x0 || 1), (box.bottom - box.top) / (y1 - y0 || 1));
  const ox = (box.left + box.right) / 2 - ((x0 + x1) / 2) * k;
  const oy = (box.top + box.bottom) / 2 - ((y0 + y1) / 2) * k;
  const px = (i: number) => ox + xs[i] * k;
  const py = (i: number) => oy + ys[i] * k;
  const project = ([lon, lat]: [number, number]): [number, number] => [ox + mercX(lon) * k, oy + mercY(lat) * k];

  const ok = drawable(a);
  const solid = o.colorMode === "solid" && o.routeColor === ACCENT && look.solid ? look.solid : o.routeColor;
  const colors = sampleColors(a, { mode: o.colorMode, color: solid, theme: look.ramp });
  const head = representativeIndex(a);
  const stroke = (from: number, to: number) => {
    ctx.beginPath();
    let pen = false;
    for (let i = from; i <= to; i++) {
      if (!ok[i - 1] && i > from) pen = false;
      if (!vis[i]) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(px(i), py(i));
      else ctx.moveTo(px(i), py(i));
      pen = true;
    }
    ctx.stroke();
  };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Route so far only (like the video, nothing ahead of the marker): casing, then the colored line.
  ctx.strokeStyle = look.casing;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 14 * s;
  stroke(0, head);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 8 * s;
  for (const c of buildChunks(a, colors, 300)) {
    if (c.from >= head) break;
    ctx.strokeStyle = c.color;
    stroke(c.from, Math.min(c.to, head));
  }
  if (vis[head]) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(px(head), py(head), 13 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = solid;
    ctx.beginPath();
    ctx.arc(px(head), py(head), 9 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  const frame: FrameState = {
    T: 0,
    shot: "chase",
    camera: { center: [a.samples[head].lon, a.samples[head].lat], zoom: 14, pitch: 0, bearing: 0, elevation: 0 },
    index: head,
    head: [a.samples[head].lon, a.samples[head].lat],
    statsIndex: head,
    rate: a.activity.routeOnly ? 1 : a.summary.elapsed / Math.max(4, o.followSeconds),
    moment: null,
    fx: { title: 1, marker: 1, start: 0, hud: 1, finish: 0, burst: 0, summary: 0, pulse: 0 },
  };
  drawPreviewHud(ctx, W, H, a, frame, {
    look,
    accent: solid,
    stats: o.stats,
    endCard: false,
    attribution: look.attribution(),
    exaggeration: o.exaggeration,
    project,
  });
}
