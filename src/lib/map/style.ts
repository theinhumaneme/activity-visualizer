import "maplibre-gl/dist/maplibre-gl.css";
import { type LayerSpecification, type StyleSpecification, addProtocol, setWorkerUrl } from "maplibre-gl";
// MapLibre computes its worker URL relative to its own module, which breaks once bundled.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
// maplibre-contour (~25 KB gzipped) is only for the Editorial and Blueprint looks: imported when one is built.
import type mlcontourModule from "maplibre-contour";
import type { MapTheme } from "./route";

setWorkerUrl(workerUrl);

const tiles = (name: string) => [`${location.origin}/api/tiles/${name}/{z}/{x}/{y}`];

export const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export const OFM_ATTRIBUTION = '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a>';
export const TERRAIN_ATTRIBUTION = "Terrain: Mapzen / AWS Open Data";

let satelliteAttribution = "Imagery © Esri, Maxar, Earthstar Geographics";
/** The Worker reports which imagery provider it's proxying (Esri by default, MapTiler with a key). */
export async function loadMapConfig() {
  try {
    const res = await fetch("/api/config");
    if (res.ok) satelliteAttribution = ((await res.json()) as { satelliteAttribution: string }).satelliteAttribution;
  } catch {
    // Keep the default attribution.
  }
}
export const getSatelliteAttribution = () => satelliteAttribution;

/**
 * Flat dark / light vector basemaps for the 2D maps, like Strava's activity map. OpenFreeMap is
 * free and keyless, so it's loaded directly rather than through the tile proxy.
 */
export const DARK_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
export const LIGHT_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

// ---------------------------------------------------------------------------------------------
// Flyover looks
// ---------------------------------------------------------------------------------------------

export type LookId = "night" | "golden" | "editorial" | "satellite" | "noir" | "bluehour" | "blueprint";

export interface Look {
  id: LookId;
  label: string;
  /** HUD palette: light text on dark glass, or dark text on paper. */
  hud: "dark" | "light";
  /** Which route ramp variant reads on this basemap. */
  ramp: MapTheme;
  /** Route color when coloring is solid and the athlete kept the default color. */
  solid?: string;
  /** Glow under the line (defaults to the line color). */
  glow?: string;
  /** Casing: dark on imagery and dark maps, white on paper. */
  casing: string;
  titleFont: "display" | "serif";
  /** Text for the export watermark line, without HTML. */
  attribution: () => string;
}

const strip = (s: string) => s.replace(/<[^>]+>/g, "");

export const LOOKS: Record<LookId, Look> = {
  night: {
    id: "night",
    label: "Night Run",
    hud: "dark",
    ramp: "dark",
    casing: "#07080a",
    titleFont: "display",
    attribution: () => `${strip(OFM_ATTRIBUTION)} · ${strip(OSM_ATTRIBUTION)} · ${TERRAIN_ATTRIBUTION}`,
  },
  golden: {
    id: "golden",
    label: "Golden Hour",
    hud: "dark",
    ramp: "dark",
    solid: "#fff6e5",
    glow: "#ff9a3d",
    casing: "#2a1606",
    titleFont: "display",
    attribution: () => `${strip(satelliteAttribution)} · ${strip(OSM_ATTRIBUTION)}`,
  },
  editorial: {
    id: "editorial",
    label: "Editorial",
    hud: "light",
    ramp: "light",
    casing: "#ffffff",
    titleFont: "serif",
    attribution: () => `${strip(OFM_ATTRIBUTION)} · ${strip(OSM_ATTRIBUTION)} · ${TERRAIN_ATTRIBUTION}`,
  },
  satellite: {
    id: "satellite",
    label: "Satellite",
    hud: "dark",
    ramp: "dark",
    casing: "#07080a",
    titleFont: "display",
    attribution: () => `${strip(satelliteAttribution)} · ${strip(OSM_ATTRIBUTION)}`,
  },
  noir: {
    id: "noir",
    label: "Noir",
    hud: "dark",
    ramp: "dark",
    casing: "#000000",
    titleFont: "display",
    attribution: () => `${strip(satelliteAttribution)} · ${strip(OSM_ATTRIBUTION)}`,
  },
  bluehour: {
    id: "bluehour",
    label: "Blue Hour",
    hud: "dark",
    ramp: "dark",
    solid: "#ffffff",
    glow: "#6f8bff",
    casing: "#0a1030",
    titleFont: "display",
    attribution: () => `${strip(satelliteAttribution)} · ${strip(OSM_ATTRIBUTION)}`,
  },
  blueprint: {
    id: "blueprint",
    label: "Blueprint",
    hud: "dark",
    ramp: "dark",
    solid: "#ffffff",
    glow: "#4fc3ff",
    casing: "#0a1c36",
    titleFont: "display",
    attribution: () => `${strip(OFM_ATTRIBUTION)} · ${strip(OSM_ATTRIBUTION)} · ${TERRAIN_ATTRIBUTION}`,
  },
};

