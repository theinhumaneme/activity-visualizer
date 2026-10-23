import { useMemo } from "react";
import type { Units } from "../../lib/analysis/types";
import { formatDuration, formatElevation, formatMotion, formatPace, unitLabel, unitLength } from "../../lib/format/format";
import { eddington, recap, streaks } from "../../lib/library/aggregate";
import { today } from "../../lib/library/load";
import { predictRaces } from "../../lib/library/predict";
import type { PersonalRecord } from "../../lib/library/records";
import type { RouteGroup } from "../../lib/library/similarity";
import type { GearTotal } from "../../lib/library/strava";
import type { LibraryRecord } from "../../lib/library/types";
import { HourBars } from "./charts";
import { type SportFilter, capitalize, distanceNumber, distanceText, hoursText, shortDate, sportLabel, sportPlural, sportSingular } from "./format";

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-grid bg-surface p-4">
      <div className="label-caps text-muted">{label}</div>
      <div className="mt-1 font-display text-3xl font-semibold leading-none tabular sm:text-4xl">{value}</div>
      {sub && <div className="mt-1.5 text-xs text-ink-2">{sub}</div>}
    </div>
  );
}

/** Shoes are usually retired somewhere in 500–800 km, or 300–500 mi (meters). */
const SHOE_LIFE: Record<Units, [number, number]> = { metric: [500_000, 800_000], imperial: [300 * 1609.344, 500 * 1609.344] };

