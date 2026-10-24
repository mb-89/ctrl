// A zip file without compression ("stored"), enough to hand over a few text
// files as one download: the external plant with its runme scripts (Live
// mode). No DOM. Each file: { name, data (string or Uint8Array), mode }; mode
// is the Unix permission (0o755 makes runme.sh executable after unzipping).

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipFiles(files, date = new Date()) {
  const enc = new TextEncoder();
  // MS-DOS time and date, as every zip reader expects them.
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    // The fields both headers share: version 2.0, UTF-8 names, stored.
    const common = (v) => { v.setUint16(0, 20, true); v.setUint16(2, 0x0800, true); v.setUint16(4, 0, true); v.setUint16(6, time, true); v.setUint16(8, day, true); v.setUint32(10, crc, true); v.setUint32(14, data.length, true); v.setUint32(18, data.length, true); v.setUint16(22, name.length, true); };
    const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    common(new DataView(local.buffer, 4));
    local.set(name, 30);
    const head = new Uint8Array(46 + name.length), cv = new DataView(head.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, (3 << 8) | 20, true);  // made by: Unix, so the mode below counts
    common(new DataView(head.buffer, 6));
    cv.setUint32(38, (((f.mode ?? 0o644) | 0o100000) << 16) >>> 0, true);
    cv.setUint32(42, offset, true);
    head.set(name, 46);
    parts.push(local, data);
    central.push(head);
    offset += local.length + data.length;
  }
  const size = central.reduce((s, h) => s + h.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const p of [...parts, ...central, end]) { out.set(p, at); at += p.length; }
  return out;
}
