/// <reference lib="webworker" />
// Terrain sampling off the main thread: fetch, decode and look up DEM tiles, hand back the result.
import { sampleTerrainHere } from "./demCore";

self.onmessage = async (e: MessageEvent<{ id: number; lat: Float64Array; lon: Float64Array }>) => {
  const { id, lat, lon } = e.data;
  try {
    const data = await sampleTerrainHere(lat, lon);
    self.postMessage({ id, data }, [data.buffer]);
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
