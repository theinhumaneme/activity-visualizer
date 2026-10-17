import { type ReactNode, useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { formatDuration, unitLength, unitLabel } from "../lib/format/format";
import { useStore } from "../state/store";
import { cssVar, useTheme } from "../state/theme";
import { withAlpha } from "./analysis/math";
import { Card } from "./ui";

export interface Band {
  low: number;
  high: number;
  label: string;
  /** Band tint (hex); without it bands alternate a neutral wash. */
  color?: string;
}

/** An extra line drawn over the main series (e.g. grade-adjusted pace). */
export interface Line {
  values: ArrayLike<number>;
  /** Theme variable ("--accent") or literal color. */
  color: string;
  width?: number;
  dash?: number[];
}

/** A labeled horizontal reference (e.g. average pace). */
export interface RefLine {
  value: number;
  label: string;
}

/** Custom canvas drawing; coordinates via u.valToPos(v, scale, true) (canvas pixels). */
export type Draw = (u: uPlot, ctx: CanvasRenderingContext2D) => void;

interface Props {
  title: ReactNode;
  /** Unit of the y-axis, shown beside the title ("min/km", "bpm"). */
  unit?: string;
  /** One value per sample; NaN leaves a gap. */
  values: ArrayLike<number>;
  /** Theme variable for the series color, e.g. "--series-pace", or a literal color. */
  color: string;
  formatValue: (v: number) => string;
  formatTick?: (v: number) => string;
  /** Allowed tick increments for the y-axis (e.g. pace in whole minutes). */
  yIncrs?: number[];
  invert?: boolean;
  area?: boolean;
  bands?: Band[];
  height?: number;
  /** Clip the y-axis to this percentile range so outliers don't flatten the line. */
  clip?: [number, number];
  /** Explicit y range; wins over `clip`. */
  range?: [number, number] | null;
  /** Always plot over distance, whatever the shared x-axis toggle says. */
  forceDistance?: boolean;
  lines?: Line[];
  refLines?: RefLine[];
  /** Drawn behind the series (after bands and the highlight). */
  under?: Draw;
  /** Drawn on top of the series. */
  over?: Draw;
  /** Don't stroke the main series (it's drawn by `over`); the cursor still follows it. */
  hideLine?: boolean;
  /** Extra header content next to the live value (legend, toggles). */
  aside?: ReactNode;
  /** Live value for the hovered sample; defaults to formatValue(values[i]). */
  readout?: (i: number) => ReactNode;
  ariaLabel?: string;
  footer?: ReactNode;
}

const resolve = (c: string) => (c.startsWith("--") ? cssVar(c) : c);
export const CHART_FONT = '"Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

/** X values for the charts: distance in display units, or seconds. Shared so custom layers line up. */
export function useChartX(forceDistance = false) {
  const a = useStore((s) => s.analysis)!;
  const xAxis = useStore((s) => s.xAxis);
  const units = a.settings.units;
  const mode = forceDistance || a.activity.routeOnly ? "distance" : xAxis;
  const x = useMemo(() => {
    const u = unitLength(units);
    return mode === "distance" ? Array.from(a.dist, (d) => d / u) : Array.from(a.t, (t) => t);
  }, [a, mode, units]);
  return { x, mode };
}

/** Text with a halo in the surface color, so labels stay legible over lines and fills. */
export function haloText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, halo: string) {
  ctx.lineWidth = 3 * devicePixelRatio;
  ctx.lineJoin = "round";
  ctx.strokeStyle = halo;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/** A rounded label chip on the canvas (reference-line values), in canvas pixels. */
function chip(ctx: CanvasRenderingContext2D, text: string, right: number, midY: number, fill: string, edge: string, ink: string, dpr: number) {
  const padX = 6 * dpr;
  const h = 18 * dpr;
  const w = ctx.measureText(text).width + padX * 2;
  const x = right - w;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x + 0.5 * dpr, midY - h / 2 + 0.5 * dpr, w - dpr, h - dpr, h / 2);
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = dpr;
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + padX, midY + 0.5 * dpr);
}

/** A soft vertical wash under a line, fading out toward the axis it fills to. */
function fade(u: uPlot, color: string, alpha: number, invert?: boolean) {
  const { top, height } = u.bbox;
  const g = u.ctx.createLinearGradient(0, invert ? top + height : top, 0, invert ? top : top + height);
  g.addColorStop(0, withAlpha(color, alpha));
  g.addColorStop(1, withAlpha(color, 0));
  return g;
}

