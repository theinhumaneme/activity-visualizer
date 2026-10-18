// Reliable tile loading. MapLibre gives up on a tile after one failed request and then treats it
// as "loaded", so a rate limit (429) or a flaky upstream (5xx) leaves a hole in the map that an
// export would capture silently. Every tile request goes through `fetchWithRetry` instead, and
// failures that survive the retries are counted so the exporter can reload and re-check a frame.
//
// Exports also preload: `preloadTiles` works out every tile the whole flight will need and fetches
// them in parallel into a tile store, which the protocol answers from. Frames then render
// without a network round trip, instead of each one waiting on its own tiles in turn.

import { type Map as MlMap, type RequestTransformFunction, addProtocol } from "maplibre-gl";
import { fetchWithRetry, tileHealth } from "../net/retryFetch";

export { fetchWithRetry, tileHealth };

const SCHEME = "retry";

let installed = false;
/** Registers the retrying tile protocol (once). */
export function installTileRetry() {
  if (installed) return;
  installed = true;
  addProtocol(SCHEME, async (params, abort) => {
    const url = params.url.slice(SCHEME.length + 3);
    const stored = await store?.get(url);
    if (stored) return { data: stored };
    const res = await fetchWithRetry(url, abort.signal);
    if (!res.ok) {
      if (res.status !== 404) {
        tileHealth.failed++;
        tileHealth.failedUrls.add(url);
      }
      throw new Error(`Tile request failed (${res.status})`);
    }
    return { data: await res.arrayBuffer(), cacheControl: res.headers.get("Cache-Control"), expires: res.headers.get("Expires") };
  });
}

/** Map option: route every http(s) tile request through the retrying protocol. */
export const retryTiles: RequestTransformFunction = (url, type) => {
  installTileRetry();
  return type === "Tile" && /^https?:\/\//.test(url) ? { url: `${SCHEME}://${url}` } : undefined;
};

/**
 * Reloads the sources that had tiles fail after all retries, so they're requested again.
 * Re-setting a source's tiles is MapLibre's public way to do it; tiles that did load come
 * straight back from the browser cache.
 */
export function reloadFailedTiles(map: MlMap) {
  if (!tileHealth.failedUrls.size) return;
  const failed = [...tileHealth.failedUrls];
  tileHealth.failedUrls.clear();
  for (const id of Object.keys(map.getStyle().sources)) {
    const src = map.getSource(id) as { tiles?: string[]; setTiles?: (t: string[]) => void } | undefined;
    const tiles = src?.tiles;
    if (!tiles?.length || !src?.setTiles) continue;
    const prefixes = tiles.map((t) => t.slice(0, t.indexOf("{")));
    if (failed.some((u) => prefixes.some((p) => p && u.startsWith(p)))) src.setTiles([...tiles]);
  }
}

// --- Preloading --------------------------------------------------------------------------------

/** Tiles fetched ahead of an export: in Cache Storage (on disk) where available, else memory. */
interface TileStore {
  get(url: string): Promise<ArrayBuffer | undefined>;
  put(url: string, data: ArrayBuffer): Promise<void>;
  clear(): Promise<void>;
}

const CACHE_NAME = "export-tiles";
/** In-memory fallback budget; past it, tiles are still fetched (warming the HTTP cache) but not kept. */
const MEMORY_BUDGET = 64 * 1024 * 1024;

let store: TileStore | null = null;
/** URLs already in the store, so planning again (new length, camera…) only fetches what's new. */
const stored = new Set<string>();

async function openStore(): Promise<TileStore> {
  try {
    if (typeof caches !== "undefined") {
      await caches.delete(CACHE_NAME);
      const cache = await caches.open(CACHE_NAME);
      return {
        get: async (url) => (await cache.match(url))?.arrayBuffer(),
        put: (url, data) => cache.put(url, new Response(data)).catch(() => undefined),
        clear: () => caches.delete(CACHE_NAME).then(() => undefined),
      };
    }
  } catch {
    // Cache Storage can be unavailable (insecure context, private mode): fall back to memory.
  }
  const mem = new Map<string, ArrayBuffer>();
  let bytes = 0;
  return {
    get: async (url) => mem.get(url),
    put: async (url, data) => {
      if (bytes + data.byteLength > MEMORY_BUDGET) return;
      mem.set(url, data);
      bytes += data.byteLength;
    },
    clear: async () => mem.clear(),
  };
}

/** A camera position to plan tiles for (what `jumpTo` takes). */
export interface PlannedCamera {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
  elevation: number;
}

