import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeFit, parseFit } from "./fit";
import { parseActivityFile } from "./index";
import { readActivityFile, restoredData, storableData } from "./read";

const EPOCH = 631065600; // FIT epoch in Unix seconds
const T0 = Date.UTC(2026, 4, 2, 13, 0, 0) / 1000 - EPOCH;
const SEMI = 2 ** 31 / 180;

/** A minimal FIT writer: definitions and data messages, enough to exercise the decoder. */
class Fit {
  private bytes: number[] = [];
  private layouts: { size: number; type: number }[][] = [];
  private big: boolean[] = [];

  def(local: number, num: number, fields: [number, number, number][], big = false) {
    this.bytes.push(0x40 | local, 0, big ? 1 : 0, ...(big ? [num >> 8, num & 0xff] : [num & 0xff, num >> 8]), fields.length);
    for (const f of fields) this.bytes.push(...f);
    this.layouts[local] = fields.map(([, size, type]) => ({ size, type }));
    this.big[local] = big;
    return this;
  }

  data(local: number, values: number[], compressedOffset?: number) {
    this.bytes.push(compressedOffset === undefined ? local : 0x80 | (local << 5) | compressedOffset);
    const view = new DataView(new ArrayBuffer(8));
    this.layouts[local].forEach(({ size, type }, i) => {
      const v = values[i];
      const le = !this.big[local];
      if (size === 1) view.setUint8(0, v);
      else if (size === 2) view.setUint16(0, v, le);
      else if (type === 0x85) view.setInt32(0, v, le);
      else view.setUint32(0, v, le);
      for (let k = 0; k < size; k++) this.bytes.push(view.getUint8(k));
    });
    return this;
  }

  build(): Uint8Array<ArrayBuffer> {
    const head = [14, 0x20, 0, 0, ...new Uint8Array(new Uint32Array([this.bytes.length]).buffer), 0x2e, 0x46, 0x49, 0x54, 0, 0];
    return new Uint8Array([...head, ...this.bytes, 0, 0]);
  }
}

const U8 = 0x02,
  U16 = 0x84,
  S32 = 0x85,
  U32 = 0x86,
  ENUM = 0x00;
const RECORD: [number, number, number][] = [
  [253, 4, U32],
  [0, 4, S32],
  [1, 4, S32],
  [5, 4, U32],
  [3, 1, U8],
  [4, 1, U8],
];

/** A run: 1 m/s north for `n` seconds from t, with heart rate and per-leg cadence. */
function run(fit: Fit, t: number, n: number, d0 = 0) {
  for (let i = 0; i < n; i++) {
    const lat = 42 + (d0 + i) / 111_320;
    fit.data(1, [t + i, Math.round(lat * SEMI), Math.round(-71 * SEMI), (d0 + i) * 100, 140 + (i % 5), 85]);
  }
}

function activityFile({ big = false } = {}) {
  const fit = new Fit()
    .def(
      0,
      0,
      [
        [0, 1, ENUM],
        [1, 2, U16],
        [2, 2, U16],
      ],
      big,
    )
    .data(0, [4, 1, 3990])
    .def(1, 20, RECORD, big);
  run(fit, T0, 60);
  fit
    .def(
      2,
      21,
      [
        [253, 4, U32],
        [0, 1, ENUM],
        [1, 1, ENUM],
      ],
      big,
    )
    .data(2, [T0 + 60, 0, 1]);
  fit.data(2, [T0 + 120, 0, 0]);
  run(fit, T0 + 120, 60, 60);
  fit.def(
    3,
    19,
    [
      [253, 4, U32],
      [2, 4, U32],
      [7, 4, U32],
      [8, 4, U32],
      [9, 4, U32],
      [23, 1, ENUM],
      [24, 1, ENUM],
    ],
    big,
  );
  fit.data(3, [T0 + 60, T0, 60000, 60000, 6000, 0, 2]).data(3, [T0 + 180, T0 + 120, 60000, 60000, 6000, 1, 0]);
  fit.def(
    4,
    18,
    [
      [253, 4, U32],
      [2, 4, U32],
      [5, 1, ENUM],
      [6, 1, ENUM],
      [7, 4, U32],
      [8, 4, U32],
      [9, 4, U32],
      [11, 2, U16],
    ],
    big,
  );
  fit.data(4, [T0 + 180, T0, 1, 0, 180000, 120000, 12000, 95]);
  fit
    .def(
      5,
      34,
      [
        [253, 4, U32],
        [5, 4, U32],
      ],
      big,
    )
    .data(5, [T0 + 180, T0 + 180 - 4 * 3600]);
  return fit.build();
}