const FONT = ["Noto Sans Regular"];
const isPoint = ["match", ["geometry-type"], ["Point", "MultiPoint"], true, false];
const isLine = ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false];

const demSource = () =>
  ({ type: "raster-dem", tiles: tiles("terrain"), tileSize: 256, maxzoom: 15, encoding: "terrarium", attribution: TERRAIN_ATTRIBUTION }) as const;

/** Upright labels over imagery: water, places, major road names only (no POIs, no clutter). */
function imageryLabels(halo: string, text: string): LayerSpecification[] {
  const h = { "text-halo-color": halo, "text-halo-width": 1.4, "text-halo-blur": 0.5 };
  return [
    {
      id: "road-names",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "transportation_name",
      minzoom: 14,
      filter: ["all", isLine, ["match", ["get", "class"], ["motorway", "trunk", "primary", "secondary"], true, false]] as never,
      layout: { "symbol-placement": "line", "text-field": ["get", "name"], "text-font": FONT, "text-size": 11 },
      paint: { "text-color": text, ...h },
    },
    {
      id: "water-names-line",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "water_name",
      filter: isLine as never,
      layout: { "symbol-placement": "line", "text-field": ["get", "name"], "text-font": FONT, "text-size": 13, "text-letter-spacing": 0.1 },
      paint: { "text-color": "#d6ecff", ...h },
    },
    {
      id: "water-names",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "water_name",
      filter: isPoint as never,
      layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": 14, "text-letter-spacing": 0.1 },
      paint: { "text-color": "#d6ecff", ...h },
    },
    {
      id: "place-names",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      filter: ["all", isPoint, ["match", ["get", "class"], ["neighbourhood", "quarter", "suburb", "village", "town", "city"], true, false]] as never,
      layout: {
        "text-field": ["get", "name"],
        "text-font": FONT,
        "text-size": ["match", ["get", "class"], "city", 18, "town", 16, 14] as never,
        "text-transform": "uppercase",
        "text-letter-spacing": 0.08,
      },
      paint: { "text-color": text, ...h },
    },
  ];
}

/** Color grades for the imagery looks: raster adjustments, a draped wash, and a matching sky. */
type Grade = "none" | "warm" | "noir" | "blue";

