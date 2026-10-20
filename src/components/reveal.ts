import { useLayoutEffect, useRef } from "react";

const reducedQuery = typeof matchMedia === "undefined" ? null : matchMedia("(prefers-reduced-motion: reduce)");

/**
 * Plays an element's `.rv-*` scene once, the first time it's mostly on screen. Content is fully
 * drawn by default: the element is only "armed" (lines undrawn, bars flat) once script is running
 * and motion is welcome, so a failed script or reduced motion just shows the finished picture.
 */
export function useReveal<T extends Element>(threshold = 0.35) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || reducedQuery?.matches || typeof IntersectionObserver === "undefined") return;
    el.setAttribute("data-reveal", "armed");
    let frame = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        // Two frames, so the armed state has been painted and the change transitions.
        frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => el.setAttribute("data-reveal", "shown"))));
      },
      { threshold },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
      el.removeAttribute("data-reveal");
    };
  }, [threshold]);
  return ref;
}
