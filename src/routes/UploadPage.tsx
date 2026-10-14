import { type ReactNode, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { SamplePreview } from "../components/SamplePreview";
import { ErrorNote, Spinner } from "../components/ui";
import { droppedFiles } from "../lib/library/files";
import { useLibrary } from "../state/library";
import { useStore } from "../state/store";

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);

const CAPABILITIES: { title: string; text: string; icon: ReactNode }[] = [
  { title: "Check your data", text: "Gaps, GPS jumps and broken altitude found and fixed before any charts.", icon: icon(<path d="M5 12.5 10 17 19 7" />) },
  { title: "Analyze every stretch", text: "Splits, pace, heart-rate zones, best efforts and efficiency, linked to the map.", icon: icon(<path d="M4 19V9m6 10V5m6 14v-7m4 7H3" />) },
  { title: "Fly over in 3D", text: "Your route over satellite imagery and real terrain.", icon: icon(<path d="m3 17 6-6 4 4 8-8M15 7h6v6" />) },
  { title: "Export to share", text: "A Strava-style video or poster, rendered on your device.", icon: icon(<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />) },
];

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
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-14 lg:py-16">
      <div className="grid items-center gap-x-12 gap-y-6 sm:gap-y-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="min-w-0">
          <h1 className="text-[2.375rem] font-extrabold leading-[1.05] tracking-[-0.035em] sm:text-[2.875rem] lg:text-display">
            Your activity, <span className="text-accent">from above.</span>
          </h1>
          <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-ink-2 sm:text-lg">
            Upload a run, ride or hike from any tracker. Get a full analysis, a 3D flyover of your route, and a video to share.
          </p>
        </div>

        <SamplePreview className="aspect-[16/10.5] w-full sm:aspect-[4/3.3] lg:row-span-2" />

        <div className="min-w-0">
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
            className={`relative flex flex-col items-center overflow-hidden rounded-card border-2 px-5 py-6 text-center transition-[background-color,border-color,box-shadow] duration-150 sm:px-6 sm:py-10 ${
              state === "dragging"
                ? "border-solid border-accent bg-accent/8 shadow-[0_0_0_6px_color-mix(in_srgb,var(--accent)_15%,transparent)]"
                : state === "loading"
                  ? "border-solid border-accent/60 bg-surface"
                  : "border-dashed border-line bg-surface hover:border-muted"
            }`}
          >
            <span
              className={`flex h-12 w-12 items-center justify-center rounded-full transition-[background-color,transform] duration-150 ${
                state === "dragging" ? "scale-110 bg-accent-strong text-white" : "bg-accent/12 text-accent-ink"
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
              {state === "loading" ? (pending === "sample" ? "Loading the sample run…" : "Reading your file…") : state === "dragging" ? "Release to open" : "Drop a TCX or GPX file"}
            </p>
            <p className="mt-1 text-sm text-ink-2">{state === "loading" ? "Parsing and checking every point, on your device." : "Or a whole folder, to build a library."}</p>

            {state === "loading" ? (
              <div className="mt-6 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Reading file">
                <div className="progress-indeterminate h-full w-2/5 rounded-full bg-accent" />
              </div>
            ) : (
              <div className="mt-6 flex flex-col items-center gap-2">
                <button type="button" onClick={() => input.current?.click()} className="btn btn-primary btn-lg min-w-48">
                  Choose file
                </button>
                <button type="button" onClick={sample} className="btn btn-quiet btn-sm text-ink-2 underline decoration-line underline-offset-4 hover:decoration-ink">
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
        <ul className="mt-5 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map((c) => (
            <li key={c.title} className="flex gap-3.5 lg:flex-col lg:gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-surface text-accent-ink ring-1 ring-grid">{c.icon}</span>
              <div>
                <h3 className="font-semibold">{c.title}</h3>
                <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{c.text}</p>
              </div>
            </li>
          ))}
        </ul>
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
  );
}
