// Reliable tile loading. MapLibre gives up on a tile after one failed request and then treats it
// as "loaded", so a rate limit (429) or a flaky upstream (5xx) leaves a hole in the map that an
// export would capture silently. Every tile request goes through `fetchWithRetry` instead, and
// failures that survive the retries are counted so the exporter can reload and re-check a frame.

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
