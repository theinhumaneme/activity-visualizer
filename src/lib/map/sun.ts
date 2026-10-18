// Real sun lighting: where the sun was at the activity's place and time (computed on the device,
// the usual low-precision solar position, good to a fraction of a degree), applied to the map's
// terrain shading and 3D-building light.

import type { Map as MlMap } from "maplibre-gl";
import { type Weather, weatherAt } from "../weather";

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

// --- Sky and haze ---------------------------------------------------------------------------------

export type Haze = "auto" | "clear" | "light" | "heavy";
export const HAZES: Haze[] = ["auto", "clear", "light", "heavy"];

/** Sky over real imagery by sun altitude: night → twilight → sunset glow → low sun → day. */
const SKY_KEYS = [
  { alt: -18, sky: [5, 8, 15], horizon: [18, 26, 44], fog: [12, 18, 32], bright: 0.4, sat: -0.35 },
  { alt: -8, sky: [22, 32, 74], horizon: [91, 79, 122], fog: [44, 51, 88], bright: 0.58, sat: -0.2 },
  { alt: -2, sky: [61, 79, 138], horizon: [228, 138, 90], fog: [167, 117, 102], bright: 0.74, sat: -0.05 },
  { alt: 4, sky: [93, 127, 184], horizon: [244, 178, 122], fog: [217, 169, 133], bright: 0.88, sat: 0 },
  { alt: 15, sky: [111, 159, 216], horizon: [240, 217, 184], fog: [216, 210, 196], bright: 0.97, sat: 0 },
  { alt: 35, sky: [106, 166, 228], horizon: [219, 232, 243], fog: [203, 216, 228], bright: 1, sat: 0 },
];

const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
const rgb = (c: number[]) => `rgb(${c.map((v) => Math.round(v)).join(",")})`;

function skyAt(altitude: number) {
  const k = SKY_KEYS;
  if (altitude <= k[0].alt) return k[0];
  for (let i = 1; i < k.length; i++) {
    if (altitude <= k[i].alt) {
      const t = (altitude - k[i - 1].alt) / (k[i].alt - k[i - 1].alt);
      return {
        alt: altitude,
        sky: mix(k[i - 1].sky, k[i].sky, t),
        horizon: mix(k[i - 1].horizon, k[i].horizon, t),
        fog: mix(k[i - 1].fog, k[i].fog, t),
        bright: k[i - 1].bright + (k[i].bright - k[i - 1].bright) * t,
        sat: k[i - 1].sat + (k[i].sat - k[i - 1].sat) * t,
      };
    }
  }
  return k[k.length - 1];
}

/** What a map's look started with, so the real sky can be switched off again. */
export interface AtmosphereBase {
  sky: Record<string, unknown>;
  raster: { bright: unknown; sat: unknown } | null;
  /** 3D building color (hex), dimmed with the light. */
  buildings: string | null;
}

export function captureAtmosphere(map: MlMap): AtmosphereBase {
  const sky = { ...((map.getSky() as Record<string, unknown> | undefined) ?? {}) };
  const raster = map.getLayer("satellite")
    ? { bright: map.getPaintProperty("satellite", "raster-brightness-max"), sat: map.getPaintProperty("satellite", "raster-saturation") }
    : null;
  const b = map.getLayer("buildings-3d") ? map.getPaintProperty("buildings-3d", "fill-extrusion-color") : null;
  return { sky, raster, buildings: typeof b === "string" && /^#[0-9a-f]{6}$/i.test(b) ? b : null };
}

/** Weather words that change the air: fog, precipitation, cloud. */
function weatherAir(w: { code: number; humidity: number } | null) {
  if (!w) return { grey: 0, haze: null as Exclude<Haze, "auto"> | null };
  const c = w.code;
  if (c === 45 || c === 48) return { grey: 0.6, haze: "heavy" as const };
  if (c >= 51) return { grey: 0.65, haze: "light" as const };
  if (c === 3) return { grey: 0.5, haze: w.humidity >= 90 ? ("light" as const) : null };
  return { grey: c === 2 ? 0.15 : 0, haze: w.humidity >= 92 ? ("light" as const) : null };
}

const HAZE_BLEND: Record<Exclude<Haze, "auto">, { ground: number; horizon: number }> = {
  clear: { ground: 0.97, horizon: 0.9 },
  light: { ground: 0.62, horizon: 0.55 },
  heavy: { ground: 0.28, horizon: 0.25 },
};

/**
 * The sky and air for the activity's moment. On real imagery (the Satellite look) with the real
 * sun on, the sky, horizon glow and imagery brightness follow the sun's altitude, greyed when
 * the weather was overcast or wet. Haze works on every look: Auto takes fog or rain from the
 * weather when it's on, and otherwise keeps the look's own.
 */
export function applyAtmosphere(
  map: MlMap,
  base: AtmosphereBase,
  o: { realSky: boolean; sun: { altitude: number } | null; weather: { code: number; humidity: number } | null; haze: Haze },
) {
  const air = weatherAir(o.weather);
  const sky: Record<string, unknown> = { ...base.sky };
  if (o.realSky && o.sun && base.raster) {
    const s = skyAt(o.sun.altitude);
    // Overcast: toward a grey of the same lightness.
    const grey = (c: number[]) => {
      const l = (c[0] + c[1] + c[2]) / 3;
      return mix(c, [l, l, l * 1.03], air.grey);
    };
    sky["sky-color"] = rgb(grey(s.sky));
    sky["horizon-color"] = rgb(grey(s.horizon));
    sky["fog-color"] = rgb(grey(s.fog));
    map.setPaintProperty("satellite", "raster-brightness-max", s.bright * (1 - 0.12 * air.grey));
    map.setPaintProperty("satellite", "raster-saturation", s.sat - 0.25 * air.grey);
    if (base.buildings) {
      const hex = base.buildings;
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) * s.bright * (1 - 0.12 * air.grey));
      map.setPaintProperty("buildings-3d", "fill-extrusion-color", rgb(c));
    }
  } else if (base.raster) {
    if (base.buildings) map.setPaintProperty("buildings-3d", "fill-extrusion-color", base.buildings);
    map.setPaintProperty("satellite", "raster-brightness-max", base.raster.bright as number | undefined);
    map.setPaintProperty("satellite", "raster-saturation", base.raster.sat as number | undefined);
  }
  const haze = o.haze === "auto" ? air.haze : o.haze;
  if (haze) {
    sky["fog-ground-blend"] = HAZE_BLEND[haze].ground;
    sky["horizon-fog-blend"] = HAZE_BLEND[haze].horizon;
  }
  map.setSky(sky as Parameters<MlMap["setSky"]>[0]);
}

/** The weather at the middle of the activity, for the sky. */
export function activityAir(samples: { time: number }[], w: Weather | null) {
  if (!w || samples.length < 2) return null;
  return weatherAt(w, (samples[0].time + samples[samples.length - 1].time) / 2);
}
