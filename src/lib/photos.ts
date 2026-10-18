// Photos in the flyover: each one is placed on the route by where it was taken (EXIF GPS) or,
// failing that, when (EXIF capture time), and pops up as the athlete passes that spot. Photos
// are read and decoded on the device and kept only in memory.

import type { Analysis } from "./analysis/types";
import { haversine } from "./geo/geo";
import type { LngLat } from "./geo/geo";

export interface Photo {
  id: string;
  name: string;
  /** Decoded, at most MAX_SIDE px on its long side. */
  bitmap: ImageBitmap;
  /** Capture time, epoch ms (absent when the photo has no EXIF date). */
  time?: number;
  /** Raw EXIF wall-clock time when there was no offset (placed in the activity's time zone). */
  localTime?: { y: number; mo: number; d: number; h: number; mi: number; s: number };
  lat?: number;
  lon?: number;
}

export interface PlacedPhoto {
  photo: Photo;
  /** Sample index the photo belongs to. */
  index: number;
  at: LngLat;
  how: "location" | "time";
}

const MAX_SIDE = 1280;
/** A photo's location must be this close to the route to be placed by it (meters). */
const NEAR_ROUTE = 300;
/** Photos taken this long before the start or after the finish still count (ms). */
const TIME_SLACK = 15 * 60 * 1000;

// --- EXIF ---------------------------------------------------------------------------------------

interface Exif {
  date?: string;
  offset?: string;
  lat?: number;
  lon?: number;
}

/** Finds the EXIF block (JPEG APP1 or the HEIC Exif item, both start "Exif\0\0") and reads it. */
export function readExif(buf: ArrayBuffer): Exif {
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < u8.length - 14; i++) {
    if (u8[i] !== 0x45 || u8[i + 1] !== 0x78 || u8[i + 2] !== 0x69 || u8[i + 3] !== 0x66 || u8[i + 4] !== 0 || u8[i + 5] !== 0) continue;
    const t = i + 6;
    const little = u8[t] === 0x49 && u8[t + 1] === 0x49;
    const big = u8[t] === 0x4d && u8[t + 1] === 0x4d;
    if (!little && !big) continue;
    try {
      return parseTiff(new DataView(buf, t), little);
    } catch {
      return {};
    }
  }
  return {};
}

function parseTiff(v: DataView, le: boolean): Exif {
  const u16 = (o: number) => v.getUint16(o, le);
  const u32 = (o: number) => v.getUint32(o, le);
  const ascii = (o: number, n: number) => {
    let s = "";
    for (let k = 0; k < n; k++) {
      const c = v.getUint8(o + k);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  /** Tag → [type, count, value offset] for one IFD. */
  const ifd = (o: number) => {
    const out = new Map<number, [number, number, number]>();
    const n = u16(o);
    for (let k = 0; k < n; k++) {
      const e = o + 2 + k * 12;
      out.set(u16(e), [u16(e + 2), u32(e + 4), e + 8]);
    }
    return out;
  };
  const str = (m: Map<number, [number, number, number]>, tag: number) => {
    const t = m.get(tag);
    if (!t || t[0] !== 2) return undefined;
    return ascii(t[1] > 4 ? u32(t[2]) : t[2], t[1]);
  };
  const rationals = (m: Map<number, [number, number, number]>, tag: number) => {
    const t = m.get(tag);
    if (!t || t[0] !== 5) return undefined;
    const o = u32(t[2]);
    return Array.from({ length: t[1] }, (_, k) => u32(o + k * 8) / (u32(o + k * 8 + 4) || 1));
  };
  const ifd0 = ifd(u32(4));
  const out: Exif = {};
  const exifPtr = ifd0.get(0x8769);
  if (exifPtr) {
    const ex = ifd(u32(exifPtr[2]));
    out.date = str(ex, 0x9003) ?? str(ex, 0x9004) ?? str(ifd0, 0x0132);
    out.offset = str(ex, 0x9011) ?? str(ex, 0x9010);
  } else out.date = str(ifd0, 0x0132);
  const gpsPtr = ifd0.get(0x8825);
  if (gpsPtr) {
    const g = ifd(u32(gpsPtr[2]));
    const lat = rationals(g, 2);
    const lon = rationals(g, 4);
    const dms = (a: number[]) => a[0] + (a[1] ?? 0) / 60 + (a[2] ?? 0) / 3600;
    if (lat?.length && lon?.length) {
      const la = dms(lat) * (str(g, 1) === "S" ? -1 : 1);
      const lo = dms(lon) * (str(g, 3) === "W" ? -1 : 1);
      if (Number.isFinite(la) && Number.isFinite(lo) && (la !== 0 || lo !== 0)) {
        out.lat = la;
        out.lon = lo;
      }
    }
  }
  return out;
}

// --- Reading --------------------------------------------------------------------------------------

let seq = 0;

/** Reads a photo: EXIF time and place, and a decoded copy small enough to keep. Null if it can't be decoded. */
export async function readPhoto(file: File): Promise<Photo | null> {
  // EXIF sits near the start of JPEG and iPhone HEIC files.
  const head = await file.slice(0, 1024 * 1024).arrayBuffer();
  const exif = readExif(head);
  let full: ImageBitmap;
  try {
    full = await createImageBitmap(file);
  } catch {
    return null;
  }
  const k = Math.min(1, MAX_SIDE / Math.max(full.width, full.height));
  let bitmap = full;
  if (k < 1) {
    bitmap = await createImageBitmap(full, { resizeWidth: Math.round(full.width * k), resizeHeight: Math.round(full.height * k), resizeQuality: "high" });
    full.close();
  }
  const photo: Photo = { id: `p${++seq}`, name: file.name, bitmap, lat: exif.lat, lon: exif.lon };
  const m = exif.date && /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(exif.date);
  if (m) {
    const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
    const off = exif.offset && /^([+-])(\d\d):(\d\d)$/.exec(exif.offset);
    if (off) photo.time = Date.UTC(y, mo - 1, d, h, mi, s) - (off[1] === "-" ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3])) * 60000;
    else photo.localTime = { y, mo, d, h, mi, s };
  }
  return photo;
}

