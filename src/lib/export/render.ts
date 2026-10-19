import { type ErrorEvent, Map as MlMap } from "maplibre-gl";
// The encoder library (~65 KB gzipped) is loaded when a video is rendered, not with the page.
import type { VideoCodec } from "mediabunny";
import type { Analysis } from "../analysis/types";
import { type TerrainGrid, sampler } from "../geo/terrainGrid";
import { drawHud, loadHudFonts } from "../hud/hud";
import type { EndStat, LiveStat } from "../hud/stats";
import { type ColorMode } from "../map/route";
import { DETAIL, type DetailLevel, applyTerrainQuality } from "../map/detail";
import { addBuildingLayer, addLandmarkLayers } from "../map/landmarks";
import type { Weather } from "../weather";
import type { GhostRunner } from "../playback/ghosts";
import { withPhotoStops } from "../playback/photoStops";
import { GLOBE_SECONDS, withGlobeIntro } from "../playback/globeIntro";
import type { LngLat } from "../geo/geo";
import { type Haze, activityAir, activitySun, applyAtmosphere, applySunLighting, captureAtmosphere } from "../map/sun";
import { LOOKS, type LookId, flyoverStyle } from "../map/style";
import { planTiles, preloadTiles, releaseTiles, reloadFailedTiles, retryTiles, tileHealth } from "../map/tileFetch";
import { FlyoverRenderer, addFlyoverLayers, settled } from "../playback/renderer";
import { type CameraMode, type Timeline, buildTimeline } from "../playback/timeline";

export type Aspect = "9:16" | "4:5" | "1:1" | "16:9" | "21:9";

export type Resolution = 720 | 1080 | 2160;

export interface ExportOptions {
  aspect: Aspect;
  /** Length of the short side in pixels (2160 = 4K). */
  resolution: Resolution;
  followSeconds: number;
  colorMode: ColorMode;
  routeColor: string;
  look: LookId;
  mode: CameraMode;
  exaggeration: number;
  reducedMotion: boolean;
  stats: boolean;
  /** Which live values and end-card totals to show. */
  liveStats?: readonly LiveStat[];
  endStats?: readonly EndStat[];
  highlights?: boolean;
  /** Peak and landmark names on the map (default on). */
  landmarks?: boolean;
  /** 3D buildings (default on). */
  buildings?: boolean;
  /** Weather during the activity (when the user turned it on), for the weather stats. */
  weather?: Weather | null;
  /** Earlier runs of the route to race (ghost race), when set from the library. */
  ghosts?: readonly GhostRunner[] | null;
  /** Photos placed on the route (sample index), shown as the athlete passes. */
  photos?: readonly { image: ImageBitmap; at: LngLat; index: number }[] | null;
  /** Light terrain and buildings from the sun's real position (default on). */
  sunLighting?: boolean;
  /** Open on the whole globe and dive down to the activity. */
  globeIntro?: boolean;
  /** A playful scale on the end card or poster ("Climbed ≈ 2.4 Eiffel Towers"). */
  comparison?: boolean;
  /** The app's name and address on the frames (default on). */
  credit?: boolean;
  /** Haze over the distance ("auto": from the weather when it's on, else the look's own). */
  haze?: Haze;
  /** Multiplier on the chase camera distance. */
  distanceScale?: number;
  /** Map detail level (sharper terrain textures and imagery at High). */
  detail?: DetailLevel;
  endCard: boolean;
  fps: number;
  terrain: TerrainGrid | null;
}

export interface ExportProgress {
  /** "tiles" while the map loads its first frame. */
  stage: "tiles" | "frames";
  frame: number;
  total: number;
  elapsedMs: number;
  /** Tile requests retried because the tile server was rate-limiting (so the UI can say why it's slow). */
  rateLimited: number;
}

