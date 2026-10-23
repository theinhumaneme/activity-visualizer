// Garmin's FIT format: a binary stream of definition messages (field layouts per local message
// type) and data messages laid out by them. Only the messages an activity needs are decoded.
import { type RawSample, cadenceIsPerLeg, finalizeSamples, resolveKind, sportKind } from "./common";
import type { Activity, Lap } from "./types";

/** FIT timestamps count seconds from 1989-12-31T00:00:00Z. */
const FIT_EPOCH = 631065600_000;
const SEMICIRCLE = 180 / 2 ** 31;

const MSG = { fileId: 0, sport: 12, session: 18, lap: 19, record: 20, event: 21, activity: 34 } as const;
const WANTED = new Set<number>(Object.values(MSG));

type Fields = Record<number, number | string>;
interface Message {
  num: number;
  f: Fields;
}

interface FieldDef {
  num: number;
  size: number;
  type: number;
}
interface Definition {
  num: number;
  little: boolean;
  fields: FieldDef[];
  /** Developer fields are skipped; only their total size matters. */
  devBytes: number;
}

const utf8 = new TextDecoder();

/** True when the bytes start with a FIT header. */
export function isFit(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54; // ".FIT"
}

/** Reads one field value, or undefined for the base type's "invalid" marker or an array/odd size. */
function readValue(view: DataView, at: number, def: FieldDef, little: boolean): number | string | undefined {
  const t = def.type & 0x1f;
  if (t === 7) {
    const bytes = new Uint8Array(view.buffer, view.byteOffset + at, def.size);
    const nul = bytes.indexOf(0);
    return utf8.decode(nul < 0 ? bytes : bytes.subarray(0, nul)) || undefined;
  }
  let v: number;
  switch (t) {
    case 0: // enum
    case 2: // uint8
    case 10: // uint8z
    case 13: // byte
      v = view.getUint8(at);
      return v === (t === 10 ? 0 : 0xff) ? undefined : v;
    case 1:
      v = view.getInt8(at);
      return v === 0x7f ? undefined : v;
    case 3:
      if (def.size < 2) return undefined;
      v = view.getInt16(at, little);
      return v === 0x7fff ? undefined : v;
    case 4:
    case 11:
      if (def.size < 2) return undefined;
      v = view.getUint16(at, little);
      return v === (t === 11 ? 0 : 0xffff) ? undefined : v;
    case 5:
      if (def.size < 4) return undefined;
      v = view.getInt32(at, little);
      return v === 0x7fffffff ? undefined : v;
    case 6:
    case 12:
      if (def.size < 4) return undefined;
      v = view.getUint32(at, little);
      return v === (t === 12 ? 0 : 0xffffffff) ? undefined : v;
    case 8:
      if (def.size < 4) return undefined;
      v = view.getFloat32(at, little);
      return Number.isFinite(v) ? v : undefined;
    case 9:
      if (def.size < 8) return undefined;
      v = view.getFloat64(at, little);
      return Number.isFinite(v) ? v : undefined;
    default:
      return undefined; // 64-bit integers: nothing an activity needs.
  }
}

