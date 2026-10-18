// Weather during an activity, from Open-Meteo (free, no key). Opt-in: it's the one feature that
// sends anything about an activity off the device, and only a location rounded to ~10 km plus
// the date. Hourly values are interpolated to any moment of the activity.

export interface Weather {
  /** Hour starts, epoch ms. */
  time: number[];
  temp: number[];
  feelsLike: number[];
  humidity: number[];
  precip: number[];
  windSpeed: number[];
  windDir: number[];
  code: number[];
}

const HOURLY = ["temperature_2m", "apparent_temperature", "relative_humidity_2m", "precipitation", "wind_speed_10m", "wind_direction_10m", "weather_code"];
const DAY = 86400000;

/** Rounds to 0.1° (~11 km): enough for weather, not enough to find a front door. */
const coarse = (v: number) => Math.round(v * 10) / 10;

export async function fetchWeather(lat: number, lon: number, startMs: number, endMs: number, signal?: AbortSignal): Promise<Weather | null> {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const la = coarse(lat);
  const lo = coarse(lon);
  const key = `rv:weather:${la},${lo},${day(startMs)},${day(endMs)}`;
  try {
    const hit = sessionStorage.getItem(key);
    if (hit) return JSON.parse(hit) as Weather;
  } catch {
    // Storage unavailable.
  }
  // The archive lags a few days behind; recent activities come from the forecast API's past days.
  const recent = Date.now() - startMs < 80 * DAY;
  const base = recent ? "https://api.open-meteo.com/v1/forecast" : "https://archive-api.open-meteo.com/v1/archive";
  const url = `${base}?latitude=${la}&longitude=${lo}&start_date=${day(startMs - DAY)}&end_date=${day(endMs + DAY)}&hourly=${HOURLY.join(",")}&timezone=UTC&timeformat=unixtime&wind_speed_unit=kmh`;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const j = (await res.json()) as { hourly?: Record<string, number[]> };
  const h = j.hourly;
  if (!h?.time?.length) return null;
  const w: Weather = {
    time: h.time.map((t) => t * 1000),
    temp: h.temperature_2m,
    feelsLike: h.apparent_temperature,
    humidity: h.relative_humidity_2m,
    precip: h.precipitation,
    windSpeed: h.wind_speed_10m,
    windDir: h.wind_direction_10m,
    code: h.weather_code,
  };
  try {
    sessionStorage.setItem(key, JSON.stringify(w));
  } catch {
    // Too large or unavailable; it's only a cache.
  }
  return w;
}

/** Linear interpolation of an hourly series at epoch ms (nearest hour for codes). */
export function weatherAt(w: Weather, ms: number) {
  const n = w.time.length;
  let i = 0;
  while (i < n - 2 && w.time[i + 1] <= ms) i++;
  const f = Math.min(1, Math.max(0, (ms - w.time[i]) / (w.time[i + 1] - w.time[i] || 1)));
  const lerp = (arr: number[]) => (arr[i] ?? NaN) + ((arr[i + 1] ?? arr[i]) - (arr[i] ?? NaN)) * f;
  return {
    temp: lerp(w.temp),
    feelsLike: lerp(w.feelsLike),
    humidity: lerp(w.humidity),
    precip: w.precip[f < 0.5 ? i : i + 1] ?? 0,
    windSpeed: lerp(w.windSpeed),
    windDir: w.windDir[f < 0.5 ? i : i + 1] ?? 0,
    code: w.code[f < 0.5 ? i : i + 1] ?? 0,
  };
}

/** Averages over the activity (hours it overlaps). */
export function weatherSummary(w: Weather, startMs: number, endMs: number) {
  const mid = weatherAt(w, (startMs + endMs) / 2);
  let lo = Infinity;
  let hi = -Infinity;
  let rain = 0;
  for (let k = 0; k < w.time.length; k++) {
    if (w.time[k] + 3600000 < startMs || w.time[k] > endMs) continue;
    lo = Math.min(lo, w.temp[k]);
    hi = Math.max(hi, w.temp[k]);
    rain += w.precip[k] ?? 0;
  }
  return { ...mid, low: Number.isFinite(lo) ? lo : mid.temp, high: Number.isFinite(hi) ? hi : mid.temp, rain };
}

/** WMO weather codes in plain words. */
export function weatherText(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return code >= 65 ? "Heavy rain" : "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 85 && code <= 86) return "Snow showers";
  if (code >= 95) return "Thunderstorm";
  return "—";
}

export const formatTemp = (c: number, units: "metric" | "imperial") => (Number.isFinite(c) ? (units === "metric" ? `${Math.round(c)}°C` : `${Math.round((c * 9) / 5 + 32)}°F`) : "—");
export const formatWind = (kmh: number, units: "metric" | "imperial") => (units === "metric" ? `${Math.round(kmh)} km/h` : `${Math.round(kmh / 1.609344)} mph`);
export const compass = (deg: number) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((deg % 360) + 360) % 360 / 45) % 8];
