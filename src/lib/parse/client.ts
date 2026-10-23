import type { FileData } from "./read";
import type { Activity } from "./types";

/** Parses an activity file off the main thread. */
export function parseInWorker(data: FileData, fileName: string): Promise<Activity[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ ok: true; activities: Activity[] } | { ok: false; error: string }>) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.activities);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "Couldn't read the file."));
    };
    worker.postMessage({ data, fileName });
  });
}
