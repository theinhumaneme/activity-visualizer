import type { Feature, FeatureCollection, MultiLineString, Point } from "geojson";
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import type { Analysis } from "../analysis/types";
import { indexAtDist } from "../analysis/series";
import { unitLabel, unitLength } from "../format/format";
import type { LngLat } from "../geo/geo";
import { ACCENT, type RouteColoring, drawable, sampleColors } from "../map/route";
import type { Look } from "../map/style";
import type { FrameState } from "./timeline";

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
/** Layer types MapLibre drapes onto the terrain (drawn into tile textures). */
const DRAPED = new Set(["background", "fill", "line", "raster", "hillshade", "color-relief"]);
/** Comet tail behind the marker, seconds of activity time. */
const TAIL_SECONDS = 8;
/** The route is cut into at most this many pieces; each one switches on as the marker passes. */
const MAX_PIECES = 5000;
/** Consecutive pieces are also merged into at most this many runs, for the finished route. */
const MAX_RUNS = 64;

/** Line width by zoom: ~3 px far out, 6–8 px close in. */
const width = (scale: number) => ["interpolate", ["linear"], ["zoom"], 10, 3 * scale, 15, 6 * scale, 18, 8 * scale] as unknown as number;
const done = ["boolean", ["feature-state", "done"], false];
const merged = ["boolean", ["feature-state", "merged"], false];
const whenDone = (on: number) => ["case", done, on, 0] as unknown as number;
/** Pieces past the last finished run: the only part still drawn piece by piece. */
const whenEdge = (on: number) => ["case", ["all", done, ["!", merged]], on, 0] as unknown as number;

/**
 * Flyover layers, added on top of the basemap so the route is always readable. All line layers
 * are draped on the terrain by MapLibre, so the route sits on the ground and never floats.
 *
 * Nothing is drawn ahead of the marker: the route builds behind you, so the colors (pace, HR
 * zone…) of a stretch appear only once you've covered it.
 *
 * Everything here is static data: the drawn line and the comet tail are one set of route pieces
 * toggled with feature state, which is a paint-only change. Nothing goes back
 * through MapLibre's worker per frame, so each export frame only waits for map tiles. The athlete
 * marker, start/finish pins and finish burst are drawn on the HUD canvas.
 *
 * The see-through glow would show every joint between pieces as a bead (round caps overlap and
 * double up), so finished stretches of it switch to "runs": the same route merged into a few
 * long lines. Only the stretch since the last finished run glows piece by piece.
 * Neither source is simplified, so tiny pieces aren't dropped when the camera pulls back.
 */
export function addFlyoverLayers(map: MlMap, look: Look) {
  // Route lines go right after the last ground layer (roads, water, hillshade…), so above every
  // road but under the labels that follow: with terrain, each unbroken run of ground layers is
  // drawn into its own set of tile textures, so lines added above the labels doubled the texture
  // memory and drawing work per frame. (Not simply "before the first label": styles may put a
  // label early, under the roads.) The km markers stay on top.
  const layers = map.getStyle().layers;
  let lastGround = -1;
  layers.forEach((l, i) => {
    if (DRAPED.has(l.type)) lastGround = i;
  });
  const below = layers[lastGround + 1]?.id;
  const addLine = (layer: Parameters<MlMap["addLayer"]>[0]) => map.addLayer(layer, below);
  map.addSource("route", { type: "geojson", data: EMPTY, tolerance: 0 });
  map.addSource("route-runs", { type: "geojson", data: EMPTY, tolerance: 0 });
  map.addSource("route-km", { type: "geojson", data: EMPTY });
  const round = { "line-cap": "round", "line-join": "round" } as const;
  const glow = { "line-color": look.glow ?? (["get", "c"] as unknown as string), "line-width": width(3.2), "line-blur": 6 };
  addLine({ id: "route-glow", type: "line", source: "route-runs", layout: round, paint: { ...glow, "line-opacity": whenDone(0.32) } });
  addLine({ id: "route-glow-edge", type: "line", source: "route", layout: round, paint: { ...glow, "line-opacity": whenEdge(0.32) } });
  // Opaque, so the caps where pieces meet can't double up.
  addLine({
    id: "route-casing",
    type: "line",
    source: "route",
    layout: round,
    paint: { "line-color": look.casing, "line-opacity": whenDone(1), "line-width": width(1.45) },
  });
  addLine({
    id: "route-line",
    type: "line",
    source: "route",
    layout: round,
    paint: { "line-color": ["get", "c"], "line-opacity": whenDone(1), "line-width": width(1) },
  });
  addLine({
    id: "route-tail",
    type: "line",
    source: "route",
    layout: round,
    paint: {
      "line-color": "#ffffff",
      "line-opacity": ["*", 0.9, ["number", ["feature-state", "tail"], 0]] as unknown as number,
      "line-width": width(1.15),
    },
  });
  map.addLayer({
    id: "route-km-dot",
    type: "circle",
    source: "route-km",
    paint: {
      "circle-radius": 3.5,
      "circle-color": "#ffffff",
      "circle-stroke-color": look.casing,
      "circle-stroke-width": 1.5,
      "circle-opacity": ["number", ["feature-state", "a"], 0],
      "circle-stroke-opacity": ["number", ["feature-state", "a"], 0],
      "circle-pitch-alignment": "viewport",
    },
  });
  map.addLayer({
    id: "route-km-label",
    type: "symbol",
    source: "route-km",
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 11,
      "text-offset": [0, -1.3],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": look.hud === "light" ? "#1a1a1a" : "#f4f5f6",
      "text-halo-color": look.hud === "light" ? "rgba(255,255,255,0.9)" : "rgba(7,8,10,0.85)",
      "text-halo-width": 1.2,
      "text-opacity": ["number", ["feature-state", "a"], 0],
    },
  });
}

