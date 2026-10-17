import type { ExpressionSpecification } from "maplibre-gl";
import { type GeoJSONSource, Map as MlMap, NavigationControl } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Units } from "../../lib/analysis/types";
import { DAY_MS, localDay } from "../../lib/library/aggregate";
import { focusBounds, heatmapData } from "../../lib/library/heatmap";
import type { LibraryRecord } from "../../lib/library/types";
import { DARK_STYLE_URL, LIGHT_STYLE_URL } from "../../lib/map/style";
import { useTheme } from "../../state/theme";
import { distanceText } from "./format";
import { useReducedMotion } from "./hooks";
import { mapPixelRatio, resolveDetail } from "../../lib/map/detail";
import { useStore } from "../../state/store";

/** Seconds the chronological build-up takes, whatever the date range. */
const BUILD_SECONDS = 12;

const RAMP = {
  dark: ["#3b1f6e", "#b8327a", "#ff7a3d", "#ffe14d"],
  light: ["#3b1f6e", "#7a2a7c", "#b8327a", "#e2533e", "#f08a24"],
};

function heatColor(theme: "dark" | "light"): ExpressionSpecification {
  const ramp = RAMP[theme];
  const stops: (number | string)[] = [0, "rgba(0,0,0,0)", 0.04, theme === "dark" ? "rgba(59,31,110,0.35)" : "rgba(59,31,110,0.25)"];
  ramp.forEach((c, i) => stops.push(0.12 + (0.88 * i) / (ramp.length - 1), c));
  return ["interpolate", ["linear"], ["heatmap-density"], ...stops] as unknown as ExpressionSpecification;
}

/** Night Run glass over the dark map; a light frosted panel over the light one. */
const panelClass = (theme: "dark" | "light") =>
  theme === "dark" ? "glass text-[var(--nr-text-hi)]" : "border border-grid bg-surface/90 text-ink backdrop-blur";
const subClass = (theme: "dark" | "light") => (theme === "dark" ? "text-[var(--nr-text-mid)]" : "text-ink-2");

