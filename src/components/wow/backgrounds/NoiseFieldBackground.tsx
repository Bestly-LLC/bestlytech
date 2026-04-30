import { useEffect, useRef } from "react";

/**
 * Atmospheric noise-field background. Slow flowing perlin-style 2D
 * scalar field rendered as a soft animated gradient. No cursor
 * reactivity — quiet, contemplative pages.
 *
 * Original Bestly work, Canvas 2D, ~80 LOC of math.
 */

// Tiny inline 2D value-noise (cheap; fine for backgrounds)
function makeNoise() {
  const seed = new Float32Array(256);
  for (let i = 0; i < 256; i++) seed[i] = Math.random();
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
  function valAt(ix: number, iy: number) {
    return seed[perm[(ix + perm[iy & 255]) & 255]];
  }
  return function noise(x: number, y: number) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const u = fade(fx);
    const v = fade(fy);
    const a = valAt(ix, iy);
    const b = valAt(ix + 1, iy);
    const c = valAt(ix, iy + 1);
    const d = valAt(ix + 1, iy + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  };
}

export function NoiseFieldBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const noise = makeNoise();

    let width = 0;
    let height = 0;
    // Render at quarter-res then upscale; reads as soft anyway
    const SCALE = 4;
    let lowW = 0;
    let lowH = 0;
    let imageData: ImageData | null = null;

    function resize() {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lowW = Math.ceil(width / SCALE);
      lowH = Math.ceil(height / SCALE);
      imageData = ctx.createImageData(lowW, lowH);
    }

    function frame(t: number) {
      if (!imageData) return;
      const data = imageData.data;
      const tt = t * 0.00012;
      for (let y = 0; y < lowH; y++) {
        for (let x = 0; x < lowW; x++) {
          // Two octaves of noise drifting in opposite directions
          const n1 = noise(x * 0.06 + tt * 18, y * 0.06 - tt * 14);
          const n2 = noise(x * 0.13 - tt * 22, y * 0.13 + tt * 19);
          const v = n1 * 0.6 + n2 * 0.4;
          const idx = (y * lowW + x) * 4;
          // Blend toward indigo: mid value = ink, high = indigo light
          // hsl(230, 64%, 68%) ≈ rgb(122, 139, 224)
          const k = Math.pow(v, 1.6); // contrast
          data[idx]     = 10 + k * 40;     // r — slight indigo lift
          data[idx + 1] = 13 + k * 50;     // g
          data[idx + 2] = 20 + k * 95;     // b — heaviest indigo channel
          data[idx + 3] = 255;
        }
      }
      // Draw the low-res image scaled up — Canvas handles smoothing
      // We use a temp offscreen by writing imageData to a smaller canvas first
      const off = ctx.canvas;
      // putImageData ignores transform; need a temp canvas
      // Faster approach: createImageBitmap, but that's async. We use a small
      // intermediate canvas here.
      tempCanvas.width = lowW;
      tempCanvas.height = lowH;
      tempCtx.putImageData(imageData, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "low";
      ctx.drawImage(tempCanvas, 0, 0, lowW, lowH, 0, 0, width, height);
      void off;

      if (!reduce) rafRef.current = requestAnimationFrame(frame);
    }

    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d")!;

    resize();
    if (reduce) frame(0);
    else rafRef.current = requestAnimationFrame(frame);

    window.addEventListener("resize", resize);
    const onVis = () => {
      if (document.hidden && rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      } else if (!document.hidden && !reduce && rafRef.current === null) {
        rafRef.current = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ filter: "blur(20px) saturate(1.1)", opacity: 0.85 }}
    />
  );
}
