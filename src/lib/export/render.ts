import { type ErrorEvent, Map as MlMap } from "maplibre-gl";
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, type VideoCodec, WebMOutputFormat, getFirstEncodableVideoCodec } from "mediabunny";
import type { Analysis } from "../analysis/types";
import { type TerrainGrid, sampler } from "../geo/terrainGrid";
import { drawHud, loadHudFonts } from "../hud/hud";
import { type ColorMode } from "../map/route";
import { LOOKS, type LookId, flyoverStyle } from "../map/style";
import { FlyoverRenderer, addFlyoverLayers, settled } from "../playback/renderer";
import { type CameraMode, type Timeline, buildTimeline } from "../playback/timeline";

export type Aspect = "9:16" | "1:1" | "16:9";

export interface ExportOptions {
  aspect: Aspect;
  /** Length of the short side in pixels. */
  resolution: 720 | 1080;
  followSeconds: number;
  colorMode: ColorMode;
  routeColor: string;
  look: LookId;
  mode: CameraMode;
  exaggeration: number;
  reducedMotion: boolean;
  stats: boolean;
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
}

export interface ExportResult {
  blob: Blob;
  extension: "mp4" | "webm" | "png";
  width: number;
  height: number;
  duration: number;
  method: "webcodecs" | "mediarecorder" | "still";
}

export function exportSize(aspect: Aspect, short: number) {
  const even = (v: number) => Math.round(v / 2) * 2;
  if (aspect === "9:16") return { width: short, height: even((short * 16) / 9) };
  if (aspect === "16:9") return { width: even((short * 16) / 9), height: short };
  return { width: short, height: short };
}

const PIXEL_RATIO = 2;

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
export function exportDuration(followSeconds: number, endCard: boolean, reducedMotion: boolean) {
  return (reducedMotion ? 1.2 : 3) + 1.2 + Math.max(4, followSeconds) + 1.6 + (reducedMotion ? 2.4 : 3.2) + (endCard ? 3 : 1);
}

interface Stage {
  map: MlMap;
  renderer: FlyoverRenderer;
  timeline: Timeline;
  composite: HTMLCanvasElement;
  W: number;
  H: number;
  draw(T: number, poster?: boolean): Promise<void>;
  cleanup(): void;
}

