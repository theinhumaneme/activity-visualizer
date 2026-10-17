import { create } from "zustand";
import { defaultSettings } from "../lib/analysis/analyze";
import { analyzeOffThread } from "../lib/analysis/remote";
import { headlineFor } from "../lib/analysis/report";
import { sampleTerrain } from "../lib/analysis/dem";
import type { Analysis, Settings, Units } from "../lib/analysis/types";
import { defaultUnits } from "../lib/format/format";
import { ACCENT, type ColorMode, ROUTE_COLORS } from "../lib/map/route";
import { parseInWorker } from "../lib/parse/client";
import type { LookId } from "../lib/map/style";
import type { CameraMode } from "../lib/playback/timeline";
import type { Activity } from "../lib/parse/types";
import { boundsOf } from "../lib/geo/geo";
import { type TerrainGrid, gridPoints } from "../lib/geo/terrainGrid";

export const SAMPLE_URL = "/samples/reservoir-loop.tcx.xml";
export const SAMPLE_NAME = "Reservoir Loop (sample).tcx";
const SESSION_KEY = "rv:last-file";
const UNITS_KEY = "rv:units";
const ROUTE_COLOR_KEY = "rv:route-color";
const PRIVACY_KEY = "rv:privacy-radius";
const LOOK_KEY = "rv:look";
const LOOK_IDS: LookId[] = ["night", "golden", "editorial", "satellite"];

function storedLook(): LookId {
  try {
    const v = localStorage.getItem(LOOK_KEY) as LookId | null;
    if (v && LOOK_IDS.includes(v)) return v;
  } catch {
    // Storage unavailable.
  }
  return "night";
}
/** Default privacy circle around start and finish. On by default: these files reveal where you live. */
export const DEFAULT_PRIVACY_RADIUS = 200;

function storedPrivacy(): number {
  try {
    const v = localStorage.getItem(PRIVACY_KEY);
    if (v !== null && Number.isFinite(Number(v))) return Math.max(0, Math.min(1000, Number(v)));
  } catch {
    // Storage unavailable.
  }
  return DEFAULT_PRIVACY_RADIUS;
}

function storedRouteColor(): string {
  try {
    const c = localStorage.getItem(ROUTE_COLOR_KEY);
    if (c && ROUTE_COLORS.some((r) => r.hex === c)) return c;
  } catch {
    // Storage unavailable.
  }
  return ACCENT;
}

export interface Highlight {
  from: number;
  to: number;
  label: string;
}

interface State {
  fileName: string | null;
  activities: Activity[];
  activity: Activity | null;
  settings: Settings | null;
  analysis: Analysis | null;
  dem: Float64Array | null;
  demStatus: "idle" | "loading" | "done" | "error";
  /** Elevation grid around the route for the flyover camera's terrain clearance. */
  terrainGrid: TerrainGrid | null;
  loading: boolean;
  error: string | null;
  hoverIndex: number | null;
  highlight: Highlight | null;
  colorMode: ColorMode;
  /** Solid route color (hex), used for the line, the moving dot and video accents. */
  routeColor: string;
  xAxis: "distance" | "time";
  /** Flyover map style. */
  look: LookId;
  cameraMode: CameraMode | "free";

  loadText(text: string, fileName: string): Promise<boolean>;
  loadFile(file: File): Promise<boolean>;
  loadSample(): Promise<boolean>;
  restoreSession(): Promise<void>;
  chooseActivity(index: number): void;
  updateSettings(patch: Partial<Settings>): void;
  setHover(i: number | null): void;
  setHighlight(h: Highlight | null): void;
  setColorMode(m: ColorMode): void;
  setRouteColor(hex: string): void;
  setXAxis(x: "distance" | "time"): void;
  setLook(l: LookId): void;
  setCameraMode(m: CameraMode | "free"): void;
  reset(): void;
}

function storedUnits(): Units {
  try {
    const u = localStorage.getItem(UNITS_KEY);
    if (u === "metric" || u === "imperial") return u;
  } catch {
    // Storage unavailable (private mode etc.).
  }
  return defaultUnits();
}

let demAbort: AbortController | null = null;
/** Bumped by each activity switch (and reset): a switch lands only if no newer one started. */
let selection = 0;
/** Bumped by each re-analysis of the current activity: only the newest result is applied. */
let revision = 0;

