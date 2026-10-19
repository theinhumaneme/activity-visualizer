import { useMemo, useState } from "react";
import { atIndex } from "../../lib/analysis/series";
import type { Analysis } from "../../lib/analysis/types";
import { formatDistance, formatDuration, formatElevation, formatMotion, formatPace, motionLabel, unitLabel, usesPace } from "../../lib/format/format";
import { useStore } from "../../state/store";
import { Chart } from "../Chart";
import { Card, Explain, Help, Stat } from "../ui";
import { formatSplitMotion } from "./units";
import { useStretch } from "./stretch";

/** A stable array: a new one each render made Chart rebuild its uPlot instance. */
const CADENCE_CLIP: [number, number] = [0.02, 0.98];

/** Steps (or pedal strokes) per minute while moving. */
export function CadenceChart({ a }: { a: Analysis }) {
  const ride = a.activity.kind === "ride";
  const unit = ride ? "rpm" : "spm";
  const values = useMemo(() => Float64Array.from(a.cadence!, (c, i) => (c > 0 && a.moving[i] ? c : NaN)), [a]);
  const fmt = useMemo(() => ({ value: (v: number) => `${Math.round(v)} ${unit}`, tick: (v: number) => String(Math.round(v)) }), [unit]);
  const s = a.summary;
  return (
    <Chart
      title="Cadence"
      unit={ride ? "rpm" : "steps/min"}
      values={values}
      color="--series-cad"
      height={140}
      clip={CADENCE_CLIP}
      formatValue={fmt.value}
      formatTick={fmt.tick}
      aside={
        s.avgCadence !== undefined && (
          <span className="tabular">
            avg {Math.round(s.avgCadence)} {unit}
          </span>
        )
      }
      footer={
        <Explain>
          {ride ? "Pedal revolutions per minute while moving." : "Both feet counted, while moving."}
          {!ride && a.activity.cadenceDoubled && " Doubled from the file's per-leg value (your device records one foot)."}
          {s.strideLength !== undefined && ` Average stride about ${s.strideLength.toFixed(2)} m.`}
        </Explain>
      }
    />
  );
}

