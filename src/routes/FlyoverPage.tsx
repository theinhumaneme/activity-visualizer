import { Map as MlMap } from "maplibre-gl";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ColorModePicker } from "../components/ColorModePicker";
import { PhotoPicker } from "../components/PhotoPicker";
import type { FlyoverArrival } from "../components/steps";
import { ChipSelect, ControlRow, Failure, Loading, NextStep, Page, Segmented } from "../components/ui";
import { formatClock, formatDate, formatDateTime, formatDuration } from "../lib/format/format";
import type { ActivityPart } from "../lib/parse/types";
import { sampler } from "../lib/geo/terrainGrid";
import { drawHud, loadHudFonts } from "../lib/hud/hud";
import { type DayStats, MAX_LIVE, liveOptions, withWeather, withoutWeather } from "../lib/hud/stats";
import { placePhotos } from "../lib/photos";
import { formatTemp, weatherSummary, weatherText } from "../lib/weather";
import { COLOR_MODES, modeAvailable } from "../lib/map/route";
import { DETAIL, MAP_DETAILS, applyTerrainQuality, resolveDetail } from "../lib/map/detail";
import { addBuildingLayer, addLandmarkLayers, setBuildingsVisible, setLandmarksVisible } from "../lib/map/landmarks";
import { type AtmosphereBase, HAZES, activityAir, activitySun, applyAtmosphere, applySunLighting, captureAtmosphere } from "../lib/map/sun";
import { LOOKS, type LookId, flyoverStyle } from "../lib/map/style";
import { planTiles, preloadTiles, releaseTiles, retryTiles } from "../lib/map/tileFetch";
import { FlyoverRenderer, addFlyoverLayers } from "../lib/playback/renderer";
import { type PhotoPage, withPhotoStops } from "../lib/playback/photoStops";
import { GLOBE_SECONDS, withGlobeIntro } from "../lib/playback/globeIntro";
import { CAMERA_DISTANCES, CHASE_LENGTHS, cameraDistanceScale, lengthLabel, suggestedLength } from "../lib/playback/lengths";
import { CAMERA_OPTIONS, type CameraMode, type FrameState, type Timeline, autoExaggeration, buildTimeline } from "../lib/playback/timeline";
import { DEFAULT_PRIVACY_RADIUS, useStore } from "../state/store";

const SPEEDS = ["0.5", "1", "2", "4"] as const;
/** Video seconds shown before and after a stretch picked on Analysis. */
const FOCUS_RUN_UP = 1.5;
const FOCUS_RUN_OUT = 0.75;

/** Preview frame: the wide page view, or the shape of a portrait / square export. */
type Shape = "wide" | "9:16" | "4:5" | "1:1" | "21:9";
const SHAPES: { value: Shape; label: string; style?: CSSProperties }[] = [
  { value: "wide", label: "Landscape" },
  { value: "9:16", label: "Portrait 9:16", style: { width: "min(100%, calc(72dvh * 9 / 16), 460px)", aspectRatio: "9 / 16" } },
  { value: "4:5", label: "Feed 4:5", style: { width: "min(100%, calc(70dvh * 4 / 5), 560px)", aspectRatio: "4 / 5" } },
  { value: "1:1", label: "Square 1:1", style: { width: "min(100%, 66dvh, 680px)", aspectRatio: "1 / 1" } },
  { value: "21:9", label: "Cinema 21:9", style: { width: "100%", aspectRatio: "21 / 9" } },
];
const MODES: { value: CameraMode | "free"; label: string; title: string }[] = [
  ...CAMERA_OPTIONS,
  { value: "free", label: "Free orbit", title: "You steer the camera; the run keeps playing" },
];

const reducedQuery = typeof matchMedia === "undefined" ? null : matchMedia("(prefers-reduced-motion: reduce)");

