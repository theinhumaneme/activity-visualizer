// Scenes for the homepage's "Read your training" section, in the same chart vocabulary as the app
// (series colors, dashed GAP, zone-free lines). Each acts out its number once when it scrolls into
// view (see useReveal); without motion they're simply the finished chart.

import type { CSSProperties } from "react";

const VIEW = "0 0 160 96";
const at = (s: number, dur?: number) => ({ "--rv-delay": `${s}s`, ...(dur ? { "--rv-dur": `${dur}s` } : {}) }) as CSSProperties;
const line = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}`;

// --- Fitness, fatigue and form -------------------------------------------------------------------

/**
 * Twelve weeks of training, then a taper: daily load by weekday (a long run on Sundays), building
 * week on week, run through the same 42- and 7-day averages the library uses.
 */
const DAYS = 84;
const SERIES = (() => {
  const week = [55, 0, 85, 60, 0, 45, 130];
  let fitness = 22;
  let fatigue = 18;
  return Array.from({ length: DAYS }, (_, d) => {
    const taper = d >= 77 ? 0.5 : 1;
    const load = week[d % 7] * (0.85 + Math.floor(d / 7) * 0.035) * taper;
    const form = fitness - fatigue;
    fitness += (load - fitness) / 42;
    fatigue += (load - fatigue) / 7;
    return { fitness, fatigue, form };
  });
})();
export const FITNESS_NOW = SERIES[DAYS - 1];

const FW = 600;
const FH = 220;
const LO = -30;
const HI = 75;
const fx = (d: number) => 36 + (d / (DAYS - 1)) * (FW - 50);
const fy = (v: number) => 14 + ((HI - v) / (HI - LO)) * (FH - 34);

/** The library's Progress chart in miniature: fitness and fatigue lines, form as bars off zero. */
export function FitnessArt() {
  const zero = fy(0);
  const bw = ((FW - 50) / DAYS) * 0.62;
  return (
    <svg viewBox={`0 0 ${FW} ${FH}`} className="h-full w-full" aria-hidden>
      {[-30, 0, 30, 60].map((v) => (
        <g key={v}>
          <path d={`M36 ${fy(v)}H${FW - 10}`} strokeWidth="1" className={v === 0 ? "stroke-line" : "stroke-grid"} />
          <text x="28" y={fy(v)} dy="0.32em" textAnchor="end" fontSize="15" className="fill-muted tabular">
            {v}
          </text>
        </g>
      ))}
      {SERIES.map((s, d) => {
        const y = fy(s.form);
        return (
          <rect
            key={d}
            x={fx(d) - bw / 2}
            y={Math.min(y, zero)}
            width={bw}
            height={Math.abs(y - zero)}
            rx="1"
            className={`${s.form >= 0 ? "rv-grow fill-good/45" : "rv-grow-down fill-warning/40"}`}
            style={at(0.25 + d * 0.014, 0.5)}
          />
        );
      })}
      <path
        d={line(SERIES.map((s, d) => [fx(d), fy(s.fatigue)]))}
        pathLength={1}
        fill="none"
        strokeWidth="1.75"
        strokeLinejoin="round"
        className="rv-draw stroke-series-hr"
        style={at(0.1, 1.6)}
      />
      <path
        d={line(SERIES.map((s, d) => [fx(d), fy(s.fitness)]))}
        pathLength={1}
        fill="none"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="rv-draw stroke-series-pace"
        style={at(0.2, 1.6)}
      />
      <circle cx={fx(DAYS - 1)} cy={fy(FITNESS_NOW.fitness)} r="5" strokeWidth="2.5" className="rv-pop fill-series-pace stroke-surface" style={at(1.6, 0.45)} />
      {["12 weeks ago", "race day"].map((t, k) => (
        <text key={t} x={k ? FW - 10 : 36} y={FH - 3} textAnchor={k ? "end" : "start"} fontSize="15" className="fill-muted">
          {t}
        </text>
      ))}
    </svg>
  );
}

// --- Hills ---------------------------------------------------------------------------------------

/** Elevation with a climb bracketed, pace dipping on it and GAP (dashed) holding level. */
export function HillsArt() {
  const elev: [number, number][] = [];
  const pace: [number, number][] = [];
  const gap: [number, number][] = [];
  for (let x = 8; x <= 152; x += 4) {
    const climb = Math.max(0, Math.min(1, (x - 52) / 56));
    const down = Math.max(0, Math.min(1, (x - 116) / 30));
    const h = 78 - 34 * climb + 26 * down - (x > 108 && x < 118 ? 1.5 : 0);
    elev.push([x, h]);
    const steep = x > 52 && x < 108 ? 1 : 0;
    const wob = Math.sin(x * 0.45) * 1.4;
    pace.push([x, 13 + steep * 9 - (x > 116 ? 3 : 0) + wob]);
    gap.push([x, 12 + wob * 0.6]);
  }
  const area = `${line(elev)}L152 90L8 90Z`;
  return (
    <svg viewBox={VIEW} className="h-full w-full" aria-hidden>
      <path d={area} className="rv-wipe fill-series-elev/20" style={at(0, 1.1)} />
      <path d={line(elev)} pathLength={1} fill="none" strokeWidth="1.75" strokeLinejoin="round" className="rv-draw stroke-series-elev" style={at(0, 1.1)} />
      <g className="rv-rise" style={at(1, 0.5)}>
        <path d="M52 74V40H108V42" fill="none" strokeWidth="0.9" strokeDasharray="2 2" className="stroke-ink-2" />
        <text x="80" y="36.5" textAnchor="middle" fontSize="7.5" fontWeight="600" className="fill-ink tabular">
          +86 m · 910 m/h
        </text>
      </g>
      <path d={line(pace)} pathLength={1} fill="none" strokeWidth="1.75" strokeLinejoin="round" className="rv-draw stroke-series-pace" style={at(0.35, 1.2)} />
      <path d={line(gap)} fill="none" strokeWidth="1.4" strokeDasharray="4 2.5" className="rv-wipe stroke-series-pace/70" style={at(0.55, 1.2)} />
    </svg>
  );
}

// --- Heart ---------------------------------------------------------------------------------------

/** Distance per heartbeat sagging through a run, then heart rate falling once you stop. */
export function HeartArt() {
  const drift: [number, number][] = [];
  for (let x = 10; x <= 112; x += 3) drift.push([x, 32 + ((x - 10) / 102) * 12 + Math.sin(x * 0.5) * 2.2]);
  const drop: [number, number][] = [];
  for (let x = 120; x <= 150; x += 2) {
    const k = (x - 120) / 30;
    drop.push([x, 26 + 38 * (1 - Math.exp(-2.4 * k)) + Math.sin(x) * 0.6]);
  }
  return (
    <svg viewBox={VIEW} className="h-full w-full" aria-hidden>
      <path d="M10 32H112" strokeWidth="1" strokeDasharray="2 3" className="stroke-muted" />
      <path d={line(drift)} pathLength={1} fill="none" strokeWidth="1.9" strokeLinejoin="round" className="rv-draw stroke-series-hr" style={at(0, 1.2)} />
      <text x="12" y="62" fontSize="7.5" fontWeight="600" className="rv-rise fill-ink-2 tabular" style={at(1, 0.5)}>
        drift +4.2%
      </text>
      <path d="M116 14V84" strokeWidth="1" className="stroke-grid" />
      <text x="118" y="88" fontSize="6.5" className="fill-muted">
        stop
      </text>
      <path d={line(drop)} pathLength={1} fill="none" strokeWidth="1.9" strokeLinecap="round" className="rv-draw stroke-series-hr" style={at(1.15, 0.9)} />
      <circle cx="150" cy={drop[drop.length - 1][1]} r="2.6" className="rv-pop fill-series-hr" style={at(1.9, 0.4)} />
      <text x="150" y="20" textAnchor="end" fontSize="7.5" fontWeight="600" className="rv-rise fill-ink tabular" style={at(1.9, 0.5)}>
        −28 bpm
      </text>
    </svg>
  );
}

// --- Power ---------------------------------------------------------------------------------------

/** W′ balance: full, drained by surges, nearly empty on the big one, refilling between. */
export function PowerArt() {
  const pts: [number, number][] = [];
  let bal = 1;
  for (let x = 8; x <= 152; x += 1.5) {
    const surge = (x > 34 && x < 42) || (x > 70 && x < 78) || (x > 104 && x < 120);
    bal = surge ? bal - (x > 104 ? 0.05 : 0.06) : bal + (1 - bal) * 0.07;
    pts.push([x, 16 + (1 - Math.max(0.04, bal)) * 64]);
  }
  const area = `${line(pts)}L152 84L8 84Z`;
  return (
    <svg viewBox={VIEW} className="h-full w-full" aria-hidden>
      <path d="M8 16H152M8 84H152" strokeWidth="1" className="stroke-grid" />
      <path d={area} className="rv-wipe fill-series-power/25" style={at(0, 1.5)} />
      <path d={line(pts)} fill="none" strokeWidth="1.9" strokeLinejoin="round" className="rv-wipe stroke-series-power" style={at(0, 1.5)} />
      <text x="10" y="11" fontSize="7.5" fontWeight="600" className="fill-ink-2">
        W′ 20 kJ
      </text>
      <text x="150" y="11" textAnchor="end" fontSize="7.5" fontWeight="600" className="rv-rise fill-ink tabular" style={at(1.3, 0.5)}>
        3.4 W/kg
      </text>
    </svg>
  );
}

// --- Races and streaks ---------------------------------------------------------------------------

const LADDER = [
  ["5K", "22:18", 0.32],
  ["10K", "46:29", 0.46],
  ["Half", "1:42:34", 0.7],
  ["Marathon", "3:34:10", 1],
] as const;

/** Predicted times climbing from 5K to marathon, and a streak of days filling in. */
export function RacesArt() {
  return (
    <svg viewBox={VIEW} className="h-full w-full" aria-hidden>
      {LADDER.map(([label, time, w], k) => (
        <g key={label} className="rv-rise" style={at(0.1 + k * 0.12, 0.5)}>
          <text x="10" y={18 + k * 16} fontSize="7.5" className="fill-ink-2">
            {label}
          </text>
          <rect x="50" y={12 + k * 16} width={62 * w} height="7" rx="2" className="rv-grow-x fill-accent/70" style={at(0.2 + k * 0.12, 0.8)} />
          <text x="150" y={18 + k * 16} textAnchor="end" fontSize="7.5" fontWeight="600" className="fill-ink tabular">
            {time}
          </text>
        </g>
      ))}
      {Array.from({ length: 14 }, (_, k) => (
        <rect
          key={k}
          x={10 + k * 10}
          y="80"
          width="7"
          height="7"
          rx="1.5"
          className={k === 3 ? "fill-surface-3" : "rv-pop fill-good"}
          style={at(0.7 + k * 0.05, 0.35)}
        />
      ))}
    </svg>
  );
}

export const METRIC_ART = { hills: HillsArt, heart: HeartArt, power: PowerArt, races: RacesArt };
