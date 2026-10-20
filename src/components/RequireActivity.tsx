import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { useStore } from "../state/store";
import { COMBINED_HIDDEN } from "./steps";
import { PageSkeleton } from "./ui";

/** Routes past Upload need an activity; after a refresh, restore it from this tab's session first. */
export function RequireActivity() {
  const hasActivity = useStore((s) => !!s.analysis);
  const combined = useStore((s) => !!s.activity?.parts);
  const { pathname } = useLocation();
  const restoreSession = useStore((s) => s.restoreSession);
  const [restoring, setRestoring] = useState(!hasActivity);

  useEffect(() => {
    if (hasActivity) return;
    restoreSession().finally(() => setRestoring(false));
  }, [hasActivity, restoreSession]);

  // A combined day has no Check, Overview or Analysis (see COMBINED_HIDDEN).
  if (hasActivity && combined && COMBINED_HIDDEN.includes(pathname)) return <Navigate to="/flyover" replace />;
  if (hasActivity) return <Outlet />;
  if (restoring) return <PageSkeleton label="Loading your activity…" />;
  return <Navigate to="/" replace />;
}
