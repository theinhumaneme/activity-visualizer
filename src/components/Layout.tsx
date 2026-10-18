import { type ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { install, useIncoming, useInstall } from "../lib/pwa";
import { useLibrary } from "../state/library";
import { useStore } from "../state/store";
import { type ThemePref, useTheme } from "../state/theme";
import { STEPS } from "./steps";
import { Check, Chevron, PageSkeleton, Segmented } from "./ui";

const REPO = "https://github.com/theinhumaneme/activity-visualizer";

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink">
      {children}
    </a>
  );
}

/** Activity files opened with or shared to the installed app: one goes to Check, several to the library. */
function IncomingFiles() {
  const files = useIncoming((s) => s.files);
  const navigate = useNavigate();
  useEffect(() => {
    if (!files?.length) return;
    useIncoming.setState({ files: null });
    if (files.length === 1) void useStore.getState().loadFile(files[0]).then((ok) => ok && navigate("/check"));
    else {
      void useLibrary.getState().addFiles(files);
      navigate("/library");
    }
  }, [files, navigate]);
  return null;
}

function InstallApp() {
  const { prompt, iosHint, installed } = useInstall();
  if (installed) return null;
  if (prompt)
    return (
      <p className="mt-3">
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => void install()}>
          Install the app
        </button>{" "}
        — works offline and opens your GPX and TCX files.
      </p>
    );
  if (iosHint) return <p className="mt-1.5">Install it: Share → Add to Home Screen.</p>;
  return null;
}

type StepState = "current" | "done" | "available" | "locked";

/** Steps you've opened for this activity count as done; Upload is done once a file is loaded. */
function useStepStates(): StepState[] {
  const activity = useStore((s) => s.activity);
  const { pathname } = useLocation();
  const [visited, setVisited] = useState<{ of: unknown; paths: Set<string> }>({ of: activity, paths: new Set() });
  const paths = visited.of === activity ? visited.paths : new Set<string>();

  useEffect(() => {
    setVisited((v) => {
      const base = v.of === activity ? v.paths : new Set<string>();
      if (base.has(pathname)) return v.of === activity ? v : { of: activity, paths: base };
      return { of: activity, paths: new Set(base).add(pathname) };
    });
  }, [activity, pathname]);

  return STEPS.map((step, i) => {
    if (step.path === pathname) return "current";
    if (i > 0 && !activity) return "locked";
    if (i === 0 ? !!activity : paths.has(step.path)) return "done";
    return "available";
  });
}

export function Layout() {
  const hasLibrary = useLibrary((s) => s.entries.length > 0);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const { pathname } = useLocation();
  const states = useStepStates();

  const header = useRef<HTMLElement>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname]);

  // Sticky bars further down sit just under the header, whose height changes with the layout.
  useEffect(() => {
    const el = header.current!;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--header-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="flex min-h-dvh flex-col">
      <header ref={header} className="header-shade sticky top-0 z-30 border-b border-grid bg-page/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 sm:px-6 lg:gap-5">
          <Link to="/" className="flex shrink-0 items-center gap-2 rounded-md font-semibold tracking-[-0.01em]">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <span className="hidden sm:inline lg:hidden xl:inline">Activity Visualizer</span>
          </Link>
          <StepNav states={states} />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {hasLibrary && (
              <NavLink to="/library" className={({ isActive }) => `btn btn-sm ${isActive ? "bg-ink text-page" : "btn-quiet"}`}>
                Library
              </NavLink>
            )}
            <ThemeToggle />
            {settings && (
              <Segmented
                size="sm"
                label="Units"
                value={settings.units}
                onChange={(units) => updateSettings({ units })}
                options={[
                  { value: "metric", label: "km", title: "Kilometers" },
                  { value: "imperial", label: "mi", title: "Miles" },
                ]}
              />
            )}
          </div>
        </div>
        <CompactSteps states={states} />
      </header>
      <main className="flex-1">
        {/* Inside the layout, so the header stays put while a page's code loads. */}
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      </main>
      <IncomingFiles />
      <footer className="border-t border-grid px-4 py-6 text-center text-label text-muted">
        <p>Your files are processed in your browser and never uploaded.</p>
        <p className="mt-1.5">
          Map data © <FooterLink href="https://www.openstreetmap.org/copyright">OpenStreetMap</FooterLink> contributors · Tiles by{" "}
          <FooterLink href="https://openfreemap.org">OpenFreeMap</FooterLink> · Terrain from{" "}
          <FooterLink href="https://mapterhorn.com/attribution">Mapterhorn</FooterLink> and <FooterLink href="https://registry.opendata.aws/terrain-tiles/">AWS Open Data</FooterLink> · Rendered with{" "}
          <FooterLink href="https://maplibre.org">MapLibre</FooterLink> and <FooterLink href="https://mediabunny.dev">Mediabunny</FooterLink>
        </p>
        <p className="mt-1.5">
          Made by <FooterLink href="https://github.com/theinhumaneme">Kalyan Mudumby</FooterLink> ·{" "}
          <FooterLink href={`${REPO}/blob/main/LICENSE`}>MIT License</FooterLink> · <FooterLink href={REPO}>Source on GitHub</FooterLink>
        </p>
        <InstallApp />
      </footer>
    </div>
  );
}

function StepMark({ state, n }: { state: StepState; n: number }) {
  const base = "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular";
  if (state === "done")
    return (
      <span className={`${base} pop bg-good/15 text-good`}>
        <Check className="h-3 w-3" />
      </span>
    );
  if (state === "current") return <span className={`${base} bg-accent-strong text-white`}>{n}</span>;
  if (state === "locked") return <span className={`${base} border border-dashed border-line text-muted`}>{n}</span>;
  return <span className={`${base} border border-line text-ink-2`}>{n}</span>;
}

