// Edge Worker: serves the React app (via static assets) and two tiny endpoints. Map tiles don't
// pass through here: the browser fetches them straight from each provider.

type Secrets = { MAPTILER_KEY?: string };
const key = (env: Env) => (env as Env & Secrets).MAPTILER_KEY;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") return Response.json({ ok: true });

    // Which satellite imagery to use: Esri by default; MapTiler when a key is set (MapTiler keys
    // are public by design and locked to the site's domain in the MapTiler dashboard).
    if (url.pathname === "/api/config") {
      const k = key(env);
      return Response.json(
        k
          ? {
              satelliteAttribution: '<a href="https://www.maptiler.com/copyright/">© MapTiler</a>',
              satelliteTiles: `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${k}`,
            }
          : { satelliteAttribution: "Imagery © Esri, Maxar, Earthstar Geographics" },
        { headers: { "Cache-Control": "public, max-age=3600" } },
      );
    }

    if (url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