/** Decodes the messages we use, in file order. Chained FIT files (several in one) are read in turn. */
export function decodeFit(bytes: Uint8Array): Message[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Message[] = [];
  let pos = 0;
  while (pos + 12 <= bytes.length && isFit(bytes.subarray(pos))) {
    const headerSize = bytes[pos];
    const dataSize = view.getUint32(pos + 4, true);
    const end = Math.min(bytes.length, pos + headerSize + dataSize);
    const defs: (Definition | undefined)[] = [];
    let lastTime = 0;
    let p = pos + headerSize;
    while (p < end) {
      const h = bytes[p++];
      if (h & 0x80) {
        // Compressed timestamp header: a 5-bit offset from the last full timestamp.
        const def = defs[(h >> 5) & 0x03];
        if (!def) throw new Error("The FIT file is damaged (data before its definition).");
        const offset = h & 0x1f;
        lastTime += (offset - lastTime) & 0x1f;
        const m = readData(view, p, def);
        p = m.next;
        if (m.f) {
          m.f[253] = lastTime;
          out.push({ num: def.num, f: m.f });
        }
      } else if (h & 0x40) {
        const little = bytes[p + 1] === 0;
        const num = view.getUint16(p + 2, little);
        const n = bytes[p + 4];
        p += 5;
        const fields: FieldDef[] = [];
        for (let i = 0; i < n; i++, p += 3) fields.push({ num: bytes[p], size: bytes[p + 1], type: bytes[p + 2] });
        let devBytes = 0;
        if (h & 0x20) {
          const nd = bytes[p++];
          for (let i = 0; i < nd; i++, p += 3) devBytes += bytes[p + 1];
        }
        defs[h & 0x0f] = { num, little, fields, devBytes };
      } else {
        const def = defs[h & 0x0f];
        if (!def) throw new Error("The FIT file is damaged (data before its definition).");
        const m = readData(view, p, def);
        p = m.next;
        if (m.f) {
          if (typeof m.f[253] === "number") lastTime = m.f[253];
          out.push({ num: def.num, f: m.f });
        }
      }
    }
    pos = end + 2; // CRC
  }
  return out;
}

function readData(view: DataView, at: number, def: Definition): { f: Fields | null; next: number } {
  let p = at;
  const keep = WANTED.has(def.num);
  const f: Fields = {};
  for (const fd of def.fields) {
    if (keep && p + fd.size <= view.byteLength) {
      const v = readValue(view, p, fd, def.little);
      if (v !== undefined) f[fd.num] = v;
    }
    p += fd.size;
  }
  return { f: keep ? f : null, next: p + def.devBytes };
}

const SPORTS: Record<number, string> = {
  0: "Generic",
  1: "Running",
  2: "Cycling",
  4: "Fitness equipment",
  5: "Swimming",
  10: "Training",
  11: "Walking",
  12: "Cross-country skiing",
  13: "Alpine skiing",
  14: "Snowboarding",
  15: "Rowing",
  16: "Mountaineering",
  17: "Hiking",
  19: "Paddling",
  21: "E-biking",
  30: "Inline skating",
  35: "Snowshoeing",
  37: "Stand-up paddleboarding",
  38: "Surfing",
  41: "Kayaking",
  42: "Rafting",
  20: "Flying",
  22: "Motorcycling",
  23: "Boating",
  24: "Driving",
  32: "Sailing",
  33: "Ice skating",
  36: "Snowmobiling",
};
/** Sub-sports worth naming over their sport, keyed "sport:sub_sport" (sub-sport numbers are shared across sports). */
const SUB_SPORTS: Record<string, string> = {
  "1:3": "Trail running",
  "1:4": "Track running",
  "2:7": "Road cycling",
  "2:8": "Mountain biking",
  "2:11": "Cyclocross",
};
const MANUFACTURERS: Record<number, string> = {
  1: "Garmin",
  23: "Suunto",
  32: "Wahoo",
  123: "Polar",
  260: "Zwift",
  265: "Strava",
  289: "Hammerhead",
  294: "Coros",
};
const TRIGGERS: Record<number, string> = { 0: "Manual", 1: "Time", 2: "Distance", 3: "Location", 4: "Location", 5: "Location", 6: "Location" };

const time = (v: number | string | undefined) => (typeof v === "number" ? FIT_EPOCH + v * 1000 : undefined);
const n = (v: number | string | undefined) => (typeof v === "number" ? v : undefined);
const scaled = (v: number | string | undefined, scale: number, offset = 0) => (typeof v === "number" ? v / scale - offset : undefined);

