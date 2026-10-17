import { flushSync } from "react-dom";
import { create } from "zustand";

export type ThemePref = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const KEY = "rv:theme";
const media = typeof matchMedia === "undefined" ? null : matchMedia("(prefers-color-scheme: dark)");

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // Storage unavailable.
  }
  return "system";
}

const resolve = (pref: ThemePref): Theme => (pref === "system" ? (media?.matches ? "dark" : "light") : pref);

function apply(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
}

interface ThemeState {
  pref: ThemePref;
  theme: Theme;
  setPref(pref: ThemePref): void;
}

type ViewTransitionDoc = Document & { startViewTransition?: (update: () => void) => unknown };

export const useTheme = create<ThemeState>((set, get) => {
  const pref = readPref();
  media?.addEventListener("change", () => set((s) => ({ theme: resolve(s.pref) })));
  return {
    pref,
    theme: resolve(pref),
    setPref(pref) {
      try {
        localStorage.setItem(KEY, pref);
      } catch {
        // Not critical.
      }
      const commit = () => {
        apply(pref);
        set({ pref, theme: resolve(pref) });
      };
      // Cross-fade the switch where the browser can, rendering the new theme inside the transition
      // so maps and charts that read theme colors swap in the same frame.
      const doc = document as ViewTransitionDoc;
      const fade = resolve(pref) !== get().theme && !!doc.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (fade) doc.startViewTransition!(() => flushSync(commit));
      else commit();
    },
  };
});

/** Reads a theme CSS variable (e.g. "--series-pace") as a color string. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
