import { create } from "zustand";
import { defaultSettings } from "../lib/analysis/settings";
import { analyzeOffThread } from "../lib/analysis/remote";
import { headlineFor } from "../lib/analysis/headline";
import { sampleTerrain } from "../lib/analysis/dem";
import type { Analysis, Settings, Units } from "../lib/analysis/types";
import { defaultUnits } from "../lib/format/format";
import { ACCENT, type ColorMode, ROUTE_COLORS } from "../lib/map/route";
import { parseInWorker } from "../lib/parse/client";
import type { LookId } from "../lib/map/style";
import type { CameraMode } from "../lib/playback/timeline";
import { type DayStats, DEFAULT_END, DEFAULT_LIVE, type EndStat, type LiveStat } from "../lib/hud/stats";
import type { CameraDistance } from "../lib/playback/lengths";
import { type MapDetail, resolveDetail } from "../lib/map/detail";
import type { Activity } from "../lib/parse/types";
import { combineActivities } from "../lib/library/combine";
import { boundsOf } from "../lib/geo/geo";
import { type Weather, fetchWeather } from "../lib/weather";
import type { GhostRunner } from "../lib/playback/ghosts";
import { type Photo, readPhoto } from "../lib/photos";
import { HAZES, type Haze } from "../lib/map/sun";
import { type TerrainGrid, gridPoints } from "../lib/geo/terrainGrid";

export const SAMPLE_URL = "/samples/reservoir-loop.tcx.xml";
export const SAMPLE_NAME = "Reservoir Loop (sample).tcx";
const SESSION_KEY = "rv:last-file";
const UNITS_KEY = "rv:units";
const ROUTE_COLOR_KEY = "rv:route-color";
const PRIVACY_KEY = "rv:privacy-radius";
const LOOK_KEY = "rv:look";
const STATS_KEY = "rv:video-stats";
const DETAIL_KEY = "rv:map-detail";
const WEATHER_KEY = "rv:weather";
const FTP_KEY = "rv:ftp";
const WEIGHT_KEY = "rv:weight";
const W_PRIME_KEY = "rv:w-prime";
const LOOK_IDS: LookId[] = ["night", "golden", "editorial", "satellite", "noir", "bluehour", "blueprint"];

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

function storedStats(): { liveStats: LiveStat[]; endStats: EndStat[]; highlights: boolean; landmarks: boolean; buildings: boolean; sunLighting: boolean; haze: Haze; globeIntro: boolean; comparisons: boolean; credit: boolean; dayStats: DayStats } {
  // 3D buildings default to off where the device is Lite: extrusions are costly to draw.
  const buildingsDefault = resolveDetail(storedDetail()) !== "lite";
  try {
    const v = JSON.parse(localStorage.getItem(STATS_KEY) ?? "null") as { liveStats?: unknown; endStats?: unknown; highlights?: unknown; landmarks?: unknown; buildings?: unknown; sunLighting?: unknown; haze?: unknown; globeIntro?: unknown; comparisons?: unknown; credit?: unknown; dayStats?: unknown } | null;
    if (v && Array.isArray(v.liveStats) && Array.isArray(v.endStats))
      return {
        liveStats: v.liveStats as LiveStat[],
        endStats: v.endStats as EndStat[],
        highlights: v.highlights !== false,
        landmarks: v.landmarks !== false,
        buildings: typeof v.buildings === "boolean" ? v.buildings : buildingsDefault,
        sunLighting: v.sunLighting !== false,
        haze: HAZES.includes(v.haze as Haze) ? (v.haze as Haze) : "auto",
        globeIntro: v.globeIntro === true,
        comparisons: v.comparisons !== false,
        credit: v.credit !== false,
        dayStats: v.dayStats === "day" ? "day" : "each",
      };
  } catch {
    // Storage unavailable or corrupt.
  }
  return { liveStats: [...DEFAULT_LIVE], endStats: [...DEFAULT_END], highlights: true, landmarks: true, buildings: buildingsDefault, sunLighting: true, haze: "auto", globeIntro: false, comparisons: true, credit: true, dayStats: "each" };
}

function storedWeatherOn(): boolean {
  try {
    return localStorage.getItem(WEATHER_KEY) === "1";
  } catch {
    return false;
  }
}

