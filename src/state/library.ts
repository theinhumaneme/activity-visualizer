import { create } from "zustand";
import type { Units } from "../lib/analysis/types";
import { defaultUnits } from "../lib/format/format";
import { clearEntries, deleteEntries, loadEntries, saveEntries } from "../lib/library/persist";
import { processFiles } from "../lib/library/pool";
import { readActivityFile } from "../lib/parse/read";
import { RECORD_VERSION, isDuplicate, readableName } from "../lib/library/record";
/** A Strava export's activities.csv. Reading it loads on demand: most libraries never see one. */
const STRAVA_CSV = /(^|\/)activities\.csv$/i;
const strava = () => import("../lib/library/strava");
import type { LibraryEntry } from "../lib/library/types";
import { DEFAULT_PRIVACY_RADIUS, useStore } from "./store";

/** Files the library can read: TCX, GPX and FIT, optionally gzipped (as in a Strava bulk export). */
export const LIBRARY_FILE = /\.(tcx|gpx|fit)(\.gz)?$/i;
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
  /** Files left out before parsing (not TCX/GPX/FIT), and activities already in the library. */
  unsupported: number;
  duplicates: number;
  /** Activities named from a Strava export's activities.csv in the last files added. */
  fromStrava: number;
  units: Units;
  /** Reading the saved library at startup. */
  restoring: boolean;
  /** The browser wouldn't keep the last files added (storage full or off): they last this visit only. */
  notSaved: boolean;
  /** Saved activities from an older version being re-read for the newer stats. */
  upgrading: { done: number; total: number } | null;
  addFiles(files: File[]): Promise<void>;
  cancel(): void;
  clear(): void;
  /** Takes these activities out of the library and the copy kept in this browser. */
  remove(ids: string[]): void;
  setUnits(u: Units): void;
  /** Loads one activity into the single-activity flow. */
  open(id: string): Promise<boolean>;
  /** Stitches several activities into one, in the order they happened, and loads that. */
  openCombined(ids: string[]): Promise<boolean>;
}

let abort: AbortController | null = null;
let seq = 0;
/** Ids stay unique across visits now that entries are saved. */
const session = Date.now().toString(36);

