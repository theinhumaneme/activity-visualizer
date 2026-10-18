import { describe, expect, it } from "vitest";
import { readExif } from "./photos";

/** A minimal little-endian EXIF block: DateTimeOriginal, OffsetTimeOriginal and GPS. */
function exifBlock() {
  const b = new Uint8Array(400);
  const v = new DataView(b.buffer);
  b.set([0x45, 0x78, 0x69, 0x66, 0, 0], 10); // "Exif\0\0" after some JPEG-ish bytes
  const T = 16; // TIFF start
  const w16 = (o: number, x: number) => v.setUint16(T + o, x, true);
  const w32 = (o: number, x: number) => v.setUint32(T + o, x, true);
  const ascii = (o: number, s: string) => [...s].forEach((c, k) => (b[T + o + k] = c.charCodeAt(0)));
  b[T] = 0x49;
  b[T + 1] = 0x49;
  w16(2, 42);
  w32(4, 8);
  // IFD0 at 8: ExifIFD pointer, GPS pointer.
  w16(8, 2);
  w16(10, 0x8769), w16(12, 4), w32(14, 1), w32(18, 50);
  w16(22, 0x8825), w16(24, 4), w32(26, 1), w32(30, 120);
  // Exif IFD at 50: DateTimeOriginal (20 bytes at 200), OffsetTimeOriginal (7 bytes at 230).
  w16(50, 2);
  w16(52, 0x9003), w16(54, 2), w32(56, 20), w32(60, 200);
  w16(64, 0x9011), w16(66, 2), w32(68, 7), w32(72, 230);
  ascii(200, "2026:10:17 18:05:30");
  ascii(230, "-04:00");
  // GPS IFD at 120: N, 42°20'24", W, 71°5'26.4".
  w16(120, 4);
  w16(122, 1), w16(124, 2), w32(126, 2), ascii(130, "N");
  w16(134, 2), w16(136, 5), w32(138, 3), w32(142, 250);
  w16(146, 3), w16(148, 2), w32(150, 2), ascii(154, "W");
  w16(158, 4), w16(160, 5), w32(162, 3), w32(166, 300);
  const rat = (o: number, n: number, d: number) => (w32(o, n), w32(o + 4, d));
  rat(250, 42, 1), rat(258, 20, 1), rat(266, 24, 1);
  rat(300, 71, 1), rat(308, 5, 1), rat(316, 264, 10);
  return b.buffer;
}

describe("readExif", () => {
  it("reads capture time, offset and GPS", () => {
    const e = readExif(exifBlock());
    expect(e.date).toBe("2026:10:17 18:05:30");
    expect(e.offset).toBe("-04:00");
    expect(e.lat).toBeCloseTo(42.34, 4);
    expect(e.lon).toBeCloseTo(-71.0907, 4);
  });

  it("returns nothing for files without EXIF", () => {
    expect(readExif(new Uint8Array(64).buffer)).toEqual({});
  });
});
