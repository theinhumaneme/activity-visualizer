// Service worker: lets the app install, open offline, and receive activity files shared from other
// apps. Only same-origin app files are cached; map tiles keep their own cache (see tilePreload).

const SHELL = "av-shell-v1";
const INBOX = "av-share-inbox";
const PRECACHE = ["/", "/manifest.webmanifest", "/favicon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];
/** Hashed build files pile up across deploys; keep the newest this many. */
const MAX_ENTRIES = 400;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("av-shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ENTRIES; i++) await cache.delete(keys[i]);
}

/** Files shared to the installed app arrive as a form post: park them for the page, then open it. */
async function receiveShare(request) {
  const form = await request.formData();
  const inbox = await caches.open(INBOX);
  for (const k of await inbox.keys()) await inbox.delete(k);
  let n = 0;
  for (const f of form.getAll("files")) {
    if (typeof f === "string") continue;
    await inbox.put(`/share-inbox/${n++}?name=${encodeURIComponent(f.name)}`, new Response(f));
  }
  return Response.redirect("/?shared=1", 303);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.method === "POST" && url.pathname === "/share-target") return event.respondWith(receiveShare(req));
  if (req.method !== "GET" || url.pathname.startsWith("/api/")) return;

  // Pages: the network first (so a deploy shows at once), the cached app when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(SHELL).then((c) => c.put("/", copy));
          }
          return res;
        })
        .catch(() => caches.match("/").then((r) => r || Response.error())),
    );
    return;
  }

  // Build files never change under one name: the cache first.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              void caches.open(SHELL).then(async (c) => {
                await c.put(req, copy);
                await trim(c);
              });
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Everything else (icons, the sample activity): cached copy now, refreshed in the background.
  event.respondWith(
    caches.open(SHELL).then(async (c) => {
      const hit = await c.match(req);
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) void c.put(req, res.clone());
          return res;
        })
        .catch(() => hit || Response.error());
      return hit || fresh;
    }),
  );
});
