import { create } from "zustand";
import type { Units } from "../lib/analysis/types";
import { defaultUnits } from "../lib/format/format";
import { processFiles } from "../lib/library/pool";
import { isDuplicate } from "../lib/library/record";
import type { LibraryEntry } from "../lib/library/types";
import { DEFAULT_PRIVACY_RADIUS, useStore } from "./store";

/** Files the library can read: TCX and GPX, optionally gzipped (as in a Strava bulk export). */
export const LIBRARY_FILE = /\.(tcx|gpx)(\.gz)?$/i;
const MAX_BYTES = 60 * 1024 * 1024;
const UNITS_KEY = "rv:units";
const PRIVACY_KEY = "rv:privacy-radius";

/** The privacy radius you set on the Check step (shared with the single-activity flow). */
export function libraryPrivacyRadius(): number {
  try {
    const v = localStorage.getItem(PRIVACY_KEY);
    if (v !== null && Number.isFinite(Number(v))) return Math.max(0, Math.min(1000, Number(v)));
  } catch {
    // Storage unavailable.
  }
  return DEFAULT_PRIVACY_RADIUS;
}

function storedUnits(): Units {
  try {
    const u = localStorage.getItem(UNITS_KEY);
    if (u === "metric" || u === "imperial") return u;
  } catch {
    // Storage unavailable.
  }
  return defaultUnits();
}

export interface FileProblem {
  fileName: string;
  message: string;
}

interface LibraryState {
  /** Oldest first. */
  entries: LibraryEntry[];
  loading: boolean;
  progress: { done: number; total: number };
  problems: FileProblem[];
  /** Files left out before parsing (not TCX/GPX), and activities already in the library. */
  unsupported: number;
  duplicates: number;
  units: Units;
  addFiles(files: File[]): Promise<void>;
  cancel(): void;
  clear(): void;
  setUnits(u: Units): void;
  /** Loads one activity into the single-activity flow. */
  open(id: string): Promise<boolean>;
}

let abort: AbortController | null = null;
let seq = 0;

export const useLibrary = create<LibraryState>((set, get) => ({
  entries: [],
  loading: false,
  progress: { done: 0, total: 0 },
  problems: [],
  unsupported: 0,
  duplicates: 0,
  units: storedUnits(),

  async addFiles(files) {
    if (get().loading) return;
    const readable = files.filter((f) => LIBRARY_FILE.test(f.name));
    const tooBig = readable.filter((f) => f.size > MAX_BYTES);
    const jobs = readable.filter((f) => f.size <= MAX_BYTES).map((file) => ({ id: `f${++seq}`, file }));
    const ctrl = new AbortController();
    abort = ctrl;
    set({
      loading: jobs.length > 0,
      progress: { done: 0, total: jobs.length },
      problems: tooBig.map((f) => ({ fileName: f.name, message: "Over 60 MB; skipped." })),
      unsupported: files.length - readable.length,
      duplicates: 0,
    });
    if (!jobs.length) return;

    const added: LibraryEntry[] = [];
    const problems: FileProblem[] = [];
    let duplicates = 0;
    let done = 0;
    let lastPaint = 0;
    await processFiles(
      jobs,
      (job, result) => {
        done++;
        if (!result.ok) problems.push({ fileName: job.file.name, message: result.error });
        else {
          for (const msg of result.skipped) problems.push({ fileName: job.file.name, message: msg });
          const entries = get().entries;
          for (const r of result.records) {
            if (entries.some((e) => isDuplicate(e, r)) || added.some((e) => isDuplicate(e, r))) duplicates++;
            else added.push({ ...r, file: job.file });
          }
        }
        // Progress repaints at most ~10×/s so 500 files don't mean 500 renders.
        const now = performance.now();
        if (now - lastPaint > 100 || done === jobs.length) {
          lastPaint = now;
          set({ progress: { done, total: jobs.length } });
        }
      },
      // Each worker needs ~20 MB at most for a 9 MB file, so use most cores (up to 6).
      { concurrency: Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)), signal: ctrl.signal },
    );
    if (abort !== ctrl) return;
    abort = null;
    // Commit once at the end: one re-render of the maps and charts instead of hundreds.
    set((s) => ({
      entries: [...s.entries, ...added].sort((a, b) => a.startTime - b.startTime),
      loading: false,
      progress: { done, total: jobs.length },
      problems: [...s.problems, ...problems],
      duplicates,
    }));
  },

  cancel() {
    abort?.abort();
    abort = null;
    set({ loading: false });
  },

  clear() {
    abort?.abort();
    abort = null;
    set({ entries: [], loading: false, progress: { done: 0, total: 0 }, problems: [], unsupported: 0, duplicates: 0 });
  },

  setUnits(u) {
    try {
      localStorage.setItem(UNITS_KEY, u);
    } catch {
      // Not critical.
    }
    set({ units: u });
    // Keep the single-activity flow in step when it has an activity loaded.
    const main = useStore.getState();
    if (main.settings && main.settings.units !== u) main.updateSettings({ units: u });
  },

  async open(id) {
    const entry = get().entries.find((e) => e.id === id);
    if (!entry) return false;
    const main = useStore.getState();
    let ok: boolean;
    if (/\.gz$/i.test(entry.file.name)) {
      const text = await new Response(entry.file.stream().pipeThrough(new DecompressionStream("gzip"))).text();
      ok = await main.loadText(text, entry.file.name.replace(/\.gz$/i, ""));
    } else ok = await main.loadFile(entry.file);
    if (!ok) return false;
    const s = useStore.getState();
    if (s.activities.length > 1 && s.activities[entry.activityIndex]) s.chooseActivity(entry.activityIndex);
    return true;
  },
}));