function useReducedMotion() {
  const [reduced, setReduced] = useState(!!reducedQuery?.matches);
  useEffect(() => {
    const on = () => setReduced(!!reducedQuery?.matches);
    reducedQuery?.addEventListener("change", on);
    return () => reducedQuery?.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function FlyoverPage() {
  const a = useStore((s) => s.analysis)!;
  const colorMode = useStore((s) => s.colorMode);
  const setColorMode = useStore((s) => s.setColorMode);
  const routeColor = useStore((s) => s.routeColor);
  const lookId = useStore((s) => s.look);
  const setLook = useStore((s) => s.setLook);
  const cameraMode = useStore((s) => s.cameraMode);
  const setCameraMode = useStore((s) => s.setCameraMode);
  const terrainGrid = useStore((s) => s.terrainGrid);
  const liveStats = useStore((s) => s.liveStats);
  const endStats = useStore((s) => s.endStats);
  const highlights = useStore((s) => s.highlights);
  const landmarks = useStore((s) => s.landmarks);
  const buildings = useStore((s) => s.buildings);
  const weather = useStore((s) => s.weather);
  const weatherOn = useStore((s) => s.weatherOn);
  const ghosts = useStore((s) => s.ghosts);
  const photos = useStore((s) => s.photos);
  const photosOn = useStore((s) => s.photosOn);
  const placement = useMemo(() => placePhotos(a, photos), [a, photos]);
  const ghostsOn = useStore((s) => s.ghostsOn);
  const setGhostsOn = useStore((s) => s.setGhostsOn);
  const weatherStatus = useStore((s) => s.weatherStatus);
  const setWeatherOn = useStore((s) => s.setWeatherOn);
  const sunLighting = useStore((s) => s.sunLighting);
  const haze = useStore((s) => s.haze);
  const globeIntro = useStore((s) => s.globeIntro);
  const comparisons = useStore((s) => s.comparisons);
  const credit = useStore((s) => s.credit);
  const dayStats = useStore((s) => s.dayStats);
  const cameraDistance = useStore((s) => s.cameraDistance);
  const mapDetail = useStore((s) => s.mapDetail);
  const setMapDetail = useStore((s) => s.setMapDetail);
  const detail = resolveDetail(mapDetail);
  const setCameraDistance = useStore((s) => s.setCameraDistance);
  const setVideoStats = useStore((s) => s.setVideoStats);
  const updateSettings = useStore((s) => s.updateSettings);
  const reduced = useReducedMotion();
  const look = LOOKS[lookId];
  const location = useLocation();
  const navigate = useNavigate();
  const arrival = location.state as FlyoverArrival | null;
  /** Set on arrival from a fresh upload; not under reduced motion, where nothing should move unasked. */
  const autoplay = useRef(!!arrival?.autoplay && !reduced);
  /** A stretch picked on Analysis, flown once the map is up (a click asked for it, so reduced motion too). */
  const [focus, setFocus] = useState(arrival?.focus ?? null);
  const focusPending = useRef(!!arrival?.focus);
  /** Video time to pause at, just past the focused stretch (null once it's been flown). */
  const focusEnd = useRef<number | null>(null);
  // Consume the request, so a refresh or coming back to this step doesn't start it again.
  useEffect(() => {
    if (arrival?.autoplay || arrival?.focus) navigate(location.pathname, { replace: true, state: null });
  }, [arrival, location.pathname, navigate]);

  const container = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const rendererRef = useRef<FlyoverRenderer | null>(null);
  const timelineRef = useRef<Timeline | null>(null);
  /** Photo stops on the current timeline. */
  const photoPagesRef = useRef<PhotoPage[]>([]);
  const tRef = useRef(0);
  const free = cameraMode === "free";
  const freeRef = useRef(free);
  freeRef.current = free;
  const [ready, setReady] = useState(false);
  /** The timeline has put the camera in place. Until then the map stays hidden: it opens on a placeholder view. */
  const [placed, setPlaced] = useState(false);
  /** The look's own sky, so the real sky and haze can be switched off again. */
  const atmosphere = useRef<AtmosphereBase | null>(null);
  const [loadingTiles, setLoadingTiles] = useState(true);
  const [styleError, setStyleError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>("1");
  // Phones start in portrait, the shape they'll most likely export.
  const [shape, setShape] = useState<Shape>(() => (typeof matchMedia !== "undefined" && matchMedia("(max-width: 639px)").matches ? "9:16" : "wide"));
  const [length, setLength] = useState<number>(() => suggestedLength(a.activity.routeOnly ? 0 : a.summary.moving));
  const [frame, setFrame] = useState<FrameState | null>(null);
  /** Progress of preloading the whole flight's tiles (null when done or not started). */
  const [preload, setPreload] = useState<{ done: number; total: number } | null>(null);
  const preloadRun = useRef<{ timer: number; ctrl: AbortController | null }>({ timer: 0, ctrl: null });
  /** When the time label and scrubber last re-rendered during playback. */
  const uiAt = useRef(0);
  const exaggeration = useMemo(() => autoExaggeration(a), [a]);

  const drawOverlay = useCallback(
    (f: FrameState) => {
      const c = hud.current;
      const r = rendererRef.current;
      const box = container.current;
      if (!c || !r || !box) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(box.clientWidth * dpr);
      const h = Math.round(box.clientHeight * dpr);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      const ctx = c.getContext("2d")!;
      ctx.clearRect(0, 0, w, h);
      drawHud(ctx, w, h, a, f, {
        look,
        accent: routeColor,
        stats: true,
        endCard: true,
        liveStats,
        endStats,
        highlights,
        weather,
        ghosts: ghostsOn ? ghosts : null,
        photoPages: photoPagesRef.current,
        comparison: comparisons,
        credit,
        dayStats,
        attribution: "",
        // Keep the stats clear of the map's own attribution control.
        bottomInset: 40 * dpr,
        exaggeration,
        project: (at) => {
          const p = r.project(at);
          return p ? [p[0] * dpr, p[1] * dpr] : null;
        },
      });
    },
    [a, look, routeColor, exaggeration, liveStats, endStats, highlights, weather, ghosts, ghostsOn, placement, photosOn, comparisons, credit, dayStats],
  );

  /**
   * Shows video time T. During playback (`live`), the page's own controls (time label, scrubber)
   * re-render ~10×/s rather than every frame; the map and the overlay still update every frame.
   */
  const show = useCallback(
    (T: number, live = false) => {
      const tl = timelineRef.current;
      const r = rendererRef.current;
      if (!tl || !r) return;
      tRef.current = Math.min(Math.max(T, 0), tl.duration);
      const f = tl.frame(tRef.current);
      r.apply(f, !freeRef.current);
      // Render the map now rather than on its next animation frame, so the overlay drawn below
      // (pins, marker, leader lines) lines up with the terrain in the same frame.
      mapRef.current?.redraw();
      drawOverlay(f);
      const now = performance.now();
      if (!live || now - uiAt.current > 100) {
        uiAt.current = now;
        setFrame(f);
      }
    },
    [drawOverlay],
  );

  // Map setup, once per activity and look (a new style needs a fresh map and layers). A new analysis
  // of the same activity (terrain heights arriving, a settings change) keeps the map: only the
  // route is redrawn, so the flight carries on instead of reloading.
  useEffect(() => {
    let map: MlMap | null = null;
    let cancelled = false;
    setReady(false);
    setPlaced(false);
    setLoadingTiles(true);
    setStyleError(null);
    const ro = new ResizeObserver(() => map?.resize());
    // Fonts only matter for the overlay: don't hold the map back for them, redraw when they land.
    void loadHudFonts(look).then(() => {
      const tl = timelineRef.current;
      if (!cancelled && tl && rendererRef.current) drawOverlay(tl.frame(tRef.current));
    });
    flyoverStyle(lookId, exaggeration, detail)
      .then((style) => {
        if (cancelled || !container.current) return;
        map = new MlMap({
          container: container.current,
          style,
          transformRequest: retryTiles,
          interactive: false,
          maxPitch: 85,
          // 3× phone screens would draw 2.25× the pixels of 2× for no visible gain on terrain.
          pixelRatio: Math.min(DETAIL[detail].pixelRatio, window.devicePixelRatio || 1),
          // Keep processed tiles around (they're re-used as the camera turns back and forth) and let
          // coarser tiles finish loading while zooming, so there's always something under the view.
          maxTileCacheZoomLevels: detail === "lite" ? 4 : 10,
          cancelPendingTileRequestsWhileZooming: false,
          attributionControl: { compact: true },
          center: [a.samples[0].lon, a.samples[0].lat],
          zoom: 13,
        });
        mapRef.current = map;
        map.on("load", () => {
          applyTerrainQuality(map!, DETAIL[detail].terrainQuality);
          addFlyoverLayers(map!, look);
          addLandmarkLayers(map!, look, a.settings.units, useStore.getState().landmarks);
          addBuildingLayer(map!, look, useStore.getState().buildings);
          const sun = useStore.getState().sunLighting ? activitySun(a.samples, !a.activity.routeOnly) : null;
          if (sun) applySunLighting(map!, sun);
          atmosphere.current = captureAtmosphere(map!);
          setReady(true);
          // Don't block the preview on every last tile: first idle, or 4 s, whichever comes first.
          const reveal = () => !cancelled && setLoadingTiles(false);
          map!.once("idle", reveal);
          setTimeout(reveal, 4000);
        });
        ro.observe(container.current);
      })
      .catch((err) => !cancelled && setStyleError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
      ro.disconnect();
      map?.remove();
      mapRef.current = null;
      rendererRef.current = null;
    };
    // `look` and `drawOverlay` derive from lookId and the activity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.activity, a.settings.units, lookId, exaggeration, attempt, detail, sunLighting]);

  // The route layers for this analysis. Declared before the timeline below, which draws with it.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const st = useStore.getState();
    rendererRef.current = new FlyoverRenderer(map, a, { mode: st.colorMode, color: st.routeColor, theme: look.ramp }, look);
    // `look` changes only with a new map, which resets `ready`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, a]);

  // (Re)build the timeline when framing inputs change, keeping the relative position.
  /**
   * Fetches every tile the whole flight will show (as the export does) into a local store the map
   * reads from, so tiles coming into view load from the device instead of popping in black over the
   * network mid-flight. Re-planned (only new tiles fetched) when the camera path changes.
   */
  const schedulePreload = useCallback(() => {
    const run = preloadRun.current;
    clearTimeout(run.timer);
    run.timer = window.setTimeout(() => {
      const tl = timelineRef.current;
      const map = mapRef.current;
      if (!tl || !map) return;
      run.ctrl?.abort();
      const ctrl = new AbortController();
      run.ctrl = ctrl;
      const cameras = [];
      // 10 samples per second of video: tiles that only show between coarser samples are caught too.
      for (let T = 0; T <= tl.duration; T += 1 / 10) cameras.push(tl.frame(T).camera);
      // Planning moves the map's camera; put it back where it was.
      const saved = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
      const urls = planTiles(map, cameras);
      map.jumpTo(saved);
      if (!freeRef.current) show(tRef.current);
      let shown = 0;
      preloadTiles(urls, ctrl.signal, (done, total) => {
        const now = performance.now();
        if (done < total && now - shown < 200) return;
        shown = now;
        setPreload(done < total ? { done, total } : null);
      }).catch(() => {});
    }, 400);
  }, [show]);

  // Leaving the page: stop preloading and drop the stored tiles.
  useEffect(
    () => () => {
      clearTimeout(preloadRun.current.timer);
      preloadRun.current.ctrl?.abort();
      void releaseTiles();
    },
    [],
  );

  useEffect(() => {
    if (!ready || !container.current) return;
    // With the terrain grid the timeline knows the ground height under the camera; don't let
    // MapLibre re-snap it to whichever elevation tile is loaded (that bobs the view).
    mapRef.current?.setCenterClampedToGround(!terrainGrid);
    let size = "";
    let pending = 0;
    const rebuild = () => {
      // Phone browsers resize the page as their toolbar shows and hides; rebuild only when the
      // map's size really changed, at most once per frame.
      const key = `${container.current!.clientWidth}x${container.current!.clientHeight}`;
      if (key === size) return;
      size = key;
      const prev = timelineRef.current;
      const frac = prev ? tRef.current / prev.duration : 0;
      const base = buildTimeline(a, {
        followSeconds: length,
        width: container.current!.clientWidth,
        height: container.current!.clientHeight,
        mode: cameraMode === "free" ? "chase" : cameraMode,
        exaggeration,
        reducedMotion: reduced,
        distanceScale: cameraDistanceScale(cameraDistance, a.activity.kind),
        elevationAt: terrainGrid ? sampler(terrainGrid, NaN) : null,
      });
      // Photo stops hold the flyover while each photo (or collage) has the screen.
      const stops = withPhotoStops(globeIntro && !reduced ? withGlobeIntro(base) : base, photosOn ? placement.placed.map((p) => ({ image: p.photo.bitmap, index: p.index })) : []);
      timelineRef.current = stops.timeline;
      photoPagesRef.current = stops.pages;
      show(frac * timelineRef.current.duration);
      setPlaced(true);
      schedulePreload();
    };
    rebuild();
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(rebuild);
    });
    ro.observe(container.current);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(pending);
    };
  }, [ready, a, length, cameraMode, cameraDistance, reduced, exaggeration, terrainGrid, show, schedulePreload, placement, photosOn, globeIntro]);

  useEffect(() => {
    const map = mapRef.current;
    if (ready && map) {
      setLandmarksVisible(map, landmarks);
      setBuildingsVisible(map, buildings);
    }
  }, [ready, landmarks, buildings]);

  // The globe projection only shows at low zoom (the intro); close in it's the usual flat map.
  useEffect(() => {
    const map = mapRef.current;
    if (ready && map) map.setProjection({ type: globeIntro && !reduced ? "globe" : "mercator" });
  }, [ready, globeIntro, reduced]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !atmosphere.current) return;
    applyAtmosphere(map, atmosphere.current, {
      realSky: sunLighting,
      sun: activitySun(a.samples, !a.activity.routeOnly),
      weather: activityAir(a.samples, weather),
      haze,
    });
  }, [ready, a, sunLighting, weather, haze]);

  // Free orbit hands the camera to you; the marker keeps playing.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const handlers = [map.dragPan, map.scrollZoom, map.dragRotate, map.touchZoomRotate, map.keyboard, map.doubleClickZoom];
    for (const h of handlers) {
      if (free) h.enable();
      else h.disable();
    }
    if (!free) show(tRef.current);
  }, [ready, free, show]);

  useEffect(() => {
    if (!ready || !rendererRef.current) return;
    rendererRef.current.setColoring({ mode: colorMode, color: routeColor, theme: look.ramp });
    show(tRef.current);
  }, [ready, colorMode, routeColor, look, show]);

  // Playback: one master clock. Video time advances with the wall clock only for live preview.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const tl = timelineRef.current;
      if (!tl) return;
      const T = tRef.current + ((now - last) / 1000) * Number(speed);
      last = now;
      const end = T >= tl.duration;
      const held = focusEnd.current !== null && T >= focusEnd.current;
      show(T, !(end || held));
      if (end || held) {
        focusEnd.current = null;
        setPlaying(false);
      } else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, show]);

  // Free orbit: redraw the HUD while you move the camera (leader lines follow the map).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !free) return;
    const onMove = () => {
      const tl = timelineRef.current;
      if (tl && !playing) drawOverlay(tl.frame(tRef.current));
    };
    map.on("move", onMove);
    return () => void map.off("move", onMove);
  }, [ready, free, playing, drawOverlay]);

  const togglePlay = useCallback(() => {
    const tl = timelineRef.current;
    if (!tl) return;
    if (!playing && tRef.current >= tl.duration - 0.01) show(0);
    // Pausing: bring the (throttled) time label and scrubber to the exact frame shown.
    if (playing) show(tRef.current);
    autoplay.current = false;
    // Playing on after the focused stretch has been flown: back to the whole flight.
    if (!playing && focusEnd.current === null) setFocus(null);
    setPlaying((p) => !p);
  }, [playing, show]);

  // Opened straight from Upload or the library: start the flight once the first view has loaded.
  // Opened from a split or climb on Analysis: fly that stretch, with a short run-up, and pause after it.
  useEffect(() => {
    const tl = timelineRef.current;
    if (!ready || loadingTiles || a.privacy.empty || !tl) return;
    if (focusPending.current && focus) {
      focusPending.current = false;
      autoplay.current = false;
      show(Math.max(tl.marks.chase, tl.timeAtIndex(focus.from) - FOCUS_RUN_UP));
      focusEnd.current = Math.min(tl.duration, tl.timeAtIndex(focus.to) + FOCUS_RUN_OUT);
      setPlaying(true);
    } else if (autoplay.current) {
      autoplay.current = false;
      setPlaying(true);
    }
  }, [ready, loadingTiles, a.privacy.empty, focus, show]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      if (e.code === "Space" && !(t instanceof HTMLButtonElement)) {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        show(tRef.current + (e.key === "ArrowLeft" ? -5 : 5));
      } else if (/^[1-8]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const m = COLOR_MODES[Number(e.key) - 1].mode;
        if (modeAvailable(a, m)) setColorMode(m);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, show, a, setColorMode]);

  const tl = timelineRef.current;
  const duration = tl?.duration ?? 1;
  const privacyOn = a.settings.privacyRadius > 0;
  const parts = a.activity.parts;

  return (
    <Page
      title="Flyover"
      subtitle={
        <>
          Your route over real terrain. Stops are fast-forwarded; the clock in the overlay is your real time.
          {parts && <CombinedNote parts={parts} utcOffsetMin={a.activity.utcOffsetMin} />}
          {reduced && " Reduced motion is on, so the camera stays top-down with no orbits."}
        </>
      }
      wide
      actions={parts ? undefined : <DataCheckLink warnings={a.quality.filter((q) => q.level === "warn").length} />}
    >
      <div className="overflow-hidden rounded-card border border-grid bg-surface shadow-[var(--shadow-raised)]">
        <div data-map={look.hud === "light" ? "light" : "dark"} className="relative bg-[#101214] text-white">
          <div
            className={shape === "wide" ? "relative h-[56dvh] min-h-[340px] w-full sm:h-[66dvh]" : "relative mx-auto max-w-full"}
            style={SHAPES.find((f) => f.value === shape)?.style}
          >
            {/* Sized with h-full/w-full: MapLibre makes its container position: relative. */}
            <div ref={container} className={`h-full w-full transition-opacity duration-300 ${placed ? "" : "opacity-0"} ${free ? "cursor-grab" : ""}`} />
            <canvas ref={hud} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
            {focus && (
              <div className="absolute left-3 top-3 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-full bg-black/65 py-1 pl-3 pr-1 text-[13px] font-medium text-white backdrop-blur-sm">
                <span className="truncate">{focus.label}</span>
                <Link to="/analysis" className="shrink-0 rounded-full bg-white/15 px-2.5 py-0.5 hover:bg-white/25">
                  ← Analysis
                </Link>
              </div>
            )}
            {preload && preload.total > 0 && (
              <div className="pointer-events-none absolute bottom-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/60 px-3 py-1 text-[12px] font-medium text-white/90 tabular" aria-live="polite">
                Preloading the flight · {Math.round((preload.done / preload.total) * 100)}%
              </div>
            )}
          </div>

          {(loadingTiles || !ready) && !styleError && <Loading overlay dark label="Loading terrain and imagery…" />}
          {styleError && (
            <Failure
              overlay
              dark
              title="The flyover couldn't load"
              message={styleError}
              retryLabel="Retry flyover"
              onRetry={() => setAttempt((n) => n + 1)}
            />
          )}
          {a.privacy.empty && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#101214]/85 p-6 text-center text-white/90">
              The whole route is inside your privacy zone, so there's nothing to show. Turn the privacy zone down to see it.
            </div>
          )}
        </div>

        {/* Player bar: play, timeline, time. */}
        <div className="flex items-center gap-3 border-t border-grid px-3 py-2.5 sm:gap-4 sm:px-4">
          <button
            type="button"
            onClick={togglePlay}
            disabled={!ready}
            aria-label={playing ? "Pause" : "Play"}
            className="btn btn-primary h-11 w-11 shrink-0 !p-0"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
              {playing ? <path d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}
            </svg>
          </button>
          <span className="w-12 shrink-0 text-right text-sm font-semibold text-ink tabular">{formatDuration(frame?.T ?? 0)}</span>
          <input
            type="range"
            aria-label="Playback position"
            className="min-w-0 flex-1"
            min={0}
            max={duration}
            step={0.01}
            value={frame?.T ?? 0}
            onChange={(e) => {
              setPlaying(false);
              show(Number(e.target.value));
            }}
          />
          <span className="w-12 shrink-0 text-sm text-muted tabular">{formatDuration(duration)}</span>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-card border border-grid bg-surface p-4 sm:p-5" aria-labelledby="fly-view">
          <h2 id="fly-view" className="text-base font-semibold">
            View
          </h2>
          <ControlRow label="Frame">
            <Segmented size="sm" label="Frame" value={shape} onChange={setShape} options={SHAPES.map(({ value, label }) => ({ value, label }))} />
          </ControlRow>
          <ControlRow label="Camera">
            <Segmented
              size="sm"
              label="Camera"
              value={cameraMode}
              onChange={setCameraMode}
              options={MODES.map((m) => ({ ...m, disabled: reduced && m.value !== "overhead" && m.value !== "free" }))}
            />
          </ControlRow>
          <ControlRow label="Camera distance" hint={cameraDistance === "auto" ? (["run", "ride", "walk"].includes(a.activity.kind) ? "Close for this activity." : "Far for this activity.") : undefined}>
            <Segmented size="sm" label="Camera distance" value={cameraDistance} onChange={setCameraDistance} options={CAMERA_DISTANCES} />
          </ControlRow>
          <ControlRow label="Map detail" hint={mapDetail === "auto" ? `${MAP_DETAILS.find((d) => d.value === detail)!.label} on this device.` : undefined}>
            <Segmented size="sm" label="Map detail" value={mapDetail} onChange={setMapDetail} options={MAP_DETAILS} />
          </ControlRow>
          <ControlRow label="Map style">
            <Segmented
              size="sm"
              label="Map style"
              value={lookId}
              onChange={(v) => setLook(v as LookId)}
              options={Object.values(LOOKS).map((l) => ({ value: l.id, label: l.label }))}
            />
          </ControlRow>
          <ControlRow label="Route playback" hint={a.activity.routeOnly ? undefined : `${Math.max(1, Math.round(a.summary.moving / length))}× real time`}>
            <Segmented
              size="sm"
              label="Route playback length"
              value={String(length)}
              onChange={(v) => setLength(Number(v))}
              options={CHASE_LENGTHS.map((l) => ({ value: String(l), label: lengthLabel(l) }))}
            />
          </ControlRow>
          <ControlRow label="Live stats" hint={`Up to ${MAX_LIVE}.`}>
            <ChipSelect label="Live stats" value={liveStats} max={MAX_LIVE} onChange={(v) => setVideoStats({ liveStats: v })} options={liveOptions(a, weather)} />
          </ControlRow>
          {parts && (
            <ControlRow label="Combined day" hint={dayStats === "day" ? "Distance runs through the day; time adds up the activities, leaving out the gaps between them." : "Time and distance start over with each activity. The end card has the whole day's totals."}>
              <Segmented
                size="sm"
                label="Live stats for a combined day"
                value={dayStats}
                onChange={(v) => setVideoStats({ dayStats: v })}
                options={[
                  { value: "each" as DayStats, label: "Each activity" },
                  { value: "day" as DayStats, label: "Whole day" },
                ]}
              />
            </ControlRow>
          )}
          <ControlRow label="Opening" hint={reduced ? "Off while reduced motion is on." : globeIntro ? `Starts on the whole Earth and dives down to the start (+${GLOBE_SECONDS} s).` : undefined}>
            <Segmented
              size="sm"
              label="Opening"
              value={globeIntro && !reduced ? "globe" : "local"}
              onChange={(v) => setVideoStats({ globeIntro: v === "globe" })}
              options={[
                { value: "local", label: "Over the route" },
                { value: "globe", label: "From the globe", disabled: reduced },
              ]}
            />
          </ControlRow>
          <ControlRow label="Place names">
            <Segmented
              size="sm"
              label="Peak and landmark names"
              value={landmarks ? "on" : "off"}
              onChange={(v) => setVideoStats({ landmarks: v === "on" })}
              options={[
                { value: "on", label: "Peaks & landmarks" },
                { value: "off", label: "Off" },
              ]}
            />
          </ControlRow>
          <ControlRow
            label="Sun lighting"
            hint={(() => {
              const sun = activitySun(a.samples, !a.activity.routeOnly);
              return sun ? ((sun.altitude < 0 ? "The sun was down: terrain keeps the look's lighting." : `Sun ${Math.round(sun.altitude)}° up, from the ${["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"][Math.round(sun.azimuth / 45) % 8]}.`) + (lookId === "satellite" ? " The sky and light match that time of day." : "")) : undefined;
            })()}
          >
            <Segmented
              size="sm"
              label="Sun lighting"
              value={sunLighting ? "real" : "look"}
              onChange={(v) => setVideoStats({ sunLighting: v === "real" })}
              options={[
                { value: "real", label: "Real sun" },
                { value: "look", label: "Look's own" },
              ]}
            />
          </ControlRow>
          {ghosts && ghosts.length > 0 && (
            <ControlRow label="Ghost race" hint={`Racing ${ghosts.map((g) => g.label).join(" and ")} by moving time.`}>
              <Segmented
                size="sm"
                label="Ghost race"
                value={ghostsOn ? "on" : "off"}
                onChange={(v) => setGhostsOn(v === "on")}
                options={[
                  { value: "on", label: "Show" },
                  { value: "off", label: "Off" },
                ]}
              />
            </ControlRow>
          )}
          {!a.activity.routeOnly && (
            <ControlRow
              label="Weather"
              hint={(() => {
                if (!weatherOn) return "Fetched from Open-Meteo for the area (location rounded to ~10 km) and the date.";
                if (weatherStatus === "loading") return "Getting the weather…";
                if (weatherStatus === "error" || (weatherStatus === "done" && !weather)) return "No weather found for this activity.";
                if (!weather) return undefined;
                const w = weatherSummary(weather, a.samples[0].time, a.samples[a.n - 1].time);
                return `${formatTemp(w.temp, a.settings.units)}, ${weatherText(w.code).toLowerCase()}: temperature in the live stats, conditions on the end card.`;
              })()}
            >
              <Segmented
                size="sm"
                label="Weather"
                value={weatherOn && (liveStats.includes("temp") || endStats.includes("weather")) ? "on" : "off"}
                onChange={(v) => {
                  if (v === "on") {
                    if (!weatherOn) setWeatherOn(true);
                    setVideoStats(withWeather(a, liveStats, endStats));
                  } else setVideoStats(withoutWeather(liveStats, endStats));
                }}
                options={[
                  { value: "on", label: "Show" },
                  { value: "off", label: "Off" },
                ]}
              />
            </ControlRow>
          )}
          <ControlRow
            label="Haze"
            hint={haze === "auto" ? (weather ? "From the weather that day (fog and rain thicken it)." : "The look's own; follows the weather when weather is on.") : undefined}
          >
            <Segmented
              size="sm"
              label="Haze"
              value={haze}
              onChange={(v) => setVideoStats({ haze: v })}
              options={HAZES.map((h) => ({ value: h, label: h[0].toUpperCase() + h.slice(1) }))}
            />
          </ControlRow>
          <PhotoPicker a={a} />
          <ControlRow label="3D buildings">
            <Segmented
              size="sm"
              label="3D buildings"
              value={buildings ? "on" : "off"}
              onChange={(v) => setVideoStats({ buildings: v === "on" })}
              options={[
                { value: "on", label: "On" },
                { value: "off", label: "Off" },
              ]}
            />
          </ControlRow>
          <ControlRow label="Highlights">
            <Segmented
              size="sm"
              label="Highlights"
              value={highlights ? "on" : "off"}
              onChange={(v) => setVideoStats({ highlights: v === "on" })}
              options={[
                { value: "on", label: "On the map" },
                { value: "off", label: "Off" },
              ]}
            />
          </ControlRow>
          <ControlRow label="Speed">
            <Segmented size="sm" label="Speed" value={speed} onChange={setSpeed} options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))} />
          </ControlRow>
        </section>

        <section className="space-y-3 rounded-card border border-grid bg-surface p-4 sm:p-5" aria-labelledby="fly-route">
          <h2 id="fly-route" className="text-base font-semibold">
            Route appearance
          </h2>
          <ColorModePicker theme={look.ramp} bare />
          <ControlRow label="Privacy">
            <label className="flex min-h-8 items-center gap-2 text-sm">
              <input type="checkbox" checked={privacyOn} onChange={(e) => updateSettings({ privacyRadius: e.target.checked ? DEFAULT_PRIVACY_RADIUS : 0 })} />
              {parts ? "Hide every start and finish" : "Hide start and finish"}
              {privacyOn ? ` (${a.settings.privacyRadius} m)` : ""}
            </label>
          </ControlRow>
        </section>
      </div>
      <p className="mt-3 text-label text-muted">
        <kbd className="font-sans font-semibold text-ink-2">Space</kbd> plays and pauses · <kbd className="font-sans font-semibold text-ink-2">← →</kbd> seek 5 s ·{" "}
        <kbd className="font-sans font-semibold text-ink-2">1–8</kbd> switch route color. Terrain ×{exaggeration.toFixed(1)}
        {tl ? ` · about ${Math.round(tl.compression)}× real time` : ""}.{" "}
        {!terrainGrid && "Camera clearance uses the route's own elevation until terrain data loads."}
      </p>

      <NextStep to="/export" label="Export video or poster" back={parts ? { to: "/library", label: "Library" } : { to: "/analysis", label: "Analysis" }} />
    </Page>
  );
}


