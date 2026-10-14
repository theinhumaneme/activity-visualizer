/// <reference lib="webworker" />
import { parseActivityFile } from "./index";

self.onmessage = (e: MessageEvent<{ text: string; fileName: string }>) => {
  try {
    const activities = parseActivityFile(e.data.text, e.data.fileName);
    self.postMessage({ ok: true, activities });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