/** An off-screen map at export resolution plus the composite canvas the HUD is drawn onto. */
async function stage(a: Analysis, opts: ExportOptions, signal: AbortSignal): Promise<Stage> {
  const { width: W, height: H } = exportSize(opts.aspect, opts.resolution);
  const cssW = W / PIXEL_RATIO;
  const cssH = H / PIXEL_RATIO;
  const look = LOOKS[opts.look];

  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-${cssW + 100}px;top:0;width:${cssW}px;height:${cssH}px;pointer-events:none;`;
  document.body.appendChild(host);
  const [style] = await Promise.all([flyoverStyle(opts.look, opts.exaggeration), loadHudFonts()]);
  const map = new MlMap({
    container: host,
    style,
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    pixelRatio: PIXEL_RATIO,
    maxPitch: 85,
    canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
    center: [a.samples[0].lon, a.samples[0].lat],
    zoom: 13,
  });
  const cleanup = () => {
    map.remove();
    host.remove();
  };
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
  addFlyoverLayers(map, look);
  const renderer = new FlyoverRenderer(map, a, { mode: opts.colorMode, color: opts.routeColor, theme: look.ramp }, look);
  const timeline = buildTimeline(a, {
    followSeconds: opts.followSeconds,
    width: cssW,
    height: cssH,
    mode: opts.mode,
    exaggeration: opts.exaggeration,
    reducedMotion: opts.reducedMotion,
    endSeconds: opts.endCard ? 3 : 1,
    endCard: opts.endCard,
    elevationAt: opts.terrain ? sampler(opts.terrain, NaN) : null,
  });
  const composite = document.createElement("canvas");
  composite.width = W;
  composite.height = H;
  const ctx = composite.getContext("2d")!;
  const attribution = look.attribution();

  const draw = async (T: number, poster = false) => {
    if (signal.aborted) throw new DOMException("Export canceled", "AbortError");
    // Browsers stop rendering hidden tabs; wait rather than capture a half-drawn frame.
    await whenVisible(signal);
    const state = timeline.frame(T);
    renderer.apply(state);
    await settled(map);
    ctx.drawImage(map.getCanvas(), 0, 0, W, H);
    drawHud(ctx, W, H, a, state, {
      look,
      accent: opts.routeColor,
      stats: opts.stats,
      endCard: opts.endCard,
      attribution,
      exaggeration: opts.exaggeration,
      project: (at) => {
        const p = renderer.project(at);
        return p ? [p[0] * PIXEL_RATIO, p[1] * PIXEL_RATIO] : null;
      },
      poster,
    });
  };
  return { map, renderer, timeline, composite, W, H, draw, cleanup };
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
  const st = await stage(a, opts, hooks.signal);
  const previewCtx = hooks.preview?.getContext("2d") ?? null;
  try {
    // No separate tile pre-pass: every frame already waits for its own tiles, so flying the
    // route twice only doubled the waiting.
    const total = Math.ceil(st.timeline.duration * opts.fps);
    const drawFrame = async (i: number) => {
      await st.draw(i / opts.fps);
      if (previewCtx && hooks.preview) previewCtx.drawImage(st.composite, 0, 0, hooks.preview.width, hooks.preview.height);
      hooks.onProgress({ stage: "frames", frame: i + 1, total, elapsedMs: performance.now() - started });
    };

    const codec = typeof VideoEncoder !== "undefined" ? await getFirstEncodableVideoCodec(["avc", "vp9", "av1"], { width: st.W, height: st.H }) : null;
    if (codec) {
      const extension = codec === "avc" ? "mp4" : "webm";
      const output = new Output({
        format: extension === "mp4" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(),
        target: new BufferTarget(),
      });
      const source = new CanvasSource(st.composite, { codec, bitrate: videoBitrate(codec, st.W, st.H, opts.fps), keyFrameInterval: 2 });
      output.addVideoTrack(source, { frameRate: opts.fps });
      await output.start();
      try {
        for (let i = 0; i < total; i++) {
          await drawFrame(i);
          await source.add(i / opts.fps, 1 / opts.fps);
        }
        source.close();
        await output.finalize();
      } catch (err) {
        await output.cancel();
        throw err;
      }
      return {
        blob: new Blob([output.target.buffer!], { type: extension === "mp4" ? "video/mp4" : "video/webm" }),
        extension,
        width: st.W,
        height: st.H,
        duration: total / opts.fps,
        method: "webcodecs",
      };
    }

    // Last resort: record the composite canvas in real time (variable frame rate). Frames that
    // take longer than 1/fps to load are held, so playback may stutter where tiles were slow.
    const mime = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) throw new Error("This browser can't encode video. Try a recent Chrome, Edge or Safari.");
    const stream = st.composite.captureStream(opts.fps);
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
    await drawFrame(0);
    recorder.start(1000);
    const t0 = performance.now();
    try {
      for (let i = 1; i < total; i++) {
        await drawFrame(i);
        const wait = t0 + (i * 1000) / opts.fps - performance.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
    } finally {
      recorder.stop();
      await stopped;
    }
    const extension = mime.startsWith("video/mp4") ? "mp4" : "webm";
    return { blob: new Blob(chunks, { type: mime.split(";")[0] }), extension, width: st.W, height: st.H, duration: total / opts.fps, method: "mediarecorder" };
  } finally {
    st.cleanup();
  }
}

/** A poster still (PNG): the pull-back framing of the whole route with the summary card. */
export async function renderPoster(a: Analysis, opts: ExportOptions, signal: AbortSignal): Promise<ExportResult> {
  const st = await stage(a, { ...opts, endCard: true }, signal);
  try {
    const T = st.timeline.marks.end + 0.5;
    await st.draw(T, false);
    // A second pass after tiles for the final camera are certainly in.
    await st.draw(T, true);
    const blob = await new Promise<Blob>((resolve, reject) => st.composite.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode the poster."))), "image/png"));
    return { blob, extension: "png", width: st.W, height: st.H, duration: 0, method: "still" };
  } finally {
    st.cleanup();
  }
}