/** What a combined day is made of, and why there's no Analysis for it. */
function CombinedNote({ parts, utcOffsetMin }: { parts: ActivityPart[]; utcOffsetMin?: number }) {
  // Activities from several days say which day; one day's say the time.
  const oneDay = new Set(parts.map((p) => formatDate(p.startTime, utcOffsetMin))).size === 1;
  return (
    <>
      {" "}
      This is {parts.length} activities flown in order:{" "}
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && ", then "}
          <span className="text-ink">{p.name}</span> {oneDay ? `at ${formatClock(p.startTime, utcOffsetMin)}` : `on ${formatDateTime(p.startTime, utcOffsetMin)}`}
        </span>
      ))}
      . The camera flies across the breaks between them. To analyze one, open it from the Library.
    </>
  );
}

/** Check is optional now that uploads land here: keep the audit, trim and privacy zone one click away. */
function DataCheckLink({ warnings }: { warnings: number }) {
  return (
    <Link to="/check" className="btn btn-secondary btn-sm gap-2">
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${warnings ? "bg-warning" : "bg-good"}`} />
      {warnings ? `Check data · ${warnings} warning${warnings === 1 ? "" : "s"}` : "Data checked"}
      <span className="text-ink-2">· trim, privacy</span>
    </Link>
  );
}
