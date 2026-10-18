// Weather during the activity (opt-in): what it was like, from Open-Meteo, with the privacy trade-off
// spelled out before anything is sent.

import { useStore } from "../state/store";
import { compass, formatTemp, formatWind, weatherSummary, weatherText } from "../lib/weather";
import { Card } from "./ui";

export function WeatherCard() {
  const a = useStore((s) => s.analysis)!;
  const weatherOn = useStore((s) => s.weatherOn);
  const weather = useStore((s) => s.weather);
  const status = useStore((s) => s.weatherStatus);
  const setWeatherOn = useStore((s) => s.setWeatherOn);
  if (a.activity.routeOnly) return null;
  const u = a.settings.units;

  if (!weatherOn) {
    return (
      <Card title="Weather">
        <p className="text-sm leading-relaxed text-ink-2">
          See the temperature, wind and rain during this activity, and add them to your video. This asks Open-Meteo (free, no account) for the weather near
          your route: only the date and a location rounded to about 10 km leave your device.
        </p>
        <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => setWeatherOn(true)}>
          Show weather
        </button>
      </Card>
    );
  }
  if (status === "loading") return <Card title="Weather">{<p className="text-sm text-ink-2">Looking up the weather…</p>}</Card>;
  if (!weather) {
    return (
      <Card title="Weather">
        <p className="text-sm text-ink-2">{status === "error" ? "The weather service didn't answer; try again later." : "No weather data for this activity."}</p>
        <button type="button" className="btn btn-quiet btn-sm mt-2" onClick={() => setWeatherOn(false)}>
          Turn weather off
        </button>
      </Card>
    );
  }
  const w = weatherSummary(weather, a.samples[0].time, a.samples[a.n - 1].time);
  const items: [string, string][] = [
    ["Conditions", weatherText(w.code)],
    ["Temperature", w.high - w.low >= 2 ? `${formatTemp(w.low, u)} – ${formatTemp(w.high, u)}` : formatTemp(w.temp, u)],
    ["Feels like", formatTemp(w.feelsLike, u)],
    ["Wind", `${formatWind(w.windSpeed, u)} ${compass(w.windDir)}`],
    ["Humidity", `${Math.round(w.humidity)}%`],
    ["Rain", w.rain > 0.05 ? (u === "metric" ? `${w.rain.toFixed(1)} mm` : `${(w.rain / 25.4).toFixed(2)} in`) : "None"],
  ];
  return (
    <Card title="Weather" aside={<button type="button" className="text-label text-muted underline decoration-line underline-offset-2 hover:text-ink" onClick={() => setWeatherOn(false)}>Turn off</button>}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {items.map(([k, v]) => (
          <div key={k}>
            <dt className="text-label font-medium text-muted">{k}</dt>
            <dd className="mt-0.5 font-semibold tabular text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-label text-muted">Weather from Open-Meteo for the area, by the hour. Add it to your video under Export → Stats.</p>
    </Card>
  );
}
