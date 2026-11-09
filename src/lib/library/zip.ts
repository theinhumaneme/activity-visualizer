// A small ZIP reader and writer, enough for library backups and Strava's bulk-export .zip.
// Writing stores files as they are (activity files are already compact, and FIT/.gz don't
// deflate further); reading handles stored and deflated entries and ZIP64, and only reads the
// parts of the archive it needs, so a multi-gigabyte export isn't loaded into memory at once.

export interface ZipInput {
  /** Path inside the archive, "/"-separated. */
  path: string;
  data: Blob;
}

export interface ZipEntry {
  path: string;
  /** Uncompressed size, bytes. */
  size: number;
  /** The entry's contents. */
  read(): Promise<Blob>;
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const END64 = 0x06064b50;
const END64_LOCATOR = 0x07064b50;
const UTF8 = 0x0800;
const MAX32 = 0xffffffff;

let table: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (table) return table;
  table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

/** CRC-32 of a blob, read in chunks. */
export async function crc32(data: Blob): Promise<number> {
  const t = crcTable();
  let c = 0xffffffff;
  const reader = data.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (let i = 0; i < value.length; i++) c = t[(c ^ value[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, as ZIP headers keep them. */
function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** A ZIP of these files, stored uncompressed. The files' bytes aren't copied until the blob is read. */
export async function writeZip(files: ZipInput[], now = new Date()): Promise<Blob> {
  if (files.length > 0xfffe) throw new Error("Too many files for one backup.");
  const enc = new TextEncoder();
  const { time, date } = dosTime(now);
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.path);
    const size = f.data.size;
    const crc = await crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, LOCAL, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, UTF8, true);
    v.setUint16(8, 0, true);
    v.setUint16(10, time, true);
    v.setUint16(12, date, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, size, true);
    v.setUint32(22, size, true);
    v.setUint16(26, name.length, true);
    v.setUint16(28, 0, true);
    local.set(name, 30);

    const cd = new Uint8Array(46 + name.length);
    const w = new DataView(cd.buffer);
    w.setUint32(0, CENTRAL, true);
    w.setUint16(4, 20, true);
    w.setUint16(6, 20, true);
    w.setUint16(8, UTF8, true);
    w.setUint16(10, 0, true);
    w.setUint16(12, time, true);
    w.setUint16(14, date, true);
    w.setUint32(16, crc, true);
    w.setUint32(20, size, true);
    w.setUint32(24, size, true);
    w.setUint16(28, name.length, true);
    w.setUint32(42, offset, true);
    cd.set(name, 46);
    central.push(cd);

    parts.push(local, f.data);
    offset += local.length + size;
    if (offset > MAX32) throw new Error("The backup would be over 4 GB.");
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, END, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true);
  e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}

async function bytes(blob: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

/** The entries of a ZIP (folders left out). Throws if it isn't one. */
export async function readZip(zip: Blob): Promise<ZipEntry[]> {
  // The end record is in the last 22 bytes, plus up to 64 KB of comment.
  const tailStart = Math.max(0, zip.size - 22 - 0xffff);
  const tail = await bytes(zip, tailStart, zip.size);
  let at = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--)
    if (tail.getUint32(i, true) === END) {
      at = i;
      break;
    }
  if (at < 0) throw new Error("Not a ZIP file.");
  let count = tail.getUint16(at + 10, true);
  let cdSize = tail.getUint32(at + 12, true);
  let cdOffset = tail.getUint32(at + 16, true);
  if (count === 0xffff || cdSize === MAX32 || cdOffset === MAX32) {
    // ZIP64: the locator just before the end record points at the 64-bit end record.
    const loc = at - 20;
    if (loc < 0 || tail.getUint32(loc, true) !== END64_LOCATOR) throw new Error("This ZIP is damaged.");
    const end64At = Number(tail.getBigUint64(loc + 8, true));
    const end64 = await bytes(zip, end64At, end64At + 56);
    if (end64.getUint32(0, true) !== END64) throw new Error("This ZIP is damaged.");
    count = Number(end64.getBigUint64(32, true));
    cdSize = Number(end64.getBigUint64(40, true));
    cdOffset = Number(end64.getBigUint64(48, true));
  }
  const cd = await bytes(zip, cdOffset, cdOffset + cdSize);
  const dec = new TextDecoder();
  const out: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== CENTRAL) throw new Error("This ZIP is damaged.");
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    let csize = cd.getUint32(p + 20, true);
    let size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let local = cd.getUint32(p + 42, true);
    const path = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    // ZIP64 extra field: the 64-bit values, in this order, for whichever fields are maxed out.
    let x = p + 46 + nameLen;
    const xEnd = x + extraLen;
    while (x + 4 <= xEnd) {
      const id = cd.getUint16(x, true);
      const len = cd.getUint16(x + 2, true);
      if (id === 0x0001) {
        let q = x + 4;
        const next = () => {
          const v = Number(cd.getBigUint64(q, true));
          q += 8;
          return v;
        };
        if (size === MAX32) size = next();
        if (csize === MAX32) csize = next();
        if (local === MAX32) local = next();
      }
      x += 4 + len;
    }
    p = xEnd + commentLen;
    if (path.endsWith("/")) continue;
    const encrypted = (flags & 1) !== 0;
    out.push({
      path,
      size,
      async read() {
        if (encrypted) throw new Error(`${path} is encrypted.`);
        const h = await bytes(zip, local, local + 30);
        if (h.getUint32(0, true) !== LOCAL) throw new Error("This ZIP is damaged.");
        const start = local + 30 + h.getUint16(26, true) + h.getUint16(28, true);
        const raw = zip.slice(start, start + csize);
        if (method === 0) return raw;
        if (method === 8) return new Response(raw.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
        throw new Error(`${path} uses a compression this app can't read.`);
      },
    });
  }
  return out;
}
