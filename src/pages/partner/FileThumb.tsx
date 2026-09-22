/**
 * Real preview thumbnails for partner files (Files grid and Mail attachments).
 *   Images  the picture itself, from a short-lived signed URL
 *   PDFs    page one, drawn in the browser with pdf.js (loaded only when a PDF thumb scrolls into view)
 *   Other   the type icon on a coloured tile
 * Signed URLs and rendered PDF pages are cached for the session, so scrolling back is instant.
 */
import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { kindOf } from "@/components/DocPreview";
import { cn } from "@/lib/utils";

const urlCache = new Map<string, Promise<string | null>>();
const pdfCache = new Map<string, Promise<string | null>>();

function signed(path: string) {
  if (!urlCache.has(path)) {
    urlCache.set(path, supabase.storage.from("partner-files").createSignedUrl(path, 3600)
      .then(({ data }) => data?.signedUrl ?? null, () => null));
  }
  return urlCache.get(path)!;
}

function pdfPage1(path: string) {
  if (!pdfCache.has(path)) {
    pdfCache.set(path, (async () => {
      const url = await signed(path);
      if (!url) return null;
      const pdfjs = await import("pdfjs-dist");
      const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = worker;
      const doc = await pdfjs.getDocument({ url }).promise;
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 360 / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
      doc.destroy();
      return canvas.toDataURL("image/jpeg", 0.8);
    })().catch(() => null));
  }
  return pdfCache.get(path)!;
}

export function FileThumb({ name, type, path, Icon, className }: {
  name: string; type: string | null; path: string | null; Icon: LucideIcon; className?: string;
}) {
  const kind = kindOf(name, type);
  const want = !!path && (kind === "image" || kind === "pdf");
  const ref = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Only fetch once the tile is on screen.
  useEffect(() => {
    if (!want || seen || !ref.current) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [want, seen]);

  useEffect(() => {
    if (!seen || !path) return;
    let gone = false;
    (kind === "pdf" ? pdfPage1(path) : signed(path)).then((s) => { if (!gone) (s ? setSrc(s) : setFailed(true)); });
    return () => { gone = true; };
  }, [seen, path, kind]);

  const tint = kind === "pdf" ? "bg-rose-500/15 text-rose-300" : kind === "image" ? "bg-sky-500/15 text-sky-300"
    : kind === "sheet" ? "bg-emerald-500/15 text-emerald-300" : kind === "docx" ? "bg-blue-500/15 text-blue-300" : "bg-white/[0.07] text-white/70";

  return (
    <span ref={ref} className={cn("relative grid shrink-0 place-items-center overflow-hidden bento:bg-[#F3F2EE]", !src && tint, className)}>
      {src ? (
        <img src={src} alt="" loading="lazy" onError={() => { setSrc(null); setFailed(true); }}
          className={cn("h-full w-full", kind === "pdf" ? "bg-white object-cover object-top" : "object-cover")} />
      ) : (
        <>
          <Icon className="h-1/2 max-h-6 w-1/2 max-w-6" aria-hidden />
          {want && seen && !failed && <span className="absolute inset-0 animate-pulse bg-white/[0.06]" />}
        </>
      )}
    </span>
  );
}
