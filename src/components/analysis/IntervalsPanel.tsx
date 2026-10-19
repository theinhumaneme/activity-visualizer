import type { Block, Intervals, Rep } from "../../lib/analysis/intervals";
import type { Analysis } from "../../lib/analysis/types";
import { formatDuration, unitLabel, usesPace } from "../../lib/format/format";
import { Card, Help, Tag } from "../ui";
import { consistencyLabel, timelineSpans } from "./math";
import { formatShortDistance, formatSplitMotion } from "./units";
import { useStretch } from "./stretch";

const BLOCK_NAME: Record<Block["kind"], string> = { warmup: "Warm-up", work: "Rep", recovery: "Recovery", cooldown: "Cool-down" };
const BLOCK_CLASS: Record<Block["kind"], string> = {
  warmup: "bg-line/70",
  work: "bg-accent",
  recovery: "bg-ink-2/30",
  cooldown: "bg-line/70",
};

/** Under 10:00 /km (≈ 1.67 m/s) a recovery is a jog; slower is a walk. */
const WALK_PACE = 600;

function recoveryWord(a: Analysis, pace: number, next?: Block) {
  if (next?.kind === "cooldown") return "cool-down";
  if (!usesPace(a.activity.kind)) return "easy";
  return Number.isFinite(pace) && pace < WALK_PACE ? "jog" : "walk";
}

