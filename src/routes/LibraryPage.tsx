import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { ActivityList } from "../components/library/ActivityList";
import { AddFiles } from "../components/library/AddFiles";
import { type SportFilter, capitalize, distanceText, shortDate, sportPlural, sportSingular } from "../components/library/format";
import { Progress } from "../components/library/Progress";
import { Recap } from "../components/library/Recap";
import { useOpenActivity } from "../components/steps";
import { Loading, Segmented } from "../components/ui";
import { unitLabel, unitLength } from "../lib/format/format";
import { groupsWithin, inPeriod, periodIncludesNow, periodOptions } from "../lib/library/aggregate";
import { personalRecords, recordsByActivity } from "../lib/library/records";
import { groupRoutes, relabelGroups } from "../lib/library/similarity";
import type { SportKind } from "../lib/parse/types";
import { libraryPrivacyRadius, useLibrary } from "../state/library";
import { useStore } from "../state/store";

// The map tabs pull in MapLibre (~290 KB gzipped); load it only when one of them is opened.
const Heatmap = lazy(() => import("../components/library/Heatmap").then((m) => ({ default: m.Heatmap })));
const Race = lazy(() => import("../components/library/Race").then((m) => ({ default: m.Race })));

type Tab = "recap" | "heatmap" | "race" | "progress" | "list";
const TABS: { value: Tab; label: string }[] = [
  { value: "recap", label: "Recap" },
  { value: "heatmap", label: "Heatmap" },
  { value: "race", label: "Race yourself" },
  { value: "progress", label: "Progress" },
  { value: "list", label: "Activities" },
];
const TAB_KEY = "rv:library-tab";

function storedTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    if (TABS.some((x) => x.value === t)) return t as Tab;
  } catch {
    // Storage unavailable.
  }
  return "recap";
}

