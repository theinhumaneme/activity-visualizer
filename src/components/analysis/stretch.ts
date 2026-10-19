import { type KeyboardEvent, useCallback } from "react";
import { useNavigate } from "react-router";
import { type Highlight, useStore } from "../../state/store";
import type { FlyoverArrival } from "../steps";

/**
 * Props that tie a split, climb, rep or effort to its stretch of the route: hover or focus finds it
 * on the map and charts, and a click (or Enter) flies it in 3D, starting just before it.
 */
export function useStretch() {
  const setHighlight = useStore((s) => s.setHighlight);
  const navigate = useNavigate();
  return useCallback(
    (h: Highlight) => {
      const watch = () => {
        setHighlight(null);
        navigate("/flyover", { state: { focus: h } satisfies FlyoverArrival });
      };
      return {
        onMouseEnter: () => setHighlight(h),
        onMouseLeave: () => setHighlight(null),
        onFocus: () => setHighlight(h),
        onBlur: () => setHighlight(null),
        onClick: watch,
        // Buttons already click on Enter; rows and cards need it added.
        onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
          if (e.key === "Enter" && e.target === e.currentTarget && e.currentTarget.tagName !== "BUTTON") watch();
        },
        title: `Watch ${h.label.charAt(0).toLowerCase()}${h.label.slice(1)} in 3D`,
      };
    },
    [setHighlight, navigate],
  );
}
