import { type GeoJSONSource, Map as MlMap, type MapMouseEvent, NavigationControl } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import type { Analysis } from "../lib/analysis/types";
import { boundsOf, mercX, mercY } from "../lib/geo/geo";
import { START_COLOR, addRouteLayers, buildChunks, pointFeatures, routeFeatures, sampleColors } from "../lib/map/route";
import { DARK_STYLE_URL, LIGHT_STYLE_URL } from "../lib/map/style";
import { useStore } from "../state/store";
import { useTheme } from "../state/theme";
import { Failure, Loading } from "./ui";
import { mapPixelRatio, resolveDetail } from "../lib/map/detail";

const EMPTY = { type: "FeatureCollection" as const, features: [] };

const MARKER_PX = 2;

/** Start (green, play), finish (checkered) and stop (pause) markers, drawn once per theme. */
function markerImage(kind: "start" | "finish" | "stop", theme: "light" | "dark"): ImageData {
  const size = (kind === "stop" ? 20 : 24) * MARKER_PX;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const r = size / 2;
  ctx.beginPath();
  ctx.arc(r, r, r - MARKER_PX, 0, Math.PI * 2);
  ctx.fillStyle = kind === "start" ? START_COLOR : kind === "finish" ? "#ffffff" : theme === "dark" ? "#23272d" : "#ffffff";
  ctx.fill();
  if (kind === "finish") {
    // Checkered disc.
    ctx.save();
    ctx.clip();
    const sq = size / 5;
    ctx.fillStyle = "#17202b";
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) if ((x + y) % 2) ctx.fillRect(x * sq, y * sq, sq, sq);
    ctx.restore();
  }
  ctx.lineWidth = 2.5 * MARKER_PX;
  ctx.strokeStyle = kind === "stop" ? (theme === "dark" ? "#f5f7fa" : "#17202b") : "#ffffff";
  ctx.beginPath();
  ctx.arc(r, r, r - 1.25 * MARKER_PX, 0, Math.PI * 2);
  ctx.stroke();
  if (kind === "start") {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(r - 3 * MARKER_PX, r - 4.5 * MARKER_PX);
    ctx.lineTo(r + 4.5 * MARKER_PX, r);
    ctx.lineTo(r - 3 * MARKER_PX, r + 4.5 * MARKER_PX);
    ctx.closePath();
    ctx.fill();
  }
  if (kind === "stop") {
    ctx.fillStyle = theme === "dark" ? "#f5f7fa" : "#17202b";
    ctx.fillRect(r - 3.5 * MARKER_PX, r - 3.5 * MARKER_PX, 2.4 * MARKER_PX, 7 * MARKER_PX);
    ctx.fillRect(r + 1.1 * MARKER_PX, r - 3.5 * MARKER_PX, 2.4 * MARKER_PX, 7 * MARKER_PX);
  }
  return ctx.getImageData(0, 0, size, size);
}

/** The same three markers in HTML, for legends. */
export function MarkerSwatch({ kind }: { kind: "start" | "finish" | "stop" }) {
  if (kind === "start")
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden>
        <circle cx="12" cy="12" r="10.5" fill={START_COLOR} stroke="#fff" strokeWidth="2" />
        <path d="M9.5 7.5 16 12l-6.5 4.5z" fill="#fff" />
      </svg>
    );
  if (kind === "finish")
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden>
        <defs>
          <pattern id="chk" width="9.6" height="9.6" patternUnits="userSpaceOnUse">
            <rect width="9.6" height="9.6" fill="#fff" />
            <rect width="4.8" height="4.8" x="4.8" fill="#17202b" />
            <rect width="4.8" height="4.8" y="4.8" fill="#17202b" />
          </pattern>
        </defs>
        <circle cx="12" cy="12" r="10.5" fill="url(#chk)" stroke="#fff" strokeWidth="2" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink" aria-hidden>
      <circle cx="12" cy="12" r="10" fill="var(--surface)" stroke="currentColor" strokeWidth="2.2" />
      <path d="M9.2 8.2v7.6M14.8 8.2v7.6" stroke="currentColor" strokeWidth="2.6" />
    </svg>
  );
}