// --- Placing --------------------------------------------------------------------------------------

/** Capture time in epoch ms: with its own offset, else in the activity's time zone, else this device's. */
function photoTime(p: Photo, a: Analysis): number | undefined {
  if (p.time !== undefined) return p.time;
  const l = p.localTime;
  if (!l) return undefined;
  const off = a.activity.utcOffsetMin;
  return off !== undefined ? Date.UTC(l.y, l.mo - 1, l.d, l.h, l.mi, l.s) - off * 60000 : new Date(l.y, l.mo - 1, l.d, l.h, l.mi, l.s).getTime();
}

function indexAtTime(a: Analysis, ms: number) {
  const s = a.samples;
  let lo = 0;
  let hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid].time < ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Where each photo goes on the route, in route order. By location when the photo has one near the
 * route (the visit nearest its capture time, on routes that pass a spot twice), else by time.
 * Photos that match neither are left out (`unplaced`).
 */
export function placePhotos(a: Analysis, photos: readonly Photo[]): { placed: PlacedPhoto[]; unplaced: Photo[] } {
  const placed: PlacedPhoto[] = [];
  const unplaced: Photo[] = [];
  const timed = !a.activity.routeOnly && a.n > 1;
  for (const p of photos) {
    const t = timed ? photoTime(p, a) : undefined;
    let index = -1;
    let how: PlacedPhoto["how"] = "location";
    if (p.lat !== undefined && p.lon !== undefined) {
      let best = Infinity;
      for (let i = 0; i < a.n; i += 1) {
        const d = haversine(p.lat, p.lon, a.samples[i].lat, a.samples[i].lon);
        if (d > NEAR_ROUTE) continue;
        // Near the route: prefer the pass closest in time, then the closest point.
        const score = t !== undefined ? Math.abs(a.samples[i].time - t) / 1000 + d : d;
        if (score < best) {
          best = score;
          index = i;
        }
      }
    }
    if (index < 0 && t !== undefined && t >= a.samples[0].time - TIME_SLACK && t <= a.samples[a.n - 1].time + TIME_SLACK) {
      index = Math.min(a.n - 1, indexAtTime(a, t));
      how = "time";
    }
    if (index < 0) unplaced.push(p);
    else placed.push({ photo: p, index, at: [a.samples[index].lon, a.samples[index].lat], how });
  }
  placed.sort((x, y) => x.index - y.index);
  return { placed, unplaced };
}