/** Line/area chart over distance or time, with a crosshair shared with the map and other charts. */
/** Shared axis geometry so every chart's plot area lines up. */
const Y_AXIS_WIDTH = 56;
const X_AXIS_HEIGHT = 32;
const AXIS_FONT_PX = 12;

export function Chart({
  title,
  unit,
  values,
  color,
  formatValue,
  formatTick,
  yIncrs,
  invert,
  area,
  bands,
  height = 180,
  clip,
  range: rangeProp,
  forceDistance,
  lines,
  refLines,
  under,
  over,
  hideLine,
  aside,
  readout,
  ariaLabel,
  footer,
}: Props) {
  const a = useStore((s) => s.analysis)!;
  const hoverIndex = useStore((s) => s.hoverIndex);
  const highlight = useStore((s) => s.highlight);
  const theme = useTheme((s) => s.theme);
  const units = a.settings.units;
  const { x, mode } = useChartX(forceDistance);
  const el = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  // Read by the draw hook so a highlight change only repaints, never rebuilds the plot.
  const highlightRef = useRef(highlight);
  const reveal = useRef<HTMLDivElement>(null);
  const swatch = color.startsWith("--") ? `var(${color})` : color;


  const autoRange = useMemo((): [number, number] | null => {
    const finite = Array.from(values)
      .filter(Number.isFinite)
      .sort((p, q) => p - q);
    if (!finite.length) return null;
    const [pl, ph] = clip ?? [0, 1];
    let lo = finite[Math.floor(pl * (finite.length - 1))];
    let hi = finite[Math.floor(ph * (finite.length - 1))];
    if (bands?.length) {
      lo = Math.min(lo, bands[0].high);
      hi = Math.max(hi, bands[bands.length - 1].low);
    }
    const pad = (hi - lo) * 0.08 || 1;
    return [lo - pad, hi + pad];
  }, [values, clip, bands]);
  const range = rangeProp !== undefined ? rangeProp : autoRange;
  const hasPlot = range !== null;

  // One-shot reveal when the plot first comes into view: a class flip, no re-render.
  useEffect(() => {
    const cover = reveal.current;
    if (!cover) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        cover.classList.add("is-shown");
        io.disconnect();
      },
      { threshold: 0.3 },
    );
    io.observe(cover);
    return () => io.disconnect();
  }, [hasPlot]);

  useEffect(() => {
    if (!el.current || !range) return;
    const y = Array.from(values, (v) => (Number.isFinite(v) ? v : null));
    const extra = (lines ?? []).map((l) => Array.from(l.values, (v) => (Number.isFinite(v) ? v : null)));
    const stroke = resolve(color);
    const MUTED = cssVar("--muted");
    const INK2 = cssVar("--ink-2");
    const GRID = cssVar("--gridline");
    const TICK = cssVar("--grid");
    const SURFACE = cssVar("--surface");
    const INK = cssVar("--ink");
    const dpr = devicePixelRatio;
    const neutralBand = theme === "dark" ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.035)";
    const fmtX = (v: number) => (mode === "distance" ? `${+v.toFixed(2)} ${unitLabel(units)}` : formatDuration(v));
    const opts: uPlot.Options = {
      width: el.current.clientWidth,
      height,
      padding: [8, 12, 0, 0],
      legend: { show: false },
      cursor: {
        y: false,
        drag: { x: false, y: false },
        points: { size: 10, width: 2.5, fill: (_u, i) => (i === 1 ? (hideLine ? INK : stroke) : resolve(lines![i - 2].color)), stroke: SURFACE },
      },
      scales: {
        x: { time: false },
        y: { dir: invert ? -1 : 1, range: () => range },
      },
      axes: [
        {
          stroke: MUTED,
          font: `${AXIS_FONT_PX}px ${CHART_FONT}`,
          size: X_AXIS_HEIGHT,
          gap: 6,
          grid: { show: false },
          ticks: { stroke: TICK, size: 4 },
          values: (_u, vals) => vals.map(fmtX),
        },
        {
          stroke: MUTED,
          font: `${AXIS_FONT_PX}px ${CHART_FONT}`,
          size: Y_AXIS_WIDTH,
          gap: 8,
          space: 30,
          incrs: yIncrs,
          grid: { stroke: GRID, width: 1, dash: [3, 4] },
          ticks: { show: false },
          values: (_u, vals) => vals.map((v) => (formatTick ?? formatValue)(v)),
        },
      ],
      series: [
        {},
        {
          stroke: hideLine ? "rgba(0,0,0,0)" : stroke,
          width: hideLine ? 0 : 2.25,
          // Every line gets a soft wash beneath it, area charts a fuller one; inverted pace fills downward too.
          fill: hideLine ? undefined : (u: uPlot) => fade(u, stroke, area ? 0.34 : theme === "dark" ? 0.2 : 0.14, invert),
          fillTo: invert ? () => range[1] : undefined,
          points: { show: false },
          spanGaps: false,
        },
        ...(lines ?? []).map((l) => ({ stroke: resolve(l.color), width: l.width ?? 1.5, dash: l.dash, points: { show: false }, spanGaps: false })),
      ],
      hooks: {
        setCursor: [
          (u) => {
            const i = u.cursor.idx;
            useStore.getState().setHover(i === null || i === undefined ? null : i);
          },
        ],
        drawClear: [
          (u) => {
            const ctx = u.ctx;
            const { left, width, top, height: h } = u.bbox;
            ctx.save();
            ctx.beginPath();
            ctx.rect(left, top, width, h);
            ctx.clip();
            if (bands?.length) {
              ctx.font = `600 ${11 * dpr}px ${CHART_FONT}`;
              ctx.textBaseline = "top";
              bands.forEach((b, k) => {
                const ya = u.valToPos(b.high, "y", true);
                const yb = u.valToPos(b.low, "y", true);
                const y0 = Math.max(top, Math.min(ya, yb));
                const y1 = Math.min(top + h, Math.max(ya, yb));
                if (y1 <= y0) return;
                ctx.fillStyle = b.color ? withAlpha(b.color, theme === "dark" ? 0.1 : 0.08) : k % 2 ? neutralBand : "rgba(0,0,0,0)";
                ctx.fillRect(left, y0, width, y1 - y0);
                if (y1 - y0 > 12 * dpr) {
                  ctx.fillStyle = b.color ?? MUTED;
                  ctx.fillText(b.label, left + width - 22 * dpr, y0 + 2 * dpr);
                }
              });
            }
            const hl = highlightRef.current;
            if (hl) {
              const xa = u.valToPos(x[Math.max(0, hl.from)], "x", true);
              const xb = u.valToPos(x[Math.min(x.length - 1, hl.to)], "x", true);
              ctx.fillStyle = theme === "dark" ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.07)";
              ctx.fillRect(Math.min(xa, xb), top, Math.max(2 * dpr, Math.abs(xb - xa)), h);
            }
            under?.(u, ctx);
            ctx.restore();
          },
        ],
        draw: [
          (u) => {
            const ctx = u.ctx;
            const { left, width, top, height: h } = u.bbox;
            ctx.save();
            ctx.beginPath();
            ctx.rect(left, top, width, h);
            ctx.clip();
            over?.(u, ctx);
            if (refLines?.length) {
              ctx.font = `600 ${11.5 * dpr}px ${CHART_FONT}`;
              for (const r of refLines) {
                const yy = Math.round(u.valToPos(r.value, "y", true)) + 0.5;
                ctx.strokeStyle = withAlpha(INK2, 0.7);
                ctx.lineWidth = dpr;
                ctx.setLineDash([2 * dpr, 4 * dpr]);
                ctx.beginPath();
                ctx.moveTo(left, yy);
                ctx.lineTo(left + width, yy);
                ctx.stroke();
                ctx.setLineDash([]);
                // The value sits in a chip at the right end of its line, clear of the y-axis labels.
                chip(ctx, r.label, left + width - 4 * dpr, yy, SURFACE, cssVar("--line"), INK, dpr);
              }
            }
            ctx.restore();
          },
        ],
      },
    };
    const u = new uPlot(opts, [x, y, ...extra] as uPlot.AlignedData, el.current);
    plot.current = u;
    // uPlot follows the mouse only; a finger dragging across the plot moves the cursor too.
    const onTouch = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      const r = u.over.getBoundingClientRect();
      u.setCursor({ left: Math.min(Math.max(0, e.clientX - r.left), r.width), top: e.clientY - r.top });
    };
    u.over.addEventListener("pointerdown", onTouch);
    u.over.addEventListener("pointermove", onTouch);
    const ro = new ResizeObserver(() => el.current && u.setSize({ width: el.current.clientWidth, height }));
    ro.observe(el.current);
    return () => {
      u.over.removeEventListener("pointerdown", onTouch);
      u.over.removeEventListener("pointermove", onTouch);
      ro.disconnect();
      u.destroy();
      plot.current = null;
    };
  }, [x, mode, values, color, invert, area, bands, height, range, units, formatValue, formatTick, yIncrs, theme, lines, refLines, under, over, hideLine]);

  // Shade the highlighted range (a hovered split, rep or climb) without rebuilding.
  useEffect(() => {
    highlightRef.current = highlight;
    plot.current?.redraw(false);
  }, [highlight]);

  // Follow hover coming from the map or another chart.
  useEffect(() => {
    const u = plot.current;
    if (!u || u.cursor.idx === hoverIndex) return;
    if (hoverIndex === null) u.setCursor({ left: -10, top: -10 }, false);
    else u.setCursor({ left: u.valToPos(x[hoverIndex], "x"), top: 10 }, false);
  }, [hoverIndex, x]);

  const current = hoverIndex !== null ? (readout ? readout(hoverIndex) : Number.isFinite(values[hoverIndex]) ? formatValue(values[hoverIndex]) : "—") : null;
  const at = hoverIndex !== null ? (mode === "distance" ? `${+x[hoverIndex].toFixed(2)} ${unitLabel(units)}` : formatDuration(x[hoverIndex])) : null;

  return (
    <Card variant="chart">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-1 sm:px-0">
        <div className="min-w-0">
          <h3 className="flex items-baseline text-base font-semibold text-ink">
            <span
              aria-hidden
              className="mr-2 h-2.5 w-2.5 shrink-0 self-center rounded-full"
              style={{ background: swatch, boxShadow: `0 0 0 3px color-mix(in srgb, ${swatch} 20%, transparent)` }}
            />
            {title}
            {unit && <span className="ml-1.5 text-sm font-normal text-muted">{unit}</span>}
          </h3>
          {aside && <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-ink-2">{aside}</div>}
        </div>
        {/* Fixed slot for the value under the cursor, so the layout doesn't jump while you scrub. */}
        <div
          className={`flex min-h-[2.75rem] min-w-[8.5rem] flex-col items-end justify-center rounded-control border px-3 py-1 text-right ${
            current !== null ? "border-grid bg-surface-2" : "border-dashed border-grid"
          }`}
          aria-live="off"
        >
          {current !== null ? (
            <>
              <span className="text-[16px] font-semibold leading-tight tracking-[-0.01em] text-ink tabular">{current}</span>
              <span className="text-[12px] leading-tight text-muted tabular">at {at}</span>
            </>
          ) : (
            <span className="flex items-center gap-1.5 text-label text-muted">
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
                <path d="M8 2v12M2.5 8H5m6 0h2.5" />
              </svg>
              Hover or tap to read
            </span>
          )}
        </div>
      </div>
      {range ? (
        <div className="relative">
          <div
            ref={el}
            tabIndex={0}
            className="w-full touch-pan-y rounded-md"
            role="img"
            aria-label={`${ariaLabel ?? (typeof title === "string" ? `${title} chart` : "Chart")}. Use the left and right arrow keys to read values.`}
            onKeyDown={(e) => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
              e.preventDefault();
              const n = x.length;
              const step = Math.max(1, Math.round(n / (e.shiftKey ? 20 : 100)));
              const cur = useStore.getState().hoverIndex ?? (e.key === "ArrowLeft" ? n : -1);
              const next = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : cur + (e.key === "ArrowLeft" ? -step : step);
              useStore.getState().setHover(Math.min(n - 1, Math.max(0, next)));
            }}
            onBlur={() => useStore.getState().setHover(null)}
          />
          {/* Wipes away left to right the first time the chart scrolls into view, so the line reads as drawn. */}
          <div ref={reveal} aria-hidden className="chart-reveal pointer-events-none absolute inset-y-0 right-0 bg-surface" style={{ left: Y_AXIS_WIDTH }} />
        </div>
      ) : (
        <p className="px-1 text-sm text-muted">No data.</p>
      )}
      {footer && <div className="px-1 sm:px-0">{footer}</div>}
    </Card>
  );
}
