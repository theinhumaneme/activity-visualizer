import { isFit, parseFit } from "./fit";
import { parseGpx } from "./gpx";
import { parseTcx } from "./tcx";
import type { FileData } from "./read";
import type { Activity } from "./types";

export type { FileData } from "./read";

export function parseActivityFile(data: FileData, fileName: string): Activity[] {
  const base =
    fileName
      .replace(/\.[^.]+$/, "")
      .replace(/[_-]+/g, " ")
      .trim() || "Activity";
  if (typeof data !== "string") {
    if (isFit(data)) return parseFit(data, base);
    data = new TextDecoder().decode(data);
  }
  const head = data.slice(0, 2000);
  if (/\.gpx$/i.test(fileName) || /<gpx[\s>]/.test(head)) return parseGpx(data, base);
  if (/\.tcx$/i.test(fileName) || /TrainingCenterDatabase/.test(head)) return parseTcx(data, base);
  if (/\.fit$/i.test(fileName)) throw new Error("This doesn't look like a FIT file (no .FIT header).");
  throw new Error("Unsupported file. Upload a .tcx, .gpx or .fit activity export.");
}
