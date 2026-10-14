import { useMemo } from "react";
import { Chart, type Draw, type Line, type RefLine, useChartX } from "../Chart";
import { Help } from "../ui";
import type { Analysis } from "../../lib/analysis/types";
import { motionLabel, unitLabel } from "../../lib/format/format";
import { cssVar, useTheme } from "../../state/theme";
import { bucketMinMax, clippedRange, rawSpeed, withAlpha } from "./math";
import { motionUnits } from "./units";

const PACE_INCRS = [5, 10, 15, 30, 60, 120, 180, 300, 600];
const CLIP: [number, number] = [0.02, 0.98];
const GAP_COLOR = "--accent-soft";

function Swatch({ color, dashed, band }: { color: string; dashed?: boolean; band?: boolean }) {
  return band ? (
    <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: `color-mix(in srgb, var(${color}) 30%, transparent)` }} aria-hidden />
  ) : (
    <span className="inline-block w-4 border-t-2" style={{ borderColor: `var(${color})`, borderStyle: dashed ? "dashed" : "solid" }} aria-hidden />
  );
}

/**
 * Pace (faster = higher) or speed: the smoothed line, grade-adjusted pace when there's elevation,
 * a faint band of the raw 3 s point-to-point readings behind, and the average as a labeled line.
 * The axis is clipped to the 2nd–98th percentile so a GPS hiccup can't flatten everything else.
 */
export function PaceChart({ a }: { a: Analysis }) {
  const theme = useTheme((s) => s.theme);
  const { x, mode } = useChartX();
  const m = useMemo(() => motionUnits(a), [a]);
  const kind = a.activity.kind;
  const s = a.summary;

  const data = useMemo(() => {
    const live = (i: number) => a.moving[i] || a.moving[i - 1];
    const toChart = (v: number, i: number) => (m.pace ? (v > 0.5 && live(i) ? m.toChart(v) : NaN) : m.toChart(v));
    const motion = Float64Array.from(a.speed, toChart);
    const gap = m.pace && a.gap ? Float64Array.from(a.gap, toChart) : null;
    const raw = Float64Array.from(rawSpeed(a.t, a.dist, a.moving, 3), (v) => (Number.isFinite(v) && (!m.pace || v > 0.3) ? m.toChart(v) : NaN));
    const avg = m.paceToChart(s.avgPace);
    const clipped = clippedRange(motion, CLIP[0], CLIP[1], 0.08, [avg]);
    return { motion, gap, raw, avg, clipped };
  }, [a, m, s.avgPace]);

  // Raw band: min/max of the raw readings in a few hundred x buckets, drawn as one ribbon per unbroken run.
  const band = useMemo(() => bucketMinMax(x, data.raw, Math.min(600, Math.max(60, Math.round(a.n / 3)))), [x, data.raw, a.n]);

  const under = useMemo<Draw>(() => {
    const color = withAlpha(cssVar("--series-pace"), theme === "dark" ? 0.22 : 0.18);
    const repShade = theme === "dark" ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.03)";
    const blocks = a.intervals?.blocks.filter((b) => b.kind === "work") ?? [];
    return (u, ctx) => {
      const { top, height } = u.bbox;
      // Work reps get a faint column so the structure of the session reads at a glance.
      ctx.fillStyle = repShade;
      for (const b of blocks) {
        const xa = u.valToPos(x[b.startIdx], "x", true);
        const xb = u.valToPos(x[b.endIdx], "x", true);
        ctx.fillRect(xa, top, xb - xa, height);
      }
      ctx.fillStyle = color;
      const n = band.x.length;
      let k = 0;
      while (k < n) {
        while (k < n && !Number.isFinite(band.lo[k])) k++;
        const start = k;
        while (k < n && Number.isFinite(band.lo[k])) k++;
        if (k - start < 2) continue;
        ctx.beginPath();
        for (let j = start; j < k; j++) {
          const px = u.valToPos(band.x[j], "x", true);
          const py = u.valToPos(band.hi[j], "y", true);
          if (j === start) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        for (let j = k - 1; j >= start; j--) ctx.lineTo(u.valToPos(band.x[j], "x", true), u.valToPos(band.lo[j], "y", true));
        ctx.closePath();
        ctx.fill();
      }
    };
  }, [band, theme, a.intervals, x]);

  const lines = useMemo<Line[] | undefined>(() => (data.gap ? [{ values: data.gap, color: GAP_COLOR, width: 1.5, dash: [5, 3] }] : undefined), [data.gap]);
  const refLines = useMemo<RefLine[]>(() => [{ value: data.avg, label: `avg ${m.format(data.avg)}` }], [data.avg, m]);
  const label = motionLabel(kind);

  return (
    <Chart
      title={label}
      unit={m.pace ? `min/${unitLabel(a.settings.units)}` : a.settings.units === "metric" ? "km/h" : "mph"}
      values={data.motion}
      color="--series-pace"
      invert={m.pace}
      range={data.clipped?.range ?? null}
      formatValue={m.format}
      formatTick={m.tick}
      yIncrs={m.pace ? PACE_INCRS : undefined}
      lines={lines}
      refLines={refLines}
      under={under}
      height={200}
      ariaLabel={`${label} over ${mode}, faster is higher`}
      aside={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1.5">
            <Swatch color="--series-pace" />
            {label}
          </span>
          {data.gap && (
            <span className="flex items-center gap-1.5">
              <Swatch color={GAP_COLOR} dashed />
              GAP
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Swatch color="--series-pace" band />
            raw
          </span>
        </span>
      }
      readout={(i) => {
        const v = data.motion[i];
        if (!Number.isFinite(v)) return "stopped";
        const g = data.gap?.[i];
        return `${m.format(v)}${g !== undefined && Number.isFinite(g) ? ` · GAP ${m.format(g, false)}` : ""}`;
      }}
      footer={
        <Help>
          <p>
            {m.pace ? "Faster is higher. " : ""}The line is smoothed over 20 s; the faint band is the raw 3 s readings, which jump around with GPS noise.
            {data.gap && " GAP (dashed) is what each stretch would be worth on flat ground: faster than your pace on climbs, slower on descents."}
            {a.intervals && " Shaded columns are your reps."}
          </p>
          {data.clipped && (
            <p className="tabular">
              The axis is clipped to the 2nd–98th percentile;{" "}
              {data.clipped.outliers
                ? `${data.clipped.outliers.toLocaleString()} outlier${data.clipped.outliers === 1 ? "" : "s"} off the edge.`
                : "nothing is cut off."}
            </p>
          )}
        </Help>
      }
    />
  );
}
