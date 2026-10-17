// The analysis worker's side: keeps activities by id and answers "run" requests with analyze()
// results whose samples travel as transferable columns. Plain module, so tests can drive it.
import { analyze } from "./analyze";
import { type SampleColumns, columnBuffers, encodeSamples } from "./columns";
import type { Analysis, Settings } from "./types";
import type { Activity } from "../parse/types";

export type ToWorker =
  | { type: "put"; id: number; activity: Activity }
  | { type: "dem"; id: number; dem: Float64Array | null }
  | { type: "drop"; id: number }
  | { type: "run"; req: number; id: number; settings: Settings };

export type FromWorker = { req: number; analysis: Omit<Analysis, "activity" | "samples">; columns: SampleColumns } | { req: number; error: string };

export function analysisHost(post: (m: FromWorker, transfer: ArrayBuffer[]) => void) {
  const kept = new Map<number, { activity: Activity; dem: Float64Array | null }>();
  return (m: ToWorker) => {
    if (m.type === "put") kept.set(m.id, { activity: m.activity, dem: null });
    else if (m.type === "dem") {
      const k = kept.get(m.id);
      if (k) k.dem = m.dem;
    } else if (m.type === "drop") kept.delete(m.id);
    else {
      const k = kept.get(m.id);
      try {
        if (!k) throw new Error("Activity not loaded in the analysis worker");
        // The activity stays here (the page has its own copy); samples travel as columns.
        const { activity: _activity, samples, ...rest } = analyze(k.activity, m.settings, k.dem);
        const columns = encodeSamples(samples);
        post({ req: m.req, analysis: rest, columns }, columnBuffers(columns));
      } catch (err) {
        post({ req: m.req, error: err instanceof Error ? err.message : String(err) }, []);
      }
    }
  };
}
