import { useEffect, useRef, useState } from "react";

const reducedQuery = typeof matchMedia === "undefined" ? null : matchMedia("(prefers-reduced-motion: reduce)");

/** True when the visitor asked for less motion: show final states, never autoplay. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => !!reducedQuery?.matches);
  useEffect(() => {
    if (!reducedQuery) return;
    const on = () => setReduced(reducedQuery.matches);
    reducedQuery.addEventListener("change", on);
    return () => reducedQuery.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** Width of an element, kept current with a ResizeObserver. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
