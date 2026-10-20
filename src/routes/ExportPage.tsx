import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { ColorModePicker } from "../components/ColorModePicker";
import { PhotoPicker } from "../components/PhotoPicker";
import { Card, Check, ChipSelect, ControlRow, Failure, GroupHeading, NextStep, Page, Segmented, Spinner } from "../components/ui";
import { type Aspect, type ExportProgress, type ExportResult, type Resolution, exportDuration, exportSize, renderPoster, renderVideo, videoBitrate } from "../lib/export/render";
import { MAX_END, MAX_LIVE, endOptions, liveOptions, withWeather, withoutWeather } from "../lib/hud/stats";
import { drawExportPreview } from "../lib/export/preview";
import { formatDuration } from "../lib/format/format";
import { loadHudFonts } from "../lib/hud/hud";
import { MAP_DETAILS, resolveDetail } from "../lib/map/detail";
import { HAZES } from "../lib/map/sun";
import { placePhotos } from "../lib/photos";
import { estimatePhotoSeconds } from "../lib/playback/photoStops";
import { GLOBE_SECONDS } from "../lib/playback/globeIntro";
import { LOOKS, type LookId } from "../lib/map/style";
import { CAMERA_DISTANCES, CHASE_LENGTHS, cameraDistanceScale, lengthLabel, suggestedLength } from "../lib/playback/lengths";
import { CAMERA_OPTIONS, type CameraMode, autoExaggeration } from "../lib/playback/timeline";
import { useStore } from "../state/store";
import { comparisonText, headlineComparison } from "../lib/compare";

const ASPECTS: { value: Aspect; label: string; name: string; hint: string; box: [number, number] }[] = [
  { value: "9:16", label: "9:16", name: "Portrait", hint: "Reels, Stories", box: [11, 20] },
  { value: "4:5", label: "4:5", name: "Feed", hint: "Instagram feed", box: [15, 19] },
  { value: "1:1", label: "1:1", name: "Square", hint: "Feed posts", box: [17, 17] },
  { value: "16:9", label: "16:9", name: "Landscape", hint: "YouTube, desktop", box: [24, 13.5] },
  { value: "21:9", label: "21:9", name: "Cinema", hint: "Widescreen", box: [28, 12] },
];

