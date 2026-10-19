import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { previewHtml } from "@/lib/email/previewDoc";

export type EditMsg =
  | { t: "edit"; bid: string; field: string; text: string }
  | { t: "button"; bid: string };

/** The live preview: the real email HTML in a sandboxed frame, forced light or dark, at desktop or phone width. */
export function PreviewFrame({ html, device, dark, editable, onEdit, className, title = "Email preview" }: {
  html: string; device: "desktop" | "phone"; dark: boolean; editable?: boolean; onEdit?: (m: EditMsg) => void; className?: string; title?: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const scroll = useRef(0);
  const [h, setH] = useState(640);
  const width = device === "phone" ? 390 : 640;
  const srcDoc = useMemo(() => previewHtml(html, { dark, editable: !!editable, scrollY: scroll.current }), [html, dark, editable]);

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow || e.data?.src !== "email-builder") return;
      if (e.data.t === "scroll") scroll.current = e.data.y;
      else if (e.data.t === "edit" || e.data.t === "button") onEdit?.(e.data as EditMsg);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [onEdit]);

  // The frame is as tall as the page behind the pane, with its own scroll, so it never sits on top of other controls.
  useEffect(() => { setH(Math.max(480, Math.round(window.innerHeight - 260))); }, [device]);

  return (
    <div className={cn("flex w-full justify-center", className)}>
      <div
        className={cn(
          "overflow-hidden rounded-[22px] border border-white/[0.1] shadow-[0_8px_30px_rgba(0,0,0,.35)] motion-safe:transition-[width] motion-safe:duration-300",
          device === "phone" ? "rounded-[34px] border-[6px] border-[#2C2C2E]" : "",
          dark ? "bg-[#0b0d14]" : "bg-[#faf9f7]",
        )}
        style={{ width: `min(${width}px, 100%)` }}
      >
        <iframe
          ref={ref}
          title={title}
          srcDoc={srcDoc}
          sandbox={editable ? "allow-scripts allow-popups allow-popups-to-escape-sandbox" : "allow-popups allow-popups-to-escape-sandbox"}
          className="block w-full border-0"
          style={{ height: h }}
        />
      </div>
    </div>
  );
}

const EMAIL_WIDTH = 600;
/** Library thumbnail: the email at its real width, scaled to the card (same idea as the old static templates page). */
export function Thumb({ html, title, dark = false }: { html: string; title: string; dark?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => { const w = entry.contentRect.width; if (w > 0) setScale(w / EMAIL_WIDTH); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const doc = useMemo(() => previewHtml(html, { dark, editable: false }), [html, dark]);
  return (
    <div ref={box} className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-[#faf9f7]">
      <iframe
        srcDoc={doc}
        title={`${title} preview`}
        loading="lazy"
        tabIndex={-1}
        sandbox=""
        className="pointer-events-none absolute left-0 top-0 border-0"
        style={{ width: EMAIL_WIDTH, height: 1400, transform: `scale(${scale})`, transformOrigin: "top left" }}
      />
      {/* feathered fade at the bottom instead of a hard cut-off */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#faf9f7] to-transparent" aria-hidden="true" />
    </div>
  );
}
