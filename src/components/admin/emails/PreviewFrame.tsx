import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { previewHtml } from "@/lib/email/previewDoc";
import type { Attachment } from "@/lib/email/api";
import { fileSize } from "./emailUtils";

/** "PDF", "PNG", "DOCX" … from the file name, for the attachment tile. */
const extOf = (name: string) => (name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? "FILE").toUpperCase();
const TILE: Record<string, string> = { PDF: "#E5484D", DOC: "#2F6FEB", DOCX: "#2F6FEB", XLS: "#1F9D55", XLSX: "#1F9D55", CSV: "#1F9D55", PPT: "#D9622B", PPTX: "#D9622B", KEY: "#2F6FEB", PAGES: "#E8A33D", NUMBERS: "#1F9D55", ZIP: "#8E8E93" };

/** The attachments as the person will see them under the email in their mail app. */
export function AttachmentStrip({ files, dark }: { files: Attachment[]; dark: boolean }) {
  if (!files.length) return null;
  return (
    <div className={cn("border-t px-4 py-3", dark ? "border-white/10 bg-[#0b0d14]" : "border-black/[0.08] bg-[#faf9f7]")} aria-label={`${files.length} ${files.length === 1 ? "attachment" : "attachments"}`} role="group">
      <p className={cn("mb-2 text-[12px] font-medium", dark ? "text-white/50" : "text-black/50")}>
        <span className="whitespace-nowrap">{files.length} {files.length === 1 ? "attachment" : "attachments"}</span>
        <span aria-hidden="true"> · </span>
        <span className="whitespace-nowrap">{fileSize(files.reduce((n, a) => n + a.size, 0))}</span>
      </p>
      <ul className="flex flex-wrap gap-2">
        {files.map((a) => {
          const ext = extOf(a.name);
          return (
            <li key={a.path} className={cn("flex max-w-full items-center gap-2.5 rounded-xl px-2.5 py-2", dark ? "bg-white/[0.06]" : "bg-white shadow-[0_1px_2px_rgba(0,0,0,.06)] ring-1 ring-black/[0.06]")}>
              <span className="flex h-9 w-8 shrink-0 items-end justify-center rounded-[5px] pb-1 text-[8px] font-bold tracking-wide text-white" style={{ background: TILE[ext] ?? (a.type.startsWith("image/") ? "#8E5CF6" : "#8E8E93") }} aria-hidden="true">{ext.slice(0, 4)}</span>
              <span className="min-w-0">
                <span className={cn("block text-[13px] font-medium leading-snug [overflow-wrap:anywhere]", dark ? "text-white/90" : "text-black/85")}>{a.name}</span>
                <span className={cn("block whitespace-nowrap text-[12px]", dark ? "text-white/50" : "text-black/50")}>{fileSize(a.size)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export type EditMsg =
  | { t: "edit"; bid: string; field: string; text: string }
  | { t: "button"; bid: string };

/** The live preview: the real email HTML in a sandboxed frame, forced light or dark, at desktop or phone width. */
export function PreviewFrame({ html, device, dark, editable, onEdit, className, title = "Email preview", attachments = [] }: {
  html: string; device: "desktop" | "phone"; dark: boolean; editable?: boolean; onEdit?: (m: EditMsg) => void; className?: string; title?: string; attachments?: Attachment[];
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
        <AttachmentStrip files={attachments} dark={dark} />
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
