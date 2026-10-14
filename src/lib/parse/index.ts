import { parseGpx } from "./gpx";
import { parseTcx } from "./tcx";
import type { Activity } from "./types";

export function parseActivityFile(text: string, fileName: string): Activity[] {
  const base =
    fileName
      .replace(/\.[^.]+$/, "")
      .replace(/[_-]+/g, " ")
      .trim() || "Activity";
  const head = text.slice(0, 2000);
  if (/\.gpx$/i.test(fileName) || /<gpx[\s>]/.test(head)) return parseGpx(text, base);
  if (/\.tcx$/i.test(fileName) || /TrainingCenterDatabase/.test(head)) return parseTcx(text, base);
  throw new Error("Unsupported file. Upload a .tcx (or .gpx) activity export.");
}
