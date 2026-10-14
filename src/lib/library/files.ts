/**
 * Files from a drop, including whole folders (a Strava bulk export's activities/ folder, say).
 * Entries must be taken synchronously inside the drop handler; reading them can happen later.
 */
export function droppedFiles(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items ?? [])
    .map((it) => (it.kind === "file" ? it.webkitGetAsEntry?.() : null))
    .filter((e): e is FileSystemEntry => !!e);
  if (!entries.length || entries.every((e) => e.isFile)) return Promise.resolve(Array.from(dt.files));
  return Promise.all(entries.map(walk)).then((lists) => lists.flat());
}

const MAX_FILES = 5000;

async function walk(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) return new Promise((resolve) => (entry as FileSystemFileEntry).file((f) => resolve([f]), () => resolve([])));
  if (!entry.isDirectory) return [];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children: FileSystemEntry[] = [];
  // readEntries returns results in batches until it returns an empty one.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
    if (!batch.length || children.length > MAX_FILES) break;
    children.push(...batch);
  }
  const out: File[] = [];
  for (const c of children) {
    out.push(...(await walk(c)));
    if (out.length > MAX_FILES) break;
  }
  return out;
}