export function parseFit(bytes: Uint8Array, fileName = "Activity"): Activity[] {
  if (!isFit(bytes)) throw new Error("This doesn't look like a FIT file (no .FIT header).");
  const msgs = decodeFit(bytes);
  const fileId = msgs.find((m) => m.num === MSG.fileId)?.f;
  // file_id type 4 is an activity; courses (6), workouts (5) and settings files aren't.
  if (fileId && n(fileId[0]) !== undefined && fileId[0] !== 4)
    throw new Error("This FIT file isn't a recorded activity (it may be a course, workout or settings file).");

  const product = typeof fileId?.[8] === "string" ? fileId[8] : undefined;
  const maker = MANUFACTURERS[n(fileId?.[1]) ?? -1];
  const device = product ? (maker && !product.toLowerCase().includes(maker.toLowerCase()) ? `${maker} ${product}` : product) : maker;

  // Local time from the activity message: its local_timestamp minus its UTC timestamp, to the quarter hour.
  const act = msgs.find((m) => m.num === MSG.activity)?.f;
  const utcOffsetMin = typeof act?.[5] === "number" && typeof act?.[253] === "number" ? Math.round((act[5] - act[253]) / 900) * 15 : undefined;

  // Records, with a new segment at each restart of the timer. Events are matched by time, not file
  // order: some apps write all of them before the records.
  const records = msgs.filter((m) => m.num === MSG.record);
  const firstTime = records.reduce((t, m) => Math.min(t, time(m.f[253]) ?? Infinity), Infinity);
  const restarts = msgs
    .filter((m) => m.num === MSG.event && m.f[0] === 0 && m.f[1] === 0)
    .map((m) => time(m.f[253]) ?? -Infinity)
    .filter((t) => t > firstTime);
  const raw: RawSample[] = [];
  let dropped = 0;
  for (const m of records) {
    const t = time(m.f[253]);
    if (t === undefined) {
      dropped++;
      continue;
    }
    const seg = restarts.filter((r) => r <= t).length;
    let lat = n(m.f[0]);
    let lon = n(m.f[1]);
    if (lat === undefined || lon === undefined || (lat === 0 && lon === 0)) lat = lon = NaN;
    else {
      lat *= SEMICIRCLE;
      lon *= SEMICIRCLE;
    }
    const cad = n(m.f[4]);
    const frac = n(m.f[53]);
    raw.push({
      time: t,
      lat,
      lon,
      dist: scaled(m.f[5], 100) ?? NaN,
      alt: scaled(m.f[78], 5, 500) ?? scaled(m.f[2], 5, 500),
      hr: n(m.f[3]),
      cad: cad === undefined ? undefined : cad + (frac ?? 0) / 128,
      speed: scaled(m.f[73], 1000) ?? scaled(m.f[6], 1000),
      power: n(m.f[7]),
      seg,
    });
  }

  const sessions = msgs.filter((m) => m.num === MSG.session).map((m) => m.f);
  const laps = msgs.filter((m) => m.num === MSG.lap).map((m) => m.f);
  const sportMsg = msgs.find((m) => m.num === MSG.sport)?.f;
  // No session message (a truncated recording): the whole file is one activity.
  const ranges = sessions.length
    ? sessions.map((s) => {
        const start = time(s[2]) ?? -Infinity;
        const elapsed = scaled(s[7], 1000);
        const end = time(s[253]) ?? (elapsed !== undefined ? start + elapsed * 1000 : Infinity);
        return { s, start, end };
      })
    : [{ s: { 5: sportMsg?.[0] ?? 0, 6: sportMsg?.[1] ?? 0 } as Fields, start: -Infinity, end: Infinity }];

  const activities: Activity[] = [];
  ranges.forEach(({ s, start, end }, i) => {
    const last = i === ranges.length - 1;
    const first = i === 0;
    // Records just outside a session's bounds (a second either side) still belong to it.
    const own = raw.filter((r) => (first || r.time >= start) && (last || r.time < ranges[i + 1].start));
    if (!own.length) return;
    const name = ranges.length > 1 ? `${fileName} (${i + 1})` : fileName;
    try {
      activities.push(
        build(
          own,
          s,
          laps.filter((l) => {
            const t = time(l[2]) ?? time(l[253]) ?? 0;
            return t >= start - 1000 && t <= end;
          }),
          { name, device, utcOffsetMin, multisport: ranges.length > 1, dropped: first ? dropped : 0 },
        ),
      );
    } catch (err) {
      if (ranges.length === 1) throw err;
    }
  });
  if (!activities.length) {
    throw new Error(
      raw.length ? "None of the records have GPS positions, so there's no route to draw (treadmill or indoor activity?)." : "The FIT file has no records.",
    );
  }
  return activities;
}

