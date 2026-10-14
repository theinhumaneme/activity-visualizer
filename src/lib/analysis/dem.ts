import { mercX, mercY } from "../geo/geo";
import { fetchWithRetry } from "../net/retryFetch";

const TILE = 256;
const MAX_TILES = 48;

/**
 * Samples terrain elevation (meters) for each point from Terrarium-encoded DEM tiles
 * served by our Worker. Picks the highest zoom (≤14) that needs at most MAX_TILES tiles.
 */
export async function sampleTerrain(points: { lat: number; lon: number }[], signal?: AbortSignal): Promise<Float64Array> {
  let z = 14;
  let tiles = tileSet(points, z);
  while (tiles.size > MAX_TILES && z > 8) tiles = tileSet(points, --z);

  const images = new Map<string, Uint8ClampedArray | null>();
  await Promise.all(
    [...tiles].map(async (k) => {
      try {
        const res = await fetchWithRetry(`/api/tiles/terrain/${z}/${k}`, signal);
        if (!res.ok) throw new Error(String(res.status));
        const bmp = await createImageBitmap(await res.blob());
        const canvas = new OffscreenCanvas(TILE, TILE);
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(bmp, 0, 0, TILE, TILE);
        images.set(k, ctx.getImageData(0, 0, TILE, TILE).data);
      } catch {
        images.set(k, null);
      }
    }),
  );

  const scale = TILE * 2 ** z;
  const decode = (d: Uint8ClampedArray, px: number, py: number) => {
    const o = (py * TILE + px) * 4;
    return d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768;
  };
  return Float64Array.from(points, (p) => {
    const wx = mercX(p.lon) * scale - 0.5;
    const wy = mercY(p.lat) * scale - 0.5;
    const tx = Math.floor((wx + 0.5) / TILE);
    const ty = Math.floor((wy + 0.5) / TILE);
    const data = images.get(`${tx}/${ty}`);
    if (!data) return NaN;
    // Bilinear within the tile (edge pixels clamp; good enough at ~5–10 m/px).
    const lx = Math.min(TILE - 1.001, Math.max(0, wx - tx * TILE));
    const ly = Math.min(TILE - 1.001, Math.max(0, wy - ty * TILE));
    const x0 = Math.floor(lx);
    const y0 = Math.floor(ly);
    const fx = lx - x0;
    const fy = ly - y0;
    const top = decode(data, x0, y0) * (1 - fx) + decode(data, x0 + 1, y0) * fx;
    const bottom = decode(data, x0, y0 + 1) * (1 - fx) + decode(data, x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  });
}

function tileSet(points: { lat: number; lon: number }[], z: number): Set<string> {
  const n = 2 ** z;
  const set = new Set<string>();
  for (const p of points) set.add(`${Math.floor(mercX(p.lon) * n)}/${Math.floor(mercY(p.lat) * n)}`);
  return set;
}
