/// <reference lib="webworker" />
import { type LibraryJob, type LibraryResult, ingestFile } from "./ingest";


self.onmessage = async (e: MessageEvent<LibraryJob>) => {
  let result: LibraryResult;
  try {
    result = await ingestFile(e.data);
  } catch (err) {
    result = { id: e.data.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const transfer: Transferable[] = [];
  if (result.ok)
    for (const r of result.records) if (r.track) transfer.push(r.track.lon.buffer, r.track.lat.buffer, r.track.dist.buffer, r.track.moving.buffer);
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(result, transfer);
};