function build(
  rows: RawSample[],
  s: Fields,
  lapMsgs: Fields[],
  meta: { name: string; device?: string; utcOffsetMin?: number; multisport: boolean; dropped: number },
): Activity {
  const sport = SUB_SPORTS[`${s[5]}:${s[6]}`] ?? SPORTS[n(s[5]) ?? -1] ?? "Activity";
  const kind = sportKind(sport);
  // Copies, so splitting one file into sessions never shares sample objects.
  const raw = rows.map((r) => ({ ...r }));
  const seg0 = raw[0].seg;
  for (const r of raw) r.seg -= seg0;

  // FIT cadence is per leg (strides/min) for running; doubled when the median says so.
  const doubled = cadenceIsPerLeg(
    raw.map((r) => r.cad),
    kind,
    true,
  );
  for (const r of raw) {
    if (r.cad !== undefined) r.cad = doubled ? Math.round(r.cad * 2) : Math.round(r.cad);
  }

  const distCount = raw.filter((r) => Number.isFinite(r.dist)).length;
  const hasFileDistance = distCount / raw.length > 0.95;
  const done = finalizeSamples(raw, hasFileDistance);
  if (!done || done.samples.length < 2) throw new Error("None of the records have GPS positions, so there's no route to draw (treadmill or indoor activity?).");
  const { samples, interpolated } = done;
  const resolved = resolveKind(kind, samples, false);

  const lapStarts = lapMsgs.map((l) => time(l[2]) ?? samples[0].time);
  const laps: Lap[] = lapMsgs.length
    ? lapMsgs.map((l, i) => {
        const from = lapStarts[i];
        const to = i + 1 < lapStarts.length ? lapStarts[i + 1] : Infinity;
        let startIndex = samples.findIndex((x) => x.time >= from);
        if (startIndex < 0) startIndex = samples.length - 1;
        let endIndex = samples.findIndex((x) => x.time >= to) - 1;
        if (endIndex < 0) endIndex = samples.length - 1;
        return {
          startIndex,
          endIndex: Math.max(startIndex, endIndex),
          startTime: from,
          totalTime: scaled(l[8], 1000) ?? scaled(l[7], 1000),
          distance: scaled(l[9], 100),
          calories: n(l[11]),
          avgHr: n(l[15]),
          maxHr: n(l[16]),
          intensity: l[23] === undefined ? undefined : l[23] === 1 ? "Resting" : "Active",
          trigger: TRIGGERS[n(l[24]) ?? -1],
        };
      })
    : [{ startIndex: 0, endIndex: samples.length - 1, startTime: samples[0].time }];

  return {
    name: meta.name,
    sport,
    kind: resolved.kind,
    kindInferred: resolved.inferred || undefined,
    startTime: samples[0].time,
    utcOffsetMin: meta.utcOffsetMin,
    device: meta.device,
    source: "fit",
    laps,
    samples,
    fileTotals: { distance: scaled(s[9], 100), time: scaled(s[8], 1000) ?? scaled(s[7], 1000), calories: n(s[11]) },
    droppedPoints: meta.dropped,
    interpolatedPoints: interpolated,
    hasFileDistance,
    cadenceDoubled: doubled,
    routeOnly: false,
    multisport: meta.multisport || undefined,
  };
}
