import { analyze, defaultSettings } from "../analysis/analyze";
import { parseActivityFile } from "../parse";
import { readActivityFile } from "../parse/read";
import { buildRecord } from "./record";
import type { LibraryRecord } from "./types";

export interface LibraryJob {
  id: string;
  file: File;
}

export type LibraryResult =
  | { id: string; ok: true; records: LibraryRecord[]; skipped: string[] }
  | { id: string; ok: false; error: string };

/** Reads, parses and analyzes one file off the main thread; only the light records come back. */
export async function ingestFile({ id, file }: LibraryJob): Promise<LibraryResult> {
  const { data, fileName } = await readActivityFile(file, file.name);
  const activities = parseActivityFile(data, fileName);
  const records: LibraryRecord[] = [];
  const skipped: string[] = [];
  activities.forEach((activity, i) => {
    if (activity.routeOnly) {
      skipped.push("A planned route without timestamps, not a recorded activity.");
      return;
    }
    if (activity.samples.length < 2) {
      skipped.push("Too few points to analyze.");
      return;
    }
    // Units don't change the summary numbers; privacy is applied when drawing.
    const a = analyze(activity, defaultSettings(activity, "metric", 0), null);
    records.push(buildRecord(activity, a, { id: `${id}#${i}`, fileName: file.name, activityIndex: i }));
  });
  return { id, ok: true, records, skipped };
}

