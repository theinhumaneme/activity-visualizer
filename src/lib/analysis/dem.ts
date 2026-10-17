// Terrain sampling for the store: runs demCore.ts in a worker (on the main thread if workers are unavailable).
import { sampleTerrainHere } from "./demCore";

// --- Off the main thread ----------------------------------------------------------------------

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (v: Float64Array) => void; reject: (e: Error) => void }>();

function demWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === "undefined") return null;
  try {
    worker = new Worker(new URL("./demWorker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
  worker.onmessage = (e: MessageEvent<{ id: number; data?: Float64Array; error?: string }>) => {
    const job = pending.get(e.data.id);
    if (!job) return;
    pending.delete(e.data.id);
    if (e.data.data) job.resolve(e.data.data);
    else job.reject(new Error(e.data.error ?? "Terrain sampling failed"));
  };
  worker.onerror = () => {
    for (const job of pending.values()) job.reject(new Error("Terrain worker failed"));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/**
 * Terrain elevation at each point, sampled in a worker so fetching and decoding tiles never
 * blocks the page. The worker keeps one tile cache, so the route and the camera grid share tiles.
 */
export function sampleTerrain(points: { lat: number; lon: number }[], signal?: AbortSignal): Promise<Float64Array> {
  const lat = Float64Array.from(points, (p) => p.lat);
  const lon = Float64Array.from(points, (p) => p.lon);
  const w = demWorker();
  if (!w) return sampleTerrainHere(lat, lon, signal);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const id = nextId++;
    pending.set(id, { resolve, reject });
    signal?.addEventListener(
      "abort",
      () => {
        if (pending.delete(id)) reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
    w.postMessage({ id, lat, lon }, [lat.buffer, lon.buffer]);
  });
}