const GRADES: Record<Grade, { raster: Record<string, number>; wash?: [string, number]; sky: StyleSpecification["sky"] }> = {
  none: {
    raster: { "raster-saturation": -0.1, "raster-contrast": 0.05 },
    sky: {
      "sky-color": "#7fb1e6",
      "sky-horizon-blend": 0.6,
      "horizon-color": "#dfe9f2",
      "horizon-fog-blend": 0.6,
      "fog-color": "#c9d6e2",
      "fog-ground-blend": 0.85,
    },
  },
  // Golden Hour: warmer imagery, an amber wash, amber fog.
  warm: {
    raster: { "raster-saturation": 0.12, "raster-contrast": 0.12, "raster-brightness-max": 0.94, "raster-hue-rotate": -4 },
    wash: ["#ff8a2a", 0.13],
    sky: {
      "sky-color": "#6f8fb8",
      "horizon-color": "#f6c38b",
      "fog-color": "#e8b27a",
      "sky-horizon-blend": 0.7,
      "horizon-fog-blend": 0.55,
      "fog-ground-blend": 0.92,
    },
  },
  // Noir: black-and-white imagery with punchy contrast, so a colored route is the only color on screen.
  noir: {
    raster: { "raster-saturation": -1, "raster-contrast": 0.28, "raster-brightness-max": 0.86 },
    sky: {
      "sky-color": "#2b2d30",
      "horizon-color": "#8a8d91",
      "fog-color": "#55585c",
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.5,
      "fog-ground-blend": 0.9,
    },
  },
  // Blue Hour: the minutes after sunset, cool and dim, with a pink horizon.
  blue: {
    raster: { "raster-saturation": -0.35, "raster-contrast": 0.1, "raster-brightness-max": 0.72, "raster-hue-rotate": 8 },
    wash: ["#2f4cff", 0.16],
    sky: {
      "sky-color": "#1b2350",
      "horizon-color": "#d98aa8",
      "fog-color": "#3a3f7a",
      "sky-horizon-blend": 0.75,
      "horizon-fog-blend": 0.5,
      "fog-ground-blend": 0.9,
    },
  },
};

/** Satellite imagery + 3D terrain + sky, with upright vector labels like Strava's flyover, in one of the grades above. */
export function satelliteStyle(exaggeration = 1.3, grade: Grade = "none"): StyleSpecification {
  const g = GRADES[grade];
  const layers: LayerSpecification[] = [
    { id: "background", type: "background", paint: { "background-color": "#0d0d0d" } },
    { id: "satellite", type: "raster", source: "satellite", paint: g.raster },
  ];
  if (g.wash) {
    // A world-sized wash draped on the terrain: the cheapest honest "color grade" for raster tiles.
    layers.push({ id: "grade-wash", type: "fill", source: "grade", paint: { "fill-color": g.wash[0], "fill-opacity": g.wash[1] } });
  }
  layers.push(...imageryLabels("rgba(0,0,0,0.75)", grade === "blue" ? "rgba(220,228,255,0.85)" : "rgba(255,255,255,0.85)"));
  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      satellite: { type: "raster", tiles: tiles("satellite"), tileSize: 256, maxzoom: 19, attribution: satelliteAttribution },
      dem: demSource(),
      openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
      grade: {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-180, -85],
                [180, -85],
                [180, 85],
                [-180, 85],
                [-180, -85],
              ],
            ],
          },
        },
      },
    },
    layers,
    terrain: { source: "dem", exaggeration },
    sky: { ...g.sky, "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 10, 1, 12, 0] },
  };
}

const styleCache = new Map<string, Promise<StyleSpecification>>();
function fetchStyle(url: string): Promise<StyleSpecification> {
  if (!styleCache.has(url)) {
    styleCache.set(
      url,
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`Couldn't load the map style (${r.status}).`);
        return r.json() as Promise<StyleSpecification>;
      }),
    );
  }
  return styleCache.get(url)!.then((s) => structuredClone(s));
}

/** Keeps only the symbol layers whose ids are listed: major roads and place names, never POIs. */
function declutter(style: StyleSpecification, keep: RegExp, text: string, halo: string) {
  style.layers = style.layers.filter((l) => l.type !== "symbol" || keep.test(l.id));
  for (const l of style.layers) {
    if (l.type !== "symbol") continue;
    l.paint = { ...l.paint, "text-color": text, "text-halo-color": halo, "text-halo-width": 1.2 };
  }
}

/** Puts `layer` just below the first layer matching `before` (roads, so hillshade sits under them). */
function insertBefore(style: StyleSpecification, layer: LayerSpecification, before: RegExp) {
  const i = style.layers.findIndex((l) => before.test(l.id));
  style.layers.splice(i < 0 ? 1 : i, 0, layer);
}

