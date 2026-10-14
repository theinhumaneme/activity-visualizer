import { type Bounds, mercX, mercY, unmercX, unmercY } from "./geo";

/**
 * A coarse elevation grid (meters, not exaggerated) around the route, so the camera solver can
 * keep clear of the ground at its own position and along its line of sight, without a map.
 * Being a plain array, it keeps the camera path a pure, repeatable function.
 */
export interface TerrainGrid {
  /** Mercator extent of the grid. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cols: number;
  rows: number;
  /** Row-major elevations; NaN where tiles were missing. */
  data: Float64Array;
}

export type ElevationAt = (lon: number, lat: number) => number;

/** Grid points covering `b` expanded by `marginMeters` (the camera trails a few hundred meters out). */
export function gridPoints(b: Bounds, marginMeters: number, cols = 72, rows = 72) {
  const metersPerMerc = 40075016.686 * Math.cos(((b.north + b.south) / 2) * (Math.PI / 180));
  const m = marginMeters / metersPerMerc;
  const x0 = mercX(b.west) - m;
  const x1 = mercX(b.east) + m;
  const y0 = mercY(b.north) - m;
  const y1 = mercY(b.south) + m;
  const points: { lat: number; lon: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      points.push({ lon: unmercX(x0 + ((x1 - x0) * c) / (cols - 1)), lat: unmercY(y0 + ((y1 - y0) * r) / (rows - 1)) });
    }
  }
  return { x0, y0, x1, y1, cols, rows, points };
}

/** Bilinear lookup; outside the grid it clamps to the edge (good enough for a camera floor). */
export function sampler(g: TerrainGrid, fallback: number): ElevationAt {
  return (lon, lat) => {
    const fx = ((mercX(lon) - g.x0) / (g.x1 - g.x0)) * (g.cols - 1);
    const fy = ((mercY(lat) - g.y0) / (g.y1 - g.y0)) * (g.rows - 1);
    const cx = Math.min(g.cols - 1.001, Math.max(0, fx));
    const cy = Math.min(g.rows - 1.001, Math.max(0, fy));
    const c0 = Math.floor(cx);
    const r0 = Math.floor(cy);
    const tx = cx - c0;
    const ty = cy - r0;
    const at = (c: number, r: number) => {
      const v = g.data[r * g.cols + c];
      return Number.isNaN(v) ? fallback : v;
    };
    const top = at(c0, r0) * (1 - tx) + at(c0 + 1, r0) * tx;
    const bottom = at(c0, r0 + 1) * (1 - tx) + at(c0 + 1, r0 + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  };
}
