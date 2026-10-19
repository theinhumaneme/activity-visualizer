import { describe, expect, it } from "vitest";
import { comparisonText, comparisons, formatRatio, headlineComparison } from "./compare";

describe("formatRatio", () => {
  it("keeps one decimal below 10 and drops a trailing .0", () => {
    expect(formatRatio(2.43)).toBe("2.4");
    expect(formatRatio(1.02)).toBe("1");
    expect(formatRatio(9.96)).toBe("10");
    expect(formatRatio(23.6)).toBe("24");
  });
});

describe("comparisons", () => {
  it("picks the largest yardstick the number reaches", () => {
    const [climb, dist] = comparisons({ distance: 10_000, elevGain: 800 });
    expect(comparisonText(climb)).toBe("Climbed ≈ 1.8 Empire State Buildings");
    expect(comparisonText(dist)).toBe("Covered ≈ 3.7 Golden Gate Bridges");
  });

  it("uses the singular for exactly one", () => {
    expect(comparisons({ distance: 42_195 })[0]).toMatchObject({ value: "1", thing: "marathon" });
  });

  it("skips numbers too small for any yardstick", () => {
    expect(comparisons({ distance: 250, elevGain: 2 })).toEqual([]);
  });

  it("adds calories only when the file has them", () => {
    expect(comparisons({ distance: 5000, calories: 570 }).map(comparisonText)).toContain("Burned ≈ 2 slices of pizza");
  });
});

describe("headlineComparison", () => {
  it("prefers a real climb, else the distance", () => {
    expect(headlineComparison({ distance: 5000, elevGain: 400 })?.key).toBe("climb");
    expect(headlineComparison({ distance: 5000, elevGain: 12 })?.key).toBe("distance");
    expect(headlineComparison({ distance: 100 })).toBeNull();
  });
});