/**
 * "Night Run": dark vector basemap with muted labels (major roads and places only), hillshade
 * at ~30% for depth, and a dark sky with a faint fog horizon so the route's accent carries.
 */
async function nightStyle(exaggeration: number): Promise<StyleSpecification> {
  const style = await fetchStyle(DARK_STYLE_URL);
  declutter(style, /^(water_name|highway_name_motorway|place_(suburb|village|town|city|city_large))$/, "rgba(160,166,174,0.78)", "rgba(7,8,10,0.85)");
  for (const l of style.layers) if (l.id === "background") l.paint = { "background-color": "#07080a" };
  style.sources.dem = demSource();
  insertBefore(
    style,
    {
      id: "hillshade",
      type: "hillshade",
      source: "dem",
      paint: {
        "hillshade-exaggeration": 0.32,
        "hillshade-shadow-color": "#000000",
        "hillshade-highlight-color": "#2a3140",
        "hillshade-accent-color": "#07080a",
        "hillshade-illumination-direction": 315,
      },
    },
    /^(waterway|building|highway_path)$/,
  );
  style.terrain = { source: "dem", exaggeration };
  style.sky = {
    // Fog only at the horizon, in the basemap's own tone, so the far ground never fades to black.
    "sky-color": "#10141b",
    "horizon-color": "#1e2633",
    "fog-color": "#1a1e24",
    "sky-horizon-blend": 0.5,
    "horizon-fog-blend": 0.5,
    "fog-ground-blend": 0.95,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 10, 1, 12, 0],
  };
  return style;
}

let contours: InstanceType<typeof mlcontourModule.DemSource> | null = null;
/** Contour lines generated in a worker from the same terrain tiles (no extra provider). */
async function contourSource() {
  if (!contours) {
    const { default: mlcontour } = await import("maplibre-contour");
    contours = new mlcontour.DemSource({ url: tiles("terrain")[0], encoding: "terrarium", maxzoom: 13, worker: true });
    contours.setupMaplibre({ addProtocol } as never);
  }
  return contours.contourProtocolUrl({
    // Meters between lines by zoom: [minor, major]. Fine at street zooms so city hills still read.
    thresholds: { 11: [50, 200], 12: [20, 100], 13: [10, 50], 14: [5, 25], 15: [5, 25] },
    elevationKey: "ele",
    levelKey: "level",
    contourLayer: "contours",
  });
}

/** "Editorial": light topo map with contour lines and soft hillshade; the route in one bold color. */
async function editorialStyle(exaggeration: number): Promise<StyleSpecification> {
  const style = await fetchStyle(LIGHT_STYLE_URL);
  declutter(style, /^(water_name_(point|line)_label|highway-name-major|label_(village|town|city|city_capital))$/, "#5b5a55", "rgba(255,255,255,0.9)");
  style.sources.dem = demSource();
  style.sources.contours = { type: "vector", tiles: [await contourSource()], maxzoom: 15 };
  const firstRoad = /^(highway|road|tunnel|bridge|railway|building)/;
  insertBefore(
    style,
    {
      id: "hillshade",
      type: "hillshade",
      source: "dem",
      paint: {
        "hillshade-exaggeration": 0.22,
        "hillshade-shadow-color": "#8f8a7a",
        "hillshade-highlight-color": "#ffffff",
        "hillshade-accent-color": "#c9c3b0",
      },
    },
    firstRoad,
  );
  insertBefore(
    style,
    {
      id: "contours",
      type: "line",
      source: "contours",
      "source-layer": "contours",
      paint: {
        "line-color": "#b49a6a",
        "line-opacity": ["match", ["get", "level"], 1, 0.55, 0.28] as never,
        "line-width": ["match", ["get", "level"], 1, 1, 0.5] as never,
      },
    },
    firstRoad,
  );
  style.layers.push({
    id: "contour-labels",
    type: "symbol",
    source: "contours",
    "source-layer": "contours",
    filter: [">", ["get", "level"], 0] as never,
    layout: {
      "symbol-placement": "line",
      "text-size": 10,
      "text-field": ["concat", ["number-format", ["get", "ele"], {}], " m"] as never,
      "text-font": FONT,
    },
    paint: { "text-color": "#9c8455", "text-halo-color": "#ffffff", "text-halo-width": 1 },
  });
  style.terrain = { source: "dem", exaggeration };
  style.sky = {
    "sky-color": "#dfe6ec",
    "horizon-color": "#f4f1ea",
    "fog-color": "#f4f1ea",
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.6,
    "fog-ground-blend": 0.92,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 10, 1, 12, 0],
  };
  return style;
}

