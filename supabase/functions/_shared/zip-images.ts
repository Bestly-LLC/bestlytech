// zip-images — read the photos out of a zip an agent uploaded, safely.
// Images only, never trust the names, never trust declared sizes beyond the caps below.
import { unzipSync } from "npm:fflate@0.8.2";

export const ZIP_MAX_BYTES = 50 * 1024 * 1024;       // same as the bucket's file_size_limit
export const ZIP_ENTRY_MAX = 25 * 1024 * 1024;       // one photo
export const ZIP_TOTAL_MAX = 200 * 1024 * 1024;      // all photos we will inflate from one zip (CPU / memory guard)
const IMG = /\.(jpe?g|png|webp|heic|heif)$/i;

export type ZipEntry = { name: string; size: number };

/** Which image files are inside, in natural name order. Reads only the zip's table of contents. */
export function listZipImages(zip: Uint8Array): { entries: ZipEntry[]; skipped: number } {
  const all: ZipEntry[] = []; let seen = 0, skipped = 0;
  unzipSync(zip, {
    filter: (f: { name: string; originalSize: number }) => {
      if (++seen > 5000) return false;
      const base = f.name.split("/").pop() ?? "";
      if (!base || f.name.endsWith("/") || f.name.startsWith("__MACOSX/") || f.name.includes("/__MACOSX/") || base.startsWith(".")) return false;
      if (!IMG.test(base)) return false;
      if (f.originalSize <= 0 || f.originalSize > ZIP_ENTRY_MAX) { skipped++; return false; }
      all.push({ name: f.name, size: f.originalSize });
      return false; // list only; nothing is inflated here
    },
  });
  all.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  let total = 0; const entries: ZipEntry[] = [];
  for (const e of all) { if (total + e.size > ZIP_TOTAL_MAX) { skipped++; continue; } total += e.size; entries.push(e); }
  return { entries, skipped };
}

/** Inflate exactly one entry (by its exact name). Memory is one photo at a time. */
export function extractZipImage(zip: Uint8Array, name: string): Uint8Array | null {
  let out: Uint8Array | null = null;
  const files = unzipSync(zip, { filter: (f: { name: string }) => f.name === name });
  out = files[name] ?? null;
  return out && out.length > 0 && out.length <= ZIP_ENTRY_MAX ? out : null;
}

/** What the bytes really are (the file name is not trusted). */
export function sniffImage(b: Uint8Array): { ext: string; mime: string } | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: "png", mime: "image/png" };
  const s = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (s(0, 4) === "RIFF" && s(8, 4) === "WEBP") return { ext: "webp", mime: "image/webp" };
  if (s(4, 4) === "ftyp" && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(s(8, 4))) return { ext: "heic", mime: "image/heic" };
  return null;
}
