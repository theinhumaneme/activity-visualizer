// Grade-adjusted pace, kept apart from the analysis pipeline so the HUD can use it without pulling that in.

/**
 * Minetti et al. (2002) metabolic cost of running, J/(kg·m), at grade g (fraction, valid ±0.45).
 * GAP = speed × C(g) / C(0): what the same effort would have been worth on the flat.
 */
export const minetti = (g: number) => 155.4 * g ** 5 - 30.4 * g ** 4 - 43.3 * g ** 3 + 46.3 * g ** 2 + 19.5 * g + 3.6;
