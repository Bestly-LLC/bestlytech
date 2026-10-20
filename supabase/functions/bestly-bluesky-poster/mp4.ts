// Minimal MP4 reader: is it an MP4, how long is it, how big is the picture. Pure, no network.
// Used for Bluesky's aspectRatio and to refuse a clip that is over Bluesky's length limit before uploading it.

export type Mp4Info = { isMp4: boolean; durationSec: number | null; width: number | null; height: number | null };

export function readMp4(b: Uint8Array): Mp4Info {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const t4 = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  const isMp4 = b.length > 12 && t4(4) === "ftyp";
  const info: Mp4Info = { isMp4, durationSec: null, width: null, height: null };
  if (!isMp4) return info;

  // children of a box range [start, end)
  const kids = (start: number, end: number) => {
    const out: Array<{ type: string; body: number; end: number }> = [];
    let o = start;
    while (o + 8 <= end) {
      let size = dv.getUint32(o);
      const type = t4(o + 4);
      let head = 8;
      if (size === 1) { if (o + 16 > end) break; size = Number(dv.getBigUint64(o + 8)); head = 16; }
      else if (size === 0) size = end - o;
      if (size < head || o + size > end) break;
      out.push({ type, body: o + head, end: o + size });
      o += size;
    }
    return out;
  };

  const moov = kids(0, b.length).find((k) => k.type === "moov");
  if (!moov) return info;
  for (const k of kids(moov.body, moov.end)) {
    if (k.type === "mvhd") {
      const v = b[k.body];
      const timescale = v === 1 ? dv.getUint32(k.body + 20) : dv.getUint32(k.body + 12);
      const dur = v === 1 ? Number(dv.getBigUint64(k.body + 24)) : dv.getUint32(k.body + 16);
      if (timescale > 0) info.durationSec = dur / timescale;
    }
    if (k.type === "trak" && info.width === null) {
      const tkhd = kids(k.body, k.end).find((x) => x.type === "tkhd");
      if (!tkhd) continue;
      const v = b[tkhd.body];
      const matrix = tkhd.body + (v === 1 ? 52 : 40);
      const w = dv.getUint32(tkhd.end - 8) / 65536;
      const h = dv.getUint32(tkhd.end - 4) / 65536;
      if (w > 0 && h > 0) {
        const a = dv.getInt32(matrix) / 65536, bb = dv.getInt32(matrix + 4) / 65536;
        const rotated = Math.abs(a) < 0.01 && Math.abs(bb) > 0.99;      // 90 or 270 degrees
        info.width = Math.round(rotated ? h : w);
        info.height = Math.round(rotated ? w : h);
      }
    }
  }
  return info;
}
