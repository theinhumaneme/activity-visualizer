import { haversine } from "../geo/geo";
import type { Track } from "./types";

/**
 * Same rule as analysis/privacy.ts `computePrivacy`: anything within `radius` of the recording's
 * first or last fix is hidden. The track's first and last points are those fixes, so this can
 * also test points between kept vertices (densified heatmap points, ghost runner positions).
 */
export function privacyTest(track: Track, radius: number): (lon: number, lat: number) => boolean {
  const n = track.lon.length;
  const sLat = track.lat[0], sLon = track.lon[0];
  const eLat = track.lat[n - 1], eLon = track.lon[n - 1];
  if (radius <= 0) return () => true;
  return (lon, lat) => haversine(sLat, sLon, lat, lon) >= radius && haversine(eLat, eLon, lat, lon) >= radius;
}

/** visible[i] for each kept track point. */
export function trackVisibility(track: Track, radius: number): Uint8Array {
  const ok = privacyTest(track, radius);
  return Uint8Array.from(track.lon, (lon, i) => (ok(lon, track.lat[i]) ? 1 : 0));
}
