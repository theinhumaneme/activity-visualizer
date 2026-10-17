// analyze() in a worker, for the page. Each activity is sent once; a settings change sends only the
// settings. One job runs at a time, and a newer request for the same activity replaces one still
// waiting (it resolves null), so dragging a slider can't queue up stale work. Without workers
// (tests, very old browsers) it runs on the main thread as before.

import { analyze } from "./analyze";
import type { FromWorker, ToWorker } from "./analysisHost";
import { decodeSamples } from "./columns";
import type { Analysis, Settings } from "./types";
import type { Activity } from "../parse/types";

/** What the client needs from a Worker (a fake in tests). */
export interface WorkerLike {
  postMessage(message: ToWorker): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

interface Job {
  activity: Activity;
  settings: Settings;
  dem: Float64Array | null;
  resolve: (a: Analysis | null) => void;
  reject: (e: Error) => void;
}

/** Activities kept in the worker at once (the current one, plus a few others in a multi-activity file). */
const KEEP = 4;

export class Analyzer {
  private worker: WorkerLike | null;
  private ids = new Map<Activity, number>();
  private dems = new Map<number, Float64Array | null>();
  private nextId = 1;
  private nextReq = 1;
  private running: { req: number; job: Job } | null = null;
  private queue: Job[] = [];

  constructor(spawn: () => WorkerLike | null) {
    this.worker = spawn();
    if (!this.worker) return;
    this.worker.onmessage = (e) => this.done(e.data);
    // A broken worker (e.g. it failed to load) falls back to the main thread for good.
    this.worker.onerror = () => {
      const jobs = [...(this.running ? [this.running.job] : []), ...this.queue];
      this.running = null;
      this.queue = [];
      this.worker?.terminate();
      this.worker = null;
      for (const j of jobs) this.runHere(j);
    };
  }

  /** The analysis, or null if a newer request for the same activity replaced this one first. */
  analyze(activity: Activity, settings: Settings, dem: Float64Array | null): Promise<Analysis | null> {
    return new Promise((resolve, reject) => {
      const job: Job = { activity, settings, dem, resolve, reject };
      if (!this.worker) return this.runHere(job);
      for (const old of this.queue.filter((j) => j.activity === activity)) old.resolve(null);
      this.queue = this.queue.filter((j) => j.activity !== activity);
      this.queue.push(job);
      this.pump();
    });
  }

  private runHere(job: Job) {
    try {
      job.resolve(analyze(job.activity, job.settings, job.dem));
    } catch (err) {
      job.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private pump() {
    const w = this.worker;
    if (!w || this.running || !this.queue.length) return;
    const job = this.queue.shift()!;
    const id = this.idFor(w, job.activity);
    if (this.dems.get(id) !== job.dem) {
      w.postMessage({ type: "dem", id, dem: job.dem });
      this.dems.set(id, job.dem);
    }
    const req = this.nextReq++;
    this.running = { req, job };
    w.postMessage({ type: "run", req, id, settings: job.settings });
  }

  private idFor(w: WorkerLike, activity: Activity) {
    let id = this.ids.get(activity);
    if (id !== undefined) return id;
    id = this.nextId++;
    w.postMessage({ type: "put", id, activity });
    this.ids.set(activity, id);
    this.dems.set(id, null);
    // Forget the oldest activities (Map keeps insertion order).
    for (const [a, old] of this.ids) {
      if (this.ids.size <= KEEP) break;
      if (a === activity) continue;
      w.postMessage({ type: "drop", id: old });
      this.ids.delete(a);
      this.dems.delete(old);
    }
    return id;
  }

  private done(m: FromWorker) {
    const r = this.running;
    if (!r || m.req !== r.req) return;
    this.running = null;
    if ("error" in m) r.job.reject(new Error(m.error));
    else r.job.resolve({ ...m.analysis, activity: r.job.activity, samples: decodeSamples(m.columns) } as Analysis);
    this.pump();
  }
}

function spawnWorker(): WorkerLike | null {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker(new URL("./analysisWorker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;
  } catch {
    return null;
  }
}

let shared: Analyzer | null = null;

/** analyze() off the main thread; null when a newer request for the same activity replaced it. */
export function analyzeOffThread(activity: Activity, settings: Settings, dem: Float64Array | null): Promise<Analysis | null> {
  shared ??= new Analyzer(spawnWorker);
  return shared.analyze(activity, settings, dem);
}
