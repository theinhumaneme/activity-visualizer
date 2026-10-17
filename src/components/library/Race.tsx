import type { FeatureCollection, LineString, Point } from "geojson";
import { type GeoJSONSource, Map as MlMap, NavigationControl } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Units } from "../../lib/analysis/types";
import { formatDuration } from "../../lib/format/format";
import { heatmapData } from "../../lib/library/heatmap";
import { privacyTest } from "../../lib/library/privacy";
import { type Runner, finishTime, positionAt, standings, trail } from "../../lib/library/race";
import type { RouteGroup } from "../../lib/library/similarity";
import type { LibraryRecord } from "../../lib/library/types";
import { DARK_STYLE_URL } from "../../lib/map/style";
import { distanceText, gapText, shortDate, sportPlural } from "./format";
import { useReducedMotion } from "./hooks";
import { mapPixelRatio, resolveDetail } from "../../lib/map/detail";
import { useStore } from "../../state/store";

const MAX_RUNNERS = 25;
const SPEEDS = [10, 30, 60, 120];
const TRAIL_SECONDS = 45;
const LATEST = "#ff5a1f";
const GHOST = "#f4f5f6";
const EMPTY = { type: "FeatureCollection" as const, features: [] };

interface Ghost extends Runner {
  record: LibraryRecord;
  latest: boolean;
  color: string;
  /** Older runs are fainter. */
  opacity: number;
  ok: (lon: number, lat: number) => boolean;
}