/** Flat map of the whole route (dark or light with the app theme). Hovering it moves the shared cursor used by the charts. */
export function RouteMap({ className = "", showStops = false, legend = true }: { className?: string; showStops?: boolean; legend?: boolean }) {
  const a = useStore((s) => s.analysis)!;
  const colorMode = useStore((s) => s.colorMode);
  const routeColor = useStore((s) => s.routeColor);
  const theme = useTheme((s) => s.theme);
  const hoverIndex = useStore((s) => s.hoverIndex);
  const highlight = useStore((s) => s.highlight);
  const setHover = useStore((s) => s.setHover);
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  // The map instance whose style has loaded; effects only touch that one (it changes with the theme).
  const [ready, setReady] = useState<MlMap | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setFailed(false);
    const map = new MlMap({
      container: container.current!,
      // Lite detail draws on-page maps at 1× (a quarter of the pixels on a 2× phone screen).
      pixelRatio: mapPixelRatio(resolveDetail(useStore.getState().mapDetail)),
      style: theme === "dark" ? DARK_STYLE_URL : LIGHT_STYLE_URL,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      bounds: boundsArray(a),
      fitBoundsOptions: { padding: 40 },
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    // A style or first-tile failure before load leaves an empty box: say so and offer a retry.
    let loaded = false;
    const giveUp = setTimeout(() => !loaded && setFailed(true), 20000);
    map.on("error", () => {
      if (!loaded) setFailed(true);
    });
    map.on("load", () => {
      loaded = true;
      clearTimeout(giveUp);
      for (const kind of ["start", "finish", "stop"] as const) map.addImage(`marker-${kind}`, markerImage(kind, theme), { pixelRatio: MARKER_PX });
      const ink = theme === "dark" ? "#f5f7fa" : "#17202b";
      const paper = theme === "dark" ? "#191c20" : "#ffffff";
      addRouteLayers(map, { ghostOpacity: 0, width: 4, headColor: routeColor, casing: theme === "light" ? "#ffffff" : undefined });
      map.addSource("highlight", { type: "geojson", data: EMPTY });
      map.addSource("hover", { type: "geojson", data: EMPTY });
      map.addSource("stops", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "highlight",
        type: "line",
        source: "highlight",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ink, "line-width": 6 },
      });
      // Start and finish as icons in place of the shared circle dots; stops below them.
      map.setLayoutProperty("route-start", "visibility", "none");
      map.setLayoutProperty("route-finish", "visibility", "none");
      map.addLayer({
        id: "stops",
        type: "symbol",
        source: "stops",
        layout: { "icon-image": "marker-stop", "icon-allow-overlap": true, "icon-ignore-placement": true },
      });
      map.addLayer({
        id: "markers",
        type: "symbol",
        source: "route-points",
        filter: ["in", ["get", "kind"], ["literal", ["start", "finish"]]],
        layout: {
          "icon-image": ["concat", "marker-", ["get", "kind"]],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          // Start above finish where a loop closes on itself, nudged apart so both show.
          "icon-offset": ["case", ["==", ["get", "kind"], "start"], ["literal", [-7, 0]], ["literal", [7, 0]]],
          "symbol-sort-key": ["case", ["==", ["get", "kind"], "start"], 2, 1],
        },
      });
      map.addLayer({
        id: "hover",
        type: "circle",
        source: "hover",
        paint: { "circle-color": paper, "circle-radius": 7, "circle-stroke-color": ink, "circle-stroke-width": 3 },
      });
      setReady(map);
    });
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container.current!);
    return () => {
      clearTimeout(giveUp);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      setReady(null);
    };
    // The map is rebuilt only when the theme changes (or on retry); data updates happen in the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, attempt]);

  // Route, colored by the selected metric.
  useEffect(() => {
    const map = ready;
    if (!map || map !== mapRef.current) return;
    const chunks = buildChunks(a, sampleColors(a, { mode: colorMode, color: routeColor, theme }));
    (map.getSource("route-progress") as GeoJSONSource).setData(routeFeatures(a, chunks));
    // With a privacy zone, the pins mark where the visible line starts and ends, not your door.
    const s = a.samples;
    const { from, to, empty } = a.privacy;
    (map.getSource("route-points") as GeoJSONSource).setData(
      empty
        ? EMPTY
        : pointFeatures([
            { kind: "finish", at: [s[to].lon, s[to].lat] },
            { kind: "start", at: [s[from].lon, s[from].lat] },
          ]),
    );
    (map.getSource("stops") as GeoJSONSource).setData(showStops ? pointFeatures(a.stops.map((st) => ({ kind: "stop", at: [st.lon, st.lat] }))) : EMPTY);
  }, [ready, a, colorMode, routeColor, theme, showStops]);

  useEffect(() => {
    const map = ready;
    if (map && map === mapRef.current) map.fitBounds(boundsArray(a), { padding: 40, animate: false });
  }, [ready, a.samples, a.privacy]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = ready;
    if (!map || map !== mapRef.current) return;
    const s = hoverIndex !== null && a.privacy.visible[hoverIndex] ? a.samples[hoverIndex] : null;
    (map.getSource("hover") as GeoJSONSource).setData(s ? pointFeatures([{ kind: "hover", at: [s.lon, s.lat] }]) : EMPTY);
  }, [ready, hoverIndex, a]);

  useEffect(() => {
    const map = ready;
    if (!map || map !== mapRef.current) return;
    const src = map.getSource("highlight") as GeoJSONSource;
    if (!highlight) {
      src.setData(EMPTY);
      return;
    }
    const coords = a.samples
      .slice(highlight.from, highlight.to + 1)
      .filter((_, k) => a.privacy.visible[highlight.from + k])
      .map((p) => [p.lon, p.lat]);
    src.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] });
  }, [ready, highlight, a]);

  // Hovering near the route picks the nearest sample (in screen pixels).
  useEffect(() => {
    const map = ready;
    if (!map || map !== mapRef.current) return;
    const xs = Float64Array.from(a.samples, (p) => mercX(p.lon));
    const ys = Float64Array.from(a.samples, (p) => mercY(p.lat));
    let frame = 0;
    const onMove = (e: MapMouseEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const mx = mercX(e.lngLat.lng);
        const my = mercY(e.lngLat.lat);
        let best = -1;
        let bestD = Infinity;
        for (let i = 0; i < xs.length; i++) {
          if (!a.privacy.visible[i]) continue;
          const d = (xs[i] - mx) ** 2 + (ys[i] - my) ** 2;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        const px = Math.sqrt(bestD) * 512 * 2 ** map.getZoom();
        setHover(px < 24 ? best : null);
      });
    };
    const onLeave = () => setHover(null);
    map.on("mousemove", onMove);
    map.on("mouseout", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      map.off("mousemove", onMove);
      map.off("mouseout", onLeave);
    };
  }, [ready, a, setHover]);

  const hasStops = showStops && a.stops.length > 0;
  return (
    <div data-map={theme} className={`relative overflow-hidden rounded-card border border-grid bg-surface-2 ${className}`}>
      <div ref={container} className="h-full w-full" />
      {!ready && !failed && <Loading overlay label="Loading map…" />}
      {failed && (
        <Failure
          overlay
          title="The map didn't load"
          message="Map tiles couldn't be fetched. Check your connection; everything else still works."
          retryLabel="Retry map"
          onRetry={() => setAttempt((n) => n + 1)}
        />
      )}
      {legend && ready && !a.privacy.empty && (
        <ul
          className="pointer-events-none absolute left-2 top-2 flex gap-3 rounded-full border border-grid bg-surface/90 px-3 py-1.5 text-label font-medium text-ink-2 shadow-[var(--shadow-raised)] backdrop-blur"
          aria-label="Map markers"
        >
          <li className="flex items-center gap-1.5">
            <MarkerSwatch kind="start" />
            Start
          </li>
          <li className="flex items-center gap-1.5">
            <MarkerSwatch kind="finish" />
            Finish
          </li>
          {hasStops && (
            <li className="flex items-center gap-1.5">
              <MarkerSwatch kind="stop" />
              Stop
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function boundsArray(a: Analysis): [[number, number], [number, number]] {
  const vis = a.samples.filter((_, i) => a.privacy.visible[i]);
  const b = boundsOf(vis.length ? vis : a.samples);
  return [
    [b.west, b.south],
    [b.east, b.north],
  ];
}
