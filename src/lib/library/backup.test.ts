import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { MANIFEST, backupName, makeBackup, unpackZip } from "./backup";
import type { LibraryEntry } from "./types";
import { crc32, readZip, writeZip } from "./zip";

const text = (s: string) => new Blob([s]);
const keepAll = () => true;

describe("zip", () => {
  it("computes the standard CRC-32", async () => {
    expect(await crc32(text("123456789"))).toBe(0xcbf43926);
    expect(await crc32(text(""))).toBe(0);
  });

  it("reads back what it writes, names and bytes intact", async () => {
    const bin = new Uint8Array(70_000).map((_, i) => (i * 31) & 0xff);
    const zip = await writeZip([
      { path: "a.txt", data: text("hello") },
      { path: "dir/ünïcode run.gpx", data: new Blob([bin]) },
      { path: "empty.fit", data: new Blob([]) },
    ]);
    const entries = await readZip(zip);
    expect(entries.map((e) => e.path)).toEqual(["a.txt", "dir/ünïcode run.gpx", "empty.fit"]);
    expect(await (await entries[0].read()).text()).toBe("hello");
    expect(new Uint8Array(await (await entries[1].read()).arrayBuffer())).toEqual(bin);
    expect((await entries[2].read()).size).toBe(0);
  });

  it("is a ZIP other tools accept: headers carry the CRC and sizes", async () => {
    const zip = new Uint8Array(await (await writeZip([{ path: "x", data: text("abc") }])).arrayBuffer());
    const v = new DataView(zip.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(14, true)).toBe(await crc32(text("abc")));
    expect(v.getUint32(18, true)).toBe(3);
    expect(v.getUint32(zip.length - 22, true)).toBe(0x06054b50);
  });

  it("reads deflated entries, as in Strava's export", async () => {
    const body = "<gpx>" + "<trkpt/>".repeat(500) + "</gpx>";
    const zip = deflatedZip("export/activities/1.gpx", body);
    const [e] = await readZip(new Blob([zip]));
    expect(e.size).toBe(body.length);
    expect(await (await e.read()).text()).toBe(body);
  });

  it("rejects what isn't a ZIP", async () => {
    await expect(readZip(text("not a zip at all, just some text"))).rejects.toThrow(/Not a ZIP/);
  });
});

/** A one-entry ZIP with a deflated entry, built by hand like other tools write them. */
function deflatedZip(path: string, body: string): Uint8Array<ArrayBuffer> {
  const name = new TextEncoder().encode(path);
  const raw = new TextEncoder().encode(body);
  const data = deflateRawSync(raw);
  const crc = crcSync(raw);
  const local = new Uint8Array(30 + name.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(8, 8, true);
  lv.setUint32(14, crc, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, raw.length, true);
  lv.setUint16(26, name.length, true);
  local.set(name, 30);
  const cd = new Uint8Array(46 + name.length);
  const cv = new DataView(cd.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, 8, true);
  cv.setUint32(16, crc, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, raw.length, true);
  cv.setUint16(28, name.length, true);
  cd.set(name, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, cd.length, true);
  ev.setUint32(16, local.length + data.length, true);
  const out = new Uint8Array(local.length + data.length + cd.length + end.length);
  out.set(local, 0);
  out.set(data, local.length);
  out.set(cd, local.length + data.length);
  out.set(end, local.length + data.length + cd.length);
  return out;
}

function crcSync(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

const entry = (file: File, extra: Partial<LibraryEntry> = {}): LibraryEntry => ({ id: file.name, fileName: file.name, activityIndex: 0, file, ...extra }) as LibraryEntry;

describe("library backup", () => {
  const sample = new File([readFileSync("public/samples/reservoir-loop.tcx.xml")], "reservoir-loop.tcx");

  it("keeps each file once, with Strava's details, and unpacks to the same files", async () => {
    const ride = new File(["<gpx/>"], "activity.gpx");
    const twin = new File(["<gpx>other</gpx>"], "activity.gpx");
    const strava = { name: "Reservoir loop", type: "Run", gear: "Pegasus 41" };
    const entries = [
      entry(sample, { strava }),
      // Two activities from one file, and another file with the same name.
      entry(ride),
      entry(ride, { id: "ride#1", activityIndex: 1 }),
      entry(twin),
    ];
    const zip = await makeBackup(entries, new Date(2026, 10, 9));
    const paths = (await readZip(zip)).map((e) => e.path);
    expect(paths[0]).toBe(MANIFEST);
    expect(paths.slice(1)).toEqual(["activities/1/reservoir-loop.tcx", "activities/2/activity.gpx", "activities/3/activity.gpx"]);

    const u = await unpackZip(zip, (n) => n !== MANIFEST);
    expect(u.files.map((f) => f.name)).toEqual(["reservoir-loop.tcx", "activity.gpx", "activity.gpx"]);
    expect(await u.files[0].text()).toBe(await sample.text());
    expect(await u.files[2].text()).toBe("<gpx>other</gpx>");
    expect(u.strava?.get("reservoir-loop.tcx")).toEqual(strava);
    expect(u.problems).toEqual([]);
  });

  it("treats any other ZIP as plain files, leaving out macOS clutter", async () => {
    const zip = await writeZip([
      { path: "export/activities.csv", data: text("Activity ID,Filename") },
      { path: "export/activities/9.fit.gz", data: text("x") },
      { path: "__MACOSX/export/._9.fit.gz", data: text("junk") },
      { path: "export/._notes.gpx", data: text("junk") },
      { path: "export/profile.json", data: text("{}") },
    ]);
    const u = await unpackZip(zip, (n) => /\.(gpx|fit)(\.gz)?$|^activities\.csv$/i.test(n));
    expect(u.files.map((f) => f.name)).toEqual(["activities.csv", "9.fit.gz"]);
    expect(u.strava).toBeNull();
  });

  it("ignores a library.json that isn't ours", async () => {
    const zip = await writeZip([{ path: MANIFEST, data: text('{"hello":1}') }]);
    expect((await unpackZip(zip, keepAll)).strava).toBeNull();
  });

  it("names the download by date", () => {
    expect(backupName(new Date(2026, 0, 5))).toBe("activity-library-2026-01-05.zip");
  });
});