interface TiledSource {
  type: string;
  tiles?: string[];
  tileSize?: number;
  minzoom?: number;
  maxzoom?: number;
  roundZoom?: boolean;
  scheme?: string;
}

/**
 * Every tile URL the map will request along these cameras, in the order they're first needed.
 * Moves the map's camera (it should be off-screen); uses MapLibre's own tile selection, with the
 * sizes it uses for each kind of source (terrain loads its elevation tiles at twice the size).
 */
export function planTiles(map: MlMap, cameras: PlannedCamera[]): string[] {
  const style = map.getStyle();
  const terrainId = map.getTerrain()?.source;
  const used = new Set(style.layers.filter((l) => "source" in l && l.layout?.visibility !== "none").map((l) => (l as { source: string }).source));
  if (terrainId) used.add(terrainId);
  const sources = [...used]
    .map((id) => ({ id, src: map.getSource(id) as unknown as TiledSource | undefined }))
    .filter(({ src }) => src && src.tiles?.length && /^https?:\/\//.test(src.tiles[0]))
    .map(({ id, src }) => ({
      tiles: src!.tiles!,
      scheme: src!.scheme,
      minzoom: src!.minzoom ?? 0,
      maxzoom: src!.maxzoom ?? 22,
      terrain: id === terrainId,
      tileSize: id === terrainId ? (src!.tileSize ?? 512) * 2 : (src!.tileSize ?? 512),
      roundZoom: id === terrainId ? false : !!src!.roundZoom,
    }));
  const ratio = map.getPixelRatio();
  // With 3D terrain MapLibre picks tiles by distance to the elevated ground, so near the camera it
  // asks for a finer zoom than a flat-ground estimate would. Its covering function accepts the
  // terrain (not in the public options type); pass it so the plan matches what it will request.
  const terrain = (map as unknown as { terrain?: unknown }).terrain;
  const urls = new Set<string>();
  for (const cam of cameras) {
    map.jumpTo(cam);
    for (const s of sources) {
      const options = { tileSize: s.tileSize, minzoom: s.minzoom, maxzoom: s.maxzoom, roundZoom: s.roundZoom, ...(terrain ? { terrain } : {}) };
      for (const id of map.coveringTiles(options)) {
        urls.add(id.canonical.url(s.tiles, ratio, s.scheme));
        // Terrain also keeps the parent tile in view to fill gaps while children load.
        if (s.terrain && id.canonical.z > s.minzoom) {
          const c = id.canonical;
          urls.add(id.scaledTo(c.z - 1).canonical.url(s.tiles, ratio, s.scheme));
        }
      }
    }
  }
  return [...urls];
}

/**
 * Fetches `urls` with a few requests in flight at once (gentle on the tile servers) into the tile
 * store the protocol reads from. Failures are left for the normal per-frame path to retry.
 * Call `releaseTiles` when the export is done.
 */
export async function preloadTiles(urls: string[], signal: AbortSignal, onProgress: (done: number, total: number) => void, concurrency = 8) {
  installTileRetry();
  store ??= await openStore();
  const s = store;
  urls = urls.filter((u) => !stored.has(u));
  const queued = new Set(urls);
  let next = 0;
  let done = 0;
  onProgress(0, urls.length);
  const worker = async () => {
    while (next < urls.length) {
      if (signal.aborted) throw new DOMException("Preload canceled", "AbortError");
      const url = urls[next++];
      try {
        const res = await fetchWithRetry(url, signal);
        if (res.ok) {
          await s.put(url, await res.arrayBuffer());
          stored.add(url);
        } else if (res.status === 404) {
          // No tile at this zoom (e.g. imagery that stops at z17 in the mountains): the map will
          // fall back to the parent tile, so fetch that too rather than waiting on it mid-flight.
          const parent = parentTileUrl(url);
          if (parent && !queued.has(parent) && !stored.has(parent)) {
            queued.add(parent);
            urls.push(parent);
          }
        }
      } catch (err) {
        if (signal.aborted) throw err;
      }
      onProgress(++done, urls.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
}

/** The z-1 tile covering a `/z/x/y` tile URL (query string kept), or null for other URL shapes. */
export function parentTileUrl(url: string): string | null {
  const m = /\/(\d+)\/(\d+)\/(\d+)(\.\w+)?(\?[^#]*)?$/.exec(url);
  if (!m) return null;
  const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (z <= 0) return null;
  return `${url.slice(0, m.index)}/${z - 1}/${x >> 1}/${y >> 1}${m[4] ?? ""}${m[5] ?? ""}`;
}

/** Drops preloaded tiles. */
export async function releaseTiles() {
  const s = store;
  store = null;
  stored.clear();
  await s?.clear();
}
