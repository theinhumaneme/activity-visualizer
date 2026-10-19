import { useMemo } from "react";
import type { Analysis } from "../../lib/analysis/types";
import { comparisons } from "../../lib/compare";
import { useStore } from "../../state/store";

/**
 * The totals on a familiar scale ("Climbed ≈ 2.4 Eiffel Towers"), with a switch to hide them.
 * The same choice puts one on the end card and poster.
 */
export function Comparisons({ a, className = "" }: { a: Analysis; className?: string }) {
  const on = useStore((s) => s.comparisons);
  const setVideoStats = useStore((s) => s.setVideoStats);
  const list = useMemo(() => comparisons(a.summary), [a.summary]);
  if (!list.length) return null;
  return (
    <section aria-label="Comparisons" className={`flex flex-wrap items-center gap-2 ${className}`}>
      {on &&
        list.map((c) => (
          <span key={c.key} className="enter inline-flex items-baseline gap-1 rounded-full border border-grid bg-surface px-3 py-1 text-sm text-ink-2">
            {c.verb} <span className="font-semibold text-ink tabular">≈ {c.value}</span> {c.thing}
          </span>
        ))}
      <button
        type="button"
        aria-pressed={on}
        onClick={() => setVideoStats({ comparisons: !on })}
        className="btn btn-quiet btn-sm text-ink-2 underline decoration-line underline-offset-4 hover:decoration-ink"
      >
        {on ? "Hide comparisons" : "Show fun comparisons"}
      </button>
    </section>
  );
}
