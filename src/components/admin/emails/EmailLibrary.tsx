import { useEffect, useRef } from "react";
import { Check, FileText, Trash2 } from "lucide-react";
import { cardCls, focusRing } from "@/components/admin/ui";
import { btnPlain, btnTinted, pill } from "@/pages/admin/laxUi";
import { cn } from "@/lib/utils";
import type { LibraryRow } from "@/lib/email/api";
import { Thumb } from "./PreviewFrame";
import { WhenText } from "./WhenText";
import "./sendFlow.css";

/** A send that just happened, kept so the card shows it (and floats to the top) before the database round trip catches up. */
export interface JustSent { id: string; to: string; name: string; at: string }

/** Marks the just-sent row as sent with its recipient and time, and puts the newest first. */
export function applyJustSent(rows: LibraryRow[], j: JustSent | null): LibraryRow[] {
  const out = j ? rows.map((r) => (r.id === j.id ? { ...r, status: "sent" as const, recipient_email: j.to, recipient_name: j.name || null, updated_at: j.at, sent_at: j.at } : r)) : rows;
  return [...out].sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
}

/** The library grid. Presentational only: the admin page and the offline harness both use it. */
export function EmailLibrary({ rows, kitName, highlightId, onOpen, onStartFrom, onDelete }: {
  rows: LibraryRow[]; kitName: Record<string, string>; highlightId?: string | null;
  onOpen: (r: LibraryRow) => void; onStartFrom: (r: LibraryRow) => void; onDelete: (r: LibraryRow) => void;
}) {
  const hot = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!highlightId || !hot.current) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    hot.current.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
  }, [highlightId, rows.length]);

  return (
    <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
      {rows.map((r) => {
        const isHot = r.id === highlightId;
        const sent = r.source !== "template" && r.status === "sent";
        const who = r.recipient_name || r.recipient_email || "";
        return (
          <article
            key={r.id} ref={isHot ? hot : undefined} data-sent-card={isHot ? "" : undefined}
            className={cn(cardCls, "flex min-w-0 flex-col gap-4 p-4 sm:p-5", isHot && "sf-card-glow")}
          >
            <Thumb html={r.html} title={r.title} />
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-white/80">{kitName[r.brand_kit] ?? r.brand_kit}</span>
                {sent ? (
                  <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", pill.green)}>
                    <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />Sent
                  </span>
                ) : (
                  <span className="text-xs text-white/50">{r.source === "template" ? "Template" : "Draft"}</span>
                )}
              </div>
              <h2 className="text-lg font-semibold leading-snug text-white [overflow-wrap:anywhere]">{r.title}</h2>
              {sent && (
                <p className="text-[13px] leading-snug text-[#EBEBF599]">
                  {who && <><span className="[overflow-wrap:anywhere]">Sent to {who}</span> <span aria-hidden="true">·</span> </>}
                  {!who && <>Sent </>}
                  <WhenText iso={r.status === "sent" ? (r.sent_at ?? r.updated_at) : r.updated_at} />
                </p>
              )}
              {r.subject && <p className="text-xs text-white/40 [overflow-wrap:anywhere]">Subject: <span className="text-white/60">{r.subject}</span></p>}
            </div>
            <div className="mt-auto flex flex-wrap gap-2">
              <button type="button" onClick={() => onOpen(r)} className={btnTinted}><FileText className="h-4 w-4" aria-hidden="true" />Open</button>
              <button type="button" onClick={() => onStartFrom(r)} className={btnPlain}>Start from this look</button>
              <button type="button" aria-label={`Delete ${r.title}`} onClick={() => onDelete(r)} className={cn("ml-auto inline-flex h-11 w-11 items-center justify-center rounded-full text-[#FF6961] hover:bg-[#FF453A]/10", focusRing)}><Trash2 className="h-4 w-4" /></button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
