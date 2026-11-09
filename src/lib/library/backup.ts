// Library backups: one .zip of the original activity files plus a small manifest with what isn't
// in them (names, sport, gear and descriptions from a Strava export). Everything else is
// recomputed from the files on restore, so a backup made by an older version stays readable and
// gains any newer stats. It unzips like any archive, so the files are never locked in.

import { fileKey, type StravaDetails } from "./strava";
import type { LibraryEntry } from "./types";
import { type ZipInput, readZip, writeZip } from "./zip";

export const MANIFEST = "library.json";
const KIND = "activity-visualizer/library-backup";

interface Manifest {
  kind: typeof KIND;
  version: 1;
  exported: string;
  activities: number;
  /** Strava's details by file, keyed like activities.csv (see `fileKey`). */
  strava: Record<string, StravaDetails>;
}

/** A name that's safe as one path segment in an archive. */
// oxlint-disable-next-line no-control-regex -- control characters are exactly what to replace
const segment = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_") || "activity";

/** The whole library as one .zip. Files holding several activities are kept once. */
export async function makeBackup(entries: LibraryEntry[], now = new Date()): Promise<Blob> {
  const paths = new Map<File, string>();
  const strava: Record<string, StravaDetails> = {};
  for (const e of entries) {
    // Each file in its own folder, so two "activity.fit" from different devices don't collide.
    if (!paths.has(e.file)) paths.set(e.file, `activities/${paths.size + 1}/${segment(e.file.name)}`);
    if (e.strava) strava[fileKey(e.fileName)] = e.strava;
  }
  const manifest: Manifest = { kind: KIND, version: 1, exported: now.toISOString(), activities: entries.length, strava };
  const files: ZipInput[] = [{ path: MANIFEST, data: new Blob([JSON.stringify(manifest, null, 1)], { type: "application/json" }) }];
  for (const [file, path] of paths) files.push({ path, data: file });
  return writeZip(files, now);
}

/** "activity-library-2026-11-09.zip" */
export function backupName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `activity-library-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.zip`;
}

export interface Unpacked {
  files: File[];
  /** From a backup's manifest: Strava's details by file. Null for any other ZIP. */
  strava: Map<string, StravaDetails> | null;
  /** Entries that couldn't be read. */
  problems: { fileName: string; message: string }[];
}

/**
 * The files in a ZIP that `keep` wants (by file name), as Files named like the originals.
 * Works for library backups and for Strava's bulk export, unzipped or not.
 */
export async function unpackZip(
  zip: Blob,
  keep: (name: string) => boolean,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Unpacked> {
  const entries = await readZip(zip);
  let strava: Map<string, StravaDetails> | null = null;
  const manifest = entries.find((e) => e.path === MANIFEST);
  if (manifest) {
    try {
      const m = JSON.parse(await (await manifest.read()).text()) as Partial<Manifest>;
      if (m.kind === KIND) strava = new Map(Object.entries(m.strava ?? {}));
    } catch {
      // Someone else's library.json: treat the ZIP as a plain archive.
    }
  }
  const wanted = entries.filter((e) => {
    // macOS adds resource-fork copies ("__MACOSX/…", "._name") when it zips a folder.
    if (e.path.startsWith("__MACOSX/")) return false;
    const name = e.path.split("/").pop()!;
    return !name.startsWith("._") && keep(name);
  });
  const files: File[] = [];
  const problems: Unpacked["problems"] = [];
  let done = 0;
  for (const e of wanted) {
    if (signal?.aborted) break;
    const name = e.path.split("/").pop()!;
    try {
      files.push(new File([await e.read()], name));
    } catch (err) {
      problems.push({ fileName: name, message: err instanceof Error ? err.message : String(err) });
    }
    onProgress?.(++done, wanted.length);
  }
  return { files, strava, problems };
}
