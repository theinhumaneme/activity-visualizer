export type LngLat = [number, number];

const R = 6371008.8;
export const toRad = (d: number) => (d * Math.PI) / 180;
export const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from point 1 to point 2, degrees clockwise from north in [0, 360). */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point `meters` away from (lon, lat) along `bearingDeg`. Flat-earth approximation, fine below ~10 km. */
export function offset(lon: number, lat: number, bearingDeg: number, meters: number): LngLat {
  const b = toRad(bearingDeg);
  const dLat = (meters * Math.cos(b)) / R;
  const dLon = (meters * Math.sin(b)) / (R * Math.cos(toRad(lat)));
  return [lon + toDeg(dLon), lat + toDeg(dLat)];
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function boundsOf(points: { lat: number; lon: number }[]): Bounds {
  const b = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
  for (const p of points) {
    if (p.lon < b.west) b.west = p.lon;
    if (p.lon > b.east) b.east = p.lon;
    if (p.lat < b.south) b.south = p.lat;
    if (p.lat > b.north) b.north = p.lat;
  }
  return b;
}

// Web Mercator in [0, 1] world units.
export const mercX = (lon: number) => (lon + 180) / 360;
export const mercY = (lat: number) => {
  const s = Math.sin(toRad(lat));
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
export const unmercX = (x: number) => x * 360 - 180;
export const unmercY = (y: number) => toDeg(Math.atan(Math.sinh(Math.PI * (1 - 2 * y))));

/** Zoom level (MapLibre, 512 px tiles) that fits `b` in a w×h viewport with `padding` px on each side. */
export function fitZoom(b: Bounds, w: number, h: number, padding: number): number {
  const dx = Math.max(mercX(b.east) - mercX(b.west), 1e-9);
  const dy = Math.max(mercY(b.south) - mercY(b.north), 1e-9);
  const zx = Math.log2(Math.max(w - 2 * padding, 1) / (dx * 512));
  const zy = Math.log2(Math.max(h - 2 * padding, 1) / (dy * 512));
  return Math.min(zx, zy, 18);
}

export function boundsCenter(b: Bounds): LngLat {
  return [unmercX((mercX(b.west) + mercX(b.east)) / 2), unmercY((mercY(b.north) + mercY(b.south)) / 2)];
}
