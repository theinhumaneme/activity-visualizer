import { type ReactNode, useMemo } from "react";
import type { Units } from "../../lib/analysis/types";
import { formatMotion, unitLabel, unitLength } from "../../lib/format/format";
import { DAY_MS, buckets, localDay, rollingMean } from "../../lib/library/aggregate";
import type { LibraryRecord } from "../../lib/library/types";
import { TimeBars, Trend } from "./charts";
import { type SportFilter, distanceText, isFootSport, shortDate, sportPlural, sportSingular } from "./format";

const ROLLING = 5;
/** Heart rate the efficiency is translated at, for the "≈ pace" readout. */
const REF_HR = 150;

function Panel({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-grid bg-surface p-4 sm:p-5">
      <h3 className="label-caps text-muted">{title}</h3>
      <div className="mt-3">{children}</div>
      {note && <p className="mt-2 text-xs leading-relaxed text-muted">{note}</p>}
    </section>
  );
}

const weekLabel = (start: number) =>
  `Week of ${new Date(start * DAY_MS).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
const monthLabel = (start: number) => new Date(start * DAY_MS).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });

export function Progress({ records, kind, units }: { records: LibraryRecord[]; kind: SportFilter; units: Units }) {
  const ul = unitLength(units);
  const unit = unitLabel(units);
  const sorted = useMemo(() => [...records].sort((a, b) => a.startTime - b.startTime), [records]);
  const weeks = useMemo(() => buckets(sorted, "week"), [sorted]);
  // Past ~18 months of weeks the bars get too thin to read; switch to months.
  const monthly = weeks.length > 78;
  const volume = useMemo(() => (monthly ? buckets(sorted, "month") : weeks), [monthly, sorted, weeks]);
  const fmtDist = (v: number) => `${+(v / ul).toFixed(v / ul < 10 ? 1 : 0)}`;
  const xOf = (r: LibraryRecord) => localDay(r) * DAY_MS;

  const withHr = sorted.filter((r) => r.efficiency !== undefined && Number.isFinite(r.efficiency));
  const effLine = rollingMean(
    withHr.map((r) => r.efficiency!),
    ROLLING,
  );
  const withCad = sorted.filter((r) => r.avgCadence !== undefined && Number.isFinite(r.avgCadence));
  const cadLine = rollingMean(
    withCad.map((r) => r.avgCadence!),
    ROLLING,
  );
  const longWeeks = weeks.filter((w) => w.count > 0);
  const byId = new Map(sorted.map((r) => [r.id, r]));
  const plural = sportPlural(kind);
  const one = sportSingular(kind);
  // Efficiency and cadence only compare like with like.
  const single = kind !== "all";
  const cadUnit = kind === "ride" ? "rpm" : isFootSport(kind) ? "steps/min" : "per min";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={`${monthly ? "Monthly" : "Weekly"} distance (${unit})`} note={monthly ? "Monthly totals: your library spans more than 18 months." : "Monday to Sunday, in each activity's local time."}>
        <TimeBars
          label={`${monthly ? "Monthly" : "Weekly"} distance`}
          data={volume.map((b) => ({
            x: b.start * DAY_MS,
            value: b.distance,
            tip: (
              <>
                <div className="text-muted">{monthly ? monthLabel(b.start) : weekLabel(b.start)}</div>
                <div className="font-semibold">{distanceText(b.distance, units)}</div>
                <div className="text-ink-2">
                  {b.count} {b.count === 1 ? one : plural}
                </div>
              </>
            ),
          }))}
          formatTick={fmtDist}
        />
      </Panel>

      <Panel title={`Longest ${one} per week (${unit})`} note="Your longest single outing each week; weeks off are skipped.">
        {longWeeks.length >= 2 ? (
          <Trend
            label="Longest activity per week"
            color="var(--series-elev)"
            lineColor="var(--series-elev)"
            points={longWeeks.map((w) => {
              const r = byId.get(w.longestId!)!;
              return {
                x: xOf(r),
                y: w.longest,
                tip: (
                  <>
                    <div className="text-muted">{shortDate(r)}</div>
                    <div className="font-semibold">{distanceText(w.longest, units)}</div>
                  </>
                ),
              };
            })}
            line={longWeeks.map((w) => w.longest)}
            formatTick={fmtDist}
          />
        ) : (
          <Empty>Needs two weeks with activity.</Empty>
        )}
      </Panel>

      {!single && (
        <Panel title="Efficiency and cadence">
          <Empty>Pick one sport above to compare efficiency and cadence: a ride and a walk don't share a scale.</Empty>
        </Panel>
      )}

      {single && (
      <Panel
        title="Aerobic efficiency (m per heartbeat)"
        note={
          <>
            Moving speed ÷ average heart rate, per {one} with heart rate ({withHr.length} of {sorted.length}). Higher means more speed for the
            same effort. Line: {ROLLING}-{one} average. Heat, hills, fatigue and sensor fit all move it, so read the trend, not one dot. The
            pace at {REF_HR} bpm in the tooltip is an estimate that assumes speed scales with heart rate.
          </>
        }
      >
        {withHr.length >= 2 ? (
          <Trend
            label="Aerobic efficiency per activity"
            color="var(--series-hr)"
            points={withHr.map((r) => ({
              x: xOf(r),
              y: r.efficiency!,
              tip: (
                <>
                  <div className="text-muted">{shortDate(r)}</div>
                  <div className="font-semibold">{r.efficiency!.toFixed(2)} m/beat</div>
                  <div className="text-ink-2">
                    {formatMotion(r.avgSpeed, r.kind, units)} at {Math.round(r.avgHr!)} bpm
                  </div>
                  <div className="text-ink-2">≈ {formatMotion((r.efficiency! * REF_HR) / 60, r.kind, units)} at {REF_HR} bpm (estimated)</div>
                </>
              ),
            }))}
            line={effLine}
            formatTick={(v) => v.toFixed(2)}
          />
        ) : (
          <Empty>Needs at least two {plural} with heart rate.</Empty>
        )}
      </Panel>
      )}

      {single && withCad.length > 0 && (
        <Panel title={`Cadence (${cadUnit})`} note={`Average cadence per ${one} that records it (${withCad.length} of ${sorted.length}). Line: ${ROLLING}-${one} average.`}>
          {withCad.length >= 2 ? (
            <Trend
              label="Average cadence per activity"
              color="var(--series-cad)"
              points={withCad.map((r) => ({
                x: xOf(r),
                y: r.avgCadence!,
                tip: (
                  <>
                    <div className="text-muted">{shortDate(r)}</div>
                    <div className="font-semibold">
                      {Math.round(r.avgCadence!)} {cadUnit}
                    </div>
                  </>
                ),
              }))}
              line={cadLine}
              formatTick={(v) => String(Math.round(v))}
            />
          ) : (
            <Empty>Needs at least two {plural} with cadence.</Empty>
          )}
        </Panel>
      )}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted">{children}</p>;
}