export interface ExportResult {
  blob: Blob;
  extension: "mp4" | "webm" | "png";
  width: number;
  height: number;
  duration: number;
  method: "webcodecs" | "mediarecorder" | "still";
  /** Frames captured with map tiles still missing after every retry (0 when the video is complete). */
  incompleteFrames: number;
}

export function exportSize(aspect: Aspect, short: number) {
  const even = (v: number) => Math.round(v / 2) * 2;
  if (aspect === "9:16") return { width: short, height: even((short * 16) / 9) };
  if (aspect === "4:5") return { width: short, height: even((short * 5) / 4) };
  if (aspect === "16:9") return { width: even((short * 16) / 9), height: short };
  if (aspect === "21:9") {
    // Capped at 3840 wide (4K): the widest map canvas and the widest most hardware encoders take.
    const width = Math.min(even((short * 21) / 9), 3840);
    return { width, height: even((width * 9) / 21) };
  }
  return { width: short, height: short };
}

/**
 * Map pixels per CSS pixel. 4K keeps 1080p's map size in CSS pixels (same framing, same label
 * sizes) and draws it at twice the density.
 */
const pixelRatioFor = (resolution: Resolution) => (resolution === 2160 ? 4 : 2);
/** The export page's progress text and preview update at most this often (ms). */
const PROGRESS_MS = 250;
/** Camera samples per second of video when working out which tiles to preload. */
const PLAN_HZ = 5;

/**
 * Bitrate for the encoder: Mediabunny's "high" quality at 30 fps (≈ 6 Mbps for 1080p H.264, which
 * scales with resolution only), raised for higher frame rates so 60 fps isn't softer per frame.
 * Frames 1/60 s apart differ less, so twice the frames needs ~1.7× the bits, not 2×.
 */
export function videoBitrate(codec: VideoCodec, width: number, height: number, fps: number): number {
  const efficiency: Partial<Record<VideoCodec, number>> = { avc: 1, hevc: 0.6, vp9: 0.6, av1: 0.4, vp8: 1.2 };
  const high = 0.3 * Math.exp(2.5538 * 0.75);
  const base = 3_000_000 * ((width * height) / (1920 * 1080)) ** 0.95 * (efficiency[codec] ?? 1) * high;
  return Math.ceil((base * Math.max(1, fps / 30) ** 0.75) / 1000) * 1000;
}

/** Total video length for these options (intro + reveal + chase + finish + pull-back + end card). */
export function exportDuration(followSeconds: number, endCard: boolean, reducedMotion: boolean, globeIntro = false) {
  return (reducedMotion ? 1.2 : 3) + 1.2 + Math.max(4, followSeconds) + 1.6 + (reducedMotion ? 2.4 : 3.2) + (endCard ? 3 : 1) + (globeIntro && !reducedMotion ? GLOBE_SECONDS : 0);
}

interface Stage {
  map: MlMap;
  renderer: FlyoverRenderer;
  timeline: Timeline;
  composite: HTMLCanvasElement;
  W: number;
  H: number;
  /** Renders one frame; resolves false if map tiles were still missing after retries. */
  draw(T: number, poster?: boolean): Promise<boolean>;
  cleanup(): void;
}

