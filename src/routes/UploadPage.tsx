import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { FEATURE_ART } from "../components/FeatureArt";
import { SamplePreview } from "../components/SamplePreview";
import { ErrorNote, Spinner, stagger } from "../components/ui";
import { droppedFiles } from "../lib/library/files";
import { useLibrary } from "../state/library";
import { useStore } from "../state/store";

const CAPABILITIES: { title: string; text: string; art: keyof typeof FEATURE_ART }[] = [
  { title: "Check your data", text: "Gaps, GPS jumps and broken altitude found and fixed before any charts.", art: "check" },
  { title: "Analyze every stretch", text: "Splits, pace, heart-rate zones, best efforts and efficiency, linked to the map.", art: "analyze" },
  { title: "Fly over in 3D", text: "Your route over satellite imagery and real terrain.", art: "fly" },
  { title: "Export to share", text: "A Strava-style video or poster, rendered on your device.", art: "export" },
];

/** Loose terrain contours for the hero backdrop, centered up and to the right. */
const BACKDROP_CONTOURS = Array.from({ length: 11 }, (_, k) => {
  const r = 60 + k * 46;
  const pts = Array.from({ length: 64 }, (_, i) => {
    const t = (i / 64) * Math.PI * 2;
    const wob = 1 + 0.08 * Math.sin(3 * t + k * 0.9) + 0.05 * Math.cos(5 * t - k * 0.6);
    return `${(880 + Math.cos(t) * r * 1.35 * wob).toFixed(0)} ${(170 + Math.sin(t) * r * wob).toFixed(0)}`;
  });
  return `M${pts.join("L")}Z`;
});

/** A warm glow and faint contour lines behind the hero: static, so it costs nothing after first paint. */
function HeroBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[760px]">
      <div className="absolute -top-56 right-[-12rem] h-[44rem] w-[44rem] rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--accent)_15%,transparent),transparent)] sm:right-[-6rem]" />
      <svg
        viewBox="0 0 1200 760"
        preserveAspectRatio="xMidYMin slice"
        className="absolute inset-0 h-full w-full text-line opacity-60 [mask-image:radial-gradient(ellipse_70%_75%_at_72%_22%,#000_25%,transparent_75%)]"
      >
        {BACKDROP_CONTOURS.map((d, k) => (
          <path key={k} d={d} fill="none" stroke="currentColor" strokeWidth={k % 4 === 0 ? 1.1 : 0.7} strokeOpacity={k % 4 === 0 ? 0.9 : 0.55} />
        ))}
      </svg>
    </div>
  );
}

