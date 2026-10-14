import type { Analysis } from "../../lib/analysis/types";
import { formatDuration, formatElevation, formatPace, unitLabel, unitLength, usesPace } from "../../lib/format/format";
import { useStore } from "../../state/store";
import { Badge, Card, Explain } from "../ui";
import { splitOffsets } from "./math";
import { formatSplitMotion } from "./units";

/**
 * Splits per km / mile. The bar is centered on your average pace: faster splits reach right
 * (accent), slower ones left (neutral). The fastest full split is highlighted; the slowest is
 * only marked, never colored as a failure.
 */
export function SplitsTable({ a }: { a: Analysis }) {
  const setHighlight = useStore((s) => s.setHighlight);
  const u = a.settings.units;
  const unit = unitLabel(u);
  const L = unitLength(u);
  const routeOnly = a.activity.routeOnly;
  const pace = usesPace(a.activity.kind);
  const s = a.summary;
  const isFull = (d: number) => Math.abs(d - L) < 1;
  const full = a.splits.filter((x) => isFull(x.distance));
  const fastest = full.length >= 2 ? full.reduce((x, y) => (y.pace < x.pace ? y : x)) : null;
  const slowest = full.length >= 2 ? full.reduce((x, y) => (y.pace > x.pace ? y : x)) : null;
  // Partial splits sit at the center so a short last split can't set the scale.
  const offsets = splitOffsets(
    a.splits.map((x) => (isFull(x.distance) ? x.pace : s.avgPace)),
    s.avgPace,
  );
  const hasGap = !routeOnly && pace && a.splits.some((x) => x.gapPace !== undefined);
  const hasHr = !routeOnly && a.zones.length > 0;
  const hasCad = !routeOnly && a.splits.some((x) => x.avgCadence !== undefined);
  const hasElev = !!a.elev;
  const th = "pb-2 pr-3 text-label font-medium text-muted whitespace-nowrap";
  const num = "py-2.5 pr-3 text-right";
  const elevUnit = u === "metric" ? "m" : "ft";
  const motionHead = pace ? `Pace /${unit}` : u === "metric" ? "km/h" : "mph";

  return (
    <Card
      title="Splits"
      aside={
        <span>
          per {unit}
          {routeOnly ? "" : ", moving time"}
        </span>
      }
    >
      <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
        <table className="w-full text-[15px] tabular">
          <thead className="text-left">
            <tr>
              <th className={th}>{unit === "km" ? "Km" : "Mile"}</th>
              {!routeOnly && (
                <>
                  <th className={`${th} text-right`}>{motionHead}</th>
                  <th className={`${th} w-full min-w-20`}>
                    <span className="sr-only">Compared with average</span>
                    <span aria-hidden className="flex justify-between text-[11px] font-normal">
                      <span>slower</span>
                      <span>faster</span>
                    </span>
                  </th>
                  <th className={`${th} hidden text-right sm:table-cell`}>Time</th>
                </>
              )}
              {hasGap && <th className={`${th} hidden text-right md:table-cell`}>GAP /{unit}</th>}
              {hasHr && <th className={`${th} text-right`}>HR bpm</th>}
              {hasCad && <th className={`${th} hidden text-right md:table-cell`}>{a.activity.kind === "ride" ? "rpm" : "spm"}</th>}
              {hasElev && <th className={`${th} !pr-0 text-right`}>Elev {elevUnit}</th>}
            </tr>
          </thead>
          <tbody>
            {a.splits.map((sp, k) => {
              const partial = !isFull(sp.distance);
              const isFast = sp === fastest;
              const isSlow = sp === slowest;
              const off = partial ? 0 : offsets[k];
              const on = () => setHighlight({ from: sp.startIdx, to: sp.endIdx, label: `Split ${sp.index}` });
              return (
                <tr
                  key={sp.index}
                  tabIndex={0}
                  className={`cursor-default border-t border-grid outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 ${isFast ? "bg-accent/8" : ""}`}
                  onMouseEnter={on}
                  onMouseLeave={() => setHighlight(null)}
                  onFocus={on}
                  onBlur={() => setHighlight(null)}
                >
                  <td className="py-2.5 pr-3 font-medium text-ink-2">{partial ? (sp.distance / L).toFixed(2) : sp.index}</td>
                  {!routeOnly && (
                    <>
                      <td className={`${num} whitespace-nowrap font-semibold`}>
                        <span className="inline-flex items-center justify-end gap-2">
                          {isFast && <Badge tone="accent">Fastest</Badge>}
                          {isSlow && (
                            <span className="hidden sm:inline">
                              <Badge>Slowest</Badge>
                            </span>
                          )}
                          {formatSplitMotion(sp.pace, a, false)}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3" title={partial ? "Partial split" : undefined}>
                        <div className="relative h-2.5">
                          <div className="absolute inset-y-[-3px] left-1/2 w-px bg-line" aria-hidden />
                          {!partial && (
                            <div
                              className={`absolute inset-y-0 rounded-full ${off >= 0 ? "bg-accent" : "bg-ink-2/45"}`}
                              style={off >= 0 ? { left: "50%", width: `${Math.max(1.5, off * 50)}%` } : { right: "50%", width: `${Math.max(1.5, -off * 50)}%` }}
                            />
                          )}
                        </div>
                      </td>
                      <td
                        className={`${num} hidden text-ink-2 sm:table-cell`}
                        title={sp.elapsed - sp.moving >= 1 ? `${formatDuration(sp.elapsed)} elapsed` : undefined}
                      >
                        {formatDuration(sp.moving)}
                      </td>
                    </>
                  )}
                  {hasGap && <td className={`${num} hidden text-ink-2 md:table-cell`}>{sp.gapPace !== undefined ? formatPace(sp.gapPace, u, false) : "—"}</td>}
                  {hasHr && <td className={`${num} text-ink-2`}>{sp.avgHr ? Math.round(sp.avgHr) : "—"}</td>}
                  {hasCad && <td className={`${num} hidden text-ink-2 md:table-cell`}>{sp.avgCadence ? Math.round(sp.avgCadence) : "—"}</td>}
                  {hasElev && (
                    <td className="py-2.5 text-right text-ink-2">
                      {sp.elevDelta !== undefined ? `${sp.elevDelta >= 0 ? "+" : "−"}${formatElevation(Math.abs(sp.elevDelta), u).split(" ")[0]}` : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!routeOnly && (
        <Explain>
          Bars compare each split with your average of {formatSplitMotion(s.avgPace, a)}. First half {formatSplitMotion(s.firstHalfPace, a)}, second half{" "}
          {formatSplitMotion(s.secondHalfPace, a)}.{hasGap && " GAP is the split's pace adjusted for hills."}
        </Explain>
      )}
    </Card>
  );
}
