import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseActivityFile } from "../parse";
import { analysisHost, type FromWorker, type ToWorker } from "./analysisHost";
import { analyze, defaultSettings } from "./analyze";
import { decodeSamples, encodeSamples } from "./columns";
import { Analyzer, type WorkerLike } from "./remote";

const activity = parseActivityFile(readFileSync("public/samples/reservoir-loop.tcx.xml", "utf8"), "reservoir-loop.tcx")[0];
const settings = defaultSettings(activity, "metric", 200);
/** JSON view for comparing analyses (typed arrays as plain arrays, the activity left out). */
const plain = (a: object) => JSON.parse(JSON.stringify({ ...a, activity: null }, (_k, v) => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v)));

/** A worker made of the real host behind a structured-clone boundary, answering asynchronously. */
function fakeWorker(log: ToWorker[]) {
  const w: WorkerLike & { fail(): void } = {
    onmessage: null,
    onerror: null,
    postMessage(m) {
      log.push(m);
      const copy = structuredClone(m);
      setTimeout(() => host(copy), 0);
    },
    terminate() {},
    fail() {
      w.onerror?.(new Error("boom"));
    },
  };
  const host = analysisHost((m: FromWorker, transfer) => {
    const copy = structuredClone(m, { transfer });
    setTimeout(() => w.onmessage?.({ data: copy } as MessageEvent<FromWorker>), 0);
  });
  return w;
}

describe("sample columns", () => {
  it("round-trip samples exactly, optional fields included", () => {
    const a = analyze(activity, settings, null);
    const back = decodeSamples(structuredClone(encodeSamples(a.samples)));
    expect(back).toEqual(a.samples);
    // Absent optional fields stay absent.
    const mixed = [{ t: 0, time: 1, lat: 1, lon: 2, dist: 0, seg: 0, pos: "gps" as const, hr: 120 }, { t: 1, time: 2, lat: 1, lon: 2, dist: 3, seg: 0, pos: "interp" as const }];
    const out = decodeSamples(encodeSamples(mixed));
    expect(out).toEqual(mixed);
    expect("hr" in out[1]).toBe(false);
  });
});

describe("Analyzer (worker client)", () => {
  it("returns the same analysis as running it in place", async () => {
    const log: ToWorker[] = [];
    const an = new Analyzer(() => fakeWorker(log));
    const a = await an.analyze(activity, settings, null);
    expect(a!.activity).toBe(activity);
    expect(plain(a!)).toEqual(plain(analyze(activity, settings, null)));
  });

  it("sends each activity once and the terrain only when it changes", async () => {
    const log: ToWorker[] = [];
    const an = new Analyzer(() => fakeWorker(log));
    const dem = new Float64Array(activity.samples.length).fill(10);
    await an.analyze(activity, settings, null);
    await an.analyze(activity, { ...settings, units: "imperial" }, null);
    await an.analyze(activity, settings, dem);
    await an.analyze(activity, { ...settings, maxHr: 185 }, dem);
    expect(log.filter((m) => m.type === "put")).toHaveLength(1);
    expect(log.filter((m) => m.type === "dem")).toHaveLength(1);
    expect(log.filter((m) => m.type === "run")).toHaveLength(4);
  });

  it("skips a waiting request when a newer one for the same activity arrives", async () => {
    const log: ToWorker[] = [];
    const an = new Analyzer(() => fakeWorker(log));
    const results = await Promise.all([1, 2, 3, 4].map((k) => an.analyze(activity, { ...settings, trimStart: k * 10 }, null)));
    // The first was already running; the second and third were replaced while waiting.
    expect(results.map((r) => r === null)).toEqual([false, true, true, false]);
    expect(results[3]!.settings.trimStart).toBe(40);
    expect(log.filter((m) => m.type === "run")).toHaveLength(2);
  });

  it("falls back to the main thread without a worker, or when the worker breaks", async () => {
    const none = new Analyzer(() => null);
    expect(plain((await none.analyze(activity, settings, null))!)).toEqual(plain(analyze(activity, settings, null)));

    const log: ToWorker[] = [];
    let w: ReturnType<typeof fakeWorker> | null = null;
    const an = new Analyzer(() => (w = fakeWorker(log)));
    const pending = an.analyze(activity, settings, null);
    w!.fail();
    expect(plain((await pending)!)).toEqual(plain(analyze(activity, settings, null)));
  });
});
