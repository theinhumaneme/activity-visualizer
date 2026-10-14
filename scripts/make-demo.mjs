// Builds the public sample activity: a synthetic run around the Central Park Reservoir loop
// that borrows the pace and heart-rate rhythm of a real run, without its location or date.
//
//   node scripts/make-demo.mjs <source.tcx> [out.tcx]
import { readFileSync, writeFileSync } from "node:fs";

const [src, out = "public/samples/reservoir-loop.tcx"] = process.argv.slice(2);
if (!src) {
  console.error("usage: node scripts/make-demo.mjs <source.tcx> [out.tcx]");
  process.exit(1);
}

const loop = JSON.parse(readFileSync(new URL("./data/reservoir-loop.json", import.meta.url))).coordinates;
const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const hav = (a, b) => {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// Start at the south-east gate (node nearest East 86th St entrance) and run counter-clockwise.
let startIdx = 0;
let best = Infinity;
for (let i = 0; i < loop.length; i++) {
  const d = hav(loop[i], [-73.9592, 40.7832]);
  if (d < best) {
    best = d;
    startIdx = i;
  }
}
const ring = [...loop.slice(startIdx, -1), ...loop.slice(0, startIdx), loop[startIdx]].reverse();
const cum = [0];
for (let i = 1; i < ring.length; i++) cum.push(cum[i - 1] + hav(ring[i - 1], ring[i]));
const loopLen = cum.at(-1);

function along(d) {
  d = ((d % loopLen) + loopLen) % loopLen;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const f = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  return [ring[i - 1][0] + f * (ring[i][0] - ring[i - 1][0]), ring[i - 1][1] + f * (ring[i][1] - ring[i - 1][1])];
}

// Deterministic noise so the output is reproducible.
let seed = 42;
const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

const xml = readFileSync(src, "utf8");
const pts = [...xml.matchAll(/<Trackpoint>([\s\S]*?)<\/Trackpoint>/g)].map((m) => {
  const b = m[1];
  const get = (tag) => b.match(new RegExp(`<${tag}>([^<]+)</${tag}>`))?.[1];
  return { time: Date.parse(get("Time")), dist: Number(get("DistanceMeters")), hr: Number(b.match(/<Value>(\d+)<\/Value>/)?.[1]) };
});
const t0 = pts[0].time;
const srcDist = pts.at(-1).dist;
const scale = (loopLen + 20) / srcDist; // one full loop plus a few steps
const start = Date.parse("2026-04-18T07:32:10-04:00");

let drift = [0, 0];
const rows = pts.map((p, i) => {
  const dist = p.dist * scale;
  const [lon, lat] = along(dist);
  drift = [drift[0] * 0.9 + gauss() * 0.35, drift[1] * 0.9 + gauss() * 0.35]; // ~2 m wandering GPS error
  const mPerDegLat = 111320;
  const prev = pts[i - 1];
  const moving = prev && (p.dist - prev.dist) / ((p.time - prev.time) / 1000) > 0.6;
  const cadence = moving ? Math.round(81 + gauss() * 1.5) : 0;
  return {
    time: new Date(start + (p.time - t0)).toISOString(),
    lat: lat + drift[1] / mPerDegLat,
    lon: lon + drift[0] / (mPerDegLat * Math.cos(rad(lat))),
    alt: 33 + 2.2 * Math.sin((dist / loopLen) * 2 * Math.PI + 1.1) + gauss() * 0.15,
    dist,
    hr: Math.max(60, Math.round(p.hr - 4 + gauss())),
    cadence,
  };
});

const tp = (r) => `        <Trackpoint>
          <Time>${r.time}</Time>
          <Position><LatitudeDegrees>${r.lat.toFixed(7)}</LatitudeDegrees><LongitudeDegrees>${r.lon.toFixed(7)}</LongitudeDegrees></Position>
          <AltitudeMeters>${r.alt.toFixed(1)}</AltitudeMeters>
          <DistanceMeters>${r.dist.toFixed(2)}</DistanceMeters>
          <HeartRateBpm><Value>${r.hr}</Value></HeartRateBpm>
          <Extensions><ns3:TPX><ns3:RunCadence>${r.cadence}</ns3:RunCadence></ns3:TPX></Extensions>
        </Trackpoint>`;

const totalTime = (pts.at(-1).time - t0) / 1000;
const doc = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities>
    <Activity Sport="Running">
      <Id>${rows[0].time}</Id>
      <Lap StartTime="${rows[0].time}">
        <TotalTimeSeconds>${totalTime.toFixed(1)}</TotalTimeSeconds>
        <DistanceMeters>${rows.at(-1).dist.toFixed(1)}</DistanceMeters>
        <Calories>271</Calories>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
${rows.map(tp).join("\n")}
        </Track>
      </Lap>
      <Notes>Synthetic sample run. Route: (c) OpenStreetMap contributors.</Notes>
      <Creator xsi:type="Device_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Name>Sample data</Name></Creator>
    </Activity>
  </Activities>
</TrainingCenterDatabase>
`;
writeFileSync(out, doc);
console.log(`wrote ${out}: ${rows.length} points, ${rows.at(-1).dist.toFixed(0)} m, loop ${loopLen.toFixed(0)} m`);
