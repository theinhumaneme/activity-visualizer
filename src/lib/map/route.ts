import type { FeatureCollection, LineString, Point } from "geojson";
import type { Map as MlMap } from "maplibre-gl";
import type { Analysis } from "../analysis/types";
import { type LngLat, haversine } from "../geo/geo";

export type ColorMode = "solid" | "pace" | "zone" | "hr" | "grade" | "elevation" | "cadence" | "progress";
export type MapTheme = "light" | "dark";

/** Keyboard order (1–8) and labels. */
export const COLOR_MODES: { mode: ColorMode; label: string }[] = [
  { mode: "solid", label: "Solid" },
  { mode: "pace", label: "Pace" },
  { mode: "zone", label: "HR zones" },
  { mode: "hr", label: "Heart rate" },
  { mode: "grade", label: "Grade" },
  { mode: "elevation", label: "Elevation" },
  { mode: "cadence", label: "Cadence" },
  { mode: "progress", label: "Progress" },
];

/** Solid route colors the user can pick; chosen to stand out on satellite imagery and both basemaps. */
export const ROUTE_COLORS = [
  { id: "orange", label: "Signature orange", hex: "#ff5a1f" },
  { id: "blue", label: "Blue", hex: "#3db8ff" },
  { id: "lime", label: "Lime", hex: "#8bd42a" },
  { id: "magenta", label: "Magenta", hex: "#ff3d9a" },
  { id: "yellow", label: "Yellow", hex: "#ffe14d" },
  { id: "white", label: "White", hex: "#ffffff" },
  { id: "red", label: "Red", hex: "#ff3b3b" },
  { id: "violet", label: "Violet", hex: "#a06bff" },
  { id: "cyan", label: "Cyan", hex: "#2de2e6" },
  { id: "mint", label: "Mint", hex: "#5af2a8" },
] as const;
export const ACCENT = ROUTE_COLORS[0].hex;
export const START_COLOR = "#57c785";

/**
 * Ramps, low → high. Pace runs slow → fast and gets brighter as you get faster (never a rainbow).
 * Grade is diverging around flat. Zones are five discrete colors, always shown with their labels.
 * Dark variants sit on the Night Run basemap and satellite; light variants on light basemaps, where
 * a yellow end would vanish. Flat grade is a mid gray rather than near-black so it stays readable
 * on a dark map.
 */
export const RAMPS: Record<Exclude<ColorMode, "solid">, Record<MapTheme, string[]>> = {
  pace: {
    dark: ["#3b1f6e", "#b8327a", "#ff7a3d", "#ffe14d"],
    light: ["#3b1f6e", "#7a2a7c", "#b8327a", "#e2533e", "#f08a24"],
  },
  // Mirrors --zone-1…5 in index.css: slate, blue, green, amber, red, in effort order.
  zone: {
    dark: ["#8e9aab", "#5b9ee0", "#45c27a", "#f0a43a", "#f2605a"],
    light: ["#8a97a8", "#3d7fbf", "#2e9e5e", "#d98a16", "#d23f3a"],
  },
  grade: {
    dark: ["#3db8ff", "#8a8f98", "#ff5a1f"],
    light: ["#1e88c9", "#9aa0a8", "#e2480f"],
  },
  elevation: {
    dark: ["#1f5f73", "#2f9b8f", "#7fd3a6", "#e6f5c9"],
    light: ["#a8dcc8", "#4fae96", "#1f7a6e", "#0e4a44"],
  },
  // Continuous heart rate: cool and calm at the low end, hot at the top.
  hr: {
    dark: ["#4a5a7a", "#7a5fc7", "#e0457b", "#ff7a4d", "#ffd27a"],
    light: ["#7d8ca3", "#5b47c4", "#b8327a", "#d8462f", "#a33a0a"],
  },
  // Cadence: deep teal (slow turnover) to pale (quick).
  cadence: {
    dark: ["#1f4e5f", "#2fa3b5", "#8be0d0", "#f2f7c9"],
    light: ["#9fd3dc", "#3d9db0", "#1f6f80", "#0f3f4a"],
  },
  // Progress, start → finish: a cool-to-warm sweep, so where you were when reads at a glance.
  progress: {
    dark: ["#3db8ff", "#a06bff", "#ff3d9a", "#ff8a3d"],
    light: ["#1e88c9", "#6a55d8", "#c2327a", "#e2480f"],
  },
};