const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function AspectIcon({ box: [w, h], on }: { box: [number, number]; on: boolean }) {
  return (
    <svg viewBox="0 0 26 22" className="h-6 w-7 shrink-0" aria-hidden>
      <rect
        x={(26 - w) / 2}
        y={(22 - h) / 2}
        width={w}
        height={h}
        rx="2"
        fill={on ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "none"}
        stroke={on ? "var(--accent-ink)" : "currentColor"}
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function ExportPage() {
  const a = useStore((s) => s.analysis)!;
  const colorMode = useStore((s) => s.colorMode);
  const routeColor = useStore((s) => s.routeColor);
  const lookId = useStore((s) => s.look);
  const setLook = useStore((s) => s.setLook);
  const storeMode = useStore((s) => s.cameraMode);
  const terrain = useStore((s) => s.terrainGrid);
  const liveStats = useStore((s) => s.liveStats);
  const endStats = useStore((s) => s.endStats);
  const setVideoStats = useStore((s) => s.setVideoStats);
  const highlights = useStore((s) => s.highlights);
  const landmarks = useStore((s) => s.landmarks);
  const buildings = useStore((s) => s.buildings);
  const weather = useStore((s) => s.weather);
  const haze = useStore((s) => s.haze);
  const globeIntro = useStore((s) => s.globeIntro);
  const comparisons = useStore((s) => s.comparisons);
  const credit = useStore((s) => s.credit);
  const ghosts = useStore((s) => s.ghosts);
  const photos = useStore((s) => s.photos);
  const photosOn = useStore((s) => s.photosOn);
  const placedPhotos = useMemo(() => placePhotos(a, photos).placed, [a, photos]);
  const ghostsOn = useStore((s) => s.ghostsOn);
  const setGhostsOn = useStore((s) => s.setGhostsOn);
  const weatherOn = useStore((s) => s.weatherOn);
  const weatherStatus = useStore((s) => s.weatherStatus);
  const setWeatherOn = useStore((s) => s.setWeatherOn);
  const sunLighting = useStore((s) => s.sunLighting);
  const cameraDistance = useStore((s) => s.cameraDistance);
  const mapDetail = useStore((s) => s.mapDetail);
  const setMapDetail = useStore((s) => s.setMapDetail);
  const setCameraDistance = useStore((s) => s.setCameraDistance);
  const [kind, setKind] = useState<"video" | "poster">("video");
  const [aspect, setAspect] = useState<Aspect>("9:16");
  // Lite devices (low memory) default to 720p: about half the encoding work and file size.
  const [resolution, setResolution] = useState<Resolution>(() => (resolveDetail(useStore.getState().mapDetail) === "lite" ? 720 : 1080));
  const [fps, setFps] = useState<30 | 60>(30);
  const [length, setLength] = useState<number>(() => suggestedLength(a.activity.routeOnly ? 0 : a.summary.moving));
  const [mode, setMode] = useState<CameraMode>(storeMode === "free" ? "cinematic" : storeMode);
  const [stats, setStats] = useState(true);
  const [endCard, setEndCard] = useState(true);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<(ExportResult & { url: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const [rendering, setRendering] = useState(false);
  const exaggeration = useMemo(() => autoExaggeration(a), [a]);

  const size = exportSize(aspect, resolution);
  const totalSeconds = exportDuration(length, endCard, reduced, globeIntro) + (photosOn ? estimatePhotoSeconds(placedPhotos.map((p) => p.index), a.n) : 0);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => () => void (result && URL.revokeObjectURL(result.url)), [result]);
  useEffect(() => void loadHudFonts(LOOKS[lookId]).then(() => setFontsReady(true)), [lookId]);

  const previewW = { "9:16": 290, "4:5": 330, "1:1": 380, "16:9": 520, "21:9": 560 }[aspect];
  const previewH = Math.round((previewW * size.height) / size.width);

  // Until rendering starts, the canvas shows a representative frame of the current options.
  useEffect(() => {
    const c = preview.current;
    if (!c || rendering || result) return;
    drawExportPreview(c.getContext("2d")!, c.width, c.height, a, {
      look: lookId,
      routeColor,
      colorMode,
      stats: kind === "video" && stats,
      liveStats,
      exaggeration,
      followSeconds: length,
    });
  }, [a, aspect, previewW, previewH, lookId, routeColor, colorMode, stats, liveStats, kind, exaggeration, length, rendering, result, fontsReady]);

  async function start() {
    setError(null);
    setResult(null);
    const ctrl = new AbortController();
    abort.current = ctrl;
    setRendering(true);
    setProgress({ stage: "tiles", frame: 0, total: 1, elapsedMs: 0, rateLimited: 0 });
    // On one-column layouts the progress sits above the options: bring it into view.
    if (matchMedia("(max-width: 1023px)").matches) preview.current?.scrollIntoView({ block: "center" });
    const opts = {
      aspect,
      resolution,
      followSeconds: length,
      colorMode,
      routeColor,
      look: lookId,
      mode,
      exaggeration,
      reducedMotion: reduced,
      distanceScale: cameraDistanceScale(cameraDistance, a.activity.kind),
      detail: resolveDetail(mapDetail),
      stats,
      liveStats,
      endStats,
      highlights,
      landmarks,
      buildings,
      weather,
      ghosts: ghostsOn ? ghosts : null,
      photos: photosOn ? placedPhotos.map((p) => ({ image: p.photo.bitmap, at: p.at, index: p.index })) : null,
      sunLighting,
      haze,
      globeIntro,
      endCard,
      comparison: comparisons,
      credit,
      fps,
      terrain,
    };
    try {
      const r = kind === "poster" ? await renderPoster(a, opts, ctrl.signal) : await renderVideo(a, opts, { onProgress: setProgress, preview: preview.current, signal: ctrl.signal });
      setResult({ ...r, url: URL.createObjectURL(r.blob) });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) setError(err instanceof Error ? err.message : String(err));
      else setProgress(null);
    } finally {
      abort.current = null;
      setRendering(false);
    }
  }

  const pct = progress ? progress.frame / Math.max(1, progress.total) : 0;
  const eta = progress && progress.stage === "frames" && progress.frame > 10 ? (progress.elapsedMs / progress.frame) * (progress.total - progress.frame) : null;
  const fileName = `${a.settings.name.replace(/[^\w\- ]+/g, "").replace(/\s+/g, " ").trim() || "activity"}-${aspect.replace(":", "x")}.${result?.extension ?? "mp4"}`;
  const what = kind === "poster" ? "poster" : "video";

  return (
    <Page title="Export" subtitle="Render a video or a poster in your browser, frame by frame. Nothing is uploaded." wide>
      <div className="grid gap-6 lg:grid-cols-[minmax(320px,0.9fr)_1.1fr] lg:items-start">
        <Card variant="settings" title="Options">
          <fieldset disabled={rendering} className="space-y-7 disabled:opacity-60">
            <section>
              <GroupHeading>Output</GroupHeading>
              <div className="space-y-4">
                <Segmented
                  label="Output"
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: "video", label: "Video" },
                    { value: "poster", label: "Poster (PNG)" },
                  ]}
                />
                <div role="radiogroup" aria-label="Format" className="grid grid-cols-3 gap-2">
                  {ASPECTS.map((o) => {
                    const on = aspect === o.value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setAspect(o.value)}
                        className={`lift flex flex-col items-start gap-2 rounded-control border p-3 text-left ${
                          on ? "border-accent bg-accent/8 ring-1 ring-accent" : "border-line bg-surface text-ink-2 hover:border-muted"
                        }`}
                      >
                        <AspectIcon box={o.box} on={on} />
                        <span>
                          <span className="block text-sm font-semibold text-ink">
                            {o.name} <span className="block font-normal text-muted tabular sm:inline">{o.label}</span>
                          </span>
                          <span className="hidden text-label text-muted sm:block">{o.hint}</span>
                        </span>
                        {on && (
                          <span className="pop absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-accent-strong text-white">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <ControlRow
                  label="Quality"
                  hint={
                    resolution === 2160
                      ? resolveDetail(useStore.getState().mapDetail) === "lite"
                        ? "4K needs lots of graphics memory: this device may not manage it. Try it on a computer."
                        : "4K: sharpest imagery and terrain, about 4× the render time and file size of 1080p. Best on a computer."
                      : undefined
                  }
                >
                  <Segmented
                    size="sm"
                    label="Quality"
                    value={String(resolution)}
                    onChange={(v) => setResolution(Number(v) as Resolution)}
                    options={[
                      { value: "720", label: "720p" },
                      { value: "1080", label: "1080p" },
                      { value: "2160", label: "4K" },
                    ]}
                  />
                </ControlRow>
              </div>
            </section>

            <section className="border-t border-grid pt-6">
              <GroupHeading>Look</GroupHeading>
              <div className="space-y-3">
                <ControlRow label="Map style">
                  <Segmented size="sm" label="Map style" value={lookId} onChange={(v) => setLook(v as LookId)} options={Object.values(LOOKS).map((l) => ({ value: l.id, label: l.label }))} />
                </ControlRow>
                <ControlRow
                  label="Map detail"
                  hint={
                    resolveDetail(mapDetail) === "high"
                      ? "Sharper terrain and imagery; uses more graphics memory and takes a little longer."
                      : mapDetail === "auto"
                        ? `${MAP_DETAILS.find((d) => d.value === resolveDetail(mapDetail))!.label} on this device.`
                        : undefined
                  }
                >
                  <Segmented size="sm" label="Map detail" value={mapDetail} onChange={setMapDetail} options={MAP_DETAILS} />
                </ControlRow>
                <ColorModePicker theme={LOOKS[lookId].ramp} bare />
              </div>
            </section>

            <section className="border-t border-grid pt-6">
              <GroupHeading>Stats</GroupHeading>
              <div className="space-y-3">
                {kind === "video" && stats && (
                  <ControlRow label="During the video" hint={`Up to ${MAX_LIVE}.`}>
                    <ChipSelect label="Live stats" value={liveStats} max={MAX_LIVE} onChange={(v) => setVideoStats({ liveStats: v })} options={liveOptions(a, weather)} />
                  </ControlRow>
                )}
                {(kind === "poster" || endCard) && (
                  <ControlRow label={kind === "poster" ? "On the poster" : "On the end card"} hint={`Up to ${MAX_END}.`}>
                    <ChipSelect label="End card stats" value={endStats} max={MAX_END} onChange={(v) => setVideoStats({ endStats: v })} options={endOptions(a, weather)} />
                  </ControlRow>
                )}
                <div className="space-y-2 pt-1 text-[15px]">
                  {(kind === "poster" || endCard) && headlineComparison(a.summary) && (
                    <label className="flex items-center gap-2.5">
                      <input type="checkbox" checked={comparisons} onChange={(e) => setVideoStats({ comparisons: e.target.checked })} />
                      <span>
                        Fun comparison <span className="text-muted">· {comparisonText(headlineComparison(a.summary)!)}</span>
                      </span>
                    </label>
                  )}
                  <label className="flex items-center gap-2.5">
                    <input type="checkbox" checked={credit} onChange={(e) => setVideoStats({ credit: e.target.checked })} />
                    <span>
                      Credit <span className="text-muted">· “Made with Activity Visualizer” and its link</span>
                    </span>
                  </label>
                </div>
                {kind === "video" && !stats && !endCard && <p className="text-label text-muted">Turn on live stats or the end card under Video to choose what they show.</p>}
              </div>
            </section>

            {kind === "video" && (
              <section className="border-t border-grid pt-6">
                <GroupHeading>Video</GroupHeading>
                <div className="space-y-3">
                  <ControlRow label="Frame rate">
                    <Segmented
                      size="sm"
                      label="Frame rate"
                      value={String(fps)}
                      onChange={(v) => setFps(Number(v) as 30 | 60)}
                      options={[
                        { value: "30", label: "30 fps" },
                        { value: "60", label: "60 fps" },
                      ]}
                    />
                  </ControlRow>
                  <ControlRow
                    label="Route playback"
                    hint={
                      a.activity.routeOnly
                        ? "Time spent following the route; the opening and ending add ~10 s."
                        : `Time spent following you along the route (${Math.max(1, Math.round(a.summary.moving / length))}× real time); the opening and ending add ~10 s.`
                    }
                  >
                    <Segmented size="sm" label="Route playback length" value={String(length)} onChange={(v) => setLength(Number(v))} options={CHASE_LENGTHS.map((l) => ({ value: String(l), label: lengthLabel(l) }))} />
                  </ControlRow>
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
                  <PhotoPicker a={a} />
                  <ControlRow label="Haze" hint={haze === "auto" ? "The look's own, or from the weather when it's on." : undefined}>
                    <Segmented
                      size="sm"
                      label="Haze"
                      value={haze}
                      onChange={(v) => setVideoStats({ haze: v })}
                      options={HAZES.map((h) => ({ value: h, label: h[0].toUpperCase() + h.slice(1) }))}
                    />
                  </ControlRow>
                  <ControlRow label="Camera distance" hint={cameraDistance === "auto" ? (["run", "ride", "walk"].includes(a.activity.kind) ? "Close for this activity." : "Far for this activity.") : undefined}>
                    <Segmented size="sm" label="Camera distance" value={cameraDistance} onChange={setCameraDistance} options={CAMERA_DISTANCES} />
                  </ControlRow>
                  <ControlRow label="Camera">
                    <Segmented
                      size="sm"
                      label="Camera"
                      value={mode}
                      onChange={setMode}
                      options={CAMERA_OPTIONS.map((o) => ({ ...o, disabled: reduced && o.value !== "overhead" }))}
                    />
                  </ControlRow>
                  <ControlRow label="Overlays">
                    <div className="space-y-2 text-[15px]">
                      <label className="flex items-center gap-2.5">
                        <input type="checkbox" checked={stats} onChange={(e) => setStats(e.target.checked)} />
                        Live stats
                      </label>
                      <label className="flex items-center gap-2.5">
                        <input type="checkbox" checked={endCard} onChange={(e) => setEndCard(e.target.checked)} />
                        End card with totals
                      </label>

                      <label className="flex items-center gap-2.5">
                        <input type="checkbox" checked={highlights} onChange={(e) => setVideoStats({ highlights: e.target.checked })} />
                        Highlights on the map (fastest mile, climbs…)
                      </label>
                      <label className="flex items-center gap-2.5">
                        <input type="checkbox" checked={landmarks} onChange={(e) => setVideoStats({ landmarks: e.target.checked })} />
                        Peak and landmark names
                      </label>
                      <label className="flex items-center gap-2.5">
                        <input type="checkbox" checked={buildings} onChange={(e) => setVideoStats({ buildings: e.target.checked })} />
                        3D buildings in cities
                      </label>
                      {ghosts && ghosts.length > 0 && (
                        <label className="flex items-center gap-2.5">
                          <input type="checkbox" checked={ghostsOn} onChange={(e) => setGhostsOn(e.target.checked)} />
                          Ghost race against {ghosts.map((g) => g.label).join(" and ")}
                        </label>
                      )}
                      {!a.activity.routeOnly && (
                        <label className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={weatherOn && (liveStats.includes("temp") || endStats.includes("weather"))}
                            onChange={(e) => {
                              if (e.target.checked) {
                                if (!weatherOn) setWeatherOn(true);
                                setVideoStats(withWeather(a, liveStats, endStats));
                              } else setVideoStats(withoutWeather(liveStats, endStats));
                            }}
                          />
                          <span>
                            Weather (temperature live, conditions at the end)
                            {weatherOn && weatherStatus === "loading" && <span className="text-muted"> · loading…</span>}
                            {weatherOn && weatherStatus === "error" && <span className="text-muted"> · not available</span>}
                          </span>
                        </label>
                      )}
                      <label className="flex items-center gap-2.5">
                        <input type="checkbox" checked={sunLighting} onChange={(e) => setVideoStats({ sunLighting: e.target.checked })} />
                        Light the map from the real sun (date and time of the activity; on Satellite, the sky too)
                      </label>
                    </div>
                  </ControlRow>
                </div>
              </section>
            )}
          </fieldset>

          <div className="mt-7 border-t border-grid pt-5">
            <p className="mb-4 text-sm text-ink-2 tabular">
              <span className="font-semibold text-ink">
                {size.width}×{size.height}
                {kind === "video"
                  ? `, ${fps} fps${fps === 60 ? " (smoother, about twice the render time)" : ""}, about ${formatDuration(totalSeconds)}, ~${Math.max(1, Math.round((videoBitrate("avc", size.width, size.height, fps) * totalSeconds) / 8 / 1e6))} MB`
                  : ", PNG"}
              </span>
              <br />
              {a.activity.parts
                ? a.settings.privacyRadius > 0
                  ? `Privacy zone on: ${a.settings.privacyRadius} m around every start and finish left out.`
                  : "Privacy zone off: your starts and finishes are visible. Turn it on in the flyover."
                : a.settings.privacyRadius > 0
                  ? `Privacy zone on: ${a.settings.privacyRadius} m around start and finish left out.`
                  : "Privacy zone off: your start and finish are visible. Turn it on in Check."}
            </p>
            {rendering ? (
              <button type="button" onClick={() => abort.current?.abort()} className="btn btn-secondary btn-lg w-full">
                Cancel rendering
              </button>
            ) : (
              <button type="button" onClick={start} disabled={a.privacy.empty} className="btn btn-primary btn-lg w-full">
                {result ? `Render ${what} again` : `Render ${what}`}
              </button>
            )}
          </div>
        </Card>

        <Card
          className="order-first lg:sticky lg:top-[calc(var(--header-h)+1.5rem)] lg:order-none"
          title={result ? undefined : rendering ? `Rendering your ${what}` : "Preview"}
          aside={!result && !rendering ? "A still of your options; rendering adds the 3D map" : undefined}
        >
          {result ? (
            <div className="enter flex flex-col items-center">
              <div className="mb-4 flex w-full items-center gap-3">
                <span className="pop flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-good/15 text-good [animation-delay:150ms]" aria-hidden>
                  <Check className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-section font-semibold">Your {result.method === "still" ? "poster" : "video"} is ready</h2>
                  <p className="text-sm text-ink-2 tabular">
                    {(result.blob.size / 1e6).toFixed(1)} MB · {result.width}×{result.height}
                    {result.duration ? ` · ${formatDuration(result.duration)}` : ""} · {result.extension.toUpperCase()}
                  </p>
                </div>
              </div>
              {result.method === "still" ? (
                <img src={result.url} alt="Poster preview" className="max-h-[62dvh] max-w-full rounded-control bg-black" />
              ) : (
                <video src={result.url} controls playsInline className="max-h-[62dvh] max-w-full rounded-control bg-black" />
              )}
              <ShareButton blob={result.blob} fileName={fileName} title={a.settings.name} />
              <a href={result.url} download={fileName} className={`btn btn-lg mt-3 w-full max-w-sm ${canShareFiles ? "btn-secondary" : "btn-primary mt-5"}`}>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />
                </svg>
                Download {result.method === "still" ? "poster" : "video"}
              </a>
              <button type="button" onClick={() => setResult(null)} className="btn btn-quiet btn-sm mt-2">
                Change options
              </button>
              {result.incompleteFrames > 0 && (
                <p role="status" className="mt-3 max-w-sm text-center text-sm text-ink-2">
                  {result.method === "still"
                    ? "Some map tiles still hadn't loaded after several retries, so parts of the map may be blank."
                    : `${result.incompleteFrames} frame${result.incompleteFrames === 1 ? " was" : "s were"} captured with map tiles still missing after several retries.`}{" "}
                  The tiles that did load are cached now, so rendering again usually fills the gaps.
                </p>
              )}
              {result.method === "mediarecorder" && (
                <p className="mt-3 text-center text-sm text-ink-2">Your browser doesn't support frame-accurate encoding, so this was recorded in real time and may stutter in places.</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <div
                className="relative w-[var(--pw-sm)] max-w-full sm:w-[var(--pw)]"
                style={{ "--pw": `${previewW}px`, "--pw-sm": `${{ "9:16": 200, "4:5": 240, "1:1": 280, "16:9": 340, "21:9": 340 }[aspect]}px` } as CSSProperties}
              >
                <canvas ref={preview} width={previewW * 2} height={previewH * 2} className="block w-full rounded-control bg-black shadow-[var(--shadow-raised)]" />
                {error && !rendering && (
                  <div className="absolute inset-0 overflow-hidden rounded-control">
                    <Failure overlay dark title={`The ${what} didn't finish`} message={error} retryLabel={`Retry ${what}`} onRetry={start} />
                  </div>
                )}
              </div>
              {rendering && (
                <div className="mt-5 w-full max-w-sm" aria-live="polite">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-medium text-ink">
                      <Spinner className="h-4 w-4 text-accent" />
                      {progress?.stage === "tiles" ? "Loading map tiles" : kind === "poster" ? "Drawing poster" : "Rendering frames"}
                    </span>
                    <span className="font-semibold tabular">{Math.round(pct * 100)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Render progress" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-2 origin-left rounded-full bg-accent transition-transform duration-300 ease-out" style={{ transform: `scaleX(${pct})` }} />
                  </div>
                  <p className="mt-2 text-center text-label text-muted tabular">
                    {progress?.stage === "frames"
                      ? `Frame ${progress.frame} of ${progress.total}${eta ? ` · about ${formatDuration(eta / 1000)} left` : ""}. `
                      : progress && progress.total > 1
                        ? `Preloading tile ${progress.frame} of ${progress.total} for the whole flight, so frames render without waiting. `
                        : "Loading the map… "}
                    {progress && progress.rateLimited > 0 ? "The tile server is busy, so tiles are being retried; this frame may take longer. " : ""}
                    Keep this tab open. Once frames start, it keeps going in a background tab; phones pause it if you switch apps.
                  </p>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
      <NextStep to="/" label="Visualize another activity" back={{ to: "/flyover", label: "Flyover" }} />
    </Page>
  );
}

/** Whether this browser can hand a file to other apps (phones, mostly). */
const canShareFiles =
  typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([""], "probe.mp4", { type: "video/mp4" })] });

/**
 * Opens the system share sheet with the rendered file attached, so it goes straight to Instagram,
 * WhatsApp, Photos… without a download-then-upload round trip. Hidden where files can't be shared.
 */
function ShareButton({ blob, fileName, title }: { blob: Blob; fileName: string; title: string }) {
  const [error, setError] = useState<string | null>(null);
  if (!canShareFiles) return null;
  const share = async () => {
    setError(null);
    const file = new File([blob], fileName, { type: blob.type });
    if (!navigator.canShare({ files: [file] })) {
      setError("This browser can't share this file; use Download instead.");
      return;
    }
    try {
      await navigator.share({ files: [file], title });
    } catch (err) {
      // Closing the share sheet isn't an error worth showing.
      if (!(err instanceof DOMException && err.name === "AbortError")) setError("Sharing didn't work; use Download instead.");
    }
  };
  return (
    <>
      <button type="button" onClick={share} className="btn btn-primary btn-lg mt-5 w-full max-w-sm">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 15V4m0 0L8 8m4-4 4 4M6 12v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-7" />
        </svg>
        Share
      </button>
      {error && (
        <p role="status" className="mt-2 text-center text-sm text-ink-2">
          {error}
        </p>
      )}
    </>
  );
}
