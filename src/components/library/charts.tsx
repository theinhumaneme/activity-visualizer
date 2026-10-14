import { type ReactNode, useState } from "react";
import { DAY_MS } from "../../lib/library/aggregate";
import { useWidth } from "./hooks";

const PAD = { left: 44, right: 8, top: 10, bottom: 22 };

/** Round tick values from 0 (or lo) to just above max: steps of 1, 2, 2.5 or 5 × 10ⁿ. */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.999; v += step) out.push(+v.toPrecision(12));
  return out;
}

/**
 * Month-start ticks between two local-time instants (ms whose UTC fields are local), thinned to
 * fit; years only when the span is long.
 */
export function dateTicks(x0: number, x1: number, max: number): { x: number; label: string }[] {
  const a = new Date(x0);
  const months = (new Date(x1).getUTCFullYear() - a.getUTCFullYear()) * 12 + new Date(x1).getUTCMonth() - a.getUTCMonth();
  const step = [1, 2, 3, 6, 12, 24, 60].find((s) => months / s <= max) ?? 120;
  const out: { x: number; label: string }[] = [];
  let y = a.getUTCFullYear();
  let m = a.getUTCMonth() + 1;
  if (step >= 12) {
    y += 1;
    m = 0;
  } else m = Math.ceil(m / step) * step;
  for (;;) {
    const t = Date.UTC(y + Math.floor(m / 12), m % 12, 1);
    if (t > x1) break;
    const d = new Date(t);
    const label =
      step >= 12 ? String(d.getUTCFullYear()) : d.toLocaleDateString(undefined, { month: "short", ...(d.getUTCMonth() === 0 || out.length === 0 ? { year: "2-digit" } : {}), timeZone: "UTC" });
    out.push({ x: t, label });
    m += step;
  }
  return out;
}

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const w = 180;
  const left = Math.max(0, Math.min(width - w, x - w / 2));
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-0 z-10 rounded-lg border border-line bg-surface-2/95 px-2.5 py-1.5 text-xs text-ink shadow-lg tabular"
      style={{ left, width: w }}
    >
      {children}
    </div>
  );
}

/** Bar with a 4 px rounded top, anchored to the baseline. */
function barPath(x: number, y: number, w: number, h: number) {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export interface BarDatum {
  /** Local-time ms of the bucket start. */
  x: number;
  value: number;
  tip: ReactNode;
}

/** Bars over time (weeks or months), one series, hover for the exact numbers. */
export function TimeBars({
  data,
  formatTick,
  label,
  height = 170,
  color = "var(--accent)",
}: {
  data: BarDatum[];
  formatTick: (v: number) => string;
  label: string;
  height?: number;
  color?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...data.map((d) => d.value));
  const ticks = niceTicks(0, max || 1);
  const top = ticks[ticks.length - 1];
  const iw = Math.max(0, width - PAD.left - PAD.right);
  const ih = height - PAD.top - PAD.bottom;
  const slot = data.length ? iw / data.length : 0;
  const gap = slot > 6 ? 2 : slot > 3 ? 1 : 0;
  const bw = Math.max(1, slot - gap);
  const y = (v: number) => PAD.top + ih - (v / top) * ih;
  const span = data.length ? [data[0].x, data[data.length - 1].x] : [0, 0];
  const xt = dateTicks(span[0], span[1] + DAY_MS, Math.max(2, Math.floor(iw / 70)));
  const xOf = (t: number) => PAD.left + ((t - span[0]) / (span[1] - span[0] || 1)) * (iw - slot) + slot / 2;

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const i = Math.floor((e.clientX - r.left - PAD.left) / slot);
            setHover(i >= 0 && i < data.length ? i : null);
          }}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
              <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--muted)" className="tabular">
                {formatTick(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => (
            <path key={i} d={barPath(PAD.left + i * slot + gap / 2, y(d.value), bw, PAD.top + ih - y(d.value))} fill={color} opacity={hover === null || hover === i ? 1 : 0.55} />
          ))}
          {xt.map((t) => (
            <text key={t.x} x={xOf(t.x)} y={height - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">
              {t.label}
            </text>
          ))}
        </svg>
      )}
      {hover !== null && data[hover] && (
        <Tooltip x={PAD.left + (hover + 0.5) * slot} width={width}>
          {data[hover].tip}
        </Tooltip>
      )}
    </div>
  );
}

export interface TrendPoint {
  x: number;
  y: number;
  tip: ReactNode;
}

