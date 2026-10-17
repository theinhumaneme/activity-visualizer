// How long the chase (the part that follows the athlete) runs, shared by the flyover and export.
// Long activities need long chases: at 45 s a 6-hour ride plays at ~500×, too fast to follow.

/** Chase lengths on offer, in seconds of video. */
export const CHASE_LENGTHS = [15, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300] as const;
export type ChaseLength = (typeof CHASE_LENGTHS)[number];

/** Fastest time-lapse the suggested length aims for (activity seconds per video second). */
const TARGET_RATE = 200;

/** How far the chase camera sits behind the athlete. */
export type CameraDistance = "auto" | "close" | "medium" | "far";
export const CAMERA_DISTANCES: { value: CameraDistance; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "close", label: "Close" },
  { value: "medium", label: "Medium" },
  { value: "far", label: "Far" },
];
const DISTANCE_SCALE = { close: 1.2, medium: 1.6, far: 2.2 } as const;

/**
 * Multiplier on the sport's camera distance. Auto: close for runs, rides and walks (you follow the
 * athlete), far for hikes and everything else (the landscape is the point).
 */
export function cameraDistanceScale(choice: CameraDistance, kind: string): number {
  const c = choice === "auto" ? (kind === "run" || kind === "ride" || kind === "walk" ? "close" : "far") : choice;
  return DISTANCE_SCALE[c];
}

export const lengthLabel = (s: number) => (s < 60 ? `${s} s` : s % 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s / 60} min`);

/**
 * The shortest offered length that keeps the chase at or under ~200× (30 s at least, for
 * short activities): 30 s for an hour or less, 1 min for 2 h, 1:30 for 4 h, 2 min for 6 h.
 */
export function suggestedLength(movingSeconds: number): ChaseLength {
  if (!(movingSeconds > 0)) return 30;
  return CHASE_LENGTHS.find((l) => l >= 30 && movingSeconds / l <= TARGET_RATE) ?? CHASE_LENGTHS[CHASE_LENGTHS.length - 1];
}