export function BestEfforts({ a }: { a: Analysis }) {
  const stretch = useStretch();
  const u = a.settings.units;
  const pace = usesPace(a.activity.kind);
  const th = "pb-2 text-label font-medium text-muted";
  return (
    <Card title="Best efforts" description="Your fastest stretch of each distance anywhere in the activity, not just from a split boundary.">
      {a.bestEfforts.length ? (
        <table className="w-full text-[15px] tabular">
          <thead>
            <tr className="text-left">
              <th className={th}>Distance</th>
              <th className={`${th} text-right`}>Time</th>
              <th className={`${th} text-right`}>{pace ? `Pace /${unitLabel(u)}` : u === "metric" ? "Speed km/h" : "Speed mph"}</th>
            </tr>
          </thead>
          <tbody>
            {a.bestEfforts.map((b) => {
              return (
                <tr
                  key={b.label}
                  tabIndex={0}
                  className="cursor-pointer border-t border-grid outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2"
                  {...stretch({ from: b.startIdx, to: b.endIdx, label: `Best ${b.label}` })}
                >
                  <td className="py-2.5 pr-2 font-medium text-ink-2">{b.label}</td>
                  <td className="py-2.5 pr-2 text-right font-semibold">{formatDuration(b.seconds)}</td>
                  <td className="py-2.5 text-right text-ink-2">{pace ? formatPace(b.pace, u, false) : formatSplitMotion(b.pace, a, false)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-muted">The activity is shorter than the shortest best-effort distance.</p>
      )}
    </Card>
  );
}

export function PaceDistribution({ a }: { a: Analysis }) {
  const kind = a.activity.kind;
  const pace = usesPace(kind);
  const u = a.settings.units;
  const unit = unitLabel(u);
  const hist = a.paceHistogram;
  const max = Math.max(1, ...hist.map((b) => b.seconds));
  const [sel, setSel] = useState<number | null>(null);
  const bucket = (b: (typeof hist)[number]) =>
    pace ? `${formatDuration(b.from)}–${formatDuration(b.to)} /${unit}` : `${b.from}–${b.to} ${u === "metric" ? "km/h" : "mph"}`;
  const peak = hist.reduce((k, b, i) => (b.seconds > hist[k].seconds ? i : k), 0);
  const shown = sel ?? null;
  // A few evenly spaced x labels, always including both ends.
  const ticks = hist.length ? [...new Set([0, Math.round((hist.length - 1) / 3), Math.round((2 * (hist.length - 1)) / 3), hist.length - 1])] : [];
  const last = hist.length - 1;
  // Bin edges: the left edge of each labeled bin, and the right edge of the last one.
  const tickText = (i: number) => {
    const v = i === last ? hist[i].to : hist[i].from;
    return pace ? formatDuration(v) : String(v);
  };

  return (
    <Card
      title={`${motionLabel(kind)} distribution`}
      description={`Moving time at each ${pace ? "pace" : "speed"}. A narrow peak means steady pacing; two peaks usually mean intervals.`}
    >
      {hist.length ? (
        <>
          <div className="mb-2 flex min-h-[2.75rem] items-center justify-between gap-3 rounded-control bg-surface-2 px-3 py-1 text-sm" aria-live="polite">
            {shown !== null ? (
              <>
                <span className="text-ink-2 tabular">{bucket(hist[shown])}</span>
                <span className="font-semibold text-ink tabular">{formatDuration(hist[shown].seconds)}</span>
              </>
            ) : (
              <>
                <span className="text-muted">Most time at {bucket(hist[peak])}</span>
                <span className="font-semibold text-ink tabular">{formatDuration(hist[peak].seconds)}</span>
              </>
            )}
          </div>
          <div className="flex">
            <div className="flex w-9 shrink-0 flex-col justify-between pb-0.5 pr-2 text-right text-[12px] text-muted tabular" aria-hidden>
              <span>{formatDuration(max)}</span>
              <span>0</span>
            </div>
            <div
              className="flex h-32 min-w-0 flex-1 items-end gap-0.5 border-b border-l border-grid"
              role="group"
              aria-label={`Moving time by ${motionLabel(kind).toLowerCase()}`}
              onMouseLeave={() => setSel(null)}
            >
              {hist.map((b, i) => (
                <button
                  key={b.from}
                  type="button"
                  aria-label={`${bucket(b)}: ${formatDuration(b.seconds)}`}
                  aria-pressed={sel === i}
                  onMouseEnter={() => setSel(i)}
                  onFocus={() => setSel(i)}
                  onClick={() => setSel((s) => (s === i ? null : i))}
                  className={`min-w-0 flex-1 rounded-t-sm transition-colors ${sel === i ? "bg-series-pace" : "bg-series-pace/70 hover:bg-series-pace"}`}
                  style={{ height: `${Math.max(2, (b.seconds / max) * 100)}%` }}
                />
              ))}
            </div>
          </div>
          <div className="relative ml-9 mt-1.5 h-4 text-[12px] text-muted tabular" aria-hidden>
            {ticks.map((i) => (
              <span
                key={i}
                className="absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full"
                style={{ left: `${(i === last ? 1 : i / hist.length) * 100}%` }}
              >
                {tickText(i)}
              </span>
            ))}
          </div>
          <p className="ml-9 mt-1.5 text-label text-muted">{pace ? `Pace, min/${unit} · faster on the left` : `Speed, ${u === "metric" ? "km/h" : "mph"}`}</p>
        </>
      ) : (
        <p className="text-sm text-muted">Not enough moving data.</p>
      )}
    </Card>
  );
}

export function EffortCard({ a }: { a: Analysis }) {
  const s = a.summary;
  const kind = a.activity.kind;
  const u = a.settings.units;
  return (
    <Card title="Effort and efficiency">
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3">
        {s.trimp !== undefined && <Stat label="Training load" value={String(Math.round(s.trimp))} sub="Edwards TRIMP" />}
        {s.efficiency !== undefined && <Stat label="Efficiency" value={`${s.efficiency.toFixed(2)} m/beat`} sub="distance per heartbeat" />}
        {s.decoupling !== undefined && (
          <Stat
            label="Aerobic decoupling"
            value={`${s.decoupling.toFixed(1)}%`}
            sub={s.moving < 1200 ? "less reliable under 20 min" : Math.abs(s.decoupling) < 5 ? "steady" : "HR drifted"}
          />
        )}
        {s.paceCv !== undefined && <Stat label={`${motionLabel(kind)} variability`} value={`${Math.round(s.paceCv * 100)}%`} sub="coefficient of variation" />}
        {s.avgCadence !== undefined && (
          <Stat
            label="Cadence"
            value={`${Math.round(s.avgCadence)} ${kind === "ride" ? "rpm" : "spm"}`}
            sub={s.strideLength ? `stride ${s.strideLength.toFixed(2)} m` : undefined}
          />
        )}
        {s.avgPower !== undefined && <Stat label="Power" value={`${Math.round(s.avgPower)} W`} sub={a.power ? `normalized ${Math.round(a.power.np)} W` : undefined} />}
        {a.slowdowns.length > 0 && (
          <Stat
            label="Slowdowns"
            value={String(a.slowdowns.length)}
            sub={`${formatDuration(a.slowdowns.reduce((x, sd) => x + sd.duration, 0))} total, still moving`}
          />
        )}
        <Stat label="Stopped" value={formatDuration(s.stoppedTime)} sub={`${a.stops.length} stop${a.stops.length === 1 ? "" : "s"} ≥ 10 s`} />
        {s.bestPace > 0 && <Stat label={`Best sustained ${motionLabel(kind).toLowerCase()}`} value={formatMotion(s.maxSpeed, kind, u)} sub="over 30 s" />}
      </div>
      <Help label="What these mean">
        <p>Training load adds up minutes in each zone × the zone number.</p>
        <p>Efficiency is speed divided by heart rate; it rises as you get fitter at the same effort.</p>
        <p>Decoupling compares that efficiency in the first and second half: under 5% means heart rate kept pace with speed.</p>
      </Help>
    </Card>
  );
}

/** Live values at the shared cursor, beside the map. Its own component so hover doesn't re-render the page. */
export function HoverReadout({ a, compact }: { a: Analysis; compact?: boolean }) {
  const i = useStore((s) => s.hoverIndex);
  const highlight = useStore((s) => s.highlight);
  const u = a.settings.units;
  const kind = a.activity.kind;
  const routeOnly = a.activity.routeOnly;
  const cells: [string, string][] = [["Distance", i === null ? "—" : formatDistance(a.dist[i], u)]];
  if (!routeOnly) {
    cells.push(["Time", i === null ? "—" : formatDuration(a.t[i])]);
    cells.push([motionLabel(kind), i === null ? "—" : formatMotion(a.speed[i], kind, u)]);
  }
  if (a.zones.length) cells.push(["Heart rate", i === null || !Number.isFinite(a.hr[i]) ? "—" : `${Math.round(a.hr[i])} bpm`]);
  if (a.elev) cells.push(["Elevation", i === null ? "—" : formatElevation(atIndex(a.elev, i), u)]);

  if (compact)
    return (
      <div className="rounded-control border border-grid bg-surface/95 px-3 py-2 shadow-[var(--shadow-raised)] backdrop-blur" aria-live="off">
        <dl className="no-scrollbar flex gap-4 overflow-x-auto">
          {cells.map(([k, v]) => (
            <div key={k} className="shrink-0">
              <dt className="text-[11px] leading-tight text-muted">{k}</dt>
              <dd className={`text-sm font-semibold leading-tight tabular ${i === null ? "text-muted" : "text-ink"}`}>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    );

  return (
    <div className="rounded-card border border-grid bg-surface px-3 py-2.5" aria-live="off">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-label">
        <span className="font-medium text-ink-2">{highlight ? `${highlight.label} · click to watch in 3D` : i === null ? "Hover a chart or the route" : "At the cursor"}</span>
        {i === null && !highlight && a.stops.length > 0 && <span className="text-muted">Pause markers are stops</span>}
      </div>
      <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 sm:grid-cols-5">
        {cells.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="truncate text-[12px] text-muted">{k}</dt>
            <dd className={`truncate text-[15px] font-semibold tabular ${i === null ? "text-muted" : "text-ink"}`}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
