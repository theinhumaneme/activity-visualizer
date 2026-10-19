/// <reference types="vite/client" />
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyze } from "../lib/analysis/analyze";
import { parseActivityFile } from "../lib/parse";

// The workers and network calls, answered asynchronously in this thread.
const later = <T>(f: () => T) => new Promise<T>((resolve, reject) => setTimeout(() => (async () => f())().then(resolve, reject), 0));
vi.mock("../lib/parse/client", () => ({ parseInWorker: (text: string, name: string) => later(() => parseActivityFile(text, name)) }));
vi.mock("../lib/analysis/remote", () => ({ analyzeOffThread: (...args: Parameters<typeof analyze>) => later(() => analyze(...args)) }));
vi.mock("../lib/analysis/dem", () => ({ sampleTerrain: () => new Promise(() => {}) }));
vi.mock("../lib/weather", () => ({ fetchWeather: async () => null }));

const { useStore } = await import("./store");

const sample = readFileSync("public/samples/reservoir-loop.tcx.xml", "utf8");

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  };
}

describe("restoreSession", () => {
  beforeEach(() => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    useStore.getState().reset();
    sessionStorage.setItem("rv:last-file", JSON.stringify({ fileName: "reservoir-loop.tcx", text: sample }));
  });

  it("has the activity in place when it finishes", async () => {
    await useStore.getState().restoreSession();
    expect(useStore.getState().analysis).not.toBeNull();
    expect(useStore.getState().fileName).toBe("reservoir-loop.tcx");
  });

  // StrictMode runs RequireActivity's effect twice; it redirects to Upload if a restore finishes empty.
  it("has the activity in place for each of two overlapping calls", async () => {
    const seen: boolean[] = [];
    const { restoreSession } = useStore.getState();
    await Promise.all([restoreSession(), restoreSession()].map((p) => p.then(() => seen.push(!!useStore.getState().analysis))));
    expect(seen).toEqual([true, true]);
  });

  it("finishes empty when the tab has no saved file", async () => {
    sessionStorage.clear();
    await useStore.getState().restoreSession();
    expect(useStore.getState().analysis).toBeNull();
  });
});