/** Grade range mapped onto the diverging ramp (±12% saturates). */
export const GRADE_SPAN = 0.12;

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export function rampColor(ramp: string[], x: number): string {
  if (!Number.isFinite(x)) return ramp[0];
  const v = Math.min(1, Math.max(0, x)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(v));
  const f = v - i;
  const a = hex(ramp[i]);
  const b = hex(ramp[i + 1]);
  const c = a.map((p, k) => Math.round(p + (b[k] - p) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function percentile(values: number[], p: number) {
  const s = values.filter(Number.isFinite).sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
}

/** Domain [low, high] used to color by a metric (5th–95th percentile, so outliers don't wash it out). */
export function colorDomain(a: Analysis, mode: ColorMode): [number, number] | null {
  if (mode === "pace") {
    const v = Array.from(a.speed).filter((_, i) => a.moving[i]);
    return v.length ? [percentile(v, 0.05), percentile(v, 0.95)] : null;
  }
  if (mode === "elevation" && a.elev) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const e of a.elev) {
      lo = Math.min(lo, e);
      hi = Math.max(hi, e);
    }
    return [lo, Math.max(hi, lo + 1)];
  }
  if (mode === "grade" && a.grade) return [-GRADE_SPAN, GRADE_SPAN];
  if (mode === "hr") {
    const v = Array.from(a.hr).filter((h, i) => Number.isFinite(h) && a.moving[i]);
    return v.length ? [percentile(v, 0.05), Math.max(percentile(v, 0.95), percentile(v, 0.05) + 1)] : null;
  }
  if (mode === "cadence" && a.cadence) {
    const v = Array.from(a.cadence).filter((c, i) => c > 0 && a.moving[i]);
    return v.length ? [percentile(v, 0.05), Math.max(percentile(v, 0.95), percentile(v, 0.05) + 1)] : null;
  }
  if (mode === "progress") return [0, Math.max(1, a.dist[a.n - 1])];
  return null;
}

/** Whether a color mode has the data it needs. */
export function modeAvailable(a: Analysis, mode: ColorMode): boolean {
  if (mode === "zone") return a.zones.length > 0;
  if (mode === "grade" || mode === "elevation") return !!a.elev;
  if (mode === "pace") return !a.activity.routeOnly;
  if (mode === "hr") return !a.activity.routeOnly && a.hr.some(Number.isFinite);
  if (mode === "cadence") return !a.activity.routeOnly && !!a.cadence;
  return true;
}

export interface RouteColoring {
  mode: ColorMode;
  /** Solid route color (hex). */
  color: string;
  theme: MapTheme;
}

export function zoneIndex(a: Analysis, hr: number): number {
  let z = 0;
  while (z < 4 && hr >= a.zones[z + 1].low) z++;
  return z;
}

export function sampleColors(a: Analysis, { mode, color, theme }: RouteColoring): string[] {
  const out = new Array<string>(a.n);
  if (!modeAvailable(a, mode)) return out.fill(color);
  if (mode === "zone") {
    const ramp = RAMPS.zone[theme];
    for (let i = 0; i < a.n; i++) out[i] = Number.isNaN(a.hr[i]) ? ramp[0] : ramp[zoneIndex(a, a.hr[i])];
    return out;
  }
  const domain = colorDomain(a, mode);
  const series =
    mode === "pace"
      ? a.speed
      : mode === "grade"
        ? a.grade
        : mode === "elevation"
          ? a.elev
          : mode === "hr"
            ? a.hr
            : mode === "cadence"
              ? a.cadence
              : mode === "progress"
                ? a.dist
                : null;
  if (domain && series) {
    const [lo, hi] = domain;
    const ramp = RAMPS[mode as Exclude<ColorMode, "solid" | "zone">][theme];
    for (let i = 0; i < a.n; i++) out[i] = rampColor(ramp, (series[i] - lo) / (hi - lo || 1));
    return out;
  }
  return out.fill(color);
}

export interface Chunk {
  from: number;
  to: number;
  color: string;
}

/** Splits the route into ≤ maxChunks colored pieces (each shares its end point with the next). */
export function buildChunks(a: Analysis, colors: string[], maxChunks = 400): Chunk[] {
  const size = Math.max(1, Math.ceil((a.n - 1) / maxChunks));
  const chunks: Chunk[] = [];
  for (let from = 0; from < a.n - 1; from += size) {
    const to = Math.min(a.n - 1, from + size);
    const prev = chunks[chunks.length - 1];
    const color = colors[Math.floor((from + to) / 2)];
    if (prev && prev.color === color) prev.to = to;
    else chunks.push({ from, to, color });
  }
  return chunks;
}

/** Track-segment breaks wider than this (m) aren't bridged by a line: the signal was lost there. */
const SEGMENT_GAP = 30;

/** Whether the line may be drawn from sample i to i+1 (privacy and segment breaks). */
export function drawable(a: Analysis): Uint8Array {
  const s = a.samples;
  const vis = a.privacy.visible;
  const ok = new Uint8Array(a.n);
  for (let i = 0; i < a.n - 1; i++) {
    const jump = s[i + 1].seg !== s[i].seg && haversine(s[i].lat, s[i].lon, s[i + 1].lat, s[i + 1].lon) > SEGMENT_GAP;
    ok[i] = vis[i] && vis[i + 1] && !jump ? 1 : 0;
  }
  return ok;
}

/**
 * Route as colored line features, optionally cut at fractional sample index `upTo` and
 * ended exactly at `head` so the line meets the moving dot. Pieces inside the privacy zone and
 * across segment breaks are left out. `from` starts the line later (used for the ghost "ahead").
 */
export function routeFeatures(a: Analysis, chunks: Chunk[], upTo = Infinity, head?: LngLat, ok = drawable(a), from = 0): FeatureCollection<LineString> {
  const s = a.samples;
  const stride = Math.max(1, Math.ceil(a.n / 6000));
  const features: FeatureCollection<LineString>["features"] = [];
  for (const c of chunks) {
    if (c.from >= upTo) break;
    if (c.to < from) continue;
    const end = Math.min(c.to, Math.floor(upTo));
    let coords: LngLat[] = [];
    const flush = () => {
      if (coords.length >= 2) features.push({ type: "Feature", properties: { c: c.color }, geometry: { type: "LineString", coordinates: coords } });
      coords = [];
    };
    const begin = Math.max(c.from, Math.floor(from));
    for (let i = begin; i <= end; i++) {
      const keep = i === begin || i === end || (i - begin) % stride === 0 || !ok[i] || !ok[i - 1];
      if (keep && (ok[i] || (i > 0 && ok[i - 1]))) coords.push([s[i].lon, s[i].lat]);
      if (!ok[i] && i < end) flush();
    }
    if (upTo < c.to && head && ok[Math.floor(upTo)]) coords.push(head);
    flush();
  }
  return { type: "FeatureCollection", features };
}

export function pointFeatures(points: { kind: string; at: LngLat }[]): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: points.map((p) => ({ type: "Feature", properties: { kind: p.kind }, geometry: { type: "Point", coordinates: p.at } })),
  };
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

