// Windows shell for Activity Visualizer: serves the built web app (app/) from a private app://
// origin, answers the two tiny /api endpoints the Cloudflare worker normally handles, and tells
// the user when a newer build has been published on the fork's Releases.
const { app, BrowserWindow, dialog, net, protocol, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const RELEASES = "https://github.com/ThePlayse/activity-visualizer/releases";
const ROOT = path.join(__dirname, "app");
const BUILD = JSON.parse(fs.readFileSync(path.join(__dirname, "build.json"), "utf8"));

// Portable exe: keep the library and settings next to the exe instead of %APPDATA%.
if (process.env.PORTABLE_EXECUTABLE_DIR) app.setPath("userData", path.join(process.env.PORTABLE_EXECUTABLE_DIR, "ActivityVisualizer-data"));

// A window covered by another one counts as hidden on Windows and stops rendering (export included).
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

// "standard + secure" makes app:// a secure context, which WebCodecs (video export) and IndexedDB need.
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

function serve(request) {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/health") return Response.json({ ok: true });
  // No MapTiler key on the desktop: the app falls back to Esri imagery.
  if (pathname === "/api/config") return Response.json({ satelliteAttribution: "Imagery © Esri, Maxar, Earthstar Geographics" });
  // A service worker would cache an old build across updates (same app:// origin every version).
  if (pathname.startsWith("/api/") || pathname === "/sw.js") return new Response("Not found", { status: 404 });
  let file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
  const inside = file.startsWith(ROOT + path.sep);
  // Unknown paths are client-side routes (/flyover, /library…): hand them the SPA.
  if (!(inside && fs.existsSync(file) && fs.statSync(file).isFile())) file = path.join(ROOT, "index.html");
  // Read directly: net.fetch(file://) left MapLibre's module workers hanging on a cold start.
  const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
  return fs.promises.readFile(file).then((body) => new Response(body, { headers: { "Content-Type": type } }));
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".gpx": "application/gpx+xml",
  ".tcx": "application/xml",
  ".fit": "application/octet-stream",
  ".xml": "application/xml",
};

async function checkForUpdate(win) {
  try {
    const res = await net.fetch("https://api.github.com/repos/ThePlayse/activity-visualizer/releases/latest", { headers: { "User-Agent": "activity-visualizer-desktop" } });
    if (!res.ok) return;
    const { tag_name: latest, html_url: url } = await res.json();
    if (!latest || latest === BUILD.tag) return;
    const { response } = await dialog.showMessageBox(win, {
      type: "info",
      buttons: ["Download", "Later"],
      defaultId: 0,
      message: "A new version of Activity Visualizer is available.",
      detail: `Installed: ${BUILD.tag}\nLatest: ${latest}`,
    });
    if (response === 0) shell.openExternal(url || RELEASES);
  } catch {
    // Offline or rate-limited: try again next launch.
  }
}

app.whenReady().then(() => {
  protocol.handle("app", serve);
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Activity Visualizer",
    icon: path.join(ROOT, "icons", "icon-512.png"),
    autoHideMenuBar: true,
    // A hidden or minimized window would pause animation frames, and with them a running video export.
    webPreferences: { backgroundThrottling: false },
  });
  // Footer credits and other target=_blank links open in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.loadURL("app://local/");
  if (app.isPackaged) win.webContents.once("did-finish-load", () => checkForUpdate(win));
});

app.on("window-all-closed", () => app.quit());
