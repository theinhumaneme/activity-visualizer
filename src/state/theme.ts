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

export const useTheme = create<ThemeState>((set) => {
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
      apply(pref);
      set({ pref, theme: resolve(pref) });
    },
  };
});

/** Reads a theme CSS variable (e.g. "--series-pace") as a color string. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
