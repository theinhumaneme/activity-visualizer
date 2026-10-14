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
/** Comet tail behind the marker, seconds of activity time. */
const TAIL_SECONDS = 8;
/** The route is cut into at most this many pieces; each one switches on as the marker passes. */
const MAX_PIECES = 5000;

/** Line width by zoom: ~3 px far out, 6–8 px close in. */
const width = (scale: number) => ["interpolate", ["linear"], ["zoom"], 10, 3 * scale, 15, 6 * scale, 18, 8 * scale] as unknown as number;
const done = ["boolean", ["feature-state", "done"], false];
const whenDone = (on: number) => ["case", done, on, 0] as unknown as number;

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
 */
export function addFlyoverLayers(map: MlMap, look: Look) {
  map.addSource("route", { type: "geojson", data: EMPTY });
  map.addSource("route-km", { type: "geojson", data: EMPTY });
  const round = { "line-cap": "round", "line-join": "round" } as const;
  map.addLayer({
    id: "route-glow",
    type: "line",
    source: "route",
    layout: round,
    paint: { "line-color": look.glow ?? ["get", "c"], "line-opacity": whenDone(0.32), "line-width": width(3.2), "line-blur": 6 },
  });
  map.addLayer({
    id: "route-casing",
    type: "line",
    source: "route",
    layout: round,
    paint: { "line-color": look.casing, "line-opacity": whenDone(0.85), "line-width": width(1.45) },
  });
  map.addLayer({
    id: "route-line",
    type: "line",
    source: "route",
    layout: round,
    paint: { "line-color": ["get", "c"], "line-opacity": whenDone(1), "line-width": width(1) },
  });
  map.addLayer({
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

/** Pushes a FrameState onto a map that has the flyover layers. */
export class FlyoverRenderer {
  private ok: Uint8Array;
  private pieces: Piece[] = [];
  /** Pieces currently drawn (0..drawn-1) and the tail values currently set. */
  private drawn = 0;
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
    this.pieces = [];
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
    }
    this.source("route").setData({ type: "FeatureCollection", features });
    // New data starts with no feature state; redraw progress from scratch on the next frame.
    this.drawn = 0;
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

  /** Screen position (CSS px) of a route point, for markers and callouts; null when off-screen. */
  project(at: LngLat): [number, number] | null {
    const p = this.map.project(at);
    const c = this.map.getCanvas();
    const w = c.clientWidth || c.width;
    const h = c.clientHeight || c.height;
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
