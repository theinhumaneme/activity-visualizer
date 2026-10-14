import type { LibraryJob, LibraryResult } from "./ingest";

const spawn = () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

function run(worker: Worker, job: LibraryJob): Promise<{ result: LibraryResult; crashed: boolean }> {
  return new Promise((resolve) => {
    worker.onmessage = (e: MessageEvent<LibraryResult>) => resolve({ result: e.data, crashed: false });
    worker.onerror = (e) => {
      e.preventDefault();
      resolve({ result: { id: job.id, ok: false, error: e.message || "Couldn't read the file." }, crashed: true });
    };
    worker.postMessage(job);
  });
}

/**
 * Parses and analyzes files in a few workers at once (default 3), reporting each result as it
 * lands. A file that crashes its worker gets a fresh worker for the next one.
 */
export async function processFiles(
  jobs: LibraryJob[],
  onResult: (job: LibraryJob, result: LibraryResult) => void,
  { concurrency = 3, signal }: { concurrency?: number; signal?: AbortSignal } = {},
): Promise<void> {
  let next = 0;
  const lanes = Math.max(1, Math.min(concurrency, jobs.length));
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      let worker = spawn();
      try {
        while (next < jobs.length && !signal?.aborted) {
          const job = jobs[next++];
          const { result, crashed } = await run(worker, job);
          if (crashed) {
            worker.terminate();
            worker = spawn();
          }
          if (!signal?.aborted) onResult(job, result);
        }
      } finally {
        worker.terminate();
      }
    }),
  );
}