export function UploadPage() {
  const loadFile = useStore((s) => s.loadFile);
  const loadSample = useStore((s) => s.loadSample);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<"file" | "sample">("file");

  async function handle(file: File | undefined) {
    if (!file) return;
    setPending("file");
    if (await loadFile(file)) navigate("/check");
  }

  // One file: the single-activity flow. Two or more (or a folder): the library.
  function handleMany(files: File[]) {
    if (files.length <= 1) return void handle(files[0]);
    void useLibrary.getState().addFiles(files);
    navigate("/library");
  }

  async function sample() {
    setPending("sample");
    if (await loadSample()) navigate("/check");
  }

  const state = loading ? "loading" : dragging ? "dragging" : "idle";

  return (
    <div className="relative isolate overflow-hidden">
      <HeroBackdrop />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-14 lg:py-16">
        <div className="grid items-center gap-x-12 gap-y-6 sm:gap-y-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <div className="min-w-0">
            <h1 className="enter text-[2.375rem] font-extrabold leading-[1.05] tracking-[-0.035em] sm:text-[2.875rem] lg:text-display">
              Your activity,{" "}
              <span className="relative inline-block text-accent">
                from above.
                {/* A brushed underline that sweeps in once. */}
                <svg
                  viewBox="0 0 220 14"
                  preserveAspectRatio="none"
                  aria-hidden
                  className="fill-x absolute -bottom-1.5 left-0 h-2.5 w-[92%] text-accent/70 sm:-bottom-2 sm:h-3"
                >
                  <path d="M3 10C48 4 120 2 217 6" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                </svg>
              </span>
            </h1>
            <p style={stagger(1)} className="enter mt-4 max-w-xl text-[17px] leading-relaxed text-ink-2 sm:text-lg">
              Upload a run, ride or hike from any tracker. Get a full analysis, a 3D flyover of your route, and a video to share.
            </p>
          </div>

          <SamplePreview className="enter aspect-[16/10.5] w-full sm:aspect-[4/3.3] lg:row-span-2" style={stagger(2)} />

          <div className="enter min-w-0" style={stagger(3)}>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!loading) setDragging(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (!loading) void droppedFiles(e.dataTransfer).then(handleMany);
              }}
              aria-busy={loading}
              className={`group relative flex flex-col items-center overflow-hidden rounded-card border-2 px-5 py-6 text-center transition-[background-color,border-color,box-shadow] duration-150 sm:px-6 sm:py-10 ${
                state === "dragging"
                  ? "border-solid border-accent bg-accent/8 shadow-[0_0_0_6px_color-mix(in_srgb,var(--accent)_15%,transparent)]"
                  : state === "loading"
                    ? "border-solid border-accent/60 bg-surface"
                    : "border-dashed border-line bg-surface hover:border-muted"
              }`}
            >
              <span
                className={`flex h-12 w-12 items-center justify-center rounded-full transition-[background-color,transform] duration-150 ${
                  state === "dragging" ? "scale-110 bg-accent-strong text-white" : "bg-accent/12 text-accent-ink group-hover:-translate-y-0.5"
                }`}
                aria-hidden
              >
                {state === "loading" ? (
                  <Spinner className="h-6 w-6" />
                ) : (
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {state === "dragging" ? <path d="M12 4v10m0 0-4-4m4 4 4-4M4 15v4h16v-4" /> : <path d="M12 15V4m0 0L8 8m4-4 4 4M4 15v4h16v-4" />}
                  </svg>
                )}
              </span>
              <p className="mt-4 text-[17px] font-semibold" aria-live="polite">
                {state === "loading"
                  ? pending === "sample"
                    ? "Loading the sample run…"
                    : "Reading your file…"
                  : state === "dragging"
                    ? "Release to open"
                    : "Drop a TCX or GPX file"}
              </p>
              <p className="mt-1 text-sm text-ink-2">
                {state === "loading" ? "Parsing and checking every point, on your device." : "Or a whole folder, to build a library."}
              </p>

              {state === "loading" ? (
                <div className="mt-6 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Reading file">
                  <div className="progress-indeterminate h-full w-2/5 rounded-full bg-accent" />
                </div>
              ) : (
                <div className="mt-6 flex flex-col items-center gap-2">
                  <button type="button" onClick={() => input.current?.click()} className="btn btn-primary btn-lg min-w-48">
                    Choose file
                  </button>
                  <button
                    type="button"
                    onClick={sample}
                    className="btn btn-quiet btn-sm text-ink-2 underline decoration-line underline-offset-4 hover:decoration-ink"
                  >
                    or try a sample run
                  </button>
                </div>
              )}
              <input
                ref={input}
                type="file"
                multiple
                accept=".tcx,.gpx,.gz,application/xml,text/xml"
                className="hidden"
                onChange={(e) => {
                  handleMany(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
            </div>
            {error && !loading && (
              <div className="mt-3">
                <ErrorNote onRetry={() => input.current?.click()} retryLabel="Choose another file">
                  {error}
                </ErrorNote>
              </div>
            )}
            <p className="mt-3 flex items-center gap-2 text-label text-ink-2">
              <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-good" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
              Processed on your device and never uploaded.
            </p>
          </div>
        </div>

        <section aria-labelledby="what-you-get" className="mt-16 sm:mt-20">
          <h2 id="what-you-get" className="text-section font-semibold tracking-[-0.01em]">
            What you get
          </h2>
          <ol className="mt-5 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {CAPABILITIES.map((c, i) => {
              const Art = FEATURE_ART[c.art];
              return (
                <li key={c.title} className="min-w-0">
                  <div className="aspect-[5/3] overflow-hidden rounded-card border border-grid bg-surface-2/60">
                    <Art />
                  </div>
                  <p className="mt-3.5 text-label font-semibold text-accent-ink tabular">0{i + 1}</p>
                  <h3 className="mt-0.5 font-semibold">{c.title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{c.text}</p>
                </li>
              );
            })}
          </ol>
        </section>

        <details className="group mt-12 max-w-3xl border-t border-grid pt-5 text-[15px] text-ink-2">
          <summary className="flex items-center gap-1.5 font-semibold text-ink">
            <svg viewBox="0 0 24 24" className="chevron h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="m9 6 6 6-6 6" />
            </svg>
            Where do I get a TCX or GPX file?
          </summary>
          <p className="disclosure-body mt-2 pl-5.5 leading-relaxed">
            Most fitness apps can export a single activity from that activity's menu: look for <em>Export</em>, <em>Download</em> or <em>Export TCX</em>. Google
            Health and Fitbit, Garmin Connect, Coros and Polar offer TCX; Strava offers GPX, which also works here.
          </p>
        </details>
      </div>
    </div>
  );
}
