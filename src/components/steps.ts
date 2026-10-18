import { useCallback } from "react";
import { useNavigate } from "react-router";
import { useStore } from "../state/store";

export const STEPS = [
  { path: "/", label: "Upload" },
  { path: "/check", label: "Check", optional: true },
  { path: "/overview", label: "Overview" },
  { path: "/analysis", label: "Analysis" },
  { path: "/flyover", label: "Flyover" },
  { path: "/export", label: "Export" },
] as const;

/** Navigation state that asks the flyover to start playing as soon as it can. */
export type FlyoverArrival = { autoplay?: boolean };

/**
 * Goes where a newly opened activity should land: straight into the flyover, playing, unless
 * Check needs an answer first (which activity in a multi-activity file, or a privacy zone that
 * hides the whole route).
 */
export function useOpenActivity() {
  const navigate = useNavigate();
  return useCallback(() => {
    const { activities, analysis } = useStore.getState();
    if (activities.length > 1 || analysis?.privacy.empty) navigate("/check");
    else navigate("/flyover", { state: { autoplay: true } satisfies FlyoverArrival });
  }, [navigate]);
}
