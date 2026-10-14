import type { Sample } from "../parse/types";
import { fillGaps, median, smoothByDistance } from "./series";
import type { ElevationSource } from "./types";

/** Median gap (m) between file altitude and terrain beyond which we trust the terrain model. */
const MAX_FILE_OFFSET = 15;

/** Half-width of the elevation smoothing window, meters of distance (a 40 m window). */
export const ELEV_SMOOTH_HALF = 20;

/**
 * Chooses between the file's altitude and terrain-model elevation, then smooths it.
 * Some devices (e.g. this Google Health export) write altitude that's tens of meters off or below sea level.
 */
export function resolveElevation(samples: Sample[], dem: Float64Array | null, dist: Float64Array) {
  const n = samples.length;
  const file = Float64Array.from(samples, (s) => (s.alt === undefined ? NaN : s.alt));
  const fileCount = file.reduce((c, v) => c + (Number.isNaN(v) ? 0 : 1), 0);
  const hasFile = fileCount / n > 0.8;
  const demCount = dem ? dem.reduce((c, v) => c + (Number.isNaN(v) ? 0 : 1), 0) : 0;
  const hasDem = !!dem && demCount / n > 0.8;

  let source: ElevationSource = "none";
  let raw: Float64Array | null = null;
  let fileOffset: number | undefined;

  if (hasDem && hasFile) {
    const diffs: number[] = [];
    for (let i = 0; i < n; i++) if (!Number.isNaN(file[i]) && !Number.isNaN(dem![i])) diffs.push(file[i] - dem![i]);
    fileOffset = median(diffs);
    const agrees = Math.abs(fileOffset) <= MAX_FILE_OFFSET;
    source = agrees ? "file" : "terrain";
    raw = agrees ? file : dem;
  } else if (hasDem) {
    source = "terrain";
    raw = dem;
  } else if (hasFile) {
    source = "file-unverified";
    raw = file;
  }

  return { source, fileOffset, elev: raw ? smoothByDistance(dist, fillGaps(raw), ELEV_SMOOTH_HALF) : null };
}
