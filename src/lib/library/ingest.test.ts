import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ingestFile } from "./ingest";

const SAMPLE = "public/samples/reservoir-loop.tcx";

describe("ingestFile", () => {
  it("reads a plain TCX into one light record", async () => {
    const file = new File([readFileSync(SAMPLE)], "reservoir-loop.tcx");
    const res = await ingestFile({ id: "a", file });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.records).toHaveLength(1);
    expect(res.records[0]).toMatchObject({ id: "a#0", activityIndex: 0, fileName: "reservoir-loop.tcx", kind: "run" });
    expect(res.records[0].track!.lon.length).toBeLessThanOrEqual(600);
  });

  it("reads a gzipped export the same way", async () => {
    const plain = await ingestFile({ id: "p", file: new File([readFileSync(SAMPLE)], "x.tcx") });
    const gz = await ingestFile({ id: "g", file: new File([gzipSync(readFileSync(SAMPLE))], "x.tcx.gz") });
    expect(gz.ok && plain.ok && gz.records[0].distance).toBe(plain.ok && plain.records[0].distance);
  });

  it("rejects what it can't read", async () => {
    await expect(ingestFile({ id: "b", file: new File(["hello"], "notes.tcx") })).rejects.toThrow();
  });
});