export const useStore = create<State>((set, get) => {
  /**
   * Re-analyzes the current activity in a worker and puts the result in place if it's still the
   * newest request. Settings show their new values at once; the analysis follows when ready.
   */
  function reanalyze(activity: Activity, settings: Settings, dem: Float64Array | null, resetHover: boolean) {
    const mine = ++revision;
    analyzeOffThread(activity, settings, dem).then(
      (a) => {
        if (!a || mine !== revision || get().activity !== activity) return;
        // Any change but a rename sends a newer request, so the current settings can only differ
        // from the requested ones by name: keep them, and the headline that uses the name.
        const current = get().settings ?? settings;
        const next: Analysis = { ...a, settings: current };
        if (current.name !== a.settings.name) next.headline = headlineFor(next);
        set(resetHover ? { analysis: next, hoverIndex: null, highlight: null } : { analysis: next });
      },
      (err) => console.error("Analysis failed", err),
    );
  }

  /** Switches to an activity once its first analysis is ready, so pages never see a mismatched pair. */
  async function selectActivity(activity: Activity) {
    const mine = ++selection;
    const settings = defaultSettings(activity, storedUnits(), storedPrivacy());
    const first = await analyzeOffThread(activity, settings, null);
    if (!first || mine !== selection) return;
    demAbort?.abort();
    // Results still on their way for the previous activity no longer apply.
    revision++;
    set({
      activity,
      settings,
      dem: null,
      demStatus: "loading",
      terrainGrid: null,
      analysis: { ...first, settings },
      hoverIndex: null,
      highlight: null,
    });
    const ctrl = new AbortController();
    demAbort = ctrl;
    sampleTerrain(activity.samples, ctrl.signal)
      .then((dem) => {
        if (ctrl.signal.aborted || get().activity !== activity) return;
        set({ dem, demStatus: "done" });
        reanalyze(activity, get().settings!, dem, false);
      })
      .catch(() => {
        if (!ctrl.signal.aborted) set({ demStatus: "error" });
      });
    // The camera trails up to ~1 km behind and above the route, so sample a margin around it.
    const grid = gridPoints(boundsOf(activity.samples), 1500);
    sampleTerrain(grid.points, ctrl.signal)
      .then((data) => {
        if (ctrl.signal.aborted || get().activity !== activity) return;
        set({ terrainGrid: { x0: grid.x0, y0: grid.y0, x1: grid.x1, y1: grid.y1, cols: grid.cols, rows: grid.rows, data } });
      })
      .catch(() => {
        // The camera falls back to a conservative floor from the route's own elevation.
      });
  }

  return {
    fileName: null,
    activities: [],
    activity: null,
    settings: null,
    analysis: null,
    dem: null,
    demStatus: "idle",
    terrainGrid: null,
    loading: false,
    error: null,
    hoverIndex: null,
    highlight: null,
    colorMode: "solid",
    routeColor: storedRouteColor(),
    xAxis: "distance",
    look: storedLook(),
    cameraMode: "cinematic",

    async loadText(text, fileName) {
      set({ loading: true, error: null });
      try {
        const activities = await parseInWorker(text, fileName);
        // Default to the longest activity when a file holds several.
        const best = activities.reduce((x, y) => (y.samples.length > x.samples.length ? y : x));
        set({ fileName, activities });
        await selectActivity(best);
        set({ loading: false });
        try {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify({ fileName, text }));
        } catch {
          // Too large or storage unavailable; refresh will just return to upload.
        }
        return true;
      } catch (err) {
        set({ loading: false, error: err instanceof Error ? err.message : String(err) });
        return false;
      }
    },

    async loadFile(file) {
      if (file.size > 60 * 1024 * 1024) {
        set({ error: "That file is over 60 MB. Activity exports are usually under 10 MB; is it the right file?" });
        return false;
      }
      return get().loadText(await file.text(), file.name);
    },

    async loadSample() {
      set({ loading: true, error: null });
      try {
        const res = await fetch(SAMPLE_URL);
        if (!res.ok) throw new Error(`Couldn't load the sample (${res.status}).`);
        return get().loadText(await res.text(), SAMPLE_NAME);
      } catch (err) {
        set({ loading: false, error: err instanceof Error ? err.message : String(err) });
        return false;
      }
    },

    async restoreSession() {
      if (get().activity) return;
      try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return;
        const { fileName, text } = JSON.parse(raw) as { fileName: string; text: string };
        await get().loadText(text, fileName);
      } catch {
        // Ignore a corrupt session entry.
      }
    },

    chooseActivity(index) {
      const a = get().activities[index];
      if (a) selectActivity(a).catch((err) => set({ error: err instanceof Error ? err.message : String(err) }));
    },

    updateSettings(patch) {
      const { activity, settings, dem } = get();
      if (!activity || !settings) return;
      const next = { ...settings, ...patch };
      if (patch.maxHr !== undefined) next.maxHrEstimated = false;
      if (patch.privacyRadius !== undefined) {
        try {
          localStorage.setItem(PRIVACY_KEY, String(patch.privacyRadius));
        } catch {
          // Not critical.
        }
      }
      if (patch.units) {
        try {
          localStorage.setItem(UNITS_KEY, patch.units);
        } catch {
          // Not critical.
        }
      }
      // The name only feeds the headline; renaming (one call per keystroke) skips the re-analysis.
      const analysis = get().analysis;
      if (analysis && Object.keys(patch).every((k) => k === "name")) {
        const renamed = { ...analysis, settings: next };
        renamed.headline = headlineFor(renamed);
        set({ settings: next, analysis: renamed });
        return;
      }
      set({ settings: next });
      reanalyze(activity, next, dem, true);
    },

    setHover: (i) => {
      if (get().hoverIndex !== i) set({ hoverIndex: i });
    },
    setHighlight: (h) => set({ highlight: h }),
    setColorMode: (m) => set({ colorMode: m }),
    setRouteColor(hex) {
      try {
        localStorage.setItem(ROUTE_COLOR_KEY, hex);
      } catch {
        // Not critical.
      }
      set({ routeColor: hex });
    },
    setXAxis: (x) => set({ xAxis: x }),
    setLook(l) {
      try {
        localStorage.setItem(LOOK_KEY, l);
      } catch {
        // Not critical.
      }
      set({ look: l });
    },
    setCameraMode: (m) => set({ cameraMode: m }),
    reset() {
      demAbort?.abort();
      selection++;
      revision++;
      try {
        sessionStorage.removeItem(SESSION_KEY);
      } catch {
        // Not critical.
      }
      set({
        fileName: null,
        activities: [],
        activity: null,
        settings: null,
        analysis: null,
        dem: null,
        demStatus: "idle",
        terrainGrid: null,
        error: null,
        hoverIndex: null,
        highlight: null,
      });
    },
  };
});
