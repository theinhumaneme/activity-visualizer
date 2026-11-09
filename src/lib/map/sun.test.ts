import type { Map as MlMap } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { type AtmosphereBase, activitySun, applyAtmosphere, applySunLighting, sunPosition } from "./sun";

const GREENWICH = { lat: 51.4769, lon: 0 };
const utc = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

/** Highest altitude over a UTC day, minute by minute, and when it happened. */
function dayPeak(y: number, mo: number, d: number, lat: number, lon: number) {
  let best = { ms: 0, altitude: -Infinity, azimuth: 0 };
  for (let m = 0; m < 1440; m++) {
    const ms = utc(y, mo, d, 0, m);
    const p = sunPosition(ms, lat, lon);
    if (p.altitude > best.altitude) best = { ms, ...p };
  }
  return best;
}

describe("sunPosition", () => {
  it("puts the sun high in the south at noon and well below the horizon at midnight (Greenwich, June solstice)", () => {
    const noon = sunPosition(utc(2026, 6, 21, 12, 2), GREENWICH.lat, GREENWICH.lon);
    // Published (NOAA): ~61.97° at solar noon, which is ~12:02 UTC.
    expect(noon.altitude).toBeCloseTo(61.97, 0);
    expect(noon.azimuth).toBeGreaterThan(175);
    expect(noon.azimuth).toBeLessThan(185);
    const midnight = sunPosition(utc(2026, 6, 21, 0, 2), GREENWICH.lat, GREENWICH.lon);
    // 90 − 51.48 − 23.44 = 15.08° below the horizon, due north.
    expect(midnight.altitude).toBeCloseTo(-15.08, 0);
    expect(Math.min(midnight.azimuth, 360 - midnight.azimuth)).toBeLessThan(5);
  });

  it("peaks at local solar noon: later in UTC the further west you are", () => {
    // Boston, December solstice: solar noon ~16:44 UTC, peak altitude 90 − 42.36 − 23.44 ≈ 24.2°.
    const boston = dayPeak(2026, 12, 21, 42.3601, -71.0589);
    expect(boston.altitude).toBeCloseTo(24.2, 0);
    expect(Math.abs(boston.ms - utc(2026, 12, 21, 16, 44))).toBeLessThanOrEqual(3 * 60_000);
  });

  it("has the noon sun in the north in the southern hemisphere", () => {
    // Sydney, June solstice: solar noon ~01:57 UTC, peak altitude 90 − 33.87 − 23.44 ≈ 32.7°.
    const sydney = dayPeak(2026, 6, 21, -33.8688, 151.2093);
    expect(sydney.altitude).toBeCloseTo(32.7, 0);
    expect(Math.abs(sydney.ms - utc(2026, 6, 21, 1, 57))).toBeLessThanOrEqual(3 * 60_000);
    expect(Math.min(sydney.azimuth, 360 - sydney.azimuth)).toBeLessThan(2);
  });

  it("rises in the east and sets in the west at the equinox", () => {
    // Equator at 0° longitude, March equinox 2026: sunrise ~06:07, sunset ~18:14 UTC.
    const morning = sunPosition(utc(2026, 3, 20, 7), 0, 0);
    const evening = sunPosition(utc(2026, 3, 20, 17), 0, 0);
    expect(morning.altitude).toBeGreaterThan(5);
    expect(morning.altitude).toBeLessThan(20);
    expect(morning.azimuth).toBeCloseTo(90, -1);
    expect(evening.altitude).toBeGreaterThan(5);
    expect(evening.azimuth).toBeCloseTo(270, -1);
    // Azimuth is always normalized to [0, 360).
    for (let h = 0; h < 24; h++) {
      const { azimuth } = sunPosition(utc(2026, 3, 20, h), 0, 0);
      expect(azimuth).toBeGreaterThanOrEqual(0);
      expect(azimuth).toBeLessThan(360);
    }
  });
});

describe("activitySun", () => {
  const sample = (ms: number) => ({ time: ms, ...GREENWICH });

  it("uses the middle of the activity by time", () => {
    const s = [sample(utc(2026, 6, 21, 11)), sample(utc(2026, 6, 21, 12)), sample(utc(2026, 6, 21, 13, 4))];
    expect(activitySun(s, true)).toEqual(sunPosition(utc(2026, 6, 21, 12, 2), GREENWICH.lat, GREENWICH.lon));
  });

  it("is null for untimed routes and single points", () => {
    expect(activitySun([sample(0), sample(1000)], false)).toBeNull();
    expect(activitySun([sample(0)], true)).toBeNull();
  });
});

/** Just enough of a MapLibre map to record what the lighting and sky code sets. */
function fakeMap(o: { satellite?: boolean; buildings?: string; hillshade?: number } = {}) {
  const paint: Record<string, unknown> = { "satellite:raster-brightness-max": 0.9, "satellite:raster-saturation": 0.1 };
  if (o.buildings) paint["buildings-3d:fill-extrusion-color"] = o.buildings;
  const calls = { light: [] as unknown[], sky: [] as Record<string, unknown>[], paint };
  const layers = [{ id: "hs", type: "hillshade", paint: o.hillshade === undefined ? {} : { "hillshade-exaggeration": o.hillshade } }];
  const map = {
    getStyle: () => ({ layers }),
    getLayer: (id: string) => (id === "satellite" ? o.satellite : id === "buildings-3d" ? !!o.buildings : false) || undefined,
    getPaintProperty: (id: string, p: string) => paint[`${id}:${p}`],
    setPaintProperty: (id: string, p: string, v: unknown) => void (paint[`${id}:${p}`] = v),
    setLight: (l: unknown) => void calls.light.push(l),
    getSky: () => ({ "sky-color": "#88aaff" }),
    setSky: (s: Record<string, unknown>) => void calls.sky.push(s),
  };
  return { map: map as unknown as MlMap, calls };
}

