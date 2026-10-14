import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import "./index.css";
import { Layout } from "./components/Layout";
import { RequireActivity } from "./components/RequireActivity";
import { CheckPage } from "./routes/CheckPage";
import { UploadPage } from "./routes/UploadPage";

// Map-heavy steps load MapLibre on demand so the upload page stays small.
const OverviewPage = lazy(() => import("./routes/OverviewPage").then((m) => ({ default: m.OverviewPage })));
const AnalysisPage = lazy(() => import("./routes/AnalysisPage").then((m) => ({ default: m.AnalysisPage })));
const FlyoverPage = lazy(() => import("./routes/FlyoverPage").then((m) => ({ default: m.FlyoverPage })));
const ExportPage = lazy(() => import("./routes/ExportPage").then((m) => ({ default: m.ExportPage })));
const LibraryPage = lazy(() => import("./routes/LibraryPage").then((m) => ({ default: m.LibraryPage })));
const loading = <p className="p-8 text-center text-muted">Loading…</p>;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={loading}>
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
