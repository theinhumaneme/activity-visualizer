# Activity Visualizer

Upload any `.gpx` or `.tcx` activity (runs, rides, hikes, walks, skiing, paddling, swims, or anything else a GPS track can hold) from Google Health, Fitbit, Garmin, Strava and others. Check the data, dig into the analysis, watch a cinematic 3D flyover, and export a video or poster. Drop several files to build a library. Files are parsed and analyzed in the browser and never uploaded.

**Steps:** Upload → Check (data audit and settings) → Overview → Analysis → Flyover → Export. Several files open the **Library** (heatmap, race your past selves, progress, recap).

## What it does

- **Data audit and cleaning:** format, device and timezone, sampling, channels, file vs GPS distance, moving vs elapsed time, pauses. Teleport spikes are moved back onto the track, start and finish GPS drift is pinned, HR dropouts and spikes are removed, positionless trackpoints are interpolated, and per-leg cadence is doubled. Each fix is reported.
- **Per-sport profiles** (`src/lib/sport.ts`): speed limits, moving threshold, pace or speed (pace per 100 m for swims), grade-adjusted pace only for foot sports, best-effort distances, camera distance. Unknown sports are inferred from speed and labeled as inferred.
- **Analysis:** summary, pace with GAP and a raw band, elevation colored by grade or pace with auto-labeled climbs, heart rate with zones (labeled "estimated" until you set your max), cadence, splits, best efforts, efficiency, and interval reps with HR recovery. Reps come from device laps or are detected from pace changes, and need a repeating structure so traffic stops aren't counted.
- **Flyover:** establishing drop, start reveal, chase, highlights (fastest split, climbs, high point, reps, final kick), finish, pull-back, end card. The camera keeps the athlete at a fixed spot on screen, above the stats, whatever the speed; the marker's pace is smoothed so it never crawls and then races. Time compression and terrain exaggeration are shown on screen.
  - **Cameras:** Cinematic, Chase, Drone, Low, Side-on, Orbit, Overhead, or Free orbit (drag the map yourself). **Camera distance:** Auto (close for runs, rides and walks; far for hikes and everything else), Close, Medium or Far.
  - **Looks:** Night Run, Golden Hour, Editorial (with contours), Satellite, Noir, Blue Hour and Blueprint.
  - **Route color:** solid (10 colors), pace, HR zones, heart rate, grade, elevation, cadence or progress (keys 1–8).
  - **Preview frame:** Landscape, Portrait 9:16 or Square 1:1, framed exactly like the export (portrait by default on phones).
  - **Highlights** are small labels pinned to their spot on the map; turn them off if you prefer a clean map.
- **Privacy zone** (default 200 m): hides the route near your start and finish on every map, in the flyover and in exports. Stats still use the whole activity.
- **Export:** 9:16, 1:1 or 16:9 MP4 at 720p or 1080p, 30 or 60 fps, plus PNG posters. Rendered frame by frame on your device (deterministic; once frames start it keeps going in a background tab, and the screen stays awake).
  - **Route playback length:** 15 s, then 30 s to 5 min in 30 s steps. The default suits the activity, keeping the time-lapse around 200× or slower (2 min for a 6-hour marathon); the opening and ending add about 10 s. The page shows the resulting speed-up and an estimated file size.
  - **Stats:** choose what the live panel shows (total or moving time, distance, pace or speed, heart rate, elevation, grade, cadence, power; up to 6) and what the end card or poster shows (distance, total, moving and stopped time, average and best pace, elevation gain, loss and high point, average and max heart rate, cadence, power, calories; up to 8). Only stats the file has are offered, and your picks are remembered.

## Performance

- **Parsing, analysis and terrain sampling run in Web Workers**, so the page stays responsive with long activities. Each activity is sent to the analysis worker once; results come back with samples as transferable typed-array columns (`src/lib/analysis/columns.ts`). A dragged trim slider can't queue up stale work: a newer request replaces one still waiting.
- **Exports preload every map tile** the flight needs, render each frame as soon as its data is in (without waiting for the browser's animation frames, which phones throttle), and redraw all terrain textures in one pass per frame.
- **Loading:** routes are code-split and the next step is prefetched; MapLibre, the encoder and the contour generator load only when needed; fonts are self-hosted; hashed assets are cached for a year (`public/_headers`), and React lives in its own long-lived chunk.

## Develop

```bash
npm install
npm run dev        # Vite + the Worker together (Cloudflare Vite plugin)
npm test           # parser, analysis, camera and worker tests
npm run build
npx vite preview   # the production build, served by the Worker locally
```

Real activity files go in `tests/fixtures/private/`, which is git-ignored. The public sample (`public/samples/reservoir-loop.tcx.xml`) is synthetic: an OpenStreetMap route with a borrowed pace and HR rhythm, regenerated by `node scripts/make-demo.mjs <source.tcx>`.

## Deploy (Cloudflare Workers)

```bash
npx wrangler login
npm run deploy
```

The Worker (`worker/index.ts`) serves the built app as static assets with an SPA fallback and handles `/api/*`:

- `/api/tiles/{satellite|terrain}/z/x/y`: a tile proxy with edge caching and per-IP rate limiting. It keeps tiles same-origin so the WebGL canvas can be captured for video export. Missing tiles (404s) are cached for a day. Cloudflare only guarantees the edge cache on a custom domain, so attach one (rather than serving from `workers.dev`) for a public deployment.
- `/api/config`: tells the app which imagery attribution to show.

Satellite imagery defaults to Esri World Imagery, which is fine for development and light use. For a public app, get a MapTiler key and set it as a secret. It stays server-side and switches imagery automatically:

```bash
npx wrangler secret put MAPTILER_KEY
```

The 2D basemaps and flyover labels come from [OpenFreeMap](https://openfreemap.org) (free, no key). Terrain comes from the AWS Terrain Tiles open dataset.

## How the flyover and export work

`src/lib/playback/timeline.ts` is a pure function from video time to camera, marker and overlay cues. It bakes the whole camera path at 60 Hz, so live preview and export are frame-identical. `src/lib/hud/hud.ts` draws the HUD on a canvas, and the same code draws the preview overlay, every video frame and posters. Export (`src/lib/export/render.ts`) works out every tile the flight needs and preloads them, then renders each frame off-screen, waits for any missing tiles, composites the HUD, and encodes MP4 (H.264) with WebCodecs via [Mediabunny]. Browsers without WebCodecs fall back to a MediaRecorder capture that pauses while each frame renders, so the video keeps the right timing. Route playback lengths and camera distances live in `src/lib/playback/lengths.ts`; the stat catalogs in `src/lib/hud/stats.ts`.

Map styles live in `src/lib/map/style.ts`. Every provider is keyless by default (OpenFreeMap vector tiles, Esri imagery, AWS terrain), and switching provider means editing that file and the tile proxy in `worker/index.ts`.

[Mediabunny]: https://mediabunny.dev

## License

[MIT](LICENSE) © Kalyan Mudumby. Map data © OpenStreetMap contributors; basemaps by OpenFreeMap (OpenMapTiles); terrain from the AWS Terrain Tiles open dataset; imagery by Esri (or MapTiler with a key). Built with MapLibre GL JS, Mediabunny, React and uPlot.
