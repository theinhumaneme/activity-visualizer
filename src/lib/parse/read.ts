// Reading activity files into what the parser takes. Kept apart from the parsers, which are
// only loaded in workers, so the main bundle can use it.

/** An activity file's contents: text for TCX/GPX, bytes for FIT. */
export type FileData = string | Uint8Array;

/**
 * Reads an activity file (gzipped ones too, as in a Strava bulk export) into what
 * parseActivityFile takes, with the name it's parsed under. FIT stays binary.
 */
export async function readActivityFile(file: Blob, name: string): Promise<{ data: FileData; fileName: string }> {
  const gz = /\.gz$/i.test(name);
  const fileName = name.replace(/\.gz$/i, "");
  const body = gz ? new Response(file.stream().pipeThrough(new DecompressionStream("gzip"))) : new Response(file);
  if (/\.fit$/i.test(fileName)) return { data: new Uint8Array(await body.arrayBuffer()), fileName };
  return { data: await body.text(), fileName };
}

/** FIT bytes as text for session storage, and back. TCX/GPX text is stored as is. */
export function storableData(data: FileData): string | { b64: string } {
  if (typeof data === "string") return data;
  let bin = "";
  for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return { b64: btoa(bin) };
}

export function restoredData(stored: string | { b64: string }): FileData {
  if (typeof stored === "string") return stored;
  const bin = atob(stored.b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