interface Piece {
  /** Last sample index the piece covers; it's drawn once the marker is past it. */
  to: number;
  /** Activity time at its end, for the comet tail's fade. */
  tEnd: number;
}

/** Appends a piece's lines to a run, joining them where the previous line ends at their start. */
function extend(run: LngLat[][], lines: LngLat[][]) {
  for (const l of lines) {
    const last = run[run.length - 1];
    const end = last?.[last.length - 1];
    if (end && end[0] === l[0][0] && end[1] === l[0][1]) last.push(...l.slice(1));
    else run.push([...l]);
  }
}

/** Pushes a FrameState onto a map that has the flyover layers. */
export class FlyoverRenderer {
  private ok: Uint8Array;
  private pieces: Piece[] = [];
  /** Runs of consecutive pieces: run k covers pieces runEnds[k-1]..runEnds[k]-1. */
  private runEnds: number[] = [];
  /** Pieces currently drawn (0..drawn-1), how many of them are covered by finished runs, and the tail values currently set. */
  private drawn = 0;
  private mergedTo = 0;
  private tail = new Map<number, number>();
  private km: { d: number; id: number }[] = [];
  private kmAlpha = new Map<number, number>();

  constructor(
    private map: MlMap,
    private a: Analysis,
    coloring: RouteColoring,
    private look: Look,
  ) {
    this.ok = drawable(a);
    this.setColoring(coloring);
    const unit = unitLength(a.settings.units);
    const features: Feature<Point>[] = [];
    for (let k = 1; k * unit < a.dist[a.n - 1] - unit * 0.1; k++) {
      const f = indexAtDist(a.dist, k * unit);
      if (!a.privacy.visible[Math.round(f)]) continue;
      features.push({ type: "Feature", id: k, properties: { label: `${k} ${unitLabel(a.settings.units)}` }, geometry: { type: "Point", coordinates: momentAt(a, f) } });
      this.km.push({ d: k * unit, id: k });
    }
    this.source("route-km").setData({ type: "FeatureCollection", features });
  }

  /** Golden Hour's white-hot route replaces the default orange when coloring is solid. */
  private resolve(c: RouteColoring): RouteColoring {
    return c.mode === "solid" && c.color === ACCENT && this.look.solid ? { ...c, color: this.look.solid } : c;
  }

  /** Cuts the route into short pieces (privacy gaps and segment breaks left out) and uploads them once. */
  setColoring(coloring: RouteColoring) {
    const a = this.a;
    const colors = sampleColors(a, this.resolve(coloring));
    const { from, to } = a.privacy;
    // Short enough that the drawn line stays within the marker's radius of the athlete.
    const step = Math.max(1, Math.ceil((to - from) / MAX_PIECES));
    const features: Feature<MultiLineString>[] = [];
    const runs: Feature<MultiLineString>[] = [];
    const perRun = Math.max(1, Math.ceil((to - from) / step / MAX_RUNS));
    let run: LngLat[][] = [];
    let runFrom = from;
    this.pieces = [];
    this.runEnds = [];
    for (let i0 = from; i0 < to; i0 += step) {
      const i1 = Math.min(to, i0 + step);
      const lines: LngLat[][] = [];
      let line: LngLat[] = [];
      for (let i = i0; i < i1; i++) {
        if (!this.ok[i]) {
          if (line.length >= 2) lines.push(line);
          line = [];
          continue;
        }
        if (!line.length) line.push([a.samples[i].lon, a.samples[i].lat]);
        line.push([a.samples[i + 1].lon, a.samples[i + 1].lat]);
      }
      if (line.length >= 2) lines.push(line);
      const id = this.pieces.length;
      this.pieces.push({ to: i1, tEnd: a.t[i1] });
      if (lines.length) features.push({ type: "Feature", id, properties: { c: colors[Math.floor((i0 + i1) / 2)] }, geometry: { type: "MultiLineString", coordinates: lines } });
      extend(run, lines);
      if (this.pieces.length % perRun === 0 || i1 >= to) {
        const k = this.runEnds.length;
        // A run's glow takes the color of its middle; looks with a fixed glow color ignore it.
        if (run.length) runs.push({ type: "Feature", id: k, properties: { c: colors[Math.floor((runFrom + i1) / 2)] }, geometry: { type: "MultiLineString", coordinates: run } });
        this.runEnds.push(this.pieces.length);
        run = [];
        runFrom = i1;
      }
    }
    this.source("route").setData({ type: "FeatureCollection", features });
    this.source("route-runs").setData({ type: "FeatureCollection", features: runs });
    // New data starts with no feature state; redraw progress from scratch on the next frame.
    this.drawn = 0;
    this.mergedTo = 0;
    this.tail.clear();
  }

