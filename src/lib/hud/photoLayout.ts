// Auto layout for photo stops: one to four photos, whole, filling as much of the frame as they can.

export type Rect = { x: number; y: number; w: number; h: number };

/** Every order of the items (at most 4! = 24 here). */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((x, k) => permutations([...items.slice(0, k), ...items.slice(k + 1)]).map((rest) => [x, ...rest]));
}

/**
 * Auto layout: photos whole (never cropped) in justified rows or columns, choosing the order and
 * grouping that fills the most of the box. Rows suit wide frames and landscape photos, columns
 * tall frames and portrait photos; the search picks whichever covers more.
 */
export function photoLayout(aspects: number[], box: Rect, gap: number): Rect[] {
  const n = aspects.length;
  let best: { area: number; rects: Rect[] } | null = null;
  const order = aspects.map((_, k) => k);
  for (const perm of permutations(order)) {
    // Each way to cut the sequence into consecutive groups (rows or columns).
    for (let mask = 0; mask < 1 << (n - 1); mask++) {
      const groups: number[][] = [[perm[0]]];
      for (let k = 1; k < n; k++) {
        if (mask & (1 << (k - 1))) groups.push([perm[k]]);
        else groups[groups.length - 1].push(perm[k]);
      }
      for (const rows of [true, false]) {
        // Work in rows; columns are rows of the transposed box with inverted aspects.
        const W = rows ? box.w : box.h;
        const H = rows ? box.h : box.w;
        const asp = (k: number) => (rows ? aspects[k] : 1 / aspects[k]);
        const sums = groups.map((g) => g.reduce((t, k) => t + asp(k), 0));
        const total = (w: number) => groups.reduce((t, g, r) => t + (w - gap * (g.length - 1)) / sums[r], 0) + gap * (groups.length - 1);
        let w = W;
        if (total(W) > H) w = (H - gap * (groups.length - 1) + groups.reduce((t, g, r) => t + (gap * (g.length - 1)) / sums[r], 0)) / sums.reduce((t, x) => t + 1 / x, 0);
        if (w <= 0) continue;
        const height = total(w);
        const out: Rect[] = new Array(n);
        let y = (H - height) / 2;
        let area = 0;
        groups.forEach((g, r) => {
          const h = (w - gap * (g.length - 1)) / sums[r];
          let x = (W - w) / 2;
          for (const k of g) {
            const cw = h * asp(k);
            out[k] = rows ? { x: box.x + x, y: box.y + y, w: cw, h } : { x: box.x + y, y: box.y + x, w: h, h: cw };
            area += cw * h;
            x += cw + gap;
          }
          y += h + gap;
        });
        if (!best || area > best.area * 1.0001) best = { area, rects: out };
      }
    }
  }
  return best!.rects;
}
