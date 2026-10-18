// Terrain (DEM) sampling itself, shared by the worker and the main-thread fallback.
import { mercX, mercY } from "../geo/geo";
import { fetchWithRetry } from "../net/retryFetch";

const TILE = 256;
const MAX_TILES = 48;
/** Decoded tiles kept for reuse (≈256 KB each): the route and the camera grid often share some. */
const CACHE_TILES = 64;

type Pixels = Uint8ClampedArray | null;
const tiles = new Map<string, Promise<Pixels>>();

/** One decoded Terrarium tile, fetched once even when several samplings ask for it at the same time. */
function tile(z: number, k: string): Promise<Pixels> {
  const key = `${z}/${k}`;
  const hit = tiles.get(key);
  if (hit) {
    tiles.delete(key);
    tiles.set(key, hit);
    return hit;
  }
  const p = (async () => {
    const res = await fetchWithRetry(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`);
    if (!res.ok) throw new Error(String(res.status));
    const bmp = await createImageBitmap(await res.blob());
    const canvas = new OffscreenCanvas(TILE, TILE);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0, TILE, TILE);
    bmp.close();
    return ctx.getImageData(0, 0, TILE, TILE).data;
  })().catch(() => {
    // Don't remember failures: the next sampling tries again.
    tiles.delete(key);
    return null;
  });
  tiles.set(key, p);
  if (tiles.size > CACHE_TILES) tiles.delete(tiles.keys().next().value!);
  return p;
}

/**
 * Samples terrain elevation (meters) at each point from Terrarium-encoded DEM tiles (AWS Terrain
 * Tiles, fetched directly). Picks the highest zoom (≤14) that needs at most MAX_TILES tiles. Runs wherever it's
 * called; `sampleTerrain` (dem.ts) sends it to a worker.
 */
export async function sampleTerrainHere(lat: ArrayLike<number>, lon: ArrayLike<number>, signal?: AbortSignal): Promise<Float64Array> {
  let z = 14;
  let keys = tileSet(lat, lon, z);
  while (keys.size > MAX_TILES && z > 8) keys = tileSet(lat, lon, --z);

  const images = new Map<string, Pixels>();
  await Promise.all([...keys].map(async (k) => images.set(k, await tile(z, k))));
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const scale = TILE * 2 ** z;
  const decode = (d: Uint8ClampedArray, px: number, py: number) => {
    const o = (py * TILE + px) * 4;
    return d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768;
  };
  const out = new Float64Array(lat.length);
  for (let i = 0; i < lat.length; i++) {
    const wx = mercX(lon[i]) * scale - 0.5;
    const wy = mercY(lat[i]) * scale - 0.5;
    const tx = Math.floor((wx + 0.5) / TILE);
    const ty = Math.floor((wy + 0.5) / TILE);
    const data = images.get(`${tx}/${ty}`);
    if (!data) {
      out[i] = NaN;
      continue;
    }
    // Bilinear within the tile (edge pixels clamp; good enough at ~5–10 m/px).
    const lx = Math.min(TILE - 1.001, Math.max(0, wx - tx * TILE));
    const ly = Math.min(TILE - 1.001, Math.max(0, wy - ty * TILE));
    const x0 = Math.floor(lx);
    const y0 = Math.floor(ly);
    const fx = lx - x0;
    const fy = ly - y0;
    const top = decode(data, x0, y0) * (1 - fx) + decode(data, x0 + 1, y0) * fx;
    const bottom = decode(data, x0, y0 + 1) * (1 - fx) + decode(data, x0 + 1, y0 + 1) * fx;
    out[i] = top * (1 - fy) + bottom * fy;
  }
  return out;
}

function tileSet(lat: ArrayLike<number>, lon: ArrayLike<number>, z: number): Set<string> {
  const n = 2 ** z;
  const set = new Set<string>();
  for (let i = 0; i < lat.length; i++) set.add(`${Math.floor(mercX(lon[i]) * n)}/${Math.floor(mercY(lat[i]) * n)}`);
  return set;
}
