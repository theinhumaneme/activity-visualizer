import { useMemo, useState } from "react";
import type { Units } from "../../lib/analysis/types";
import { formatClock, formatDuration, formatMotion, formatPace, motionLabel } from "../../lib/format/format";
import { activityLoad } from "../../lib/library/load";
import type { PersonalRecord } from "../../lib/library/records";
import type { LibraryRecord } from "../../lib/library/types";
import { type SportFilter, distanceText, shortDate, sportLabel } from "./format";

type SortKey = "date" | "distance" | "time" | "pace" | "gap" | "hr" | "load";
const PAGE = 50;

const shortLabel = (label: string) => label.replace(/^Half marathon$/, "Half").replace(/^Marathon$/, "Full").replace(/^1 mile$/, "Mile").replace(/ km$/, "K");

export function ActivityList({
  records,
  prsById,
  kind,
  units,
  opening,
  onOpen,
}: {
  records: LibraryRecord[];
  prsById: Map<string, PersonalRecord[]>;
  kind: SportFilter;
  units: Units;
  opening: string | null;
  onOpen: (id: string) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "date", desc: true });
  const [shown, setShown] = useState(PAGE);
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
              {header("date", "Date", "pl-4")}
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
            {sorted.slice(0, shown).map((r) => {
              const prs = prsById.get(r.id) ?? [];
              return (
                <tr key={r.id} className="border-b border-grid last:border-0 hover:bg-surface-2/60">
                  <td className="py-2 pl-4 pr-2">
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
