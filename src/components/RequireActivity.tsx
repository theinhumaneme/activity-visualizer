import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router";
import { useStore } from "../state/store";

/** Routes past Upload need an activity; after a refresh, restore it from this tab's session first. */
export function RequireActivity() {
  const hasActivity = useStore((s) => !!s.analysis);
  const restoreSession = useStore((s) => s.restoreSession);
  const [restoring, setRestoring] = useState(!hasActivity);

  useEffect(() => {
    if (hasActivity) return;
    restoreSession().finally(() => setRestoring(false));
  }, [hasActivity, restoreSession]);

  if (hasActivity) return <Outlet />;
  if (restoring) return <p className="p-8 text-center text-muted">Loading your activity…</p>;
  return <Navigate to="/" replace />;
}
