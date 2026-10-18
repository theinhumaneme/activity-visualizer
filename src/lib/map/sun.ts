// Real sun lighting: where the sun was at the activity's place and time (computed on the device,
// the usual low-precision solar position, good to a fraction of a degree), applied to the map's
// terrain shading and 3D-building light.

import type { Map as MlMap } from "maplibre-gl";

const RAD = Math.PI / 180;

/** Sun azimuth (degrees clockwise from north) and altitude (degrees above the horizon). */
export function sunPosition(ms: number, lat: number, lon: number): { azimuth: number; altitude: number } {
  const d = ms / 86400000 + 2440587.5 - 2451545.0; // days since J2000
  const M = (357.5291 + 0.98560028 * d) * RAD; // mean anomaly
  const C = (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) * RAD;
  const L = M + C + 102.9372 * RAD + Math.PI; // ecliptic longitude
  const e = 23.4397 * RAD; // obliquity
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const sidereal = (280.16 + 360.9856235 * d) * RAD - -lon * RAD;
  const H = sidereal - ra; // hour angle
  const phi = lat * RAD;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  // Azimuth measured from south, westward; converted to from north, clockwise.
  const azSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { azimuth: (((azSouth / RAD + 180) % 360) + 360) % 360, altitude: altitude / RAD };
}

/**
 * Points hillshade and 3D-building light at the sun. Below the horizon (night activities) the
 * looks keep their own lighting. Low sun casts longer, stronger shading.
 */
export function applySunLighting(map: MlMap, sun: { azimuth: number; altitude: number }) {
  if (sun.altitude < 0) return;
  for (const layer of map.getStyle().layers) {
    if (layer.type !== "hillshade") continue;
    map.setPaintProperty(layer.id, "hillshade-illumination-anchor", "map");
    map.setPaintProperty(layer.id, "hillshade-illumination-direction", sun.azimuth);
    const base = (layer.paint as { "hillshade-exaggeration"?: number } | undefined)?.["hillshade-exaggeration"];
    if (typeof base === "number") map.setPaintProperty(layer.id, "hillshade-exaggeration", Math.min(1, base * (sun.altitude < 20 ? 1.35 : sun.altitude < 45 ? 1.1 : 0.9)));
  }
  // Light for extruded buildings: polar angle from straight up, so low sun lights the walls.
  map.setLight({ anchor: "map", position: [1.15, sun.azimuth, Math.min(85, Math.max(10, 90 - sun.altitude))], intensity: 0.45 });
}

/** The sun at the middle of an activity (by time), or null for planned routes without times. */
export function activitySun(samples: { time: number; lat: number; lon: number }[], timed: boolean) {
  if (!timed || samples.length < 2) return null;
  const mid = samples[Math.floor(samples.length / 2)];
  return sunPosition((samples[0].time + samples[samples.length - 1].time) / 2, mid.lat, mid.lon);
}