export function LibraryPage() {
  const entries = useLibrary((s) => s.entries);
  const loading = useLibrary((s) => s.loading);
  const progress = useLibrary((s) => s.progress);
  const problems = useLibrary((s) => s.problems);
  const unsupported = useLibrary((s) => s.unsupported);
  const duplicates = useLibrary((s) => s.duplicates);
  const units = useLibrary((s) => s.units);
  const setUnits = useLibrary((s) => s.setUnits);
  const cancel = useLibrary((s) => s.cancel);
  const clear = useLibrary((s) => s.clear);
  const restoring = useLibrary((s) => s.restoring);
  const notSaved = useLibrary((s) => s.notSaved);
  const upgrading = useLibrary((s) => s.upgrading);
  const open = useLibrary((s) => s.open);
  const mainUnits = useStore((s) => s.settings?.units);
  const mainError = useStore((s) => s.error);

  // Follow the header's km/mi toggle when a single activity is loaded too.
  useEffect(() => {
    if (mainUnits && mainUnits !== units) setUnits(mainUnits);
  }, [mainUnits]); // eslint-disable-line react-hooks/exhaustive-deps

  const radius = useMemo(libraryPrivacyRadius, []);
  const [tab, setTabState] = useState<Tab>(storedTab);
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // Not critical.
    }
  };

  const kinds = useMemo(() => {
    const counts = new Map<SportKind, number>();
    for (const e of entries) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [entries]);
  // Several sports: start with all of them together; one sport: just that one.
  const [kindPref, setKind] = useState<SportFilter | null>(null);
  const kind: SportFilter =
    kindPref && (kindPref === "all" ? kinds.length > 1 : kinds.includes(kindPref)) ? kindPref : kinds.length > 1 ? "all" : (kinds[0] ?? "all");

  const ofKind = useMemo(() => (kind === "all" ? entries : entries.filter((e) => e.kind === kind)), [entries, kind]);
  const periods = useMemo(() => periodOptions(ofKind), [ofKind]);
  const [periodPref, setPeriod] = useState("all");
  const period = periods.some((p) => p.value === periodPref) ? periodPref : "all";
  const periodLabel = periods.find((p) => p.value === period)?.label ?? "All time";
  const shown = useMemo(() => ofKind.filter((e) => inPeriod(e, period)), [ofKind, period]);
  const byId = useMemo(() => new Map(shown.map((e) => [e.id, e])), [shown]);

  // Route grouping (always within one sport) runs once over the selection; periods just filter the members.
  // Switching units only relabels the groups; the shape comparison doesn't run again.
  const grouped = useMemo(() => groupRoutes(ofKind), [ofKind]);
  const allGroups = useMemo(() => relabelGroups(grouped, ofKind, unitLength(units), unitLabel(units)), [grouped, ofKind, units]);
  const groups = useMemo(() => groupsWithin(allGroups, new Set(shown.map((e) => e.id))), [allGroups, shown]);
  const prsAllTime = useMemo(() => recordsByActivity(personalRecords(ofKind)), [ofKind]);
  const prsPeriod = useMemo(() => personalRecords(shown), [shown]);

  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const openLanding = useOpenActivity();
  async function openActivity(id: string) {
    setOpening(id);
    setOpenError(null);
    const ok = await open(id);
    setOpening(null);
    if (ok) openLanding();
    else setOpenError(useStore.getState().error ?? mainError ?? "Couldn't open that file.");
  }

  const total = useMemo(() => shown.reduce((s, e) => s + e.distance, 0), [shown]);
  const notes = [
    unsupported > 0 && `${unsupported} ${unsupported === 1 ? "file isn't" : "files aren't"} TCX or GPX (FIT isn't supported yet).`,
    duplicates > 0 && `${duplicates} already in your library.`,
  ].filter(Boolean) as string[];

  return (
    <div className="enter mx-auto max-w-7xl px-4 py-6 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="label-caps text-accent">Library</div>
          <h1 className="mt-1 font-display text-4xl font-bold uppercase leading-none tracking-tight sm:text-5xl">
            {entries.length ? `${shown.length.toLocaleString()} ${shown.length === 1 ? sportSingular(kind) : sportPlural(kind)}. ${distanceText(total, units)}.` : "Your library"}
          </h1>
          {shown.length > 0 && (
            <p className="mt-2 text-sm text-ink-2">
              {shortDate(shown[0])} – {shortDate(shown[shown.length - 1])}
              <span className="text-muted"> · kept in this browser for your next visit</span>
            </p>
          )}
        </div>
        {entries.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <AddFiles />
            <button
              onClick={() => {
                if (confirm("Remove every activity from the library, including the copies kept in this browser? Your original files aren't touched.")) clear();
              }}
              className="rounded-full px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-ink-2"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="mt-6 rounded-2xl border border-grid bg-surface p-4" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>
              Reading <span className="tabular">{progress.done.toLocaleString()}</span> of <span className="tabular">{progress.total.toLocaleString()}</span> files…
            </span>
            <button onClick={cancel} className="rounded-full px-3 py-1 text-ink-2 hover:bg-surface-2">
              Stop
            </button>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full origin-left rounded-full bg-accent transition-transform" style={{ transform: `scaleX(${progress.done / Math.max(1, progress.total)})` }} />
          </div>
          <p className="mt-2 text-xs text-muted">Parsed and analyzed on your device, three at a time. Nothing is uploaded.</p>
        </div>
      )}

      {(problems.length > 0 || notes.length > 0) && !loading && (
        <details className="mt-4 rounded-xl border border-grid bg-surface px-4 py-3 text-sm text-ink-2">
          <summary className="cursor-pointer">
            {[problems.length > 0 && `${problems.length} skipped`, ...notes].filter(Boolean).join(" · ")}
          </summary>
          <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto text-xs">
            {problems.map((p, i) => (
              <li key={i}>
                <span className="font-medium text-ink">{p.fileName}</span>: {p.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      {openError && (
        <p role="alert" className="mt-4 rounded-lg bg-critical/15 px-3 py-2 text-sm text-ink">
          {openError}
        </p>
      )}

      {upgrading && !loading && (
        <p role="status" className="mt-4 text-sm text-muted">
          Updating saved activities for the new stats: <span className="tabular">{upgrading.done.toLocaleString()}</span> of{" "}
          <span className="tabular">{upgrading.total.toLocaleString()}</span> files…
        </p>
      )}

      {notSaved && !loading && (
        <p role="status" className="mt-4 rounded-lg bg-warning/15 px-3 py-2 text-sm text-ink">
          This browser wouldn't store more (its storage is full or turned off), so the last files you added are here for this visit only.
        </p>
      )}

      {!entries.length && !loading && !restoring && (
        <div className="mt-6">
          <AddFiles zone />
        </div>
      )}

      {entries.length > 0 && (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <span className="label-caps text-muted">Period</span>
              <select value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-ink">
                {periods.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            {kinds.length > 1 && (
              <Segmented
                label="Sport"
                value={kind}
                onChange={setKind}
                options={[{ value: "all" as SportFilter, label: "All" }, ...kinds.map((k) => ({ value: k as SportFilter, label: capitalize(sportPlural(k)) }))]}
              />
            )}
            <Segmented
              label="Units"
              value={units}
              onChange={setUnits}
              options={[
                { value: "metric", label: "km" },
                { value: "imperial", label: "mi" },
              ]}
            />
          </div>

          <nav aria-label="Library views" className="mt-4 flex gap-1 overflow-x-auto border-b border-grid [scrollbar-width:none]">
            {TABS.map((t) => (
              <button
                key={t.value}
                onClick={() => setTab(t.value)}
                aria-current={tab === t.value ? "page" : undefined}
                className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm ${tab === t.value ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink-2"}`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="mt-4">
            {tab === "recap" && <Recap records={shown} groups={groups} prs={prsPeriod} kind={kind} units={units} periodLabel={periodLabel} onOpen={openActivity} />}
            <Suspense fallback={<Loading label="Loading the map…" />}>
              {tab === "heatmap" && <Heatmap records={shown} radius={radius} units={units} />}
              {tab === "race" && <Race key={`${kind}-${period}`} groups={groups} byId={byId} radius={radius} units={units} />}
            </Suspense>
            {tab === "progress" && <Progress records={shown} history={ofKind} throughToday={periodIncludesNow(period)} kind={kind} units={units} />}
            {tab === "list" && <ActivityList records={shown} prsById={prsAllTime} kind={kind} units={units} opening={opening} onOpen={openActivity} />}
          </div>
          {tab === "list" && <p className="mt-2 text-xs text-muted">PR badges are all-time bests for each distance across your library. GAP is pace adjusted for hills; load is heart-rate training load (TRIMP), or TSS from power.</p>}
        </>
      )}
    </div>
  );
}
