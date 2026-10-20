// Small scenes for the upload page's "What you get" list, drawn from the sample run and the app's
// own palette, so each step shows the thing it makes rather than a generic icon. Each acts out its
// step once as it scrolls into view (see useReveal); without motion it's the finished picture.

import type { CSSProperties } from "react";
import { ROUTE } from "./SamplePreview";

const VIEW = "0 0 160 96";
const at = (s: number, dur?: number) => ({ "--rv-delay": `${s}s`, ...(dur ? { "--rv-dur": `${dur}s` } : {}) }) as CSSProperties;

/** A GPS spike in the raw track (dashed, red) and the cleaned line through it. */
function CheckArt() {
  const pts = [
    [12, 72],
    [28, 66],
    [44, 61],
    [58, 57],
    [70, 54],
    [78, 52.5],
    [86, 51],
    [100, 47],
    [116, 42],
    [132, 36],
    [148, 30],
  ];
  const clean = `M${pts.map((p) => p.join(" ")).join(" ")}`;
  const raw = clean.replace("78 52.5", "78 18");
  return (
    <svg viewBox={VIEW} className="h-full w-full" aria-hidden>
      <path d={raw} fill="none" strokeWidth="1.25" strokeDasharray="3 3" strokeLinejoin="round" className="stroke-critical/70" />
      <circle cx="78" cy="18" r="3.5" className="fill-critical/20 stroke-critical" strokeWidth="1.25" />
      <path d={clean} pathLength={1} fill="none" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="rv-draw stroke-ink-2" style={at(0.3, 1.1)} />
      {pts.map(([x, y], i) => (
        <circle key={x} cx={x} cy={y} r="1.9" className="rv-pop fill-surface stroke-ink-2" strokeWidth="1.1" style={at(0.3 + i * 0.08, 0.4)} />
      ))}
      <g className="rv-pop" style={at(1.15, 0.45)}>
        <circle cx="78" cy="52.5" r="5.5" className="fill-good" />
        <path d="m75.6 52.6 1.7 1.7 3.2-3.4" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/** Split bars with the pace line running over them and the average dashed across. */
function AnalyzeArt() {
  const bars = [44, 52, 49, 58, 40, 55, 62, 47, 51];
  const w = 11;
  const gap = 5;
  const x0 = 10;
  const line = bars.map((h, i) => `${x0 + i * (w + gap) + w / 2} ${86 - h - 8 + ((i * 7) % 5)}`).join(" L");
  return (
    <svg viewBox={VIEW} className="h-full w-full" aria-hidden>
      {bars.map((h, i) => (
        <rect
          key={i}
          x={x0 + i * (w + gap)}
          y={86 - h}
          width={w}
          height={h}
          rx="2"
          className={`rv-grow ${i === 6 ? "fill-accent/80" : "fill-surface-3"}`}
          style={at(i * 0.06, 0.7)}
        />
      ))}
      <path d="M8 34H152" strokeDasharray="2 3" strokeWidth="1" className="rv-wipe stroke-muted" style={at(0.55, 0.8)} />
      <path d={`M${line}`} pathLength={1} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="rv-draw stroke-series-pace" style={at(0.6, 1)} />
    </svg>
  );
}

/** The sample loop laid on contours and tipped back, like the flyover camera. */
function FlyArt() {
  return (
    <svg viewBox={VIEW} className="h-full w-full" aria-hidden>
      <rect width="160" height="96" fill="#0b0f12" />
      <g transform="translate(80 54) scale(0.36 0.21) rotate(-16) translate(-200 -150)">
        {[90, 140, 190, 240, 290].map((r) => (
          <ellipse key={r} cx="200" cy="150" rx={r * 1.3} ry={r} fill="none" stroke="#fff" strokeOpacity="0.08" strokeWidth="3" />
        ))}
        <path d={ROUTE} fill="#16304a" fillOpacity="0.6" />
        <path d={ROUTE} pathLength={1} fill="none" stroke="#ff5a1f" strokeOpacity="0.35" strokeWidth="22" strokeLinejoin="round" className="rv-draw" style={at(0.1, 1.6)} />
        <path d={ROUTE} pathLength={1} fill="none" stroke="#ff5a1f" strokeWidth="9" strokeLinejoin="round" className="rv-draw" style={at(0.1, 1.6)} />
      </g>
      <circle cx="52" cy="58" r="3.2" fill="#ff5a1f" stroke="#fff" strokeWidth="1.5" className="rv-pop" style={at(1.5, 0.45)} />
      <rect x="0" y="0" width="160" height="22" fill="url(#fa-haze)" />
      <defs>
        <linearGradient id="fa-haze" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b0f12" />
          <stop offset="1" stopColor="#0b0f12" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** A 9:16 video frame (route, stats, progress) in front of a 16:9 one. */
function ExportArt() {
  return (
    <svg viewBox={VIEW} className="h-full w-full" aria-hidden>
      <rect x="30" y="24" width="100" height="56" rx="5" fill="none" strokeWidth="1.25" strokeDasharray="3 3" className="stroke-line" />
      <rect x="62" y="8" width="36" height="80" rx="6" fill="#0b0f12" />
      <g transform="translate(80 38) scale(0.075) translate(-200 -150)">
        <path d={ROUTE} pathLength={1} fill="none" stroke="#ff5a1f" strokeWidth="26" strokeLinejoin="round" className="rv-draw" style={at(0.1, 1.2)} />
      </g>
      {[
        [67, 9],
        [78, 7],
        [87, 6],
      ].map(([x, w], k) => (
        <rect key={x} x={x} y="62" width={w} height="4" rx="1" fill="#fff" fillOpacity="0.85" className="rv-rise" style={at(0.7 + k * 0.1, 0.5)} />
      ))}
      <rect x="67" y="72" width="26" height="2" rx="1" fill="#fff" fillOpacity="0.2" />
      <rect x="67" y="72" width="17" height="2" rx="1" fill="#ff5a1f" className="rv-grow-x" style={at(0.9, 1.4)} />
    </svg>
  );
}

export const FEATURE_ART = { check: CheckArt, analyze: AnalyzeArt, fly: FlyArt, export: ExportArt };
