// Edge Worker: serves the React app (via static assets) and proxies map tiles.
//
// The proxy keeps any imagery API key server-side, gives the browser same-origin tiles
// (so WebGL canvases stay readable for video export), and caches tiles at the edge.

interface TileSource {
  url: (z: number, x: number, y: number, env: Env) => string;
  maxzoom: number;
  contentType: string;
}

type Secrets = { MAPTILER_KEY?: string };
const key = (env: Env) => (env as Env & Secrets).MAPTILER_KEY;

const SOURCES: Record<string, TileSource> = {
  satellite: {
    url: (z, x, y, env) =>
      key(env)
        ? `https://api.maptiler.com/tiles/satellite-v2/${z}/${x}/${y}.jpg?key=${key(env)}`
        : // blankTile=false: where Esri has no imagery at this zoom (mountains, remote areas at z18-19)
          // it answers 404 instead of a grey "Map data not yet available" tile, so the map falls back
          // to the nearest coarser real imagery rather than drawing the placeholder.
          `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}?blankTile=false`,
    maxzoom: 19,
    contentType: "image/jpeg",
  },
  terrain: {
    url: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
    maxzoom: 15,
    contentType: "image/png",
  },
  // Mapterhorn: free, open high-resolution terrain (512 px Terrarium). Global to z12; finer where
  // national lidar is open (much of Europe and the US). Elsewhere z13+ is a 404 and the client
  // builds the tile from AWS terrain instead (see tileFetch).
  dem: {
    url: (z, x, y) => `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`,
    maxzoom: 16,
    contentType: "image/webp",
  },
};

const TILE_PATH = /^\/api\/tiles\/([a-z]+)\/(\d{1,2})\/(\d+)\/(\d+)$/;
const ONE_WEEK = 60 * 60 * 24 * 7;
const ONE_DAY = 60 * 60 * 24;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") return Response.json({ ok: true });

    if (url.pathname === "/api/config") {
      return Response.json({
        satelliteAttribution: key(env) ? '<a href="https://www.maptiler.com/copyright/">© MapTiler</a>' : "Imagery © Esri, Maxar, Earthstar Geographics",
      });
    }

    const m = url.pathname.match(TILE_PATH);
    if (m) return tile(request, env, ctx, m[1], Number(m[2]), Number(m[3]), Number(m[4]));

    if (url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function tile(request: Request, env: Env, ctx: ExecutionContext, name: string, z: number, x: number, y: number): Promise<Response> {
  const source = SOURCES[name];
  const n = 2 ** z;
  if (!source || z > source.maxzoom || x >= n || y >= n) {
    return new Response("Bad tile", { status: 400 });
  }
  // Browsers mark cross-site requests; refuse those so other sites can't hotlink the proxy.
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return new Response("Forbidden", { status: 403 });
  }

  const cache = caches.default;
  // Versioned with the client's ?v= so a change in what a tile URL returns isn't masked by the edge cache.
  const version = new URL(request.url).searchParams.get("v") ?? "1";
  const cacheKey = new Request(new URL(`/api/tiles/${name}/${z}/${x}/${y}?v=${version}`, request.url).toString());
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  const { success } = await env.TILE_LIMITER.limit({ key: ip });
  // Tell the client how long to back off; it retries rather than leaving a hole in the map.
  if (!success) return new Response("Too many tile requests", { status: 429, headers: { "Retry-After": "5" } });

  const upstream = await fetch(source.url(z, x, y, env), {
    headers: { "User-Agent": "activity-visualizer/0.1 (+tile proxy)" },
    cf: { cacheTtl: ONE_WEEK, cacheEverything: true },
  });
  if (!upstream.ok) {
    if (upstream.status !== 404) return new Response(null, { status: 502 });
    // Missing tiles (ocean, beyond coverage) are normal; let the map treat them as empty, and
    // remember that for a day so they don't go upstream (and count against the limit) each time.
    const missing = new Response(null, { status: 404, headers: { "Cache-Control": `public, max-age=${ONE_DAY}` } });
    ctx.waitUntil(cache.put(cacheKey, missing.clone()));
    return missing;
  }

  const response = new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? source.contentType,
      // A tile URL's content doesn't change within the week: browsers skip revalidating it.
      "Cache-Control": `public, max-age=${ONE_WEEK}, immutable`,
    },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
