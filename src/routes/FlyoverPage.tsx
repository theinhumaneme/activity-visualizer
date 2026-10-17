import { Map as MlMap } from "maplibre-gl";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ColorModePicker } from "../components/ColorModePicker";
import { ControlRow, Failure, Loading, NextStep, Page, Segmented } from "../components/ui";
import { formatDuration } from "../lib/format/format";
import { sampler } from "../lib/geo/terrainGrid";
import { drawHud, loadHudFonts } from "../lib/hud/hud";
import { COLOR_MODES, modeAvailable } from "../lib/map/route";
import { DETAIL, MAP_DETAILS, applyTerrainQuality, resolveDetail } from "../lib/map/detail";
import { LOOKS, type LookId, flyoverStyle } from "../lib/map/style";
import { retryTiles } from "../lib/map/tileFetch";
import { FlyoverRenderer, addFlyoverLayers } from "../lib/playback/renderer";
import { CAMERA_DISTANCES, CHASE_LENGTHS, cameraDistanceScale, lengthLabel, suggestedLength } from "../lib/playback/lengths";
import { CAMERA_OPTIONS, type CameraMode, type FrameState, type Timeline, autoExaggeration, buildTimeline } from "../lib/playback/timeline";
import { DEFAULT_PRIVACY_RADIUS, useStore } from "../state/store";

const SPEEDS = ["0.5", "1", "2", "4"] as const;

/** Preview frame: the wide page view, or the shape of a portrait / square export. */
type Shape = "wide" | "9:16" | "1:1";
const SHAPES: { value: Shape; label: string; style?: CSSProperties }[] = [
  { value: "wide", label: "Landscape" },
  { value: "9:16", label: "Portrait 9:16", style: { width: "min(100%, calc(72dvh * 9 / 16), 460px)", aspectRatio: "9 / 16" } },
  { value: "1:1", label: "Square 1:1", style: { width: "min(100%, 66dvh, 680px)", aspectRatio: "1 / 1" } },
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
  const cameraDistance = useStore((s) => s.cameraDistance);
  const mapDetail = useStore((s) => s.mapDetail);
  const setMapDetail = useStore((s) => s.setMapDetail);
  const detail = resolveDetail(mapDetail);
  const setCameraDistance = useStore((s) => s.setCameraDistance);
  const setVideoStats = useStore((s) => s.setVideoStats);
  const updateSettings = useStore((s) => s.updateSettings);
  const reduced = useReducedMotion();
  const look = LOOKS[lookId];

  const container = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const rendererRef = useRef<FlyoverRenderer | null>(null);
  const timelineRef = useRef<Timeline | null>(null);
  const tRef = useRef(0);
  const free = cameraMode === "free";
  const freeRef = useRef(free);
  freeRef.current = free;
  const [ready, setReady] = useState(false);
  const [loadingTiles, setLoadingTiles] = useState(true);
  const [styleError, setStyleError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>("1");
  // Phones start in portrait, the shape they'll most likely export.
  const [shape, setShape] = useState<Shape>(() => (typeof matchMedia !== "undefined" && matchMedia("(max-width: 639px)").matches ? "9:16" : "wide"));
  const [length, setLength] = useState<number>(() => suggestedLength(a.activity.routeOnly ? 0 : a.summary.moving));
  const [frame, setFrame] = useState<FrameState | null>(null);
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
    [a, look, routeColor, exaggeration, liveStats, endStats, highlights],
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

  // Map setup, once per activity and look (a new style needs a fresh map and layers).
  useEffect(() => {
    let map: MlMap | null = null;
    let cancelled = false;
    setReady(false);
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
          attributionControl: { compact: true },
          center: [a.samples[0].lon, a.samples[0].lat],
          zoom: 13,
        });
        mapRef.current = map;
        map.on("load", () => {
          const st = useStore.getState();
          applyTerrainQuality(map!, DETAIL[detail].terrainQuality);
          addFlyoverLayers(map!, look);
          rendererRef.current = new FlyoverRenderer(map!, a, { mode: st.colorMode, color: st.routeColor, theme: look.ramp }, look);
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
  }, [a, lookId, exaggeration, attempt, detail]);

  // (Re)build the timeline when framing inputs change, keeping the relative position.
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
      timelineRef.current = buildTimeline(a, {
        followSeconds: length,
        width: container.current!.clientWidth,
        height: container.current!.clientHeight,
        mode: cameraMode === "free" ? "chase" : cameraMode,
        exaggeration,
        reducedMotion: reduced,
        distanceScale: cameraDistanceScale(cameraDistance, a.activity.kind),
        elevationAt: terrainGrid ? sampler(terrainGrid, NaN) : null,
      });
      show(frac * timelineRef.current.duration);
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
  }, [ready, a, length, cameraMode, cameraDistance, reduced, exaggeration, terrainGrid, show]);

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
      show(T, !end);
      if (end) setPlaying(false);
      else raf = requestAnimationFrame(tick);
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
    setPlaying((p) => !p);
  }, [playing, show]);

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

  return (
    <Page
      title="Flyover"
      subtitle={
        <>
          Your route over real terrain. Stops are fast-forwarded; the clock in the overlay is your real time.
          {reduced && " Reduced motion is on, so the camera stays top-down with no orbits."}
        </>
      }
      wide
    >
      <div className="overflow-hidden rounded-card border border-grid bg-surface shadow-[var(--shadow-raised)]">
        <div data-map={look.hud === "light" ? "light" : "dark"} className="relative bg-[#101214] text-white">
          <div
            className={shape === "wide" ? "relative h-[56dvh] min-h-[340px] w-full sm:h-[66dvh]" : "relative mx-auto max-w-full"}
            style={SHAPES.find((f) => f.value === shape)?.style}
          >
            {/* Sized with h-full/w-full: MapLibre makes its container position: relative. */}
            <div ref={container} className={`h-full w-full ${free ? "cursor-grab" : ""}`} />
            <canvas ref={hud} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
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
              Hide start and finish{privacyOn ? ` (${a.settings.privacyRadius} m)` : ""}
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

      <NextStep to="/export" label="Export video or poster" back={{ to: "/analysis", label: "Analysis" }} />
    </Page>
  );
}
