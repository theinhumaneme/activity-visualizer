import { type ReactNode, useMemo } from "react";
import type { Units } from "../../lib/analysis/types";
import { formatDuration, formatMotion, unitLabel, unitLength } from "../../lib/format/format";
import { DAY_MS, buckets, localDay, rollingMean, weekStart } from "../../lib/library/aggregate";
import { FATIGUE_DAYS, FITNESS_DAYS, activityLoad, formWord, today, trainingLoad } from "../../lib/library/load";
import type { LibraryRecord } from "../../lib/library/types";
import { RAMPS } from "../../lib/map/route";
import { useTheme } from "../../state/theme";
import { LoadChart, TimeBars, Trend } from "./charts";
import { type SportFilter, distanceText, hoursText, isFootSport, shortDate, sportPlural, sportSingular } from "./format";

const ROLLING = 5;
/** Heart rate the efficiency is translated at, for the "≈ pace" readout. */
const REF_HR = 150;

function Panel({ title, note, children, wide }: { title: string; note?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-grid bg-surface p-4 sm:p-5 ${wide ? "lg:col-span-2" : ""}`}>
      <h3 className="label-caps text-muted">{title}</h3>
      <div className="mt-3">{children}</div>
      {note && <p className="mt-2 text-xs leading-relaxed text-muted">{note}</p>}
    </section>
  );
}

const weekLabel = (start: number) =>
  `Week of ${new Date(start * DAY_MS).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
const monthLabel = (start: number) => new Date(start * DAY_MS).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });

const dayLabel = (day: number) => new Date(day * DAY_MS).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const ZONE_NAMES = ["Recovery", "Endurance", "Tempo", "Threshold", "Maximum"];

/**
 * @param history every activity of the chosen sport, so fitness at the start of the period
 *   includes the training before it.
 * @param throughToday the period runs to today, so fitness and form are shown up to now.
 */
export function Progress({
  records,
  history,
  throughToday,
  kind,
  units,
  newGround,
}: {
  records: LibraryRecord[];
  history: LibraryRecord[];
  throughToday: boolean;
  kind: SportFilter;
  units: Units;
  /** Meters of new ground per activity id (see explore.ts). */
  newGround: ReadonlyMap<string, number>;
}) {
  const theme = useTheme((s) => s.theme);
  const ul = unitLength(units);
  const unit = unitLabel(units);
  const sorted = useMemo(() => [...records].sort((a, b) => a.startTime - b.startTime), [records]);
  const weeks = useMemo(() => buckets(sorted, "week", newGround), [sorted, newGround]);
  // Past ~18 months of weeks the bars get too thin to read; switch to months.
  const monthly = weeks.length > 78;
  const volume = useMemo(() => (monthly ? buckets(sorted, "month", newGround) : weeks), [monthly, sorted, weeks, newGround]);
  const anyNew = volume.some((b) => b.fresh > 0);
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

  // Fitness over the whole history, shown for the period's days.
  const firstDay = sorted.length ? localDay(sorted[0]) : 0;
  const lastDay = sorted.length ? localDay(sorted[sorted.length - 1]) : 0;
  const loadDays = useMemo(() => {
    const all = trainingLoad(history, throughToday ? today() : lastDay);
    return all.filter((d) => d.day >= firstDay && d.day <= (throughToday ? today() : lastDay));
  }, [history, throughToday, firstDay, lastDay]);
  const withLoad = sorted.filter((r) => activityLoad(r) !== undefined).length;
  const now = loadDays[loadDays.length - 1];

  // Heart-rate zone time per week.
  const zoneWeeks = useMemo(() => {
    const zr = sorted.filter((r) => r.zoneSeconds?.length === 5);
    if (!zr.length) return null;
    const map = new Map<number, number[]>();
    for (const r of zr) {
      const w = weekStart(localDay(r));
      const cur = map.get(w) ?? [0, 0, 0, 0, 0];
      r.zoneSeconds!.forEach((v, k) => (cur[k] += v));
      map.set(w, cur);
    }
    const keys = [...map.keys()];
    const out: { start: number; parts: number[] }[] = [];
    for (let w = Math.min(...keys); w <= Math.max(...keys); w += 7) out.push({ start: w, parts: map.get(w) ?? [0, 0, 0, 0, 0] });
    const totals = out.reduce((t, w) => t.map((v, k) => v + w.parts[k]), [0, 0, 0, 0, 0]);
    return { weeks: out, totals, count: zr.length };
  }, [sorted]);
  const zoneTotal = zoneWeeks ? zoneWeeks.totals.reduce((a, b) => a + b, 0) : 0;
  const easyShare = zoneWeeks && zoneTotal > 0 ? (zoneWeeks.totals[0] + zoneWeeks.totals[1]) / zoneTotal : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel
        wide
        title="Fitness, fatigue and form"
        note={
          <>
            Each {one}'s training load is its heart-rate TRIMP (power TSS for rides without heart rate); {withLoad} of {sorted.length} have one.
            Fitness is your load averaged over {FITNESS_DAYS} days, fatigue over {FATIGUE_DAYS}; form is fitness minus fatigue. Zones use an estimated
            max heart rate of at least 190, so compare yourself over time rather than with others. Fitness takes about six weeks of history to settle.
          </>
        }
      >
        {loadDays.length >= 2 && now ? (
          <>
            <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
              <span>
                <span className="mr-1.5 inline-block h-0.5 w-4 align-middle bg-series-pace" aria-hidden />
                Fitness <span className="font-semibold tabular">{Math.round(now.fitness)}</span>
              </span>
              <span>
                <span className="mr-1.5 inline-block h-0.5 w-4 align-middle bg-series-hr" aria-hidden />
                Fatigue <span className="font-semibold tabular">{Math.round(now.fatigue)}</span>
              </span>
              <span>
                Form <span className="font-semibold tabular">{now.form >= 0 ? "+" : "−"}{Math.abs(Math.round(now.form))}</span>{" "}
                <span className="text-ink-2">{formWord(now.form, now.fitness)}</span>
              </span>
              <span className="text-muted">{throughToday ? "today" : `on ${dayLabel(now.day)}`}</span>
            </div>
            <LoadChart
              label="Fitness, fatigue and form per day"
              points={loadDays.map((d) => ({
                x: d.day * DAY_MS,
                fitness: d.fitness,
                fatigue: d.fatigue,
                form: d.form,
                tip: (
                  <>
                    <div className="text-muted">{dayLabel(d.day)}</div>
                    <div>
                      Fitness <span className="font-semibold">{Math.round(d.fitness)}</span> · fatigue <span className="font-semibold">{Math.round(d.fatigue)}</span>
                    </div>
                    <div>
                      Form {d.form >= 0 ? "+" : "−"}
                      {Math.abs(Math.round(d.form))} <span className="text-ink-2">{formWord(d.form, d.fitness)}</span>
                    </div>
                    <div className="text-ink-2">{d.load > 0 ? `Load that day ${Math.round(d.load)}` : "Rest day"}</div>
                  </>
                ),
              }))}
            />
          </>
        ) : (
          <Empty>Needs {plural} with heart rate (or power) on at least two days.</Empty>
        )}
      </Panel>

      <Panel
        title={`${monthly ? "Monthly" : "Weekly"} distance (${unit})`}
        note={
          <>
            {monthly ? "Monthly totals: your library spans more than 18 months." : "Monday to Sunday, in each activity's local time."}
            {anyNew && (
              <>
                {" "}
                <span className="inline-block h-2 w-2 rounded-sm bg-accent align-middle" /> New ground, where none of your earlier activities had been (any
                sport); <span className="inline-block h-2 w-2 rounded-sm bg-[var(--muted)] align-middle" /> ground you'd covered before.
              </>
            )}
          </>
        }
      >
        <TimeBars
          label={`${monthly ? "Monthly" : "Weekly"} distance${anyNew ? ", new ground and familiar" : ""}`}
          colors={anyNew ? ["var(--muted)", "var(--accent)"] : undefined}
          data={volume.map((b) => ({
            x: b.start * DAY_MS,
            value: b.distance,
            parts: anyNew ? [b.distance - b.fresh, b.fresh] : undefined,
            tip: (
              <>
                <div className="text-muted">{monthly ? monthLabel(b.start) : weekLabel(b.start)}</div>
                <div className="font-semibold">{distanceText(b.distance, units)}</div>
                {anyNew && b.distance > 0 && <div className="text-ink-2">{distanceText(b.fresh, units)} new ground</div>}
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

      <Panel
        title="Time in heart-rate zones per week (h)"
        note={
          zoneWeeks ? (
            <>
              {zoneWeeks.count} of {sorted.length} {plural} have heart rate. Zones 1–2 are easy; most endurance coaching aims for about 80% of the time
              there. Zones use an estimated max heart rate of at least 190.
            </>
          ) : undefined
        }
      >
        {zoneWeeks ? (
          <>
            <p className="mb-2 text-sm">
              <span className="font-semibold tabular">{Math.round(easyShare * 100)}%</span> easy (zones 1–2),{" "}
              <span className="font-semibold tabular">{Math.round((1 - easyShare) * 100)}%</span> harder, over {hoursText(zoneTotal)}.
            </p>
            <TimeBars
              label="Hours in each heart-rate zone per week"
              colors={RAMPS.zone[theme]}
              data={zoneWeeks.weeks.map((w) => {
                const total = w.parts.reduce((a, b) => a + b, 0);
                return {
                  x: w.start * DAY_MS,
                  value: total / 3600,
                  parts: w.parts.map((v) => v / 3600),
                  tip: (
                    <>
                      <div className="text-muted">{weekLabel(w.start)}</div>
                      {total > 0 ? (
                        [...w.parts].reverse().map((v, k) => (
                          <div key={k} className="flex justify-between gap-2">
                            <span>
                              Z{5 - k} {ZONE_NAMES[4 - k]}
                            </span>
                            <span className="font-semibold">{formatDuration(v)}</span>
                          </div>
                        ))
                      ) : (
                        <div>No heart rate this week</div>
                      )}
                    </>
                  ),
                };
              })}
              formatTick={(v) => (v < 10 ? v.toFixed(1).replace(/\.0$/, "") : String(Math.round(v)))}
            />
          </>
        ) : (
          <Empty>None of these {plural} record heart rate.</Empty>
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
