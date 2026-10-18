// Map detail: how sharp the maps are drawn, traded against GPU memory and work per frame.
// Auto picks from what the browser says about the device; the user can override it.

import type { Map as MlMap } from "maplibre-gl";

export type MapDetail = "auto" | "lite" | "standard" | "high";
export type DetailLevel = Exclude<MapDetail, "auto">;

export const MAP_DETAILS: { value: MapDetail; label: string; title: string }[] = [
  { value: "auto", label: "Auto", title: "Pick from this device's memory and processor" },
  { value: "lite", label: "Lite", title: "Lighter maps for older or low-memory phones" },
  { value: "standard", label: "Standard", title: "Balanced" },
  { value: "high", label: "High", title: "Sharper 3D terrain and satellite imagery; needs a capable GPU" },
];

interface DetailSettings {
  /**
   * Resolution of the textures MapLibre draws the map into for 3D terrain, as a multiple of the
   * terrain tile size (MapLibre's default is 2). At 2 the map is 1:1 sharp at whole zoom levels
   * but softens up to 2× before the next one; 3 keeps it within 1.33×, for 2.25× the memory.
   */
  terrainQuality: number;
  /** Device pixel ratio cap for on-page maps (exports always render at 2). */
  pixelRatio: number;
  /**
   * Declared size of 256 px satellite tiles: 128 makes MapLibre fetch one zoom level deeper, so
   * imagery stays sharp on 2× screens and exports instead of being upscaled (4× the tiles).
   */
  satelliteTileSize: 128 | 256;
  /**
   * Declared size of the 512 px terrain tiles: 256 fetches one zoom level deeper (finer relief,
   * 4× the elevation data); Lite takes them at face value.
   */
  demTileSize: 256 | 512;
}

export const DETAIL: Record<DetailLevel, DetailSettings> = {
  lite: { terrainQuality: 1.5, pixelRatio: 1, satelliteTileSize: 256, demTileSize: 512 },
  standard: { terrainQuality: 2, pixelRatio: 2, satelliteTileSize: 256, demTileSize: 256 },
  high: { terrainQuality: 3, pixelRatio: 2, satelliteTileSize: 128, demTileSize: 256 },
};

/** Device class from what the browser reports (deviceMemory is Chromium-only; Safari reports none). */
export function deviceDetail(): DetailLevel {
  if (typeof navigator === "undefined") return "standard";
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency || 4;
  const touch = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  // Memory first: Safari reports no memory and a capped core count, so cores alone would put
  // every iPhone on Lite.
  if (memory !== undefined ? memory <= 2 || (touch && memory <= 4) : cores <= 2) return "lite";
  if (!touch && cores >= 8 && (memory === undefined || memory >= 8)) return "high";
  return "standard";
}

export const resolveDetail = (d: MapDetail): DetailLevel => (d === "auto" ? deviceDetail() : d);

/**
 * Sets the 3D terrain texture resolution on a loaded map. MapLibre has no option for it, so this
 * reaches into its internals; it checks their shape and does nothing if they change.
 */
export function applyTerrainQuality(map: MlMap, quality: number) {
  type Internals = {
    terrain?: { qualityFactor: number; tileManager?: { tileSize: number; releaseAllRTT?: () => void } };
    painter?: { renderToTexture?: { rttSize: number } };
  };
  const m = map as unknown as Internals;
  const terrain = m.terrain;
  const rtt = m.painter?.renderToTexture;
  if (!terrain || !rtt || typeof terrain.qualityFactor !== "number" || typeof terrain.tileManager?.tileSize !== "number") return;
  terrain.qualityFactor = quality;
  rtt.rttSize = Math.round(terrain.tileManager.tileSize * quality);
  terrain.tileManager.releaseAllRTT?.();
  map.triggerRepaint();
}

/**
 * Pixel ratio for an on-page 2D map at this detail level (never above the screen's own). Flat maps
 * are cheap, so Lite keeps them at 1.5× rather than the flyover's 1×.
 */
export const mapPixelRatio = (level: DetailLevel) =>
  Math.min(level === "lite" ? 1.5 : DETAIL[level].pixelRatio, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);

/** Layers Lite leaves out of the 3D flyover: shading and decoration that cost GPU time per frame. */
const LITE_DROP = new Set(["hillshade", "contours", "contour-labels", "grade-wash"]);

/** A flyover style lightened for Lite: no hillshade, contour lines or color wash. */
export function liteStyle<S extends { layers: { id: string; type: string }[]; sources: Record<string, unknown> }>(style: S): S {
  const layers = style.layers.filter((l) => l.type !== "hillshade" && !LITE_DROP.has(l.id));
  const sources = { ...style.sources };
  if (!layers.some((l) => "source" in l && (l as { source?: string }).source === "contours")) delete sources.contours;
  return { ...style, layers, sources };
}