describe("FIT", () => {
  it("reads records, laps, totals, device and local time", () => {
    const [a] = parseFit(activityFile(), "Morning Run");
    expect(a).toMatchObject({ name: "Morning Run", sport: "Running", kind: "run", source: "fit", device: "Garmin", utcOffsetMin: -240 });
    expect(a.samples).toHaveLength(120);
    expect(a.startTime).toBe((T0 + EPOCH) * 1000);
    expect(a.hasFileDistance).toBe(true);
    expect(a.samples.at(-1)!.dist).toBe(119);
    expect(a.samples[0].lat).toBeCloseTo(42, 6);
    expect(a.samples[0].hr).toBe(140);
    expect(a.cadenceDoubled).toBe(true);
    expect(a.samples[0].cad).toBe(170);
    expect(a.fileTotals).toEqual({ distance: 120, time: 120, calories: 95 });
    expect(a.laps.map((l) => [l.startIndex, l.endIndex, l.intensity, l.trigger])).toEqual([
      [0, 59, "Active", "Distance"],
      [60, 119, "Resting", "Manual"],
    ]);
  });

  it("starts a new segment when the timer restarts", () => {
    const [a] = parseFit(activityFile(), "x");
    expect(a.samples[59].seg).toBe(0);
    expect(a.samples[60].seg).toBe(1);
  });

  it("reads big-endian messages the same", () => {
    const [le] = parseFit(activityFile(), "x");
    const [be] = parseFit(activityFile({ big: true }), "x");
    expect(be.samples).toEqual(le.samples);
    expect(be.fileTotals).toEqual(le.fileTotals);
  });

  it("expands compressed timestamps and skips invalid values", () => {
    const fit = new Fit()
      .def(0, 20, [
        [253, 4, U32],
        [0, 4, S32],
        [1, 4, S32],
        [3, 1, U8],
      ])
      .def(1, 20, [
        [0, 4, S32],
        [1, 4, S32],
        [3, 1, U8],
      ]);
    const pos = (i: number) => [Math.round((42 + i / 1e4) * SEMI), Math.round(-71 * SEMI)];
    fit.data(0, [T0 + 30, ...pos(0), 0xff]); // T0 + 30 ends in 0b11110 … wraps below
    fit.data(1, [...pos(1), 150], (T0 + 31) & 0x1f);
    fit.data(1, [...pos(2), 151], (T0 + 33) & 0x1f); // rolls over the 5-bit counter
    const recs = decodeFit(fit.build()).filter((m) => m.num === 20);
    expect(recs.map((m) => m.f[253])).toEqual([T0 + 30, T0 + 31, T0 + 33]);
    expect(recs[0].f[3]).toBeUndefined();
    const [a] = parseFit(fit.build(), "x");
    expect(a.samples.map((s) => s.hr)).toEqual([undefined, 150, 151]);
    expect(a.kind).toBe("other");
  });

  it("splits a multisport file into its sessions", () => {
    const fit = new Fit().def(1, 20, RECORD);
    run(fit, T0, 30);
    run(fit, T0 + 30, 30, 30);
    fit.def(4, 18, [
      [253, 4, U32],
      [2, 4, U32],
      [5, 1, ENUM],
    ]);
    fit.data(4, [T0 + 30, T0, 2]).data(4, [T0 + 60, T0 + 30, 1]);
    const acts = parseFit(fit.build(), "Duathlon");
    expect(acts.map((a) => [a.name, a.sport, a.samples.length, a.multisport])).toEqual([
      ["Duathlon (1)", "Cycling", 30, true],
      ["Duathlon (2)", "Running", 30, true],
    ]);
  });

  it("explains files it can't draw", () => {
    const indoor = new Fit()
      .def(0, 0, [[0, 1, ENUM]])
      .data(0, [4])
      .def(1, 20, [
        [253, 4, U32],
        [3, 1, U8],
      ]);
    for (let i = 0; i < 10; i++) indoor.data(1, [T0 + i, 120]);
    expect(() => parseFit(indoor.build(), "x")).toThrow(/treadmill/);
    const course = new Fit()
      .def(0, 0, [[0, 1, ENUM]])
      .data(0, [6])
      .build();
    expect(() => parseFit(course, "x")).toThrow(/isn't a recorded activity/);
    expect(() => parseActivityFile(new Uint8Array(20), "x.fit")).toThrow(/doesn't look like a FIT file/);
  });

  it("is detected by its header, whatever the name", () => {
    expect(parseActivityFile(activityFile(), "download.bin")[0].source).toBe("fit");
  });
});

describe("reading files", () => {
  it("keeps FIT binary, gzipped or not, and decodes text formats", async () => {
    const bytes = activityFile();
    const plain = await readActivityFile(new Blob([bytes]), "a.fit");
    const gz = await readActivityFile(new Blob([gzipSync(bytes)]), "a.fit.gz");
    expect(plain.data).toEqual(bytes);
    expect(gz).toEqual({ data: bytes, fileName: "a.fit" });
    expect(await readActivityFile(new Blob(["<gpx/>"]), "a.gpx")).toEqual({ data: "<gpx/>", fileName: "a.gpx" });
  });

  it("round-trips FIT bytes through session storage", () => {
    const bytes = activityFile();
    const stored = JSON.parse(JSON.stringify(storableData(bytes)));
    expect(restoredData(stored)).toEqual(bytes);
    expect(storableData("<gpx/>")).toBe("<gpx/>");
  });
});

const PRIVATE_FIT = "tests/fixtures/private/20687011171.fit";
describe.skipIf(!existsSync(PRIVATE_FIT))("Nike Run Club FIT from a Strava export (private fixture)", () => {
  const [a] = existsSync(PRIVATE_FIT) ? parseActivityFile(new Uint8Array(readFileSync(PRIVATE_FIT)), "20687011171.fit") : [];
  it("reads the run", () => {
    expect(a).toMatchObject({ sport: "Running", kind: "run", hasFileDistance: true });
    expect(a.samples).toHaveLength(3877);
    expect(a.samples.at(-1)!.dist).toBeCloseTo(7097.4, 1);
    expect(a.fileTotals).toEqual({ distance: 7097.4, time: 3329, calories: 525 });
  });
  it("splits at the two pauses, though the events come before the records", () => {
    expect(new Set(a.samples.map((s) => s.seg))).toEqual(new Set([0, 1, 2]));
  });
});
