// Installable app: the service worker, the browser's install prompt, and activity files that
// arrive from outside — opened with the app ("Open with…" on desktop) or shared to it on a phone.

import { create } from "zustand";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export const useInstall = create<{
  /** The browser offered to install (Chrome, Edge, Android). */
  prompt: InstallPrompt | null;
  /** Safari on iPhone/iPad: no prompt, installed from the Share menu. */
  iosHint: boolean;
  installed: boolean;
}>(() => ({ prompt: null, iosHint: false, installed: false }));

export async function install() {
  const p = useInstall.getState().prompt;
  if (!p) return;
  await p.prompt();
  const { outcome } = await p.userChoice;
  useInstall.setState({ prompt: null, installed: outcome === "accepted" });
}

/** Files handed to the app from outside, waiting for the router to pick them up. */
export const useIncoming = create<{ files: File[] | null }>(() => ({ files: null }));

async function sharedFiles(): Promise<File[]> {
  const inbox = await caches.open("av-share-inbox");
  const files: File[] = [];
  for (const req of await inbox.keys()) {
    const res = await inbox.match(req);
    const name = new URL(req.url).searchParams.get("name") || "shared.gpx";
    if (res) files.push(new File([await res.blob()], name));
    await inbox.delete(req);
  }
  return files;
}

export function setupPwa() {
  const installed = standalone();
  useInstall.setState({ installed, iosHint: !installed && ios() });
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    useInstall.setState({ prompt: e as InstallPrompt });
  });
  window.addEventListener("appinstalled", () => useInstall.setState({ prompt: null, installed: true }));

  // Opened with the app from the file manager (installed desktop app).
  const lq = (window as Window & { launchQueue?: { setConsumer(cb: (p: { files: FileSystemFileHandle[] }) => void): void } }).launchQueue;
  lq?.setConsumer(async ({ files }) => {
    if (!files?.length) return;
    useIncoming.setState({ files: await Promise.all(files.map((h) => h.getFile())) });
  });

  // Shared from another app: the service worker parked the files and opened /?shared=1.
  const url = new URL(location.href);
  if (url.searchParams.has("shared")) {
    history.replaceState(null, "", url.pathname);
    if ("caches" in window)
      void sharedFiles().then((files) => files.length && useIncoming.setState({ files }), () => {});
  }

  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }
}
