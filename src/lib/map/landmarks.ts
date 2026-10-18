// Peak and landmark names over the flyover: summits with their elevation, and well-known places
// (attractions, monuments, viewpoints…), from the same free OpenFreeMap vector tiles as the
// basemap labels. Added on every look whose style includes that source.

import type { ExpressionSpecification, Map as MlMap } from "maplibre-gl";
import type { Units } from "../analysis/types";
import type { Look } from "./style";

const SOURCE = "openmaptiles";
const LAYERS = ["landmark-peak-dot", "landmark-peak", "landmark-poi"] as const;
/** Landmark classes worth naming from the air (OpenMapTiles poi classes). */
const LANDMARK_CLASSES = ["attraction", "monument", "castle", "viewpoint", "museum", "stadium", "zoo", "theme_park"];

const name: ExpressionSpecification = ["coalesce", ["get", "name:latin"], ["get", "name:en"], ["get", "name"]];

/** Adds the peak and landmark label layers (under the route's km markers), if the style has the source. */
export function addLandmarkLayers(map: MlMap, look: Look, units: Units, visible: boolean) {
  if (!map.getSource(SOURCE)) return;
  const light = look.hud === "light";
  const text = light ? "#1d1c19" : "#f4f5f6";
  const halo = light ? "rgba(255,255,255,0.92)" : "rgba(7,8,10,0.85)";
  const elevation: ExpressionSpecification =
    units === "metric"
      ? ["concat", ["to-string", ["round", ["get", "ele"]]], " m"]
      : ["concat", ["to-string", ["round", ["*", ["get", "ele"], 3.28084]]], " ft"];
  const before = map.getLayer("route-km-dot") ? "route-km-dot" : undefined;
  const visibility = visible ? "visible" : "none";
  const peaks: ExpressionSpecification = ["all", ["match", ["get", "class"], ["peak", "volcano"], true, false], ["has", "name"]];
  map.addLayer(
    {
      id: "landmark-peak-dot",
      type: "circle",
      source: SOURCE,
      "source-layer": "mountain_peak",
      minzoom: 9,
      filter: peaks,
      layout: { visibility },
      paint: {
        "circle-radius": 3,
        "circle-color": text,
        "circle-stroke-color": halo,
        "circle-stroke-width": 1.5,
        "circle-pitch-alignment": "viewport",
      },
    },
    before,
  );
  map.addLayer(
    {
      id: "landmark-peak",
      type: "symbol",
      source: SOURCE,
      "source-layer": "mountain_peak",
      minzoom: 9,
      filter: peaks,
      layout: {
        visibility,
        "text-field": ["case", ["has", "ele"], ["format", name, {}, "\n", {}, elevation, { "font-scale": 0.82 }], name] as ExpressionSpecification,
        "text-font": ["Noto Sans Bold"],
        "text-size": 13,
        "text-anchor": "bottom",
        "text-offset": [0, -0.5],
        "text-max-width": 9,
        // Higher peaks win when labels would collide.
        "symbol-sort-key": ["-", 0, ["coalesce", ["get", "ele"], 0]],
        "text-padding": 6,
      },
      paint: { "text-color": text, "text-halo-color": halo, "text-halo-width": 1.4 },
    },
    before,
  );
  map.addLayer(
    {
      id: "landmark-poi",
      type: "symbol",
      source: SOURCE,
      "source-layer": "poi",
      minzoom: 13,
      filter: ["all", ["match", ["get", "class"], LANDMARK_CLASSES, true, false], ["has", "name"]],
      layout: {
        visibility,
        "text-field": name,
        "text-font": ["Noto Sans Regular"],
        "text-size": 12,
        "text-max-width": 9,
        "symbol-sort-key": ["coalesce", ["get", "rank"], 99],
        "text-padding": 6,
      },
      paint: { "text-color": text, "text-halo-color": halo, "text-halo-width": 1.3, "text-opacity": 0.9 },
    },
    before,
  );
}

export function setLandmarksVisible(map: MlMap, visible: boolean) {
  for (const id of LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
}

// --- 3D buildings ------------------------------------------------------------------------------

/** Building colors per look: dark blocks on dark maps, paper on Editorial, stone over imagery. */
function buildingColor(look: Look): string {
  if (look.hud === "light") return "#e4ddcf";
  if (look.id === "night" || look.id === "blueprint") return "#20262f";
  return "#cfc8bc";
}

/**
 * Extrudes buildings to their mapped height (OpenMapTiles render_height) from zoom 13, where
 * city runs and rides are filmed. Drawn above the draped route, so buildings in front hide it as
 * they would in real life.
 */
export function addBuildingLayer(map: MlMap, look: Look, visible: boolean) {
  if (!map.getSource(SOURCE) || map.getLayer("buildings-3d")) return;
  map.addLayer(
    {
      id: "buildings-3d",
      type: "fill-extrusion",
      source: SOURCE,
      "source-layer": "building",
      // A step below the chase camera's usual zoom, so they don't pop in and out around it.
      minzoom: 13,
      layout: { visibility: visible ? "visible" : "none" },
      paint: {
        "fill-extrusion-color": buildingColor(look),
        // Full height at every zoom: easing heights in with zoom made buildings rise and sink as
        // the camera's zoom changes with your speed.
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": look.id === "night" || look.id === "blueprint" || look.hud === "light" ? 0.85 : 0.7,
      },
    },
    map.getLayer("landmark-peak-dot") ? "landmark-peak-dot" : map.getLayer("route-km-dot") ? "route-km-dot" : undefined,
  );
}

export function setBuildingsVisible(map: MlMap, visible: boolean) {
  if (map.getLayer("buildings-3d")) map.setLayoutProperty("buildings-3d", "visibility", visible ? "visible" : "none");
}
