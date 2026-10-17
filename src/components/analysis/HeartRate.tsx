import { useMemo } from "react";
import { Link } from "react-router";
import type { Analysis } from "../../lib/analysis/types";
import { formatDuration } from "../../lib/format/format";
import { RAMPS } from "../../lib/map/route";
import { useTheme } from "../../state/theme";
import { type Band, Chart } from "../Chart";
import { Card, Help, Tag } from "../ui";
import { shares } from "./math";

const bpmRange = (z: Analysis["zones"][number]) =>
  z.zone === 1 ? `< ${Math.round(z.high)}` : z.zone === 5 ? `≥ ${Math.round(z.low)}` : `${Math.round(z.low)}–${Math.round(z.high) - 1}`;

/** Heart rate over the activity with the five zones tinted behind the line. */
export function HeartRateChart({ a }: { a: Analysis }) {
  const theme = useTheme((s) => s.theme);
  const bands = useMemo<Band[]>(
    () => a.zones.map((z, k) => ({ low: z.low, high: Math.min(z.high, 250), label: `Z${z.zone}`, color: RAMPS.zone[theme][k] })),
    [a.zones, theme],
  );
  const fmt = useMemo(() => ({ value: (v: number) => `${Math.round(v)} bpm`, tick: (v: number) => String(Math.round(v)) }), []);
  const s = a.summary;
  return (
    <Chart
      title="Heart rate"
      unit="bpm"
      values={a.hr}
      color="--series-hr"
      bands={bands}
      formatValue={fmt.value}
      formatTick={fmt.tick}
      aside={
        <span className="tabular">
          avg {Math.round(s.avgHr ?? NaN)} · max {Math.round(s.maxHr ?? NaN)}
          {a.settings.maxHrEstimated && (
            <>
              {" "}
              <Tag tone="warning" title="Zones use an estimated max heart rate">
                Zones estimated
              </Tag>
            </>
          )}
        </span>
      }
    />
  );
}

/** Time in each zone: one stacked bar for the mix, then a labeled bar per zone, hardest first. */
export function ZoneBreakdown({ a }: { a: Analysis }) {
  const theme = useTheme((s) => s.theme);
  const ramp = RAMPS.zone[theme];
  const pct = shares(a.zones.map((z) => z.seconds));
  const top = Math.max(...pct, 0.0001);
  const st = a.settings;

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          Time in zones
          {st.maxHrEstimated && <Tag tone="warning">Estimated</Tag>}
        </span>
      }
      aside={
        <span className="tabular">
          max HR {st.maxHr} · {st.zoneMethod === "max" ? "% of max" : "HR reserve"}
        </span>
      }
    >
      <div
        className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-surface-2"
        role="img"
        aria-label={a.zones.map((z, k) => `Zone ${z.zone} ${Math.round(pct[k] * 100)}%`).join(", ")}
      >
        {a.zones.map((z, k) =>
          pct[k] > 0 ? (
            <div key={z.zone} style={{ width: `${pct[k] * 100}%`, background: ramp[k] }} title={`Z${z.zone} ${z.name}: ${Math.round(pct[k] * 100)}%`} />
          ) : null,
        )}
      </div>
      <ul className="mt-4 space-y-2.5">
        {[...a.zones].reverse().map((z) => {
          const k = z.zone - 1;
          return (
            <li key={z.zone} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 text-sm sm:grid-cols-[2rem_9.5rem_minmax(0,1fr)_auto]">
              <span className="flex h-6 w-8 items-center justify-center rounded-md text-[12px] font-bold text-white tabular" style={{ background: ramp[k] }}>
                Z{z.zone}
              </span>
              <span className="min-w-0 truncate">
                <span className="font-medium text-ink">{z.name}</span> <span className="text-label text-muted tabular">{bpmRange(z)}</span>
              </span>
              <span
                className="col-span-2 col-start-2 row-start-2 mt-1 h-2 overflow-hidden rounded-full bg-surface-2 sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:mt-0"
                aria-hidden
              >
                <span className="block h-full rounded-full" style={{ width: `${(pct[k] / top) * 100}%`, background: ramp[k] }} />
              </span>
              <span className="text-right tabular">
                <span className="font-semibold text-ink">{formatDuration(z.seconds)}</span>
                <span className="inline-block w-11 text-right text-muted">{Math.round(pct[k] * 100)}%</span>
              </span>
            </li>
          );
        })}
      </ul>
      <Help label="How zones are set">
        <p>
          Zones are {st.zoneMethod === "max" ? "percentages of your max heart rate" : "percentages of your heart-rate reserve (max − resting) above resting"}.
          Ranges are in bpm.
          {st.maxHrEstimated ? (
            <>
              {" "}
              Your max isn't known yet, so it's estimated at {st.maxHr} bpm.{" "}
              <Link to="/check" className="font-medium text-ink underline underline-offset-2">
                Enter yours on the Check step
              </Link>{" "}
              for zones you can trust.
            </>
          ) : (
            " Change max HR on the Check step if these look off."
          )}
        </p>
      </Help>
    </Card>
  );
}