const dayLabel = (day: number) => new Date(day * DAY_MS).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function Heatmap({ records, radius, units }: { records: LibraryRecord[]; radius: number; units: Units }) {
  const theme = useTheme((s) => s.theme);
  const reduced = useReducedMotion();
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState<MlMap | null>(null);

  const data = useMemo(() => heatmapData(records, radius), [records, radius]);
  const focus = useMemo(() => focusBounds(data.lines), [data]);
  const drawn = useMemo(() => {
    const ids = new Set(data.lines.features.map((f) => f.properties.id));
    return records.filter((r) => ids.has(r.id)).map((r) => ({ day: localDay(r), distance: r.distance }));
  }, [data, records]);
  const n = drawn.length;
  const [d0, d1] = data.days ?? [0, 0];

  const [day, setDay] = useState(d1);
  const [playing, setPlaying] = useState(false);
  const [glow, setGlow] = useState(1);
  const [showAll, setShowAll] = useState(false);

  // New data: jump to the end (reduced motion) or build up from the first day.
  useEffect(() => {
    setDay(reduced || d0 === d1 ? d1 : d0);
    setPlaying(!reduced && d1 > d0);
  }, [d0, d1, reduced]);

  useEffect(() => {
    const map = new MlMap({
      container: container.current!,
      // Lite detail draws on-page maps at 1× (a quarter of the pixels on a 2× phone screen).
      pixelRatio: mapPixelRatio(resolveDetail(useStore.getState().mapDetail)),
      style: theme === "dark" ? DARK_STYLE_URL : LIGHT_STYLE_URL,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("lib-points", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("lib-lines", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "lib-heat",
        type: "heatmap",
        source: "lib-points",
        paint: {
          "heatmap-color": heatColor(theme),
          "heatmap-radius": ["interpolate", ["exponential", 2], ["zoom"], 8, 2, 12, 5, 15, 12, 18, 32],
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.95, 17, 0.75],
        },
      });
      map.addLayer({
        id: "lib-lines",
        type: "line",
        source: "lib-lines",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": theme === "dark" ? "#ffd2bd" : "#9a3412",
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 15, 1.4, 18, 2.4],
        },
      });
      setReady(map);
    });
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container.current!);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      setReady(null);
    };
  }, [theme]);

  // Data, and tuning for how many routes overlap: sparse libraries glow, dense ones don't saturate.
  useEffect(() => {
    const map = ready;
    if (!map || map !== mapRef.current) return;
    (map.getSource("lib-points") as GeoJSONSource).setData(data.points);
    (map.getSource("lib-lines") as GeoJSONSource).setData(data.lines);
    const weight = 0.09 * Math.max(0.25, Math.min(1, Math.sqrt(6 / Math.max(1, n)))) * (data.step / 15);
    map.setPaintProperty("lib-heat", "heatmap-weight", weight);
    map.setPaintProperty("lib-lines", "line-opacity", Math.max(0.06, Math.min(0.5, 0.55 / Math.max(1, n) ** 0.4)));
  }, [ready, data, n]);

  useEffect(() => {
    const map = ready;
    if (!map || map !== mapRef.current) return;
    map.setPaintProperty("lib-heat", "heatmap-intensity", ["interpolate", ["linear"], ["zoom"], 8, 0.5 * glow, 12, glow, 15, 2 * glow, 18, 4 * glow]);
  }, [ready, glow]);

  useEffect(() => {
    const map = ready;
    if (!map || map !== mapRef.current) return;
    const b = showAll ? data.bounds : (focus?.bounds ?? data.bounds);
    if (b)
      map.fitBounds(
        [
          [b[0], b[1]],
          [b[2], b[3]],
        ],
        { padding: 40, animate: false, maxZoom: 15 },
      );
  }, [ready, data, focus, showAll]);

  // Filter by day; integer days only, so scrubbing doesn't re-filter on every pixel.
  const cutoff = Math.floor(day);
  useEffect(() => {
    const map = ready;
    if (!map || map !== mapRef.current) return;
    const f: ExpressionSpecification = ["<=", ["get", "day"], cutoff];
    map.setFilter("lib-heat", f);
    map.setFilter("lib-lines", f);
  }, [ready, cutoff]);

  // Playback: the whole range in BUILD_SECONDS, filter updates throttled to ~12/s (~4/s at Lite:
  // each one makes MapLibre re-filter every point in its worker).
  useEffect(() => {
    if (!playing || !ready) return;
    let raf = 0;
    let lastT = performance.now();
    let lastSet = 0;
    let cur = day >= d1 ? d0 : day;
    const perMs = (d1 - d0) / (BUILD_SECONDS * 1000);
    const every = resolveDetail(useStore.getState().mapDetail) === "lite" ? 250 : 80;
    const tick = (now: number) => {
      cur = Math.min(d1, cur + (now - lastT) * perMs);
      lastT = now;
      if (now - lastSet > every || cur >= d1) {
        lastSet = now;
        setDay(cur);
      }
      if (cur >= d1) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // `day` is read once when play starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, ready, d0, d1]);

  const sofar = useMemo(() => {
    let count = 0;
    let dist = 0;
    for (const r of drawn)
      if (r.day <= cutoff) {
        count++;
        dist += r.distance;
      }
    return { count, dist };
  }, [drawn, cutoff]);

  return (
    <div className="relative">
      <div ref={container} data-map={theme} className="h-[62vh] min-h-[380px] w-full overflow-hidden rounded-2xl border border-grid bg-page" />
      {n === 0 && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-ink-2">
          No routes to draw here: these activities have no GPS, or sit entirely inside your privacy circles.
        </div>
      )}
      {n > 0 && (
        <div className={`${panelClass(theme)} pointer-events-auto absolute inset-x-2 bottom-2 rounded-2xl p-3 sm:inset-x-auto sm:left-3 sm:w-[min(440px,calc(100%-24px))]`}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => (playing ? setPlaying(false) : setPlaying(true))}
              disabled={d0 === d1}
              aria-label={playing ? "Pause" : "Play the build-up"}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--nr-route)] text-white disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                {playing ? <path d="M7 5h3v14H7zM14 5h3v14h-3z" /> : <path d="M8 5v14l11-7z" />}
              </svg>
            </button>
            <div className="min-w-0 flex-1">
              <div className="font-display text-2xl font-semibold leading-none tabular">{dayLabel(cutoff)}</div>
              <div className={`mt-0.5 text-xs tabular ${subClass(theme)}`}>
                {sofar.count.toLocaleString()} of {n.toLocaleString()} · {distanceText(sofar.dist, units)}
              </div>
            </div>
          </div>
          <input
            type="range"
            min={d0}
            max={d1}
            step={1}
            value={cutoff}
            disabled={d0 === d1}
            aria-label="Show activities up to this date"
            onChange={(e) => {
              setPlaying(false);
              setDay(Number(e.target.value));
            }}
            className="mt-2 w-full"
          />
          <div className={`mt-1 flex flex-wrap items-center justify-between gap-2 text-xs ${subClass(theme)}`}>
            <label className="flex items-center gap-2">
              <span className="label-caps">Glow</span>
              <input type="range" min={0.3} max={3} step={0.1} value={glow} onChange={(e) => setGlow(Number(e.target.value))} className="w-24" aria-label="Heat intensity" />
            </label>
            {focus && focus.elsewhere > 0 && (
              <button onClick={() => setShowAll((v) => !v)} className="underline underline-offset-2 hover:opacity-80">
                {showAll ? "Back to your usual area" : `Show all (+${focus.elsewhere} elsewhere)`}
              </button>
            )}
          </div>
        </div>
      )}
      <p className="mt-2 text-xs text-muted">
        {radius > 0
          ? `Nothing within ${radius} m of any start or finish is drawn. Change the radius on the Check step.`
          : "Privacy circles are off: starts and finishes are drawn. Turn them on in the Check step."}
      </p>
    </div>
  );
}