export const useLibrary = create<LibraryState>((set, get) => ({
  entries: [],
  loading: false,
  progress: { done: 0, total: 0 },
  problems: [],
  unsupported: 0,
  duplicates: 0,
  fromStrava: 0,
  units: storedUnits(),
  restoring: typeof indexedDB !== "undefined",
  notSaved: false,
  upgrading: null,

  async addFiles(files) {
    if (get().loading) return;
    // A Strava export's activities.csv names its files; it applies to activities already here too.
    const csv = files.find((f) => STRAVA_CSV.test(f.webkitRelativePath || f.name));
    const { fileKey, readActivitiesCsv, withStrava } = csv ? await strava() : { fileKey: null, readActivitiesCsv: null, withStrava: null };
    const details = csv ? await csv.text().then(readActivitiesCsv!, () => null) : null;
    let fromStrava = 0;
    if (details?.size) {
      const named: LibraryEntry[] = [];
      const entries = get().entries.map((e) => {
        const d = details.get(fileKey!(e.fileName));
        if (!d) return e;
        const n = withStrava!(e, d);
        named.push(n);
        return n;
      });
      if (named.length) {
        fromStrava = named.length;
        set({ entries });
        void saveEntries(named);
      }
    }
    const readable = files.filter((f) => LIBRARY_FILE.test(f.name));
    const tooBig = readable.filter((f) => f.size > MAX_BYTES);
    const jobs = readable.filter((f) => f.size <= MAX_BYTES).map((file) => ({ id: `${session}-${++seq}`, file }));
    const ctrl = new AbortController();
    abort = ctrl;
    set({
      loading: jobs.length > 0,
      progress: { done: 0, total: jobs.length },
      problems: tooBig.map((f) => ({ fileName: f.name, message: "Over 60 MB; skipped." })),
      unsupported: files.length - readable.length - (csv ? 1 : 0),
      duplicates: 0,
      fromStrava,
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
          const d = details && details.get(fileKey!(job.file.name));
          for (const rec of result.records) {
            const r = d ? withStrava!(rec, d) : rec;
            if (entries.some((e) => isDuplicate(e, r)) || added.some((e) => isDuplicate(e, r))) duplicates++;
            else {
              added.push({ ...r, file: job.file });
              if (r.strava) fromStrava++;
            }
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
      fromStrava,
    }));
    if (added.length) {
      const saved = await saveEntries(added);
      set({ notSaved: !saved });
    }
  },

  cancel() {
    abort?.abort();
    abort = null;
    set({ loading: false });
  },

  clear() {
    abort?.abort();
    abort = null;
    set({ entries: [], loading: false, progress: { done: 0, total: 0 }, problems: [], unsupported: 0, duplicates: 0, fromStrava: 0, notSaved: false });
    void clearEntries();
  },

  remove(ids) {
    const gone = new Set(ids);
    set((s) => ({ entries: s.entries.filter((e) => !gone.has(e.id)) }));
    void deleteEntries(ids);
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
    return useStore.getState().loadFile(entry.file, { index: entry.activityIndex, name: entry.name });
  },

  async openCombined(ids) {
    const picked = get()
      .entries.filter((e) => ids.includes(e.id))
      .sort((a, b) => a.startTime - b.startTime);
    try {
      const sources = await Promise.all(picked.map(async (e) => ({ ...(await readActivityFile(e.file, e.file.name)), index: e.activityIndex, name: e.name })));
      return await useStore.getState().loadCombined(sources);
    } catch (err) {
      useStore.setState({ loading: false, error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },
}));

/**
 * Re-reads saved activities whose records predate the current version, in the background, so
 * stats added since (load, zones, GAP) cover the whole library. An activity whose file can't be
 * read again keeps its old record.
 */
async function upgrade(stale: LibraryEntry[]) {
  // One job per file; its records come back as `${job id}#${activity index}`, matching the saved ids.
  const files = new Map<string, File>();
  for (const e of stale) files.set(e.id.slice(0, e.id.lastIndexOf("#")), e.file);
  const jobs = [...files].map(([id, file]) => ({ id, file }));
  const fresh = new Map<string, LibraryEntry>();
  let done = 0;
  useLibrary.setState({ upgrading: { done, total: jobs.length } });
  await processFiles(
    jobs,
    (job, result) => {
      done++;
      if (result.ok) for (const r of result.records) fresh.set(r.id, { ...r, file: job.file });
      useLibrary.setState({ upgrading: { done, total: jobs.length } });
    },
    { concurrency: 2 },
  );
  const updated: LibraryEntry[] = [];
  const { withStrava } = await strava();
  useLibrary.setState((s) => ({
    upgrading: null,
    entries: s.entries.map((e) => {
      const f = fresh.get(e.id);
      if (!f || (e.version ?? 1) >= RECORD_VERSION) return e;
      // What Strava's CSV said isn't in the file; keep it.
      const g = e.strava ? withStrava(f, e.strava) : f;
      updated.push(g);
      return g;
    }),
  }));
  if (updated.length) await saveEntries(updated);
}

// Bring back the library saved on earlier visits.
if (typeof indexedDB !== "undefined")
  void loadEntries()
    .then((saved) => {
      if (!saved.length) return;
      // Saved before id-only files got readable names.
      saved = saved.map((e) => (e.strava ? e : { ...e, name: readableName(e) }));
      useLibrary.setState((s) => {
        const ids = new Set(s.entries.map((e) => e.id));
        return { entries: [...s.entries, ...saved.filter((e) => !ids.has(e.id))].sort((a, b) => a.startTime - b.startTime) };
      });
      const stale = saved.filter((e) => (e.version ?? 1) < RECORD_VERSION && e.id.includes("#"));
      if (stale.length) void upgrade(stale).catch(() => useLibrary.setState({ upgrading: null }));
    })
    .catch(() => {})
    .finally(() => useLibrary.setState({ restoring: false }));
