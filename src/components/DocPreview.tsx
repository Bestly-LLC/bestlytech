/**
 * In-site document preview (partner portal Files and Mail).
 *   PDF         the browser's own viewer in a frame
 *   Images      shown directly
 *   Word .docx  rendered in the page (docx-preview, loaded only when needed)
 *   Excel/CSV   first sheets as tables (SheetJS, loaded only when needed)
 *   Text/JSON   as text
 *   Anything else (PowerPoint, zip…): a clear "Download" instead of a broken frame.
 * Files come from a short-lived signed URL; nothing is sent to a third-party viewer.
 */
import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface PreviewFile { name: string; type: string | null; url: string | null }

export function kindOf(name: string, type: string | null) {
  const n = name.toLowerCase(), t = type ?? "";
  if (t === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (t.startsWith("image/") || /\.(png|jpe?g|gif|webp|heic|svg)$/.test(n)) return "image";
  if (n.endsWith(".docx") || t.includes("wordprocessingml")) return "docx";
  if (/\.(xlsx|xls|csv)$/.test(n) || t.includes("spreadsheet") || t === "text/csv") return "sheet";
  if (t.startsWith("text/") || /\.(txt|md|json|ics|vcf)$/.test(n)) return "text";
  return "other";
}

export function DocPreview({ file, onClose }: { file: PreviewFile | null; onClose: () => void }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [text, setText] = useState<string>("");
  const [sheets, setSheets] = useState<{ name: string; html: string }[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const docxRef = useRef<HTMLDivElement>(null);
  const kind = file ? kindOf(file.name, file.type) : "other";

  useEffect(() => {
    if (!file?.url) return;
    let gone = false;
    setState("loading"); setText(""); setSheets([]); setSheetIdx(0);
    (async () => {
      try {
        if (kind === "pdf" || kind === "image" || kind === "other") { setState("ready"); return; }
        const res = await fetch(file.url!);
        if (!res.ok) throw new Error(String(res.status));
        if (kind === "text") { const t = await res.text(); if (!gone) { setText(t.slice(0, 400000)); setState("ready"); } return; }
        const buf = await res.arrayBuffer();
        if (kind === "docx") {
          const { renderAsync } = await import("docx-preview");
          if (gone || !docxRef.current) return;
          docxRef.current.innerHTML = "";
          await renderAsync(buf, docxRef.current, undefined, { inWrapper: true, ignoreWidth: false, breakPages: true });
          if (!gone) setState("ready");
          return;
        }
        if (kind === "sheet") {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(buf, { type: "array" });
          const out = wb.SheetNames.slice(0, 8).map((n) => ({ name: n, html: XLSX.utils.sheet_to_html(wb.Sheets[n], { header: "", footer: "" }) }));
          if (!gone) { setSheets(out); setState("ready"); }
        }
      } catch { if (!gone) setState("error"); }
    })();
    return () => { gone = true; };
  }, [file?.url, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={!!file} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn(
        "flex max-w-none flex-col gap-0 overflow-hidden rounded-2xl border border-white/10 bg-[#111114] p-0 text-white shadow-2xl sm:rounded-2xl [&>button]:hidden bento:border-black/10 bento:bg-[#fff]",
        // Pictures get a window sized to the picture; documents get the tall reader.
        kind === "image" ? "max-h-[90dvh] w-auto min-w-[min(22rem,94vw)] max-w-[min(64rem,94vw)]" : "h-[92dvh] w-[min(64rem,96vw)]",
      )}>
        <div className="flex items-center gap-2 border-b border-white/[0.08] px-4 py-3">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-[0.95rem] font-semibold text-white">{file?.name}</DialogTitle>
            <DialogDescription className="sr-only">Preview of the file</DialogDescription>
          </div>
          {file?.url && (
            <>
              <a href={file.url} target="_blank" rel="noreferrer" aria-label="Open in a new tab" className="grid h-9 w-9 place-items-center rounded-full text-white/60 hover:bg-white/[0.08]"><ExternalLink className="h-4 w-4" /></a>
              <a href={file.url} download={file.name} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/[0.08] px-3.5 text-sm font-medium text-white hover:bg-white/[0.14] bento:bg-[#F3F2EE]"><Download className="h-4 w-4" /> Download</a>
            </>
          )}
          <button onClick={onClose} aria-label="Close preview" className="grid h-10 w-10 place-items-center rounded-full bg-white/[0.08] text-white hover:bg-white/[0.16] bento:bg-black/5 bento:text-black"><X className="h-5 w-5" /></button>
        </div>

        <div className={cn("relative min-h-0 overflow-auto bg-black/40 bento:bg-[#F3F2EE]", kind !== "image" && "flex-1")}>
          {!file?.url ? <Centered>This file is too large to copy into the portal. Open the original email.</Centered>
            : state === "error" ? <Centered>Couldn't preview this file. Download it instead.</Centered>
            : kind === "pdf" ? <iframe title={file.name} src={file.url} className="h-full w-full bg-white" />
            : kind === "image" ? (
              <button type="button" onClick={onClose} aria-label="Close preview" className="grid w-full cursor-zoom-out place-items-center p-3">
                <img src={file.url} alt={file.name} className="max-h-[calc(90dvh-5rem)] max-w-full rounded-lg object-contain" />
              </button>
            )
            : kind === "text" ? <pre className="whitespace-pre-wrap break-words p-5 font-mono text-[13px] leading-relaxed text-white/85">{text}</pre>
            : kind === "docx" ? <div ref={docxRef} className="docx-host min-h-full bg-[#e9e9ee] [&_.docx-wrapper]:bg-transparent [&_.docx-wrapper]:p-4" />
            : kind === "sheet" ? (
              <div className="min-h-full bg-white text-black">
                {sheets.length > 1 && (
                  <div className="sticky top-0 flex gap-1 border-b bg-white/95 px-3 py-2 backdrop-blur">
                    {sheets.map((s, i) => (
                      <button key={s.name} onClick={() => setSheetIdx(i)} className={cn("rounded-full px-3 py-1 text-xs font-medium", i === sheetIdx ? "bg-black text-white" : "bg-black/5 text-black/70")}>{s.name}</button>
                    ))}
                  </div>
                )}
                <div className="sheet-host overflow-auto p-3 text-[13px] [&_td]:border [&_td]:border-black/10 [&_td]:px-2 [&_td]:py-1 [&_table]:border-collapse" dangerouslySetInnerHTML={{ __html: sheets[sheetIdx]?.html ?? "" }} />
              </div>
            )
            : <Centered>No preview for this kind of file. Download it to open.</Centered>}
          {state === "loading" && kind !== "pdf" && kind !== "image" && kind !== "other" && file?.url && (
            <div className="absolute inset-0 grid place-items-center"><Loader2 className="h-7 w-7 animate-spin text-white/50" /></div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const Centered = ({ children }: { children: React.ReactNode }) => <div className="grid h-full min-h-[40vh] place-items-center p-8 text-center text-sm text-white/60">{children}</div>;
