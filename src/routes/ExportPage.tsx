import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { ColorModePicker } from "../components/ColorModePicker";
import { Card, Check, ControlRow, Failure, GroupHeading, NextStep, Page, Segmented, Spinner } from "../components/ui";
import { type Aspect, type ExportProgress, type ExportResult, exportDuration, exportSize, renderPoster, renderVideo } from "../lib/export/render";
import { drawExportPreview } from "../lib/export/preview";
import { formatDuration } from "../lib/format/format";
import { loadHudFonts } from "../lib/hud/hud";
import { LOOKS, type LookId } from "../lib/map/style";
import { type CameraMode, autoExaggeration } from "../lib/playback/timeline";
import { useStore } from "../state/store";

const ASPECTS: { value: Aspect; label: string; name: string; hint: string; box: [number, number] }[] = [
  { value: "9:16", label: "9:16", name: "Portrait", hint: "Reels, Stories", box: [11, 20] },
  { value: "1:1", label: "1:1", name: "Square", hint: "Feed posts", box: [17, 17] },
  { value: "16:9", label: "16:9", name: "Landscape", hint: "YouTube, desktop", box: [24, 13.5] },
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
  const [kind, setKind] = useState<"video" | "poster">("video");
  const [aspect, setAspect] = useState<Aspect>("9:16");
  const [resolution, setResolution] = useState<720 | 1080>(1080);
  const [fps, setFps] = useState<30 | 60>(30);
  const [length, setLength] = useState(25);
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
  const totalSeconds = exportDuration(length, endCard, reduced);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => () => void (result && URL.revokeObjectURL(result.url)), [result]);
  useEffect(() => void loadHudFonts().then(() => setFontsReady(true)), []);

  const previewW = aspect === "16:9" ? 520 : aspect === "1:1" ? 380 : 290;
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
      exaggeration,
      followSeconds: length,
    });
  }, [a, aspect, previewW, previewH, lookId, routeColor, colorMode, stats, kind, exaggeration, length, rendering, result, fontsReady]);

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
      stats,
      endCard,
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
  const fileName = `${a.settings.name.replace(/[^\w\- ]+/g, "").trim() || "activity"}-${aspect.replace(":", "x")}.${result?.extension ?? "mp4"}`;
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
                        className={`relative flex flex-col items-start gap-2 rounded-control border p-3 text-left transition-colors duration-150 ${
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
                          <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-accent-strong text-white">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <ControlRow label="Quality">
                  <Segmented
                    size="sm"
                    label="Quality"
                    value={String(resolution)}
                    onChange={(v) => setResolution(Number(v) as 720 | 1080)}
                    options={[
                      { value: "720", label: "720p" },
                      { value: "1080", label: "1080p" },
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
                <ColorModePicker theme={LOOKS[lookId].ramp} bare />
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
                  <ControlRow label="Chase length">
                    <Segmented size="sm" label="Length" value={String(length)} onChange={(v) => setLength(Number(v))} options={[15, 25, 35].map((l) => ({ value: String(l), label: `${l} s` }))} />
                  </ControlRow>
                  <ControlRow label="Camera">
                    <Segmented
                      size="sm"
                      label="Camera"
                      value={mode}
                      onChange={setMode}
                      options={[
                        { value: "cinematic", label: "Cinematic", disabled: reduced },
                        { value: "chase", label: "Chase", disabled: reduced },
                        { value: "overhead", label: "Overhead" },
                      ]}
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
                {kind === "video" ? `, ${fps} fps${fps === 60 ? " (smoother, about twice the render time)" : ""}, about ${formatDuration(totalSeconds)}` : ", PNG"}
              </span>
              <br />
              {a.settings.privacyRadius > 0 ? `Privacy zone on: ${a.settings.privacyRadius} m around start and finish left out.` : "Privacy zone off: your start and finish are visible. Turn it on in Check."}
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
            <div className="flex flex-col items-center">
              <div className="mb-4 flex w-full items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-good/15 text-good" aria-hidden>
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
              <a href={result.url} download={fileName} className="btn btn-primary btn-lg mt-5 w-full max-w-sm">
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
                style={{ "--pw": `${previewW}px`, "--pw-sm": `${aspect === "9:16" ? 200 : aspect === "1:1" ? 280 : 340}px` } as CSSProperties}
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
                    <div className="h-2 rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct * 100}%` }} />
                  </div>
                  <p className="mt-2 text-center text-label text-muted tabular">
                    {progress?.stage === "frames"
                      ? `Frame ${progress.frame} of ${progress.total}${eta ? ` · about ${formatDuration(eta / 1000)} left` : ""}. `
                      : progress && progress.total > 1
                        ? `Preloading tile ${progress.frame} of ${progress.total} for the whole flight, so frames render without waiting. `
                        : "Loading the map… "}
                    {progress && progress.rateLimited > 0 ? "The tile server is busy, so tiles are being retried; this frame may take longer. " : ""}
                    Keep this tab open; it pauses in the background.
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