describe("applySunLighting", () => {
  it("points hillshade and building light at the sun, stronger when low", () => {
    const { map, calls } = fakeMap({ hillshade: 0.5 });
    applySunLighting(map, { azimuth: 250, altitude: 10 });
    expect(calls.paint["hs:hillshade-illumination-direction"]).toBe(250);
    expect(calls.paint["hs:hillshade-illumination-anchor"]).toBe("map");
    expect(calls.paint["hs:hillshade-exaggeration"]).toBeCloseTo(0.675, 6);
    // Polar angle from straight up: 80° for a sun 10° above the horizon.
    expect(calls.light).toEqual([{ anchor: "map", position: [1.15, 250, 80], intensity: 0.45 }]);
  });

  it("clamps the light's polar angle for a sun overhead", () => {
    const { map, calls } = fakeMap();
    applySunLighting(map, { azimuth: 180, altitude: 88 });
    expect((calls.light[0] as { position: number[] }).position[2]).toBe(10);
  });

  it("leaves the look alone when the sun is below the horizon", () => {
    const { map, calls } = fakeMap({ hillshade: 0.5 });
    applySunLighting(map, { azimuth: 0, altitude: -5 });
    expect(calls.light).toEqual([]);
    expect(calls.paint["hs:hillshade-illumination-direction"]).toBeUndefined();
  });
});

describe("applyAtmosphere", () => {
  const base: AtmosphereBase = { sky: { "sky-color": "#88aaff" }, raster: { bright: 0.9, sat: 0.1 }, buildings: "#808080" };
  const lum = (rgb: unknown) => (String(rgb).match(/\d+/g) ?? []).map(Number).reduce((a, b) => a + b, 0);
  const spread = (rgb: unknown) => {
    const c = (String(rgb).match(/\d+/g) ?? []).map(Number);
    return Math.max(...c) - Math.min(...c);
  };
  const run = (altitude: number, weather: { code: number; humidity: number } | null = null, haze: "auto" | "clear" | "light" | "heavy" = "auto") => {
    const { map, calls } = fakeMap({ satellite: true, buildings: "#808080" });
    applyAtmosphere(map, base, { realSky: true, sun: { altitude }, weather, haze });
    return { sky: calls.sky[0], paint: calls.paint };
  };

  it("darkens the sky and imagery at night and brightens them by day", () => {
    const night = run(-30);
    const dusk = run(-5);
    const day = run(50);
    expect(lum(night.sky["sky-color"])).toBeLessThan(lum(dusk.sky["sky-color"]));
    expect(lum(dusk.sky["sky-color"])).toBeLessThan(lum(day.sky["sky-color"]));
    expect(night.paint["satellite:raster-brightness-max"]).toBeCloseTo(0.4, 6);
    expect(day.paint["satellite:raster-brightness-max"]).toBeCloseTo(1, 6);
    // Buildings dim with the light.
    expect(night.paint["buildings-3d:fill-extrusion-color"]).toBe("rgb(51,51,51)");
  });

  it("greys the sky when overcast", () => {
    const clear = run(30, { code: 0, humidity: 50 });
    const overcast = run(30, { code: 3, humidity: 50 });
    // Overcast (code 3) moves halfway toward a grey of the same lightness.
    expect(spread(overcast.sky["sky-color"])).toBeLessThan(spread(clear.sky["sky-color"]) * 0.6);
    expect(lum(overcast.sky["sky-color"])).toBeCloseTo(lum(clear.sky["sky-color"]), -1);
  });

  it("takes haze from fog in Auto, and a chosen haze overrides it", () => {
    expect(run(30, { code: 45, humidity: 99 }).sky["fog-ground-blend"]).toBe(0.28);
    expect(run(30, { code: 0, humidity: 40 }).sky["fog-ground-blend"]).toBeUndefined();
    expect(run(30, { code: 45, humidity: 99 }, "clear").sky["fog-ground-blend"]).toBe(0.97);
  });

  it("restores the look's own imagery and buildings when the real sky is off", () => {
    const { map, calls } = fakeMap({ satellite: true, buildings: "#808080" });
    applyAtmosphere(map, base, { realSky: true, sun: { altitude: -30 }, weather: null, haze: "auto" });
    applyAtmosphere(map, base, { realSky: false, sun: { altitude: -30 }, weather: null, haze: "auto" });
    expect(calls.paint["satellite:raster-brightness-max"]).toBe(0.9);
    expect(calls.paint["satellite:raster-saturation"]).toBe(0.1);
    expect(calls.paint["buildings-3d:fill-extrusion-color"]).toBe("#808080");
    expect(calls.sky[1]).toEqual({ "sky-color": "#88aaff" });
  });
});