/** An off-screen map at export resolution plus the composite canvas the HUD is drawn onto. */
async function stage(a: Analysis, opts: ExportOptions, signal: AbortSignal): Promise<Stage> {
  const { width: W, height: H } = exportSize(opts.aspect, opts.resolution);
  const PIXEL_RATIO = pixelRatioFor(opts.resolution);
  const uhd = opts.resolution === 2160;
  const cssW = W / PIXEL_RATIO;
  const cssH = H / PIXEL_RATIO;
  const look = LOOKS[opts.look];

  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-${cssW + 100}px;top:0;width:${cssW}px;height:${cssH}px;pointer-events:none;`;
  document.body.appendChild(host);
  // Fonts are only needed for the first HUD draw: load them while the map loads.
  const fonts = loadHudFonts(look);
  // 4K always takes the finest tiles and terrain mesh: anything less would be upscaled.
  const detail = uhd ? "high" : (opts.detail ?? "standard");
  // Exports keep the full look even on Lite devices (Lite only lightens on-page maps).
  const style = await flyoverStyle(opts.look, opts.exaggeration, detail === "lite" ? "standard" : detail);
  const map = new MlMap({
    container: host,
    style,
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    pixelRatio: PIXEL_RATIO,
    maxPitch: 85,
    // No MSAA: with terrain almost everything is drawn into (un-antialiased) tile textures first,
    // so it only smoothed silhouettes, for ~4x the framebuffer memory. preserveDrawingBuffer stays:
    // a frame is copied out after asynchronous waits.
    canvasContextAttributes: { preserveDrawingBuffer: true, antialias: false },
    // Tiles retry rate limits and server errors instead of leaving holes in the frame.
    transformRequest: retryTiles,
    center: [a.samples[0].lon, a.samples[0].lat],
    zoom: 13,
  });
  let removed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    map.remove();
    host.remove();
  };
  // Phones drop the GL context under memory pressure; every frame after that would only time out.
  let contextLost = false;
  map.on("webglcontextlost", () => (contextLost = true));
  // (MapLibre loads its style on an animation frame, so a tab that's hidden right now waits here
  // until it's shown again; once loaded, frames render in a background tab too.)
  try {
    await new Promise<void>((resolve, reject) => {
      map.once("load", () => resolve());
      map.once("error", (e: ErrorEvent) => reject(e.error ?? new Error("Map failed to load")));
      signal.addEventListener("abort", () => reject(new DOMException("Export canceled", "AbortError")), { once: true });
    });
  } catch (err) {
    cleanup();
    throw err;
  }
  // The timeline already knows the ground height under the camera (from the terrain grid). Left
  // on, MapLibre re-snaps the camera to whichever elevation tile happens to be loaded, which
  // shifts the whole view up and down as tiles change: visible as jitter.
  if (opts.terrain) map.setCenterClampedToGround(false);
  redrawTexturesAtOnce(map);
  const globe = !!opts.globeIntro && !opts.reducedMotion;
  if (globe) map.setProjection({ type: "globe" });
  // Exports never go below MapLibre's default texture resolution (Lite only lightens on-page maps).
  // At 4K the draped textures need twice the resolution to stay as sharp (capped: 30 of them sit
  // in graphics memory).
  applyTerrainQuality(map, uhd ? 4 : Math.max(2, DETAIL[detail].terrainQuality));
  addFlyoverLayers(map, look);
  addLandmarkLayers(map, look, a.settings.units, opts.landmarks !== false);
  addBuildingLayer(map, look, opts.buildings !== false);
  const sun = opts.sunLighting === false ? null : activitySun(a.samples, !a.activity.routeOnly);
  if (sun) applySunLighting(map, sun);
  applyAtmosphere(map, captureAtmosphere(map), {
    realSky: opts.sunLighting !== false,
    sun: activitySun(a.samples, !a.activity.routeOnly),
    weather: activityAir(a.samples, opts.weather ?? null),
    haze: opts.haze ?? "auto",
  });
  const renderer = new FlyoverRenderer(map, a, { mode: opts.colorMode, color: opts.routeColor, theme: look.ramp }, look);
  // The map's size is fixed: project without reading layout from the DOM every frame.
  renderer.setViewport(cssW, cssH);
  await fonts;
  const base = buildTimeline(a, {
    followSeconds: opts.followSeconds,
    width: cssW,
    height: cssH,
    mode: opts.mode,
    exaggeration: opts.exaggeration,
    reducedMotion: opts.reducedMotion,
    distanceScale: opts.distanceScale,
    endSeconds: opts.endCard ? 3 : 1,
    endCard: opts.endCard,
    elevationAt: opts.terrain ? sampler(opts.terrain, NaN) : null,
  });
  // Photo stops hold the flyover while each photo (or collage) has the screen.
  const { timeline, pages: photoPages } = withPhotoStops(globe ? withGlobeIntro(base) : base, opts.photos?.map((p) => ({ image: p.image, index: p.index })) ?? []);
  const composite = document.createElement("canvas");
  composite.width = W;
  composite.height = H;
  const ctx = composite.getContext("2d")!;
  const attribution = look.attribution();

  const draw = async (T: number, poster = false) => {
    if (signal.aborted) throw new DOMException("Export canceled", "AbortError");
    if (contextLost) throw new Error("The browser ran out of graphics memory and stopped the map. Try 720p, or close other tabs and apps, and render again.");
    const state = timeline.frame(T);
    renderer.apply(state);
    const complete = await settleFrame(map, signal);
    ctx.drawImage(map.getCanvas(), 0, 0, W, H);
    drawHud(ctx, W, H, a, state, {
      look,
      accent: opts.routeColor,
      stats: opts.stats,
      liveStats: opts.liveStats,
      endStats: opts.endStats,
      highlights: opts.highlights,
      weather: opts.weather,
      ghosts: opts.ghosts,
      photoPages,
      endCard: opts.endCard,
      comparison: opts.comparison,
      credit: opts.credit,
      attribution,
      exaggeration: opts.exaggeration,
      project: (at) => {
        const p = renderer.project(at);
        return p ? [p[0] * PIXEL_RATIO, p[1] * PIXEL_RATIO] : null;
      },
      poster,
    });
    return complete;
  };
  return { map, renderer, timeline, composite, W, H, draw, cleanup };
}

/**
 * Waits until every tile the frame needs is in. MapLibre counts a tile that failed as "loaded",
 * so going idle isn't enough: if a tile failed even after fetchWithRetry's backoff, reload the
 * sources concerned and wait again. Returns false if the frame is still incomplete after that,
 * so the exporter can report it instead of shipping a hole silently.
 */
async function settleFrame(map: MlMap, signal: AbortSignal): Promise<boolean> {
  // Render right away, and again whenever tile data arrives, instead of waiting for the map's
  // next animation frame: browsers throttle those (30 Hz in iOS Low Power Mode, as low as 1 Hz in
  // windows that aren't in front), which made every frame that needed a tile wait a whole frame
  // or more. Rendering also starts the tile requests for the new camera immediately.
  // Timers are avoided too (a background window clamps them to ~1 s): it waits on tile events and
  // yields with a message, falling back to a timer only when nothing arrives.
  const failedNow = tileHealth.failed;
  const deadline = performance.now() + 8000;
  let spins = 0;
  while (performance.now() < deadline) {
    if (renderNow(map)) {
      if (tileHealth.failed === failedNow) return true;
      break;
    }
    // Tiles are in but something else needs another pass (label placement, textures): go again.
    if (map.areTilesLoaded() && spins++ < 4) await yieldNow();
    else {
      spins = 0;
      await dataOrTimeout(map, 250);
    }
  }
  // Fallback: let the map run its own animation frames, which browsers stop in hidden tabs.
  // (Everything above works in a background tab, so a hidden tab only waits here.)
  await whenVisible(signal);
  for (let attempt = 0; attempt < 3; attempt++) {
    const failedBefore = tileHealth.failed;
    const idle = await settled(map, attempt === 0 ? 8000 : 15000);
    if (idle && tileHealth.failed === failedBefore) return true;
    reloadFailedTiles(map);
  }
  return false;
}

// One reused channel: a new MessageChannel per yield would leave thousands of open ports behind.
let yieldChannel: MessageChannel | null = null;
const yieldQueue: (() => void)[] = [];

/** Lets queued tasks (tile messages from MapLibre's workers) run, without a timer. */
function yieldNow(): Promise<void> {
  if (!yieldChannel) {
    yieldChannel = new MessageChannel();
    yieldChannel.port1.onmessage = () => yieldQueue.shift()?.();
  }
  const channel = yieldChannel;
  return new Promise((resolve) => {
    yieldQueue.push(resolve);
    channel.port2.postMessage(null);
  });
}

/** Resolves when the map reports new data (a tile loaded or parsed), or after `ms` if none arrives. */
function dataOrTimeout(map: MlMap, ms: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      map.off("data", onData);
      // Let tiles that arrived together all land before rendering again.
      void yieldNow().then(resolve);
    };
    const onData = () => finish();
    const timer = setTimeout(finish, ms);
    map.on("data", onData);
  });
}

/** Renders the current camera synchronously; true when the map is complete (it went idle). */
function renderNow(map: MlMap): boolean {
  let idle = false;
  const onIdle = () => (idle = true);
  map.once("idle", onIdle);
  map.redraw();
  map.off("idle", onIdle);
  return idle;
}

/** Keeps the screen on while rendering (a locked phone pauses the page); re-acquired when the page comes back. */
function keepAwake(): () => void {
  type Sentinel = { release(): Promise<void> };
  const wl = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<Sentinel> } }).wakeLock;
  if (!wl) return () => {};
  let sentinel: Sentinel | null = null;
  let done = false;
  const acquire = () => {
    if (done || document.hidden) return;
    wl.request("screen").then(
      (s) => (done ? void s.release() : (sentinel = s)),
      () => {},
    );
  };
  acquire();
  document.addEventListener("visibilitychange", acquire);
  return () => {
    done = true;
    document.removeEventListener("visibilitychange", acquire);
    void sentinel?.release().catch(() => {});
  };
}

/**
 * With 3D terrain, MapLibre draws the map into one texture per terrain tile. After a zoom change
 * it redraws those textures one per animation frame (smooth for interactive maps), so an export
 * frame waited 20–40 browser frames for the zoom change it makes on almost every frame. Here
 * every stale texture is redrawn in the same pass instead: one render per export frame. This
 * reaches into MapLibre internals, so it checks their shape and does nothing if they change.
 */
function redrawTexturesAtOnce(map: MlMap) {
  type Rtt = {
    prepareForRender(style: unknown, zoom: number, moving: boolean): void;
    _textureDifference?(tile: unknown): string;
    _renderableTiles?: { releaseRTT(painter: unknown): void }[];
    needsFollowUpFrame: boolean;
    painter: unknown;
  };
  const rtt = (map as unknown as { painter?: { renderToTexture?: Rtt } }).painter?.renderToTexture;
  if (!rtt || typeof rtt.prepareForRender !== "function" || typeof rtt._textureDifference !== "function") return;
  const prepare = rtt.prepareForRender.bind(rtt);
  rtt.prepareForRender = (style, zoom, moving) => {
    prepare(style, zoom, moving);
    for (const tile of rtt._renderableTiles ?? []) if (rtt._textureDifference!(tile) !== "none") tile.releaseRTT(rtt.painter);
    rtt.needsFollowUpFrame = false;
  };
}

/**
 * A fresh file in the origin-private file system (on disk, not counted against page memory) to
 * stream an export into, or null where that isn't available. Earlier exports' files are removed.
 */
async function openVideoFile(extension: string) {
  try {
    const root = await navigator.storage?.getDirectory?.();
    if (!root) return null;
    const dir = await root.getDirectoryHandle("exports", { create: true });
    for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) await dir.removeEntry(name).catch(() => {});
    const handle = await dir.getFileHandle(`video-${Date.now()}.${extension}`, { create: true });
    if (typeof (handle as { createWritable?: unknown }).createWritable !== "function") return null;
    const writable = await handle.createWritable();
    return {
      writable: writable as unknown as WritableStream<{ type: "write"; data: Uint8Array<ArrayBuffer>; position: number }>,
      /** The finished file (read from disk on demand, not loaded into memory). */
      file: () => handle.getFile(),
      discard: () => dir.removeEntry(handle.name).catch(() => {}),
    };
  } catch {
    return null;
  }
}

/** Resolves when the page is visible (immediately if it already is). */
function whenVisible(signal: AbortSignal): Promise<void> {
  if (typeof document === "undefined" || !document.hidden) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      if (document.hidden) return;
      document.removeEventListener("visibilitychange", done);
      resolve();
    };
    document.addEventListener("visibilitychange", done);
    signal.addEventListener("abort", () => reject(new DOMException("Export canceled", "AbortError")), { once: true });
  });
}

/**
 * Renders the flyover frame by frame on an off-screen map, waiting for tiles before capturing
 * each frame, so the video never shows half-loaded imagery. Frame i is always video time i/fps:
 * nothing depends on the wall clock, so re-rendering gives identical frames.
 */
export async function renderVideo(
  a: Analysis,
  opts: ExportOptions,
  hooks: { onProgress: (p: ExportProgress) => void; preview?: HTMLCanvasElement | null; signal: AbortSignal },
): Promise<ExportResult> {
  const started = performance.now();
  const release = keepAwake();
  let st: Stage;
  try {
    st = await stage(a, opts, hooks.signal);
  } catch (err) {
    release();
    throw err;
  }
  const previewCtx = hooks.preview?.getContext("2d") ?? null;
  try {
    const limitedAtStart = tileHealth.rateLimited;
    // Preload every tile the flight needs, many at a time, before drawing anything: frames then
    // render from local data instead of each one waiting on its own network round trips (which
    // is what made phones slow, and why the map looked like it loaded in as the camera zoomed).
    // Each frame still waits for its tiles, so anything the plan missed is fetched on demand.
    const cameras = [];
    for (let T = 0; T <= st.timeline.duration; T += 1 / PLAN_HZ) cameras.push(st.timeline.frame(T).camera);
    let reported = 0;
    await preloadTiles(planTiles(st.map, cameras), hooks.signal, (done, all) => {
      if (done < all && performance.now() - reported < 100) return;
      reported = performance.now();
      hooks.onProgress({ stage: "tiles", frame: done, total: all, elapsedMs: performance.now() - started, rateLimited: tileHealth.rateLimited - limitedAtStart });
    });
    const total = Math.ceil(st.timeline.duration * opts.fps);
    let incompleteFrames = 0;
    let shown = 0;
    const drawFrame = async (i: number) => {
      if (!(await st.draw(i / opts.fps))) incompleteFrames++;
      // Re-rendering the page and scaling a 1080p frame into the preview every frame competes
      // with the map for the GPU; a few times a second is plenty to show progress.
      const now = performance.now();
      if (now - shown < PROGRESS_MS && i + 1 < total) return;
      shown = now;
      if (previewCtx && hooks.preview) previewCtx.drawImage(st.composite, 0, 0, hooks.preview.width, hooks.preview.height);
      hooks.onProgress({ stage: "frames", frame: i + 1, total, elapsedMs: now - started, rateLimited: tileHealth.rateLimited - limitedAtStart });
    };

    const { BufferTarget, CanvasSource, Mp4OutputFormat, Output, StreamTarget, WebMOutputFormat, getFirstEncodableVideoCodec } = await import("mediabunny");
    const codec = typeof VideoEncoder !== "undefined" ? await getFirstEncodableVideoCodec(["avc", "vp9", "av1"], { width: st.W, height: st.H }) : null;
    if (codec) {
      const extension = codec === "avc" ? "mp4" : "webm";
      // Stream the file to the browser's private on-device storage as it's encoded: a 5-minute
      // 1080p video is ~250 MB, and holding it in memory (then copying it into a Blob) could take
      // 2-3x that, enough to crash a low-memory phone. Falls back to memory where unsupported.
      const disk = await openVideoFile(extension);
      const output = new Output({
        format:
          extension === "mp4"
            ? // "reserve" keeps the index at the front (plays and uploads everywhere) while streaming;
              // it needs the frame count up front, which we know.
              new Mp4OutputFormat({ fastStart: disk ? "reserve" : "in-memory" })
            : new WebMOutputFormat(),
        target: disk ? new StreamTarget(disk.writable, { chunked: true }) : new BufferTarget(),
      });
      const source = new CanvasSource(st.composite, { codec, bitrate: videoBitrate(codec, st.W, st.H, opts.fps), keyFrameInterval: 2 });
      output.addVideoTrack(source, { frameRate: opts.fps, maximumPacketCount: total + 16 });
      await output.start();
      try {
        for (let i = 0; i < total; i++) {
          await drawFrame(i);
          await source.add(i / opts.fps, 1 / opts.fps);
        }
        source.close();
        // Free the map's GPU and tile memory before the file is assembled (which needs 2-3x its size).
        st.cleanup();
        await output.finalize();
      } catch (err) {
        await output.cancel();
        await disk?.discard();
        throw err;
      }
      const type = extension === "mp4" ? "video/mp4" : "video/webm";
      return {
        blob: disk ? new Blob([await disk.file()], { type }) : new Blob([(output.target as InstanceType<typeof BufferTarget>).buffer!], { type }),
        extension,
        width: st.W,
        height: st.H,
        duration: total / opts.fps,
        method: "webcodecs",
        incompleteFrames,
      };
    }

    // Last resort (no WebCodecs): record the composite canvas. The recorder times frames by the
    // wall clock, so it's paused while each frame renders and runs for exactly 1/fps per frame:
    // slow frames no longer stretch or squash the video. Without requestFrame/pause (rare), frames
    // are held while they render, so playback may stutter where tiles were slow.
    const mime = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) throw new Error("This browser can't encode video. Try a recent Chrome, Edge or Safari.");
    const stream = st.composite.captureStream(0);
    const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    const paced = typeof track.requestFrame === "function" && typeof recorder.pause === "function";
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // Each frame must stay on the recorder for exactly 1/fps of wall time. Timers can't be trusted
    // for that (a background window clamps them to a second or more), so wait by yielding instead.
    const hold = async (ms: number) => {
      const until = performance.now() + ms;
      while (performance.now() < until) await yieldNow();
    };
    await drawFrame(0);
    recorder.start(1000);
    track.requestFrame?.();
    const t0 = performance.now();
    try {
      for (let i = 1; i < total; i++) {
        if (paced) {
          await hold(1000 / opts.fps);
          recorder.pause();
          await drawFrame(i);
          recorder.resume();
          track.requestFrame!();
        } else {
          await drawFrame(i);
          const wait = t0 + (i * 1000) / opts.fps - performance.now();
          if (wait > 0) await sleep(wait);
        }
      }
      await (paced ? hold : sleep)(1000 / opts.fps);
    } finally {
      recorder.stop();
      await stopped;
    }
    const extension = mime.startsWith("video/mp4") ? "mp4" : "webm";
    return { blob: new Blob(chunks, { type: mime.split(";")[0] }), extension, width: st.W, height: st.H, duration: total / opts.fps, method: "mediarecorder", incompleteFrames };
  } finally {
    st.cleanup();
    release();
    void releaseTiles();
  }
}

/** A poster still (PNG): the pull-back framing of the whole route with the summary card. */
export async function renderPoster(a: Analysis, opts: ExportOptions, signal: AbortSignal): Promise<ExportResult> {
  const st = await stage(a, { ...opts, endCard: true }, signal);
  try {
    const T = st.timeline.marks.end + 0.5;
    await st.draw(T, false);
    // A second pass after tiles for the final camera are certainly in.
    const complete = await st.draw(T, true);
    const blob = await new Promise<Blob>((resolve, reject) => st.composite.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode the poster."))), "image/png"));
    return { blob, extension: "png", width: st.W, height: st.H, duration: 0, method: "still", incompleteFrames: complete ? 0 : 1 };
  } finally {
    st.cleanup();
  }
}
