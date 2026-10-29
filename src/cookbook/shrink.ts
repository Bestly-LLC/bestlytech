// Family Cookbook: shrink a phone photo to about half a megabyte before it is sent.
// A 12-megapixel card photo is 3 to 5 MB; the recipe is just as readable at 2000 px on the long edge as a JPEG.

export const TARGET_BYTES = 520_000;
export const MAX_EDGE = 2000;

/** Largest size with the long edge at most `max`, never enlarging. */
export function fitSize(w: number, h: number, max: number): { w: number; h: number } {
  const long = Math.max(w, h);
  if (long <= max) return { w: Math.round(w), h: Math.round(h) };
  const k = max / long;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** The sequence of (edge, quality) tries, biggest first, ending in something small enough for any photo. */
export function tries(maxEdge = MAX_EDGE): { edge: number; q: number }[] {
  const out: { edge: number; q: number }[] = [];
  for (const k of [1, 0.85, 0.7, 0.55]) for (const q of [0.82, 0.7, 0.58]) out.push({ edge: Math.round(maxEdge * k), q });
  return out;
}

function toBlob(c: HTMLCanvasElement, q: number): Promise<Blob | null> {
  return new Promise((res) => c.toBlob((b) => res(b), "image/jpeg", q));
}

export type Source = Blob | HTMLVideoElement;

async function decode(src: Source): Promise<{ draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; w: number; h: number; close: () => void }> {
  if (src instanceof HTMLVideoElement) {
    return { draw: (ctx, w, h) => ctx.drawImage(src, 0, 0, w, h), w: src.videoWidth, h: src.videoHeight, close: () => {} };
  }
  if ("createImageBitmap" in window) {
    try {
      const bmp = await createImageBitmap(src, { imageOrientation: "from-image" } as ImageBitmapOptions);
      return { draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h), w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(src);
  const img = new Image();
  await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error("decode")); img.src = url; });
  return { draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h), w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

/** Returns a JPEG of about half a megabyte (or smaller). Throws if the picture cannot be read at all. */
export async function shrink(src: Source): Promise<Blob> {
  const d = await decode(src);
  try {
    if (!d.w || !d.h) throw new Error("empty picture");
    let best: Blob | null = null;
    for (const t of tries()) {
      const s = fitSize(d.w, d.h, t.edge);
      const c = document.createElement("canvas");
      c.width = s.w; c.height = s.h;
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, s.w, s.h);
      d.draw(ctx, s.w, s.h);
      const b = await toBlob(c, t.q);
      if (!b) continue;
      best = b;
      if (b.size <= TARGET_BYTES) break;
    }
    if (!best) throw new Error("could not encode");
    return best;
  } finally { d.close(); }
}