function storedDetail(): MapDetail {
  try {
    const v = localStorage.getItem(DETAIL_KEY);
    if (v === "auto" || v === "lite" || v === "standard" || v === "high") return v;
  } catch {
    // Storage unavailable.
  }
  return "auto";
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

/** One activity of a combined day, as read from its file. */
export interface CombinedSource {
  text: string;
  fileName: string;
  /** Which activity in the file. */
  index: number;
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
  /** Weather lookup is opt-in (it sends a rounded location and the date to Open-Meteo). */
  weatherOn: boolean;
  weather: Weather | null;
  weatherStatus: "idle" | "loading" | "done" | "error";
  setWeatherOn(on: boolean): void;
  /** Earlier runs of this route to race in the flyover (set from the library's race). */
  ghosts: GhostRunner[] | null;
  ghostsOn: boolean;
  setGhosts(g: GhostRunner[] | null): void;
  setGhostsOn(on: boolean): void;
  /** Photos added for the flyover (in memory only), placed on the route when shown. */
  photos: Photo[];
  photosOn: boolean;
  /** Reads and adds photos; resolves with the names of any that couldn't be decoded. */
  addPhotos(files: File[]): Promise<string[]>;
  removePhoto(id: string): void;
  setPhotosOn(on: boolean): void;
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
  /** Values the video shows in the live panel and on the end card (saved for next time). */
  liveStats: LiveStat[];
  endStats: EndStat[];
  /** Label highlights (fastest mile, climbs…) on the map in the flyover and video. */
  highlights: boolean;
  /** Peak and landmark names on the flyover and video maps. */
  landmarks: boolean;
  /** 3D buildings in cities (off by default on Lite devices). */
  buildings: boolean;
  /** Light the terrain and buildings from where the sun was during the activity. */
  sunLighting: boolean;
  /** Haze over the distance: "auto" follows the weather when it's on. */
  haze: Haze;
  /** Open videos from the whole globe, diving down to the activity. */
  globeIntro: boolean;
  /** Playful scale for the totals ("Climbed ≈ 2.4 Eiffel Towers") on Overview, Analysis and the end card. */
  comparisons: boolean;
  /** "Made with Activity Visualizer" and the site's address on videos and posters. */
  credit: boolean;
  /** A combined day's live stats: per activity (default) or through the whole day. The end card always has the day's totals. */
  dayStats: DayStats;
  /** Chase camera distance (auto picks by sport). */
  cameraDistance: CameraDistance;
  setCameraDistance(d: CameraDistance): void;
  /** Map sharpness vs GPU load (auto picks from the device). */
  mapDetail: MapDetail;
  setMapDetail(d: MapDetail): void;

  loadText(text: string, fileName: string): Promise<boolean>;
  /** Stitches activities from several files into one (a combined day) and loads it. */
  loadCombined(sources: CombinedSource[]): Promise<boolean>;
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
  setVideoStats(patch: { liveStats?: LiveStat[]; endStats?: EndStat[]; highlights?: boolean; landmarks?: boolean; buildings?: boolean; sunLighting?: boolean; haze?: Haze; globeIntro?: boolean; comparisons?: boolean; credit?: boolean; dayStats?: DayStats }): void;
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

/** The rider's FTP, watts (0 = estimate from each ride). */
function storedFtp(): number {
  try {
    const v = Number(localStorage.getItem(FTP_KEY));
    if (v >= 50 && v <= 600) return v;
  } catch {
    // Storage unavailable.
  }
  return 0;
}

/** A remembered number within [lo, hi], or 0 when unset. */
function storedNumber(key: string, lo: number, hi: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    if (v >= lo && v <= hi) return v;
  } catch {
    // Storage unavailable.
  }
  return 0;
}
/** Body weight, kg (0 = not entered). */
const storedWeight = () => storedNumber(WEIGHT_KEY, 30, 200);
/** W′, joules (0 = the default). */
const storedWPrime = () => storedNumber(W_PRIME_KEY, 5000, 50000);

let demAbort: AbortController | null = null;
/** Bumped by each activity switch (and reset): a switch lands only if no newer one started. */
let selection = 0;
/** Bumped by each re-analysis of the current activity: only the newest result is applied. */
let revision = 0;
/** The restore from this tab's session in progress, shared by every caller. */
let restoring: Promise<void> | null = null;

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

  /** Fetches the weather for an activity if the user turned weather on (and the activity has times). */
  function loadWeather(activity: Activity) {
    set({ weather: null, weatherStatus: "idle" });
    if (!get().weatherOn || activity.routeOnly || !activity.samples.length) return;
    const first = activity.samples[0];
    const last = activity.samples[activity.samples.length - 1];
    set({ weatherStatus: "loading" });
    fetchWeather(first.lat, first.lon, first.time, last.time)
      .then((w) => {
        if (get().activity !== activity) return;
        set({ weather: w, weatherStatus: w ? "done" : "error" });
      })
      .catch(() => get().activity === activity && set({ weatherStatus: "error" }));
  }

  /** Switches to an activity once its first analysis is ready, so pages never see a mismatched pair. */
  async function selectActivity(activity: Activity) {
    const mine = ++selection;
    const settings = defaultSettings(activity, storedUnits(), storedPrivacy(), storedFtp(), storedWeight(), storedWPrime());
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
    loadWeather(activity);
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
    weatherOn: storedWeatherOn(),
    weather: null,
    weatherStatus: "idle",
    ghosts: null,
    ghostsOn: true,
    setGhosts: (ghosts) => set({ ghosts, ghostsOn: true }),
    setGhostsOn: (ghostsOn) => set({ ghostsOn }),
    photos: [],
    photosOn: true,
    async addPhotos(files) {
      const images = files.filter((f) => f.type.startsWith("image/") || /\.(jpe?g|heic|heif|png|webp|avif)$/i.test(f.name));
      const read = await Promise.all(images.map((f) => readPhoto(f).catch(() => null)));
      const added = read.filter((p): p is Photo => !!p);
      set((st) => ({ photos: [...st.photos, ...added], photosOn: true }));
      return images.filter((_, k) => !read[k]).map((f) => f.name);
    },
    removePhoto(id) {
      const p = get().photos.find((x) => x.id === id);
      p?.bitmap.close();
      set((st) => ({ photos: st.photos.filter((x) => x.id !== id) }));
    },
    setPhotosOn: (photosOn) => set({ photosOn }),
    setWeatherOn(on) {
      try {
        localStorage.setItem(WEATHER_KEY, on ? "1" : "0");
      } catch {
        // Not critical.
      }
      set({ weatherOn: on });
      const act = get().activity;
      if (on && act) loadWeather(act);
      if (!on) set({ weather: null, weatherStatus: "idle" });
    },
    loading: false,
    error: null,
    hoverIndex: null,
    highlight: null,
    colorMode: "solid",
    routeColor: storedRouteColor(),
    xAxis: "distance",
    look: storedLook(),
    cameraMode: "cinematic",
    ...storedStats(),
    cameraDistance: "auto",
    setCameraDistance: (d) => set({ cameraDistance: d }),
    mapDetail: storedDetail(),
    setMapDetail(d) {
      try {
        localStorage.setItem(DETAIL_KEY, d);
      } catch {
        // Not critical.
      }
      set({ mapDetail: d });
    },

    async loadText(text, fileName) {
      // Ghosts belong to the activity they were picked for.
      for (const p of get().photos) p.bitmap.close();
      set({ loading: true, error: null, ghosts: null, photos: [] });
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

    async loadCombined(sources) {
      for (const p of get().photos) p.bitmap.close();
      set({ loading: true, error: null, ghosts: null, photos: [] });
      try {
        const parsed = await Promise.all(sources.map((src) => parseInWorker(src.text, src.fileName)));
        const combined = combineActivities(parsed.map((acts, k) => acts[sources[k].index] ?? acts[0]));
        set({ fileName: combined.name, activities: [combined] });
        await selectActivity(combined);
        set({ loading: false });
        try {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify({ combined: sources }));
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

    restoreSession() {
      // StrictMode runs RequireActivity's effect twice. Separate restores would race: the second
      // supersedes the first's activity, so the first would finish with nothing loaded and the
      // page would bounce to Upload. One shared restore finishes only once the activity is in.
      restoring ??= (async () => {
        if (get().activity) return;
        try {
          const raw = sessionStorage.getItem(SESSION_KEY);
          if (!raw) return;
          const saved = JSON.parse(raw) as { fileName: string; text: string } | { combined: CombinedSource[] };
          if ("combined" in saved) await get().loadCombined(saved.combined);
          else await get().loadText(saved.text, saved.fileName);
        } catch {
          // Ignore a corrupt session entry.
        }
      })().finally(() => {
        restoring = null;
      });
      return restoring;
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
      for (const [key, value] of [
        [FTP_KEY, patch.ftp],
        [WEIGHT_KEY, patch.weight],
        [W_PRIME_KEY, patch.wPrime],
      ] as const) {
        if (value === undefined) continue;
        try {
          localStorage.setItem(key, String(value));
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
    setVideoStats(patch) {
      set(patch);
      try {
        localStorage.setItem(STATS_KEY, JSON.stringify({ liveStats: get().liveStats, endStats: get().endStats, highlights: get().highlights, landmarks: get().landmarks, buildings: get().buildings, sunLighting: get().sunLighting, haze: get().haze, globeIntro: get().globeIntro, comparisons: get().comparisons, credit: get().credit, dayStats: get().dayStats }));
      } catch {
        // Not critical.
      }
    },
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
        ghosts: null,
        photos: [],
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
