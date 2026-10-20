// Bridges: where a combined day hands over from one activity to the next. The flyover doesn't
// trace anything there (no line, no marker); the camera flies from the last point shown of one
// activity to the first point shown of the next. Privacy circles around those finishes and
// starts are skipped the same way, so the hand-off never passes through them.

import type { Privacy } from "./privacy";

export interface Bridge {
  /** Last sample shown before the hand-off. */
  from: number;
  /** First sample shown after it. */
  to: number;
}

/**
 * One bridge per break (the first sample of each later activity), from the last visible sample
 * before it to the first visible sample from it on, within the range the flyover plays. Breaks
 * whose bridges touch (an activity hidden entirely by the privacy circles) share one bridge.
 */
export function computeBridges(breaks: readonly number[], privacy: Privacy): Bridge[] {
  const { visible, from, to } = privacy;
  if (privacy.empty) return [];
  const out: Bridge[] = [];
  for (const b of [...breaks].sort((x, y) => x - y)) {
    if (b <= from || b > to) continue;
    let a = b - 1;
    while (a > from && !visible[a]) a--;
    let c = b;
    while (c < to && !visible[c]) c++;
    const prev = out[out.length - 1];
    if (prev && a <= prev.to) prev.to = Math.max(prev.to, c);
    else out.push({ from: a, to: c });
  }
  return out;
}

/** Sample indices where a combined activity's later parts start, after the start/end trim. */
export function partBreaks(parts: readonly { startIndex: number }[] | undefined, offset: number, n: number): number[] {
  return (parts ?? []).map((p) => p.startIndex - offset).filter((b) => b > 0 && b < n);
}
