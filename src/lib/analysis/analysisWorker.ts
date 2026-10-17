/// <reference lib="webworker" />
// Runs analyze() off the main thread (see analysisHost.ts and remote.ts).
import { type ToWorker, analysisHost } from "./analysisHost";

const handle = analysisHost((m, transfer) => self.postMessage(m, transfer));
self.onmessage = (e: MessageEvent<ToWorker>) => handle(e.data);
