import type { ReactNode } from "react";
import type { Analysis } from "../../lib/analysis/types";
import { formatDateTime, formatDistance, formatDuration, formatElevation, formatPace, formatUtcOffset, motionLabel, usesPace } from "../../lib/format/format";
import { formatSplitMotion, splitUnit } from "./units";

/** Start time in the activity's own local time, with the offset when the file records it. */
export function startLine(a: Analysis): string {
  const { startTime, utcOffsetMin } = a.activity;
  return `${formatDateTime(startTime, utcOffsetMin)}${utcOffsetMin !== undefined ? ` (${formatUtcOffset(utcOffsetMin)})` : ""}`;
}

function Metric({ label, value, sub, size }: { label: string; value: string; sub?: ReactNode; size: "lg" | "md" | "sm" }) {
  const [num, unit] = splitUnit(value);
  const text = size === "lg" ? "text-[1.875rem] sm:text-[2.5rem]" : size === "md" ? "text-[1.375rem]" : "text-lg";
  return (
    <div className="min-w-0">
      <div className="text-label font-medium text-muted">{label}</div>
      <div className={`num mt-0.5 truncate leading-[1.1] ${text}`}>
        {num}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-label leading-snug text-ink-2 tabular">{sub}</div>}
    </div>
  );
}

/**
 * The headline numbers, straight from the data: nothing estimated or invented (calories only
 * when the file has them). Distance, moving time and pace lead; heart rate, elevation and the
 * rest sit in a quieter row. Route-only files get distance and elevation alone. `strip` is the
 * compact one-row version for pages that already showed the full summary.
 */
export function SummaryHeader({ a, showName = true, variant = "hero" }: { a: Analysis; showName?: boolean; variant?: "hero" | "strip" }) {
  const s = a.summary;
  const u = a.settings.units;
  const kind = a.activity.kind;
  const routeOnly = a.activity.routeOnly;
  const pace = usesPace(kind);
  const elevRange =
    s.elevMin !== undefined && s.elevMax !== undefined
      ? `range ${Math.round(u === "metric" ? s.elevMin : s.elevMin * 3.28084)}–${formatElevation(s.elevMax, u)}`
      : undefined;

  const primary: { label: string; value: string; sub?: string }[] = [{ label: "Distance", value: formatDistance(s.distance, u) }];
  if (!routeOnly) {
    primary.push({
      label: "Moving time",
      value: formatDuration(s.moving),
      sub: `${formatDuration(s.elapsed)} elapsed${s.stoppedTime >= 1 ? ` · ${formatDuration(s.stoppedTime)} stopped` : ""}`,
    });
    primary.push({
      label: `Avg ${motionLabel(kind).toLowerCase()}`,
      value: formatSplitMotion(s.avgPace, a),
      sub: s.gapPace !== undefined ? `GAP ${formatPace(s.gapPace, u)}` : pace ? `best ${formatPace(s.bestPace, u)}` : undefined,
    });
  }
  const secondary: { label: string; value: string; sub?: string }[] = [];
  if (s.avgHr !== undefined)
    secondary.push({ label: "Avg heart rate", value: `${Math.round(s.avgHr)} bpm`, sub: s.maxHr !== undefined ? `max ${Math.round(s.maxHr)}` : undefined });
  if (s.elevGain !== undefined)
    secondary.push({ label: "Elevation gain", value: `+${formatElevation(s.elevGain, u)}`, sub: `−${formatElevation(s.elevLoss ?? 0, u)} loss` });
  if (s.calories !== undefined) secondary.push({ label: "Calories", value: s.calories.toLocaleString(), sub: "from your device" });
  if (!routeOnly && pace && s.gapPace !== undefined) secondary.push({ label: "Best pace", value: formatPace(s.bestPace, u), sub: "over 30 s" });

  if (variant === "strip") {
    return (
      <section aria-label="Summary" className="rounded-card border border-grid bg-surface px-4 py-3 sm:px-5">
        <div className="no-scrollbar -mx-1 flex gap-x-1 overflow-x-auto">
          {[...primary, ...secondary].map((m, k) => (
            <div key={m.label} className={`shrink-0 px-3 py-1 ${k ? "border-l border-grid" : ""}`}>
              <Metric label={m.label} value={m.value} size={k < primary.length ? "md" : "sm"} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-card border border-grid bg-surface p-5 shadow-[var(--shadow-raised)] sm:p-6" aria-label="Summary">
      {showName && (
        <div className="mb-5">
          <h2 className="text-[1.75rem] font-bold leading-tight tracking-[-0.025em]">{a.settings.name}</h2>
          <p className="mt-1 text-sm text-ink-2">
            {startLine(a)} · {a.activity.sport}
            {a.activity.device ? ` · ${a.activity.device}` : ""}
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 min-[480px]:grid-cols-3">
        {primary.map((m) => (
          <Metric key={m.label} {...m} size="lg" />
        ))}
      </div>
      {secondary.length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-y-4 border-t border-grid pt-4 sm:flex sm:flex-wrap">
          {secondary.map((m) => (
            <div key={m.label} className="min-w-0 pr-4 sm:border-r sm:border-grid sm:px-5 sm:first:pl-0 sm:last:border-0">
              <Metric {...m} size="sm" />
            </div>
          ))}
        </div>
      )}
      {(s.elevMethod || routeOnly) && (
        <p className="mt-4 text-label text-muted">
          {routeOnly && "This file is a route without timestamps, so time, pace and heart rate aren't shown. "}
          {s.elevMethod && `Elevation: ${s.elevMethod}${elevRange ? `, ${elevRange}` : ""}.`}
        </p>
      )}
    </section>
  );
}
