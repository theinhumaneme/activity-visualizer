/// <reference lib="webworker" />
import { type FileData, parseActivityFile } from "./index";

self.onmessage = (e: MessageEvent<{ data: FileData; fileName: string }>) => {
  try {
    const activities = parseActivityFile(e.data.data, e.data.fileName);
    self.postMessage({ ok: true, activities });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
