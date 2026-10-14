import { XMLParser } from "fast-xml-parser";
import { haversine } from "../geo/geo";
import { type RawSample, asArray, cadenceIsPerLeg, finalizeSamples, num, resolveKind, sportKind, utcOffsetOf } from "./common";
import { SPORTS } from "../sport";
import type { Activity, Sample } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = Record<string, any>;

/** Reads a child by local name whatever its namespace (gpxtpx:hr, ns3:hr, hr…). */
function local(node: Node | undefined, name: string): unknown {
  if (!node || typeof node !== "object") return undefined;
  if (name in node) return node[name];
  for (const v of Object.values(node)) {
    if (v && typeof v === "object") {
      const found = local(v as Node, name);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

export function parseGpx(xml: string, fileName = "Activity"): Activity[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    isArray: (name) => ["trk", "trkseg", "trkpt", "rte", "rtept"].includes(name),
  });
  const doc = parser.parse(xml) as Node;
  if (!("gpx" in doc)) throw new Error("This doesn't look like a GPX file (no gpx element).");
  const gpx: Node = doc.gpx ?? {};
  const device = gpx["@_creator"] ? String(gpx["@_creator"]) : undefined;
  const tracks = asArray<Node>(gpx.trk);
  // Planned routes (rte/rtept) have no timestamps at all; treat each like an untimed track.
  const routes = asArray<Node>(gpx.rte).map((r) => ({ name: r.name, type: r.type, trkseg: [{ trkpt: asArray<Node>(r.rtept) }] }));
  const all = [...tracks, ...routes];
  if (!all.length) throw new Error("The GPX file contains no tracks or routes.");

  return all.map((trk) => {
    // GPX often has no <type>; the sport is then inferred from speed below.
    const sport = String(trk.type ?? "activity");
    const kind = sportKind(sport);
    const raw: RawSample[] = [];
    let dropped = 0;
    let firstIso: string | undefined;
    let timed = 0;
    const segs = asArray<Node>(trk.trkseg);
    segs.forEach((seg, k) => {
      for (const p of asArray<Node>(seg.trkpt)) {
        const lat = num(p["@_lat"]);
        const lon = num(p["@_lon"]);
        if (lat === undefined || lon === undefined) {
          dropped++;
          continue;
        }
        const iso = p.time === undefined ? "" : String(p.time);
        const time = Date.parse(iso);
        if (Number.isFinite(time)) {
          timed++;
          firstIso ??= iso;
        }
        const ext = p.extensions as Node | undefined;
        raw.push({
          time,
          lat,
          lon,
          dist: NaN,
          alt: num(p.ele),
          hr: num(local(ext, "hr")),
          cad: num(local(ext, "cad")),
          speed: num(local(ext, "speed")),
          power: num(local(ext, "power")),
          seg: k,
        });
      }
    });
    if (raw.length < 2) throw new Error("The GPX track has fewer than two points.");

    // No (or almost no) timestamps: synthesize time from distance at a nominal pace, in file order.
    const routeOnly = timed / raw.length < 0.5;
    if (routeOnly) {
      let d = 0;
      const t0 = Date.UTC(2000, 0, 1);
      raw.forEach((r, i) => {
        if (i > 0) d += haversine(raw[i - 1].lat, raw[i - 1].lon, r.lat, r.lon);
        r.time = t0 + Math.round((d / SPORTS[kind].nominalSpeed) * 1000) + i; // +i keeps times strictly increasing
        r.hr = r.cad = r.speed = r.power = undefined;
      });
    } else {
      dropped += raw.filter((r) => !Number.isFinite(r.time)).length;
    }
    const usable = raw.filter((r) => Number.isFinite(r.time));

    const doubled = cadenceIsPerLeg(
      usable.map((r) => r.cad),
      kind,
      true,
    );
    if (doubled) for (const r of usable) if (r.cad) r.cad *= 2;

    const done = finalizeSamples(usable, false);
    if (!done || done.samples.length < 2) throw new Error("The GPX track has no usable points.");
    const samples: Sample[] = done.samples;
    const resolved = resolveKind(kind, samples, routeOnly);
    return {
      name: String(trk.name ?? fileName),
      sport,
      kind: resolved.kind,
      kindInferred: resolved.inferred || undefined,
      startTime: samples[0].time,
      utcOffsetMin: utcOffsetOf(firstIso),
      device,
      source: "gpx" as const,
      laps: [{ startIndex: 0, endIndex: samples.length - 1, startTime: samples[0].time }],
      samples,
      fileTotals: {},
      droppedPoints: dropped,
      interpolatedPoints: done.interpolated,
      hasFileDistance: false,
      cadenceDoubled: doubled,
      routeOnly,
    };
  });
}
