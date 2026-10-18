import { useMemo } from "react";
import type { Analysis } from "../../lib/analysis/types";
import { formatDistance, formatDuration } from "../../lib/format/format";
import { compass, formatWind } from "../../lib/weather";
import { type WindStretch, windAlong } from "../../lib/wind";
import { useStore } from "../../state/store";
import { type Band, Chart, type RefLine } from "../Chart";
import { Card, Help, Stat } from "../ui";

const HEAD = "#d2463c";
const TAIL = "#2e9e5e";
const ZERO: RefLine[] = [{ value: 0, label: "calm" }];

/**
 * Headwind and tailwind along the route, from the hour's wind and your direction of travel.
 * Needs the weather (opt-in), so without it this offers to turn it on.
 */
export function WindSection({ a }: { a: Analysis }) {
  const weather = useStore((s) => s.weather);
  const weatherOn = useStore((s) => s.weatherOn);
  const status = useStore((s) => s.weatherStatus);
  const setWeatherOn = useStore((s) => s.setWeatherOn);
  const setHighlight = useStore((s) => s.setHighlight);
  const u = a.settings.units;
  const wind = useMemo(() => windAlong(a, weather), [a, weather]);
  const perUnit = u === "metric" ? 1 : 1 / 1.609344;
  const unit = u === "metric" ? "km/h" : "mph";
  const values = useMemo(() => (wind ? Float64Array.from(wind.head, (v) => v * perUnit) : null), [wind, perUnit]);
  const top = useMemo(() => {
    let m = 5;
    if (values) for (const v of values) if (Number.isFinite(v)) m = Math.max(m, Math.abs(v));
    return Math.ceil(m * 1.1);
  }, [values]);
  const bands = useMemo<Band[]>(
    () => [
      { low: 0, high: top, label: "Headwind", color: HEAD },
      { low: -top, high: 0, label: "Tailwind", color: TAIL },
    ],
    [top],
  );
  const range = useMemo<[number, number]>(() => [-top, top], [top]);
  const fmt = useMemo(
    () => ({
      value: (v: number) => (Math.abs(v) < 0.5 ? "calm" : `${Math.round(Math.abs(v))} ${unit} ${v > 0 ? "headwind" : "tailwind"}`),
      tick: (v: number) => String(Math.round(Math.abs(v))),
    }),
    [unit],
  );

  if (!weatherOn)
    return (
      <Card title="Wind">
        <p className="text-sm leading-relaxed text-ink-2">
          See where the wind was against you and where it helped, worked out from the hour's wind and your direction at every point. It uses the weather,
          which asks Open-Meteo (free, no account) for the date and a location rounded to about 10 km.
        </p>
        <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => setWeatherOn(true)}>
          Show weather and wind
        </button>
      </Card>
    );
  if (status === "loading") return <Card title="Wind">{<p className="text-sm text-ink-2">Looking up the wind…</p>}</Card>;
  if (!wind || !values) return <Card title="Wind">{<p className="text-sm text-ink-2">No wind data for this activity.</p>}</Card>;

  const where = (st: WindStretch) => `${formatDuration(st.seconds)} starting at ${formatDistance(a.dist[st.startIdx], u)}`;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const stretchStat = (label: string, st: WindStretch | null, kind: "headwind" | "tailwind") =>
    st && (
      <button
        type="button"
        className="-m-2 rounded-control p-2 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2"
        onMouseEnter={() => setHighlight({ from: st.startIdx, to: st.endIdx, label })}
        onMouseLeave={() => setHighlight(null)}
        onFocus={() => setHighlight({ from: st.startIdx, to: st.endIdx, label })}
        onBlur={() => setHighlight(null)}
      >
        <Stat label={label} value={`${formatWind(Math.abs(st.head), u)}`} sub={`${kind}, ${where(st)}`} />
      </button>
    );

  return (
    <div className="space-y-4">
      <Chart
        title="Headwind"
        unit={unit}
        values={values}
        color="--series-wind"
        bands={bands}
        refLines={ZERO}
        range={range}
        forceDistance
        formatValue={fmt.value}
        formatTick={fmt.tick}
        aside={
          <span className="tabular">
            {formatWind(wind.speed, u)} from the {compass(wind.from)}
          </span>
        }
      />
      <Card title="Wind">
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3">
          <Stat label="Into the wind" value={pct(wind.headShare)} sub="of moving time" />
          <Stat label="With the wind" value={pct(wind.tailShare)} sub="of moving time" />
          <Stat label="Across" value={pct(wind.crossShare)} sub={wind.headShare + wind.tailShare + wind.crossShare < 0.95 ? "the rest was calm" : "of moving time"} />
          <Stat
            label="On balance"
            value={formatWind(Math.abs(wind.avgHead), u)}
            sub={Math.abs(wind.avgHead) < 1 ? "it evened out" : wind.avgHead > 0 ? "against you on average" : "behind you on average"}
          />
          {stretchStat("Toughest headwind", wind.hardest, "headwind")}
          {stretchStat("Best tailwind", wind.kindest, "tailwind")}
        </div>
        <Help label="How this is worked out">
          <p>
            The hour's wind from Open-Meteo, measured 10 m above the ground (nearer the ground it's usually about a third lighter), split into the part
            blowing straight against or behind you and the part from the side, using your direction over each 25 m.
          </p>
          <p>Hover a stretch to find it on the map and charts.</p>
        </Help>
      </Card>
    </div>
  );
}