/**
 * Dots over time with an optional line (a rolling mean, or the points joined). One y-axis,
 * hover picks the nearest dot.
 */
export function Trend({
  points,
  line,
  formatTick,
  label,
  height = 190,
  color = "var(--series-pace)",
  lineColor = "var(--ink)",
}: {
  points: TrendPoint[];
  /** Values aligned with `points` (NaN for a gap). */
  line?: number[];
  formatTick: (v: number) => string;
  label: string;
  height?: number;
  color?: string;
  lineColor?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const ys = points.map((p) => p.y).filter(Number.isFinite);
  const lo0 = Math.min(...ys);
  const hi0 = Math.max(...ys);
  const pad = (hi0 - lo0) * 0.1 || Math.abs(hi0) * 0.05 || 1;
  const ticks = niceTicks(lo0 - pad, hi0 + pad);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const iw = Math.max(0, width - PAD.left - PAD.right - 8);
  const ih = height - PAD.top - PAD.bottom;
  const x0 = points[0]?.x ?? 0;
  const x1 = points[points.length - 1]?.x ?? 1;
  const xOf = (t: number) => PAD.left + 4 + ((t - x0) / (x1 - x0 || 1)) * iw;
  const yOf = (v: number) => PAD.top + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const xt = dateTicks(x0, x1, Math.max(2, Math.floor(iw / 70)));
  const linePath = line
    ? line
        .map((v, i) => (Number.isFinite(v) ? `${i === 0 || !Number.isFinite(line[i - 1]) ? "M" : "L"}${xOf(points[i].x).toFixed(1)},${yOf(v).toFixed(1)}` : ""))
        .join("")
    : "";
  const r = points.length > 150 ? 2.5 : 4;

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            let best = -1;
            let bd = Infinity;
            points.forEach((p, i) => {
              const d = Math.abs(xOf(p.x) - mx);
              if (d < bd) {
                bd = d;
                best = i;
              }
            });
            setHover(bd < 24 ? best : null);
          }}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={yOf(t)} y2={yOf(t)} stroke="var(--grid)" />
              <text x={PAD.left - 6} y={yOf(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--muted)" className="tabular">
                {formatTick(t)}
              </text>
            </g>
          ))}
          {xt.map((t) => (
            <text key={t.x} x={xOf(t.x)} y={height - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">
              {t.label}
            </text>
          ))}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={xOf(p.x)}
              cy={yOf(p.y)}
              r={hover === i ? r + 2 : r}
              fill={color}
              fillOpacity={line ? 0.55 : 0.9}
              stroke="var(--surface)"
              strokeWidth={hover === i ? 2 : 1}
            />
          ))}
          {linePath && <path d={linePath} fill="none" stroke={lineColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        </svg>
      )}
      {hover !== null && points[hover] && (
        <Tooltip x={xOf(points[hover].x)} width={width}>
          {points[hover].tip}
        </Tooltip>
      )}
    </div>
  );
}

/** 24 small bars, one per local hour. */
export function HourBars({ hours, label, height = 120 }: { hours: number[]; label: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...hours);
  const padB = 20;
  const ih = height - padB - 6;
  const slot = width / 24;
  const fmtHour = (h: number) => new Date(Date.UTC(2000, 0, 1, h)).toLocaleTimeString(undefined, { hour: "numeric", timeZone: "UTC" });
  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} onPointerLeave={() => setHover(null)}>
          <line x1={0} x2={width} y1={6 + ih} y2={6 + ih} stroke="var(--grid)" />
          {hours.map((c, h) => {
            const bh = (c / max) * ih;
            return (
              <g key={h} onPointerEnter={() => setHover(h)}>
                <rect x={h * slot} y={0} width={slot} height={height} fill="transparent" />
                <path d={barPath(h * slot + 1, 6 + ih - bh, Math.max(1, slot - 2), bh)} fill="var(--accent)" opacity={hover === null || hover === h ? 1 : 0.55} />
              </g>
            );
          })}
          {[0, 6, 12, 18].map((h) => (
            <text key={h} x={h * slot + slot / 2} y={height - 5} textAnchor="middle" fontSize="11" fill="var(--muted)">
              {fmtHour(h)}
            </text>
          ))}
        </svg>
      )}
      {hover !== null && (
        <Tooltip x={(hover + 0.5) * slot} width={width}>
          {fmtHour(hover)}: {hours[hover]} {hours[hover] === 1 ? "start" : "starts"}
        </Tooltip>
      )}
    </div>
  );
}