  apply(state: FrameState, driveCamera = true) {
    const { camera } = state;
    const a = this.a;
    if (driveCamera) {
      this.map.jumpTo({ center: camera.center, zoom: camera.zoom, pitch: camera.pitch, bearing: camera.bearing, elevation: camera.elevation });
    }
    if (a.privacy.empty) return;

    // Drawn pieces: everything the marker has passed. Only pieces that changed are touched.
    let target = this.drawn;
    while (target < this.pieces.length && this.pieces[target].to <= state.index) target++;
    while (target > 0 && this.pieces[target - 1].to > state.index) target--;
    for (let k = Math.min(target, this.drawn); k < Math.max(target, this.drawn); k++) this.state("route", k, { done: k < target });
    this.drawn = target;
    // Finished runs take over the glow of the pieces they cover.
    let runs = 0;
    while (runs < this.runEnds.length && this.runEnds[runs] <= target) runs++;
    const mergedTo = runs ? this.runEnds[runs - 1] : 0;
    if (mergedTo !== this.mergedTo) {
      const before = this.mergedTo ? this.runEnds.indexOf(this.mergedTo) + 1 : 0;
      for (let k = Math.min(runs, before); k < Math.max(runs, before); k++) this.state("route-runs", k, { done: k < runs });
      for (let k = Math.min(mergedTo, this.mergedTo); k < Math.max(mergedTo, this.mergedTo); k++) this.state("route", k, { merged: k < mergedTo });
      this.mergedTo = mergedTo;
    }

    // Comet tail: pieces ending in the last few seconds behind the marker, fading with age.
    const next = new Map<number, number>();
    if (state.shot === "chase" && a.privacy.visible[Math.round(state.index)]) {
      const tNow = a.t[Math.min(a.n - 1, Math.floor(state.index))];
      for (let k = target - 1; k >= 0 && tNow - this.pieces[k].tEnd < TAIL_SECONDS; k--) {
        next.set(k, Math.round((1 - (tNow - this.pieces[k].tEnd) / TAIL_SECONDS) * 20) / 20);
      }
    }
    for (const [k, v] of next) if (this.tail.get(k) !== v) this.state("route", k, { tail: v });
    for (const k of this.tail.keys()) if (!next.has(k)) this.state("route", k, { tail: 0 });
    this.tail = next;

    // Km ticks fade in over ~60 m of route after the marker passes them.
    const dNow = a.dist[Math.min(a.n - 1, Math.floor(state.index))];
    for (const k of this.km) {
      const v = k.d <= dNow ? Math.round(Math.min(1, (dNow - k.d) / 60) * 10) / 10 : 0;
      if ((this.kmAlpha.get(k.id) ?? 0) !== v) {
        this.state("route-km", k.id, { a: v });
        this.kmAlpha.set(k.id, v);
      }
    }
  }

  private viewport: [number, number] | null = null;
  /** Fixes the map's CSS size for `project` (exports), so it doesn't read layout every call. */
  setViewport(w: number, h: number) {
    this.viewport = [w, h];
  }

  /** Screen position (CSS px) of a route point, for markers and callouts; null when off-screen. */
  project(at: LngLat): [number, number] | null {
    const p = this.map.project(at);
    let w: number;
    let h: number;
    if (this.viewport) [w, h] = this.viewport;
    else {
      const c = this.map.getCanvas();
      w = c.clientWidth || c.width;
      h = c.clientHeight || c.height;
    }
    if (!Number.isFinite(p.x) || p.x < -50 || p.y < -50 || p.x > w + 50 || p.y > h + 50) return null;
    return [p.x, p.y];
  }

  private state(source: string, id: number, s: Record<string, unknown>) {
    this.map.setFeatureState({ source, id }, s);
  }

  private source(id: string) {
    return this.map.getSource(id) as GeoJSONSource;
  }
}

export function momentAt(a: Analysis, f: number): LngLat {
  const i = Math.floor(f);
  const j = Math.min(a.n - 1, i + 1);
  const u = f - i;
  return [a.samples[i].lon + (a.samples[j].lon - a.samples[i].lon) * u, a.samples[i].lat + (a.samples[j].lat - a.samples[i].lat) * u];
}

/**
 * Resolves once the map has drawn the current camera with all tiles settled: true when it went
 * idle, false when it timed out first (tiles still loading).
 */
export function settled(map: MlMap, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (idle: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      map.off("idle", onIdle);
      resolve(idle);
    };
    const onIdle = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    map.once("idle", onIdle);
    map.triggerRepaint();
  });
}
