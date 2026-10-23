import { Fragment, useMemo, useRef, useState } from "react";
import type { Units } from "../../lib/analysis/types";
import { formatClock, formatDuration, formatMotion, formatPace, motionLabel } from "../../lib/format/format";
import { localDay } from "../../lib/library/aggregate";
import { countText } from "../../lib/library/combine";
import { activityLoad } from "../../lib/library/load";
import type { PersonalRecord } from "../../lib/library/records";
import type { LibraryRecord } from "../../lib/library/types";
import { type SportFilter, distanceText, shortDate, sportLabel } from "./format";

type SortKey = "date" | "distance" | "time" | "pace" | "gap" | "hr" | "load";
const PAGE = 50;

const shortLabel = (label: string) => label.replace(/^Half marathon$/, "Half").replace(/^Marathon$/, "Full").replace(/^1 mile$/, "Mile").replace(/ km$/, "K");

/** Where a combined day opens: playing in the flyover, or on the export page. */
export type CombineTo = "flyover" | "export";

export function ActivityList({
  records,
  prsById,
  kind,
  units,
  opening,
  onOpen,
  selected,
  onSelect,
  onCombine,
}: {
  records: LibraryRecord[];
  prsById: Map<string, PersonalRecord[]>;
  kind: SportFilter;
  units: Units;
  /** The id being opened (or "combined" while a combined day loads). */
  opening: string | null;
  onOpen: (id: string) => void;
  /** Activities picked to fly together or delete (kept across filters, so they can come from anywhere). */
  selected: ReadonlySet<string>;
  onSelect: (ids: string[], on: boolean) => void;
  onCombine: (ids: string[], to: CombineTo) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "date", desc: true });
  const [shown, setShown] = useState(PAGE);
  /** The last row ticked, for shift-click ranges. */
  const anchor = useRef<string | null>(null);
  const sorted = useMemo(() => {
    const val = (r: LibraryRecord): number => {
      switch (sort.key) {
        case "date":
          return r.startTime;
        case "distance":
          return r.distance;
        case "time":
          return r.moving;
        case "pace":
          return r.avgSpeed;
        case "gap":
          // Faster first when descending, like pace.
          return r.gapPace ? 1000 / r.gapPace : NaN;
        case "hr":
          return r.avgHr ?? NaN;
        case "load":
          return activityLoad(r) ?? NaN;
      }
    };
    return [...records].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      // Missing values sink to the bottom either way.
      if (Number.isNaN(va) !== Number.isNaN(vb)) return Number.isNaN(va) ? 1 : -1;
      return sort.desc ? vb - va : va - vb;
    });
  }, [records, sort]);

  // Days with two or more activities get a header with "Fly the day" while sorted by date.
  const days = useMemo(() => {
    const byDay = new Map<number, LibraryRecord[]>();
    for (const r of records) {
      const d = localDay(r);
      const list = byDay.get(d);
      if (list) list.push(r);
      else byDay.set(d, [r]);
    }
    for (const list of byDay.values()) list.sort((a, b) => a.startTime - b.startTime);
    return byDay;
  }, [records]);
  const page = sorted.slice(0, shown);
  const toggle = (id: string, on: boolean, range: boolean) => {
    const from = range && anchor.current ? page.findIndex((r) => r.id === anchor.current) : -1;
    const to = page.findIndex((r) => r.id === id);
    if (from >= 0 && to >= 0) onSelect(page.slice(Math.min(from, to), Math.max(from, to) + 1).map((r) => r.id), on);
    else onSelect([id], on);
    anchor.current = id;
  };

  const hasGap = records.some((r) => r.gapPace !== undefined);
  const hasLoad = records.some((r) => activityLoad(r) !== undefined);
  const header = (key: SortKey, label: string, className = "") => {
    const active = sort.key === key;
    return (
      <th scope="col" aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"} className={`px-2 py-2 font-normal ${className}`}>
        <button
          onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}
          className={`label-caps inline-flex items-center gap-1 ${active ? "text-ink" : "text-muted hover:text-ink-2"}`}
        >
          {label}
          <span aria-hidden className={active ? "" : "invisible"}>
            {sort.desc ? "↓" : "↑"}
          </span>
        </button>
      </th>
    );
  };

  return (
    <div className="rounded-2xl border border-grid bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm tabular">
          <thead className="border-b border-grid text-left">
            <tr>
              <th scope="col" className="w-0 py-2 pl-4 pr-1">
                <span className="sr-only">Pick</span>
              </th>
              {header("date", "Date", "pl-1")}
              {header("distance", "Distance", "text-right")}
              {header("time", "Time", "text-right")}
              {header("pace", kind === "all" ? "Pace / speed" : motionLabel(kind), "text-right")}
              {hasGap && header("gap", "GAP", "text-right")}
              {header("hr", "HR", "text-right")}
              {hasLoad && header("load", "Load", "text-right")}
              <th scope="col" className="label-caps px-2 py-2 text-left font-normal text-muted">
                Records
              </th>
              <th scope="col" className="pr-4">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {page.map((r, i) => {
              const prs = prsById.get(r.id) ?? [];
              const day = sort.key === "date" ? days.get(localDay(r))! : null;
              const firstOfDay = !!day && day.length > 1 && (i === 0 || localDay(page[i - 1]) !== localDay(r));
              return (
                <Fragment key={r.id}>
                  {firstOfDay && <DayRow day={day} selected={selected} opening={opening} onSelect={onSelect} onCombine={onCombine} />}
                  <tr className={`border-b border-grid last:border-0 ${selected.has(r.id) ? "bg-accent/10" : "hover:bg-surface-2/60"}`}>
                    <td className="py-2 pl-4 pr-1">
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={(e) => toggle(r.id, e.target.checked, (e.nativeEvent as MouseEvent).shiftKey)}
                        aria-label={`Pick ${r.name}, ${shortDate(r)}`}
                        className="h-4 w-4 accent-[var(--color-accent)]"
                      />
                    </td>
                    <td className="py-2 pl-1 pr-2">
                      <div className="whitespace-nowrap">{shortDate(r)}</div>
                      <div className="max-w-[16rem] truncate text-xs text-muted" title={r.fileName}>
                        {kind === "all" && `${sportLabel(r.kind)} · `}
                        {formatClock(r.startTime, r.utcOffsetMin)} · {r.name}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">{distanceText(r.distance, units)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">{formatDuration(r.moving)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">{formatMotion(r.avgSpeed, r.kind, units)}</td>
                    {hasGap && (
                      <td className="whitespace-nowrap px-2 py-2 text-right" title="Grade-adjusted pace">
                        {r.gapPace !== undefined ? formatPace(r.gapPace, units) : <span className="text-muted">—</span>}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-2 py-2 text-right">{r.avgHr ? Math.round(r.avgHr) : <span className="text-muted">—</span>}</td>
                    {hasLoad && (
                      <td className="whitespace-nowrap px-2 py-2 text-right" title={r.trimp !== undefined ? "Heart-rate training load (TRIMP)" : r.tss !== undefined ? "Training stress from power (TSS)" : undefined}>
                        {activityLoad(r) !== undefined ? Math.round(activityLoad(r)!) : <span className="text-muted">—</span>}
                      </td>
                    )}
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        {prs.map((p) => (
                          <span
                            key={p.distance}
                            title={`Fastest ${p.label}: ${formatDuration(p.seconds)}`}
                            className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-1.5 py-0.5 text-[11px] font-semibold text-ink"
                          >
                            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
                            {shortLabel(p.label)} PR
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <button
                        onClick={() => onOpen(r.id)}
                        disabled={opening !== null}
                        className="rounded-full border border-line px-3 py-1 text-xs font-medium text-ink-2 hover:bg-surface-2 disabled:opacity-50"
                      >
                        {opening === r.id ? "Opening…" : "Open"}
                      </button>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {sorted.length > shown && (
        <div className="border-t border-grid p-3 text-center">
          <button onClick={() => setShown((s) => s + PAGE * 4)} className="text-sm text-ink-2 underline underline-offset-2 hover:text-ink">
            Show more ({(sorted.length - shown).toLocaleString()} left)
          </button>
        </div>
      )}
    </div>
  );
}

/** A day with several activities: pick them all, or fly / export them as one in a click. */
function DayRow({
  day,
  selected,
  opening,
  onSelect,
  onCombine,
}: {
  day: LibraryRecord[];
  selected: ReadonlySet<string>;
  opening: string | null;
  onSelect: (ids: string[], on: boolean) => void;
  onCombine: (ids: string[], to: CombineTo) => void;
}) {
  const ids = day.map((r) => r.id);
  const all = ids.every((id) => selected.has(id));
  const label = `${shortDate(day[0])} · ${countText(day.map((r) => r.kind))}`;
  const btn = "rounded-full px-2.5 py-0.5 text-xs font-medium disabled:opacity-50";
  return (
    <tr className="border-b border-grid bg-surface-2/50">
      <td className="py-1.5 pl-4 pr-1">
        <input type="checkbox" checked={all} onChange={(e) => onSelect(ids, e.target.checked)} aria-label={`Pick all of ${label}`} className="h-4 w-4 accent-[var(--color-accent)]" />
      </td>
      <td colSpan={99} className="py-1.5 pl-1 pr-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-xs font-semibold text-ink-2">{label}</span>
          <span className="ml-auto flex gap-1">
            <button onClick={() => onCombine(ids, "flyover")} disabled={opening !== null} className={`${btn} bg-ink text-page hover:opacity-90`}>
              {opening === "combined" ? "Opening…" : "Fly the day"}
            </button>
            <button onClick={() => onCombine(ids, "export")} disabled={opening !== null} className={`${btn} border border-line text-ink-2 hover:bg-surface-2`}>
              Export the day
            </button>
          </span>
        </div>
      </td>
    </tr>
  );
}