function Gear({ gear, units }: { gear: GearTotal[]; units: Units }) {
  const [low, high] = SHOE_LIFE[units];
  const range = `${distanceNumber(low, units)}–${distanceText(high, units)}`;
  return (
    <section className="rounded-2xl border border-grid bg-surface p-4 sm:p-5 lg:col-span-2">
      <div className="label-caps text-muted">Gear · all time</div>
      <ul className="mt-2 divide-y divide-grid">
        {gear.map((g) => {
          const worn = g.distance / high;
          return (
            <li key={g.name} className="py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <span className="font-medium">{g.name}</span>
                <span className="font-display text-2xl font-semibold tabular">{distanceText(g.distance, units)}</span>
              </div>
              <div className="text-xs text-muted">
                {g.count.toLocaleString()} {g.count === 1 ? "activity" : "activities"} · {hoursText(g.moving)} · {shortDate(g.first)} – {shortDate(g.last)}
              </div>
              {g.shoe && (
                <>
                  <div
                    className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"
                    role="meter"
                    aria-label={`${g.name}: ${distanceText(g.distance, units)} of a typical ${distanceText(high, units)}`}
                    aria-valuemin={0}
                    aria-valuemax={high}
                    aria-valuenow={Math.round(g.distance)}
                  >
                    <div className={`h-full rounded-full ${g.distance >= low ? "bg-warning" : "bg-accent"}`} style={{ width: `${Math.min(1, worn) * 100}%` }} />
                    <div aria-hidden className="absolute inset-y-0 w-px bg-ink/40" style={{ left: `${(low / high) * 100}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-ink-2">
                    {g.distance >= high
                      ? `Past the ${distanceText(high, units)} most shoes are retired by; check the cushioning and the tread.`
                      : g.distance >= low
                        ? `In the ${range} window where most shoes lose their cushioning: about ${distanceText(high - g.distance, units)} left at most.`
                        : `About ${distanceText(low - g.distance, units)} before the ${range} window where most shoes wear out.`}
                  </p>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-muted">From the gear you set on Strava (activities.csv in your export), over your whole library.</p>
    </section>
  );
}

const hourText = (h: number) => new Date(Date.UTC(2000, 0, 1, h)).toLocaleTimeString(undefined, { hour: "numeric", timeZone: "UTC" });

export function Recap({
  records,
  groups,
  prs,
  kind,
  units,
  periodLabel,
  onOpen,
  newGround,
  gear,
}: {
  records: LibraryRecord[];
  groups: RouteGroup[];
  prs: PersonalRecord[];
  kind: SportFilter;
  units: Units;
  periodLabel: string;
  onOpen: (id: string) => void;
  /** Meters of new ground per activity id (see explore.ts). */
  newGround: ReadonlyMap<string, number>;
  gear: GearTotal[];
}) {
  const r = useMemo(() => recap(records, groups, kind === "all" ? null : kind), [records, groups, kind]);
  const byId = useMemo(() => new Map(records.map((x) => [x.id, x])), [records]);
  const st = useMemo(() => streaks(records, today()), [records]);
  const ed = useMemo(() => eddington(records, unitLength(units)), [records, units]);
  const explored = useMemo(() => {
    let fresh = 0;
    let routed = 0;
    let best: { r: LibraryRecord; share: number } | null = null;
    for (const x of records) {
      const n = newGround.get(x.id);
      if (n === undefined) continue;
      fresh += n;
      routed += x.distance;
      // The most adventurous outing: the biggest share of new ground over at least a kilometer.
      if (x.distance >= 1000 && (!best || n / x.distance > best.share)) best = { r: x, share: n / x.distance };
    }
    return routed > 0 ? { fresh, share: fresh / routed, best } : null;
  }, [records, newGround]);
  const predictions = useMemo(() => (kind === "run" || kind === "all" ? predictRaces(prs) : []), [prs, kind]);
  if (!r.count) return <p className="py-10 text-center text-muted">Nothing in this period yet.</p>;
  const plural = sportPlural(kind);
  const one = sportSingular(kind);
  const pace = (pr: PersonalRecord) => formatMotion(pr.distance / pr.seconds, pr.kind, units);
  const kindPrs = kind === "all" ? prs : prs.filter((p) => p.kind === kind);

  return (
    <div className="space-y-4">
      <section className="relative overflow-hidden rounded-3xl border border-grid bg-surface px-5 py-8 sm:px-8 sm:py-12">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent/20 blur-3xl" />
        <div className="label-caps text-accent">{periodLabel}</div>
        <p className="mt-2 font-display text-6xl font-bold uppercase leading-[0.9] tabular sm:text-8xl">
          {distanceNumber(r.distance, units)}
          <span className="ml-2 text-3xl text-ink-2 sm:text-5xl">{units === "metric" ? "km" : "mi"}</span>
        </p>
        <p className="mt-3 text-lg text-ink-2 sm:text-xl">
          {r.count === 1 ? `One ${one}. It counts.` : "Every one of them earned."}
        </p>
        <p className="mt-1 text-sm text-muted">
          {r.first && r.last && r.first !== r.last ? `${shortDate(r.first)} – ${shortDate(r.last)}` : r.first && shortDate(r.first)}
        </p>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label={capitalize(plural)} value={r.count.toLocaleString()} sub={`${r.activeDays.toLocaleString()} active ${r.activeDays === 1 ? "day" : "days"}`} />
        <Tile label="Time moving" value={hoursText(r.moving)} sub={`${formatDuration(r.moving / r.count)} per ${one} on average`} />
        <Tile
          label="Elevation gain"
          value={r.elevation ? formatElevation(r.elevation.gain, units) : "—"}
          sub={
            r.elevation
              ? `From your device's altitude in ${r.elevation.withData} of ${r.count}, not terrain-corrected.`
              : "None of these files record altitude."
          }
        />
        <Tile
          label={`Longest ${one}`}
          value={r.longest ? distanceText(r.longest.distance, units) : "—"}
          sub={
            r.longest && (
              <button className="underline decoration-line underline-offset-2 hover:text-ink" onClick={() => onOpen(r.longest!.id)}>
                {shortDate(r.longest)}
              </button>
            )
          }
        />
        {r.fastest5k && (
          <Tile label="Fastest 5K" value={formatDuration(r.fastest5k.seconds)} sub={`${pace(r.fastest5k)} · ${shortDate(r.fastest5k)}`} />
        )}
        {r.fastest10k && (
          <Tile label="Fastest 10K" value={formatDuration(r.fastest10k.seconds)} sub={`${pace(r.fastest10k)} · ${shortDate(r.fastest10k)}`} />
        )}
        <Tile
          label="Longest streak"
          value={`${st.longestDays} ${st.longestDays === 1 ? "day" : "days"}`}
          sub={
            <>
              {st.longestWeeks} {st.longestWeeks === 1 ? "week" : "weeks"} in a row at best
              {st.currentDays > 1 ? ` · on a ${st.currentDays}-day streak now` : st.currentWeeks > 1 ? ` · ${st.currentWeeks} weeks running now` : ""}
            </>
          }
        />
        <Tile
          label="Eddington number"
          value={ed.e}
          sub={`${ed.e} days of ${ed.e}+ ${unitLabel(units)}. ${ed.toNext} more ${ed.toNext === 1 ? "day" : "days"} of ${ed.e + 1}+ for ${ed.e + 1}.`}
        />
        {explored && (
          <Tile
            label="New ground"
            value={distanceText(explored.fresh, units)}
            sub={
              <>
                {Math.round(explored.share * 100)}% of the way was somewhere you hadn't been before
                {explored.best && explored.best.share > 0.2 && (
                  <>
                    {" · most new: "}
                    <button className="underline decoration-line underline-offset-2 hover:text-ink" onClick={() => onOpen(explored.best!.r.id)}>
                      {shortDate(explored.best.r)}
                    </button>{" "}
                    ({Math.round(explored.best.share * 100)}%)
                  </>
                )}
              </>
            }
          />
        )}
        {r.mostRun && (
          <Tile
            label="Most-repeated route"
            value={`${r.mostRun.members.length}×`}
            sub={`${r.mostRun.label} · ${distanceText(r.mostRun.distance, units)}`}
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {predictions.length > 0 && (
          <section className="rounded-2xl border border-grid bg-surface p-4 sm:p-5 lg:col-span-2">
            <div className="label-caps text-muted">Race predictions</div>
            <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              {predictions.map((p) => (
                <div key={p.label} className="min-w-0">
                  <div className="text-sm text-ink-2">{p.label}</div>
                  <div className="font-display text-2xl font-semibold leading-tight tabular">{formatDuration(p.seconds)}</div>
                  <div className="text-xs text-muted tabular">
                    {formatPace((p.seconds / p.distance) * 1000, units)} · {p.actual ? "your best" : `from your ${p.from.label}`}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">
              Riegel's formula on your fastest run efforts of 3 km or more {periodLabel === "All time" ? "" : "in this period "}(time × (distance
              ratio)^1.06). It assumes you've trained for the distance, so longer races read optimistic if you haven't.
            </p>
          </section>
        )}
        <section className="rounded-2xl border border-grid bg-surface p-4 sm:p-5">
          <div className="label-caps text-muted">When you head out</div>
          <p className="mt-1 text-base font-medium">
            {r.peakHour !== null ? `Most often around ${hourText(r.peakHour)}.` : "—"}
          </p>
          <div className="mt-3">
            <HourBars hours={r.hours} label="Starts by hour of day, in each activity's local time" />
          </div>
          <p className="mt-2 text-xs text-muted">Local time where each activity was recorded.</p>
        </section>

        <section className="rounded-2xl border border-grid bg-surface p-4 sm:p-5">
          <div className="label-caps text-muted">Personal records</div>
          {kindPrs.length ? (
            <table className="mt-2 w-full text-sm tabular">
              <tbody>
                {kindPrs.map((p) => (
                  <tr key={`${p.kind}|${p.distance}`} className="border-t border-grid first:border-0">
                    <td className="py-1.5 pr-2 text-ink-2">
                      {kind === "all" && <span className="mr-1.5 text-muted">{sportLabel(p.kind)}</span>}
                      {p.label}
                    </td>
                    <td className="py-1.5 pr-2 font-semibold">{formatDuration(p.seconds)}</td>
                    <td className="hidden py-1.5 pr-2 text-muted sm:table-cell">{pace(p)}</td>
                    <td className="py-1.5 text-right">
                      <button className="text-muted underline decoration-line underline-offset-2 hover:text-ink" onClick={() => onOpen(p.activityId)}>
                        {byId.get(p.activityId) ? shortDate(byId.get(p.activityId)!) : shortDate(p)}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-2 text-sm text-muted">No efforts long enough to time yet.</p>
          )}
          <p className="mt-2 text-xs text-muted">Fastest stretch of each distance inside any {one}{kind === "all" ? ", per sport" : ""}, from your files only.</p>
        </section>
        {gear.length > 0 && <Gear gear={gear} units={units} />}
      </div>
    </div>
  );
}