/** Timeline of warm-up, reps, recoveries and cool-down, sized by time. Hover a block to find it. */
function Timeline({ a, iv }: { a: Analysis; iv: Intervals }) {
  const stretch = useStretch();
  const spans = timelineSpans(iv.blocks, a.t);
  let rep = 0;
  return (
    <div className="relative mt-1 h-7 w-full overflow-hidden rounded-md bg-page" role="img" aria-label="Session structure over time">
      {iv.blocks.map((b, k) => {
        const n = b.kind === "work" ? ++rep : 0;
        const label = b.kind === "work" ? `Rep ${n}` : BLOCK_NAME[b.kind];
        return (
          <div
            key={b.startIdx}
            className={`absolute cursor-pointer border-r border-surface ${BLOCK_CLASS[b.kind]} ${b.kind === "work" ? "inset-y-0" : "inset-y-1.5"} hover:brightness-125`}
            style={{ left: `${spans[k].start * 100}%`, width: `${spans[k].width * 100}%` }}
            {...stretch({ from: b.startIdx, to: b.endIdx, label })}
            title={`${label} · ${formatDuration(a.t[b.endIdx] - a.t[b.startIdx])} · click to watch in 3D`}
          >
            {b.kind === "work" && spans[k].width > 0.04 && (
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-white tabular">{n}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RepCard({ a, iv, rep, fastest, next }: { a: Analysis; iv: Intervals; rep: Rep; fastest: boolean; next?: Block }) {
  const stretch = useStretch();
  const r = rep.recovery;
  const drop = r?.hrFrom !== undefined && r?.hrTo !== undefined ? r.hrFrom - r.hrTo : undefined;
  const mean = iv.reps.reduce((x, y) => x + y.pace, 0) / iv.reps.length;
  const u = a.settings.units;
  const perUnit = (secPerKm: number) => (u === "metric" ? secPerKm : secPerKm * 1.609344);
  const vsMean = Math.round(perUnit(rep.pace - mean));
  const pace = usesPace(a.activity.kind);
  const label = `Rep ${rep.n} of ${iv.reps.length}`;

  return (
    <li
      tabIndex={0}
      className={`cursor-pointer rounded-xl border p-3 outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 ${fastest ? "border-accent/60" : "border-grid"}`}
      {...stretch({ from: rep.startIdx, to: rep.endIdx, label })}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-label font-medium text-muted">{label}</span>
        {fastest && <Tag tone="accent">Fastest</Tag>}
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="tabular text-xl font-semibold">{formatSplitMotion(rep.pace, a)}</span>
        {pace && vsMean !== 0 && (
          <span className="text-xs text-muted tabular" title="Compared with your average rep pace">
            {vsMean < 0 ? "−" : "+"}
            {Math.abs(vsMean)} s vs avg
          </span>
        )}
      </div>
      <div className="mt-0.5 text-sm text-ink-2 tabular">
        {formatDuration(rep.duration)} · {formatShortDistance(rep.distance, a)}
        {rep.peakHr !== undefined && ` · peak ${Math.round(rep.peakHr)} bpm`}
      </div>
      {r ? (
        <div className="mt-2 border-t border-grid pt-2 text-xs text-ink-2 tabular">
          <span className="text-muted">Then</span> {formatDuration(r.duration)} {recoveryWord(a, r.pace, next)}
          {drop !== undefined && (
            <>
              {" · "}HR {Math.round(r.hrFrom!)} → {Math.round(r.hrTo!)} in {Math.round(r.window)} s
              {drop > 0 && <span className="text-good"> (−{Math.round(drop)})</span>}
            </>
          )}
        </div>
      ) : (
        <div className="mt-2 border-t border-grid pt-2 text-xs text-muted">Last rep</div>
      )}
    </li>
  );
}

/**
 * Interval session breakdown: a structure strip, then one card per rep with its pace, HR peak
 * and how fast HR came down in the recovery. Recoveries are part of the plan, so they're
 * described, not judged.
 */
export function IntervalsPanel({ a, iv }: { a: Analysis; iv: Intervals }) {
  const fastest = iv.reps.reduce((x, y) => (y.pace < x.pace ? y : x));
  const cv = iv.paceCv;
  const nextBlock = (rep: Rep) => iv.blocks.find((b) => b.startIdx >= rep.endIdx && b.kind !== "work");
  const drops = iv.reps
    .map((r) => (r.recovery?.hrFrom !== undefined && r.recovery.hrTo !== undefined ? r.recovery.hrFrom - r.recovery.hrTo : NaN))
    .filter(Number.isFinite);
  const avgDrop = drops.length ? drops.reduce((x, y) => x + y, 0) / drops.length : undefined;

  return (
    <Card
      title={`Intervals · ${iv.reps.length} reps`}
      aside={<span className="text-xs">{iv.source === "laps" ? "from your device laps" : "detected from pace changes"}</span>}
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <div>
          <div className="text-label font-medium text-muted">Consistency</div>
          <div className="tabular text-lg font-semibold">
            {(cv * 100).toFixed(1)}% <span className="text-sm font-medium text-ink-2">{consistencyLabel(cv)}</span>
          </div>
        </div>
        <div>
          <div className="text-label font-medium text-muted">Typical rep</div>
          <div className="tabular text-lg font-semibold">{formatDuration(iv.repDuration)}</div>
        </div>
        {avgDrop !== undefined && (
          <div>
            <div className="text-label font-medium text-muted">HR recovery</div>
            <div className="tabular text-lg font-semibold">
              −{Math.round(avgDrop)} <span className="text-sm font-medium text-ink-2">bpm avg</span>
            </div>
          </div>
        )}
      </div>
      <div className="mt-4">
        <Timeline a={a} iv={iv} />
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-sm bg-accent" aria-hidden />
            rep
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-sm bg-ink-2/30" aria-hidden />
            recovery
          </span>
          {iv.blocks.some((b) => b.kind === "warmup" || b.kind === "cooldown") && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-sm bg-line/70" aria-hidden />
              warm-up / cool-down
            </span>
          )}
        </div>
      </div>
      <ul className="mt-4 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 xl:grid-cols-3">
        {iv.reps.map((rep) => (
          <RepCard key={rep.n} a={a} iv={iv} rep={rep} fastest={rep === fastest} next={nextBlock(rep)} />
        ))}
      </ul>
      <Help label="How reps are measured">
        <p>
          Consistency is how much your rep {usesPace(a.activity.kind) ? "pace" : "speed"} varied (coefficient of variation): under 3% is very even, and anything
          under 6% is a well-judged set. Paces are per {unitLabel(a.settings.units)} over each whole rep. HR recovery is the drop in the first minute after each
          rep. Hover a rep to see it on the map and charts.
        </p>
      </Help>
    </Card>
  );
}