/**
 * "Blueprint": the dark vector map redrawn as a drafting sheet: navy ground, every road and
 * building in thin pale-blue line work, contour lines from the terrain, and labels in light blue.
 */
async function blueprintStyle(exaggeration: number): Promise<StyleSpecification> {
  const style = await fetchStyle(DARK_STYLE_URL);
  declutter(style, /^(water_name|highway_name_motorway|place_(suburb|village|town|city|city_large))$/, "rgba(190,215,255,0.8)", "rgba(10,28,54,0.9)");
  const INK = "#8fb8f0";
  for (const l of style.layers) {
    if (l.type === "background") l.paint = { "background-color": "#0c2340" };
    else if (l.type === "fill") {
      const water = /water/.test(l.id);
      l.paint = water
        ? { "fill-color": "#081a33", "fill-opacity": 1 }
        : { "fill-color": "#0f2a4d", "fill-opacity": 0.55, "fill-outline-color": "rgba(143,184,240,0.35)" };
    } else if (l.type === "line") {
      const major = /motorway|trunk|primary|major/.test(l.id);
      l.paint = { ...l.paint, "line-color": INK, "line-opacity": major ? 0.42 : 0.18 };
    } else if (l.type === "fill-extrusion") {
      l.paint = { ...l.paint, "fill-extrusion-color": "#14345e", "fill-extrusion-opacity": 0.6 };
    }
  }
  style.sources.dem = demSource();
  style.sources.contours = { type: "vector", tiles: [await contourSource()], maxzoom: 15 };
  insertBefore(
    style,
    {
      id: "hillshade",
      type: "hillshade",
      source: "dem",
      paint: {
        "hillshade-exaggeration": 0.35,
        "hillshade-shadow-color": "#04101f",
        "hillshade-highlight-color": "#1f4f8a",
        "hillshade-accent-color": "#0c2340",
        "hillshade-illumination-direction": 315,
      },
    },
    /^(waterway|building|highway_path)$/,
  );
  insertBefore(
    style,
    {
      id: "contours",
      type: "line",
      source: "contours",
      "source-layer": "contours",
      paint: {
        "line-color": "#5fa8ff",
        "line-opacity": ["match", ["get", "level"], 1, 0.5, 0.22] as never,
        "line-width": ["match", ["get", "level"], 1, 0.9, 0.5] as never,
      },
    },
    /^(waterway|building|highway_path)$/,
  );
  style.terrain = { source: "dem", exaggeration };
  style.sky = {
    "sky-color": "#08172c",
    "horizon-color": "#163a66",
    "fog-color": "#0c2340",
    "sky-horizon-blend": 0.5,
    "horizon-fog-blend": 0.5,
    "fog-ground-blend": 0.95,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 10, 1, 12, 0],
  };
  return style;
}

export function flyoverStyle(id: LookId, exaggeration: number): Promise<StyleSpecification> {
  if (id === "night") return nightStyle(exaggeration);
  if (id === "editorial") return editorialStyle(exaggeration);
  if (id === "blueprint") return blueprintStyle(exaggeration);
  const grade: Grade = id === "golden" ? "warm" : id === "noir" ? "noir" : id === "bluehour" ? "blue" : "none";
  return Promise.resolve(satelliteStyle(exaggeration, grade));
}

void loadMapConfig();