const lineWidth = (base: number) => ["interpolate", ["linear"], ["zoom"], 10, base * 0.5, 14, base, 18, base * 1.8] as unknown as number;

/** Layers shared by every map: faint full route, drawn route with casing, start/finish/head dots. */
export function addRouteLayers(map: MlMap, opts: { ghostOpacity: number; width: number; headColor: string; casing?: string }) {
  map.addSource("route-full", { type: "geojson", data: EMPTY });
  map.addSource("route-progress", { type: "geojson", data: EMPTY });
  map.addSource("route-points", { type: "geojson", data: EMPTY });
  map.addLayer({
    id: "route-ghost",
    type: "line",
    source: "route-full",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffffff", "line-opacity": opts.ghostOpacity, "line-width": lineWidth(opts.width * 0.6) },
  });
  map.addLayer({
    id: "route-casing",
    type: "line",
    source: "route-progress",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": opts.casing ?? "#000000", "line-opacity": opts.casing ? 0.9 : 0.45, "line-width": lineWidth(opts.width + 3) },
  });
  map.addLayer({
    id: "route-line",
    type: "line",
    source: "route-progress",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["get", "c"], "line-width": lineWidth(opts.width) },
  });
  const dot = (kind: string, color: string, radius: number) =>
    map.addLayer({
      id: `route-${kind}`,
      type: "circle",
      source: "route-points",
      filter: ["==", ["get", "kind"], kind],
      paint: {
        "circle-color": color,
        "circle-radius": radius,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2.5,
        "circle-pitch-alignment": "viewport",
      },
    });
  dot("finish", "#111111", 6);
  dot("start", START_COLOR, 6.5);
  dot("head", opts.headColor, 8);
}