export function Race({ groups, byId, radius, units }: { groups: RouteGroup[]; byId: Map<string, LibraryRecord>; radius: number; units: Units }) {
  const reduced = useReducedMotion();
  const [groupId, setGroupId] = useState<string | null>(groups[0]?.id ?? null);
  const group = groups.find((g) => g.id === groupId) ?? groups[0] ?? null;

  const ghosts = useMemo((): Ghost[] => {
    if (!group) return [];
    const members = group.members
      .map((id) => byId.get(id))
      .filter((r): r is LibraryRecord => !!r?.track)
      .sort((a, b) => a.startTime - b.startTime)
      .slice(-MAX_RUNNERS);
    return members.map((r, i) => {
      const latest = i === members.length - 1;
      return {
        id: r.id,
        track: r.track!,
        record: r,
        latest,
        color: latest ? LATEST : GHOST,
        opacity: latest ? 1 : 0.35 + (0.5 * i) / Math.max(1, members.length - 1),
        ok: privacyTest(r.track!, radius),
      };
    });
  }, [group, byId, radius]);

  const total = useMemo(() => Math.max(0, ...ghosts.map((g) => finishTime(g.track))), [ghosts]);
  const defaultSpeed = useMemo(() => SPEEDS.reduce((best, s) => (Math.abs(total / s - 25) < Math.abs(total / best - 25) ? s : best), SPEEDS[0]), [total]);
  const [speed, setSpeed] = useState(defaultSpeed);
  const [playing, setPlaying] = useState(false);
  const tauRef = useRef(0);
  const [tau, setTau] = useState(0);

  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState<MlMap | null>(null);

  useEffect(() => {
    const map = new MlMap({
      container: container.current!,
      // Lite detail draws on-page maps at 1× (a quarter of the pixels on a 2× phone screen).
      pixelRatio: mapPixelRatio(resolveDetail(useStore.getState().mapDetail)),
      style: DARK_STYLE_URL,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("race-route", { type: "geojson", data: EMPTY });
      map.addSource("race-trails", { type: "geojson", data: EMPTY });
      map.addSource("race-dots", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "race-route",
        type: "line",
        source: "race-route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-opacity": 0.14, "line-width": 4 },
      });
      map.addLayer({
        id: "race-trails",
        type: "line",
        source: "race-trails",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-opacity": ["get", "opacity"], "line-width": 3 },
      });
      map.addLayer({
        id: "race-dots",
        type: "circle",
        source: "race-dots",
        layout: { "circle-sort-key": ["get", "z"] },
        paint: {
          "circle-color": ["get", "color"],
          "circle-opacity": ["get", "opacity"],
          "circle-radius": ["case", ["get", "latest"], 7, 5],
          "circle-stroke-color": "#07080a",
          "circle-stroke-width": 2,
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
  }, []);

  const draw = useCallback(
    (t: number) => {
      const map = ready;
      if (!map || map !== mapRef.current) return;
      const dots: FeatureCollection<Point> = { type: "FeatureCollection", features: [] };
      const trails: FeatureCollection<LineString> = { type: "FeatureCollection", features: [] };
      ghosts.forEach((g, i) => {
        const at = positionAt(g.track, t);
        if (g.ok(at[0], at[1]))
          dots.features.push({
            type: "Feature",
            properties: { color: g.color, opacity: g.opacity, latest: g.latest, z: g.latest ? 1e6 : i },
            geometry: { type: "Point", coordinates: at },
          });
        trail(g.track, t, TRAIL_SECONDS).forEach((piece, p, all) => {
          // Break the piece wherever it enters a privacy circle.
          let run: [number, number][] = [];
          const opacity = (g.opacity * 0.8 * (p + 1)) / all.length;
          const flush = () => {
            if (run.length >= 2) trails.features.push({ type: "Feature", properties: { color: g.color, opacity }, geometry: { type: "LineString", coordinates: run } });
            run = [];
          };
          for (const c of piece) {
            if (g.ok(c[0], c[1])) run.push(c);
            else flush();
          }
          flush();
        });
      });
      (map.getSource("race-dots") as GeoJSONSource).setData(dots);
      (map.getSource("race-trails") as GeoJSONSource).setData(trails);
    },
    [ready, ghosts],
  );

  // New race: the route of the latest run as a faint guide, framed; the gun (or the result, with reduced motion).
  useEffect(() => {
    const map = ready;
    if (!map || map !== mapRef.current) return;
    // Densified like the heatmap, so a long straight segment can't cut across a privacy circle.
    const latest = ghosts[ghosts.length - 1];
    const guide = latest ? heatmapData([latest.record], radius) : null;
    const b = heatmapData(
      ghosts.map((g) => g.record),
      radius,
      { step: 50 },
    ).bounds;
    (map.getSource("race-route") as GeoJSONSource).setData(guide ? guide.lines : EMPTY);
    if (b)
      map.fitBounds(
        [
          [b[0], b[1]],
          [b[2], b[3]],
        ],
        { padding: 48, animate: false, maxZoom: 16 },
      );
    const start = reduced ? total : 0;
    tauRef.current = start;
    setTau(start);
    setSpeed(defaultSpeed);
    setPlaying(!reduced && ghosts.length > 1);
    draw(start);
  }, [ready, ghosts, total, reduced, defaultSpeed, draw, radius]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    let lastDraw = 0;
    // Each draw re-sends the dots and trails to MapLibre's worker: 30 per second is smooth enough
    // (15 at Lite), where every display frame (up to 120 Hz) kept the worker busy.
    const drawEvery = resolveDetail(useStore.getState().mapDetail) === "lite" ? 66 : 33;
    if (tauRef.current >= total) tauRef.current = 0;
    const tick = (now: number) => {
      tauRef.current = Math.min(total, tauRef.current + ((now - last) / 1000) * speed);
      last = now;
      if (now - lastDraw >= drawEvery || tauRef.current >= total) {
        lastDraw = now;
        draw(tauRef.current);
      }
      // The leaderboard re-renders ~8×/s; the map every frame.
      if (now - lastUi > 120 || tauRef.current >= total) {
        lastUi = now;
        setTau(tauRef.current);
      }
      if (tauRef.current >= total) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, total, draw]);

  const board = useMemo(() => standings(ghosts, tau), [ghosts, tau]);
  const ghostById = useMemo(() => new Map(ghosts.map((g) => [g.id, g])), [ghosts]);

  if (!groups.length)
    return (
      <div className="rounded-2xl border border-grid bg-surface p-6 text-center">
        <p className="font-medium">No repeated routes yet.</p>
        <p className="mt-1 text-sm text-ink-2">Do the same route twice and you can race your past self here.</p>
        <p className="mt-3 text-xs text-muted">Same route = starts and finishes within 150 m, length within 10%, and no point more than 120 m off the other line.</p>
      </div>
    );

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]" role="radiogroup" aria-label="Route">
        {groups.map((g) => (
          <button
            key={g.id}
            role="radio"
            aria-checked={g.id === group?.id}
            onClick={() => setGroupId(g.id)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${g.id === group?.id ? "border-accent bg-accent/15 text-ink" : "border-grid bg-surface text-ink-2 hover:bg-surface-2"}`}
          >
            {g.label} <span className="tabular text-muted">· {g.members.length} {sportPlural(g.kind)}</span>
          </button>
        ))}
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-grid bg-[var(--nr-bg)]">
        <div ref={container} data-map="dark" className="h-[55vh] min-h-[340px] w-full sm:h-[62vh] sm:min-h-[420px]" />
        <div className="glass m-2 flex items-center gap-3 rounded-2xl p-2.5 text-[var(--nr-text-hi)] sm:absolute sm:inset-x-2 sm:bottom-2 sm:m-0">
          <button
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause" : "Play the race"}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--nr-route)] text-white"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
              {playing ? <path d="M7 5h3v14H7zM14 5h3v14h-3z" /> : <path d="M8 5v14l11-7z" />}
            </svg>
          </button>
          <input
            type="range"
            min={0}
            max={Math.ceil(total)}
            step={1}
            value={Math.round(tau)}
            aria-label="Race time"
            onChange={(e) => {
              setPlaying(false);
              tauRef.current = Number(e.target.value);
              setTau(tauRef.current);
              draw(tauRef.current);
            }}
            className="min-w-0 flex-1"
          />
          <div role="group" aria-label="Speed" className="flex shrink-0 rounded-full bg-black/30 p-0.5 text-xs">
            {SPEEDS.map((s) => (
              <button
                key={s}
                aria-pressed={speed === s}
                onClick={() => setSpeed(s)}
                className={`rounded-full px-2 py-1 tabular ${speed === s ? "bg-white/15 text-[var(--nr-text-hi)]" : "text-[var(--nr-text-mid)]"}`}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
        <div className="glass mx-2 mb-2 max-h-[45vh] overflow-y-auto rounded-2xl p-3 text-[var(--nr-text-hi)] sm:absolute sm:left-2 sm:top-2 sm:m-0 sm:max-h-[calc(100%-96px)] sm:w-[280px]">
          <div className="label-caps text-[var(--nr-text-mid)]">Race your past selves</div>
          <div className="mt-0.5 font-display text-3xl font-semibold leading-none tabular">{formatDuration(tau)}</div>
          <ol className="mt-2 space-y-0.5 text-sm tabular" aria-label="Leaderboard">
            {board.map((row) => {
              const g = ghostById.get(row.id)!;
              return (
                <li key={row.id} className={`flex items-center gap-2 rounded-md px-1.5 py-0.5 ${g.latest ? "bg-[var(--nr-route)]/20" : ""}`}>
                  <span className="w-5 text-right text-[var(--nr-text-mid)]">{row.rank}</span>
                  <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: g.color, opacity: g.opacity }} />
                  <span className="min-w-0 flex-1 truncate">
                    {shortDate(g.record)}
                    {g.latest && <span className="ml-1 text-[var(--nr-route)]">latest</span>}
                  </span>
                  <span className={row.rank === 1 ? "" : "text-[var(--nr-text-mid)]"}>
                    {row.done ? (row.rank === 1 ? formatDuration(finishTime(g.track)) : gapText(row.gap)) : row.rank === 1 ? "Leads" : gapText(row.gap)}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

      </div>

      {group && (
        <p className="text-xs text-muted">
          {group.label} · {distanceText(group.distance, units)}. Everyone starts together and the clock counts moving time only, so stops don't count against
          anyone. Gaps are seconds behind the leader at the same point of the route.
          {group.members.length > MAX_RUNNERS && ` Racing your ${MAX_RUNNERS} most recent of ${group.members.length}.`}
          {radius > 0 && ` Ghosts vanish inside your ${radius} m privacy circles.`}
        </p>
      )}
    </div>
  );
}