/** Full six-step sequence, on wide screens. */
function StepNav({ states }: { states: StepState[] }) {
  return (
    <nav aria-label="Steps" className="hidden min-w-0 flex-1 lg:block">
      <ol className="flex items-center gap-1">
        {STEPS.map((step, i) => {
          const state = states[i];
          const inner = (
            <>
              <StepMark state={state} n={i + 1} />
              {step.label}
            </>
          );
          const cls = "flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-sm transition-colors duration-150";
          return (
            <li key={step.path} className="flex items-center gap-1">
              {i > 0 && <span className={`h-px w-3 ${state === "locked" ? "bg-grid" : "bg-line"}`} aria-hidden />}
              {state === "locked" ? (
                <span className={`${cls} cursor-not-allowed text-muted`} aria-disabled title="Load an activity first">
                  {inner}
                </span>
              ) : (
                <NavLink
                  to={step.path}
                  end
                  aria-current={state === "current" ? "step" : undefined}
                  className={`${cls} ${state === "current" ? "bg-surface font-semibold text-ink shadow-[var(--shadow-raised)] ring-1 ring-grid" : "font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
                >
                  {inner}
                  {state === "done" && <span className="sr-only">(done)</span>}
                </NavLink>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** "Step 3 of 6 · Overview" with the whole sequence one tap away, on phones and tablets. */
function CompactSteps({ states }: { states: StepState[] }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const box = useRef<HTMLDivElement>(null);
  const current = states.indexOf("current");
  const done = states.filter((s) => s === "done").length;

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (current < 0) return null;
  const prev = STEPS[current - 1];
  const next = states[current + 1] && states[current + 1] !== "locked" ? STEPS[current + 1] : null;

  return (
    <div ref={box} className="relative border-t border-grid lg:hidden">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-1.5 sm:px-6">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="step-menu"
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-9 min-w-0 flex-1 items-center gap-2.5 rounded-control px-1 text-left"
        >
          <span className="flex gap-1" aria-hidden>
            {states.map((s, i) => (
              <span key={i} className={`h-1.5 w-2.5 rounded-full sm:w-3.5 ${s === "current" ? "bg-accent" : s === "done" ? "bg-good/70" : "bg-surface-3"}`} />
            ))}
          </span>
          <span className="min-w-0 truncate text-sm">
            <span className="text-ink-2">
              Step {current + 1} of {STEPS.length} ·{" "}
            </span>
            <span className="font-semibold text-ink">{STEPS[current].label}</span>
            <span className="sr-only">, {done} done. Show all steps</span>
          </span>
          <Chevron className={`ml-auto text-ink-2 transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
        </button>
        {prev && (
          <Link to={prev.path} className="btn btn-quiet btn-sm hidden !px-2.5 sm:inline-flex" aria-label={`Back to ${prev.label}`}>
            ←
          </Link>
        )}
        {next && (
          <Link to={next.path} className="btn btn-secondary btn-sm !px-2.5" aria-label={`Next: ${next.label}`}>
            →
          </Link>
        )}
      </div>
      {open && (
        <nav id="step-menu" aria-label="Steps" className="drop-in absolute inset-x-0 top-full border-b border-grid bg-surface shadow-[var(--shadow-pop)]">
          <ol className="mx-auto grid max-w-7xl gap-0.5 px-4 py-2 sm:grid-cols-2 sm:px-6">
            {STEPS.map((step, i) => {
              const state = states[i];
              const row = "flex min-h-11 items-center gap-3 rounded-control px-2 text-[15px]";
              return (
                <li key={step.path}>
                  {state === "locked" ? (
                    <span className={`${row} text-muted`} aria-disabled>
                      <StepMark state={state} n={i + 1} />
                      {step.label}
                      <span className="ml-auto text-label">Load an activity first</span>
                    </span>
                  ) : (
                    <NavLink
                      to={step.path}
                      end
                      aria-current={state === "current" ? "step" : undefined}
                      className={`${row} ${state === "current" ? "bg-surface-2 font-semibold text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
                    >
                      <StepMark state={state} n={i + 1} />
                      {step.label}
                      {state === "done" && <span className="ml-auto text-label text-good">Done</span>}
                      {state === "current" && <span className="ml-auto text-label text-accent-ink">You're here</span>}
                    </NavLink>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      )}
    </div>
  );
}

const THEME_ICONS: Record<ThemePref, { label: string; path: string }> = {
  system: { label: "Match system theme", path: "M4 5h16v11H4zM9 20h6M12 16v4" },
  light: {
    label: "Light theme",
    path: "M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14-1.41-1.41M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
  },
  dark: { label: "Dark theme", path: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" },
};

function ThemeToggle() {
  const pref = useTheme((s) => s.pref);
  const setPref = useTheme((s) => s.setPref);
  return (
    <div role="radiogroup" aria-label="Theme" className="flex shrink-0 gap-0.5 rounded-full border border-grid bg-surface-2 p-0.5">
      {(Object.keys(THEME_ICONS) as ThemePref[]).map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={pref === p}
          aria-label={THEME_ICONS[p].label}
          title={THEME_ICONS[p].label}
          onClick={() => setPref(p)}
          className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-150 ${pref === p ? "bg-ink text-page" : "text-ink-2 hover:bg-surface-3 hover:text-ink"}`}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d={THEME_ICONS[p].path} />
          </svg>
        </button>
      ))}
    </div>
  );
}
