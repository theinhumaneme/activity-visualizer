import { useMemo, useState } from "react";
import { climbLabel } from "../../lib/analysis/climbs";
import type { Analysis } from "../../lib/analysis/types";
import { formatElevation } from "../../lib/format/format";
import { GRADE_SPAN, RAMPS, buildChunks, colorDomain, sampleColors } from "../../lib/map/route";
import { useStore } from "../../state/store";
import { cssVar, useTheme } from "../../state/theme";
import { CHART_FONT, Chart, type Draw, haloText, useChartX } from "../Chart";
import { Explain, Segmented } from "../ui";
import { withAlpha } from "./math";
import { formatShortDistance, motionUnits } from "./units";

type ColorBy = "grade" | "pace";

/** Short y-ranges still get a few meters of axis, so a 4 m wobble doesn't look like a mountain. */
const MIN_SPAN_M = 8;

const elevNum = (m: number, metric: boolean) => String(Math.round(metric ? m : m * 3.28084));

/**
 * Elevation over distance as an area colored segment by segment (by grade or pace), with
 * climbs bracketed and labeled. The y-axis fits the data, and its range is always stated so a
 * zoomed axis never exaggerates small hills.
 */
export function ElevationProfile({ a }: { a: Analysis }) {
  const theme = useTheme((s) => s.theme);
  const xAxis = useStore((s) => s.xAxis);
  const setHighlight = useStore((s) => s.setHighlight);
  const [colorBy, setColorBy] = useState<ColorBy>("grade");
  const by: ColorBy = a.activity.routeOnly ? "grade" : colorBy;
  const { x } = useChartX(true);
  const u = a.settings.units;
  const metric = u === "metric";
  const elev = a.elev!;
  const s = a.summary;
  const lo = s.elevMin ?? Math.min(...elev);
  const hi = s.elevMax ?? Math.max(...elev);

  // Extra headroom when there are climbs, so their labels sit above the profile, not on it.
  const hasClimbs = a.climbs.length > 0;
  const range = useMemo<[number, number]>(() => {
    const span = Math.max(hi - lo, MIN_SPAN_M);
    const base = (hi + lo) / 2 - span / 2;
    return [base - span * 0.1, base + span * (hasClimbs ? 1.45 : 1.12)];
  }, [lo, hi, hasClimbs]);

  const over = useMemo<Draw>(() => {
    const colors = sampleColors(a, { mode: by, color: cssVar("--series-elev"), theme });
    const chunks = buildChunks(a, colors, 300);
    const INK = cssVar("--ink");
    const INK2 = cssVar("--ink-2");
    const SURFACE = cssVar("--surface");
    const dpr = devicePixelRatio;
    return (pl, ctx) => {
      const { top, height } = pl.bbox;
      const bottom = top + height;
      const px = (i: number) => pl.valToPos(x[i], "x", true);
      const py = (i: number) => pl.valToPos(elev[i], "y", true);
      for (const c of chunks) {
        const grad = ctx.createLinearGradient(0, top, 0, bottom);
        grad.addColorStop(0, withAlpha(c.color, theme === "dark" ? 0.55 : 0.45));
        grad.addColorStop(1, withAlpha(c.color, 0.04));
        ctx.beginPath();
        ctx.moveTo(px(c.from), bottom);
        for (let i = c.from; i <= c.to; i++) ctx.lineTo(px(i), py(i));
        ctx.lineTo(px(c.to), bottom);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(px(c.from), py(c.from));
        for (let i = c.from + 1; i <= c.to; i++) ctx.lineTo(px(i), py(i));
        ctx.strokeStyle = c.color;
        ctx.lineWidth = 2 * dpr;
        ctx.lineJoin = "round";
        ctx.stroke();
      }

      // Climb brackets and labels, stacked into up to two rows; a label that still won't fit is
      // left to the chip list below the chart.
      ctx.font = `600 ${10.5 * dpr}px ${CHART_FONT}`;
      ctx.textBaseline = "top";
      const rows: number[] = [-Infinity, -Infinity];
      for (const c of a.climbs) {
        const xa = px(c.startIdx);
        const xb = px(c.endIdx);
        const text = `${climbLabel(c)} · +${formatElevation(c.gain, u)} · ${Math.round(c.grade * 100)}%`;
        const w = ctx.measureText(text).width;
        const cx = Math.max(pl.bbox.left + 2 * dpr, Math.min((xa + xb) / 2 - w / 2, pl.bbox.left + pl.bbox.width - w - 2 * dpr));
        const row = rows.findIndex((end) => cx > end + 6 * dpr);
        if (row < 0) continue;
        const ty = top + 2 * dpr + row * 14 * dpr;
        ctx.strokeStyle = INK2;
        ctx.lineWidth = dpr;
        ctx.setLineDash([2 * dpr, 3 * dpr]);
        // Bracket under the label, with legs down to where the climb starts and tops out.
        ctx.beginPath();
        ctx.moveTo(xa, py(c.startIdx));
        ctx.lineTo(xa, ty + 13 * dpr);
        ctx.lineTo(xb, ty + 13 * dpr);
        ctx.lineTo(xb, py(c.endIdx));
        ctx.stroke();
        ctx.setLineDash([]);
        rows[row] = cx + w;
        haloText(ctx, text, cx, ty, INK, SURFACE);
      }
    };
  }, [a, by, theme, x, elev, u]);

  const legend =
    by === "grade"
      ? { ramp: RAMPS.grade[theme], low: `−${GRADE_SPAN * 100}%`, high: `+${GRADE_SPAN * 100}%` }
      : (() => {
          const d = colorDomain(a, "pace");
          const m = motionUnits(a);
          return {
            ramp: RAMPS.pace[theme],
            low: d ? `${m.format(m.toChart(d[0]))} slower` : "slower",
            high: d ? `faster ${m.format(m.toChart(d[1]))}` : "faster",
          };
        })();

  const fmt = useMemo(() => ({ value: (v: number) => formatElevation(v, u), tick: (v: number) => elevNum(v, metric) }), [u, metric]);

  return (
    <Chart
      title="Elevation"
      unit={metric ? "m" : "ft"}
      values={elev}
      color="--series-elev"
      hideLine
      forceDistance
      range={range}
      over={over}
      height={170}
      formatValue={fmt.value}
      formatTick={fmt.tick}
      readout={(i) => {
        const g = a.grade?.[i];
        return `${formatElevation(elev[i], u)}${g !== undefined && Number.isFinite(g) ? ` · ${g >= 0 ? "+" : "−"}${Math.abs(g * 100).toFixed(1)}%` : ""}`;
      }}
      aside={
        <span className="tabular" title="The y-axis is zoomed to the data">
          range {elevNum(lo, metric)}–{formatElevation(hi, u)}
        </span>
      }
      footer={
        <>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-label font-medium text-ink-2">Color by</span>
            <Segmented
              size="sm"
              label="Color the profile by"
              value={by}
              onChange={setColorBy}
              options={[
                { value: "grade", label: "Grade" },
                { value: "pace", label: a.activity.kind === "ride" ? "Speed" : "Pace", disabled: a.activity.routeOnly },
              ]}
            />
            <span className="flex items-center gap-2 text-label text-ink-2 tabular" aria-label="Color legend">
              {legend.low}
              <span className="h-2.5 w-20 rounded-full" aria-hidden style={{ background: `linear-gradient(90deg, ${legend.ramp.join(", ")})` }} />
              {legend.high}
            </span>
          </div>
          {a.climbs.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Climbs">
              {a.climbs.map((c, k) => (
                <li key={c.startIdx}>
                  <button
                    type="button"
                    className="min-h-8 rounded-full border border-line px-3 text-label text-ink-2 tabular transition-colors hover:bg-surface-2 hover:text-ink focus-visible:bg-surface-2"
                    onMouseEnter={() => setHighlight({ from: c.startIdx, to: c.endIdx, label: climbLabel(c) })}
                    onMouseLeave={() => setHighlight(null)}
                    onFocus={() => setHighlight({ from: c.startIdx, to: c.endIdx, label: climbLabel(c) })}
                    onBlur={() => setHighlight(null)}
                  >
                    {k + 1}. {climbLabel(c)} · +{formatElevation(c.gain, u)} over {formatShortDistance(c.length, a)} · {Math.round(c.grade * 100)}%
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Explain>
            {a.climbs.length
              ? `${a.climbs.length} climb${a.climbs.length === 1 ? "" : "s"} (at least 8 m of gain at 2.5% or steeper). Hover one to see it on the map.`
              : hi - lo < 15
                ? "Mostly flat. The axis is zoomed in, so read the range above before the shape."
                : "No sustained climbs (at least 8 m of gain at 2.5% or steeper)."}
            {xAxis === "time" && " This profile always runs over distance."}
          </Explain>
        </>
      }
    />
  );
}
