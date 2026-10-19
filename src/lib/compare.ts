// Playful scale for the headline numbers: "Climbed ≈ 2.4 Eiffel Towers". Unit-free, so they read
// the same in km and miles. Each picks the largest yardstick the number reaches at least once.

import type { Summary } from "./analysis/types";

export interface Comparison {
  key: "climb" | "distance" | "calories";
  /** The verb that leads: "Climbed", "Covered", "Burned". */
  verb: string;
  /** "2.4", "12" or "1". */
  value: string;
  /** Singular or plural to match the value: "Eiffel Towers". */
  thing: string;
}

interface Yardstick {
  size: number;
  one: string;
  many: string;
}

/** Heights in meters, smallest first. */
const HEIGHTS: Yardstick[] = [
  { size: 3, one: "flight of stairs", many: "flights of stairs" },
  { size: 93, one: "Statue of Liberty", many: "Statues of Liberty" },
  { size: 330, one: "Eiffel Tower", many: "Eiffel Towers" },
  { size: 443, one: "Empire State Building", many: "Empire State Buildings" },
  { size: 828, one: "Burj Khalifa", many: "Burj Khalifas" },
  { size: 8849, one: "Everest", many: "Everests" },
];

/** Lengths in meters, smallest first. */
const LENGTHS: Yardstick[] = [
  { size: 400, one: "lap of a running track", many: "laps of a running track" },
  { size: 2737, one: "Golden Gate Bridge", many: "Golden Gate Bridges" },
  { size: 21_600, one: "length of Manhattan", many: "lengths of Manhattan" },
  { size: 42_195, one: "marathon", many: "marathons" },
];

/** Energy in kcal. */
const FOOD: Yardstick[] = [{ size: 285, one: "slice of pizza", many: "slices of pizza" }];

/** One decimal below 10 (without a trailing ".0"), whole numbers above. */
export function formatRatio(r: number): string {
  if (r >= 9.95) return String(Math.round(r));
  const v = Math.round(r * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function measure(amount: number, scale: Yardstick[]): { value: string; thing: string } | null {
  if (!(amount > 0)) return null;
  let pick: Yardstick | null = null;
  for (const y of scale) if (amount >= y.size) pick = y;
  if (!pick) return null;
  const value = formatRatio(amount / pick.size);
  return { value, thing: value === "1" ? pick.one : pick.many };
}

/** Every comparison this summary supports, climb first. */
export function comparisons(s: Pick<Summary, "distance" | "elevGain" | "calories">): Comparison[] {
  const out: Comparison[] = [];
  const climb = s.elevGain !== undefined ? measure(s.elevGain, HEIGHTS) : null;
  if (climb) out.push({ key: "climb", verb: "Climbed", ...climb });
  const dist = measure(s.distance, LENGTHS);
  if (dist) out.push({ key: "distance", verb: "Covered", ...dist });
  const food = s.calories !== undefined ? measure(s.calories, FOOD) : null;
  if (food) out.push({ key: "calories", verb: "Burned", ...food });
  return out;
}

/** The one for the end card: the climb when it's a real one (30 m or more), else the distance. */
export function headlineComparison(s: Pick<Summary, "distance" | "elevGain" | "calories">): Comparison | null {
  const all = comparisons(s);
  const climb = all.find((c) => c.key === "climb");
  if (climb && (s.elevGain ?? 0) >= 30) return climb;
  return all.find((c) => c.key === "distance") ?? climb ?? null;
}

export const comparisonText = (c: Comparison) => `${c.verb} ≈ ${c.value} ${c.thing}`;
