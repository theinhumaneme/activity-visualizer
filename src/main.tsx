import { StrictMode, Suspense, lazy, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
// Self-hosted fonts (same files Google Fonts serves): no render-blocking third-party stylesheet,
// and each script subset downloads only when a page uses it. Fraunces is only for the Editorial look.
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/fraunces/opsz.css";
import "./index.css";
import { resolveDetail } from "./lib/map/detail";
import { useStore } from "./state/store";

// Lets CSS drop costly effects (background blur) on Lite devices.
const markDetail = () => document.documentElement.setAttribute("data-detail", resolveDetail(useStore.getState().mapDetail));
markDetail();
useStore.subscribe((s, prev) => s.mapDetail !== prev.mapDetail && markDetail());
import { Layout } from "./components/Layout";
import { RequireActivity } from "./components/RequireActivity";
import { CheckPage } from "./routes/CheckPage";
import { UploadPage } from "./routes/UploadPage";

// Map-heavy steps load MapLibre on demand so the upload page stays small.
const pages = {
  "/overview": () => import("./routes/OverviewPage"),
  "/analysis": () => import("./routes/AnalysisPage"),
  "/flyover": () => import("./routes/FlyoverPage"),
  "/export": () => import("./routes/ExportPage"),
  "/library": () => import("./routes/LibraryPage"),
};
const OverviewPage = lazy(() => pages["/overview"]().then((m) => ({ default: m.OverviewPage })));
const AnalysisPage = lazy(() => pages["/analysis"]().then((m) => ({ default: m.AnalysisPage })));
const FlyoverPage = lazy(() => pages["/flyover"]().then((m) => ({ default: m.FlyoverPage })));
const ExportPage = lazy(() => pages["/export"]().then((m) => ({ default: m.ExportPage })));
const LibraryPage = lazy(() => pages["/library"]().then((m) => ({ default: m.LibraryPage })));

// After a refresh on a later step, fetch its code right away, alongside restoring the activity,
// instead of after it.
const here = pages[location.pathname as keyof typeof pages];
if (here) void here().catch(() => {});

/** The step after each page: its code (and MapLibre, from Check on) downloads while you read. */
const NEXT: Record<string, keyof typeof pages> = { "/check": "/overview", "/overview": "/analysis", "/analysis": "/flyover", "/flyover": "/export" };

function PrefetchNext() {
  const { pathname } = useLocation();
  useEffect(() => {
    const next = NEXT[pathname];
    if (!next) return;
    // Skip on metered or "save data" connections.
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const id = idle(() => void pages[next]().catch(() => {}));
    return () => cancel(id);
  }, [pathname]);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <PrefetchNext />
      {/* Pages suspend inside Layout, which shows their skeleton; nothing else here suspends. */}
      <Suspense fallback={null}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<UploadPage />} />
            <Route path="library" element={<LibraryPage />} />
            <Route element={<RequireActivity />}>
              <Route path="check" element={<CheckPage />} />
              <Route path="overview" element={<OverviewPage />} />
              <Route path="analysis" element={<AnalysisPage />} />
              <Route path="flyover" element={<FlyoverPage />} />
              <Route path="export" element={<ExportPage />} />
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);
