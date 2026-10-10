/**
 * One Maya ticket. Used for Needs follow-up, Leads and Done. Nothing here truncates: names, emails and the issue wrap in full.
 */
import { useState } from "react";
import { AlertTriangle, Check, Clock, Mail, MessageSquarePlus, Phone, RotateCcw, ShieldAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtPhone } from "@/components/admin/roofguard/AvaShared";
import { KIND_LABEL, PRIVACY_ACTION, dueOf, whenWords, type Ticket } from "./mayaFormat";

export type TicketMode = "followup" | "lead" | "done";
export type TicketAct = (t: Ticket, status: "open" | "done" | "spam", note: string | null) => void;

const press = "motion-safe:transition-transform motion-safe:duration-100 motion-safe:active:scale-[0.97]";
const btnBase = cn("inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-50", press);
const btnPrimary = cn(btnBase, "bg-white text-black hover:bg-white/90");
const btnQuiet = cn(btnBase, "bg-white/[0.07] text-white ring-1 ring-white/10 hover:bg-white/[0.12]");

export function TicketCard({ t, mode, onAct }: { t: Ticket; mode: TicketMode; onAct: TicketAct }) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const due = dueOf(t);
  const who = t.name?.trim() || null;
  const act = (status: "open" | "done" | "spam", auto: string | null) => {
    const typed = note.trim();
    onAct(t, status, [auto, typed].filter(Boolean).join(". ") || null);
  };
  const dueTone = due.tone === "late" ? "text-orange-300" : due.tone === "soon" ? "text-amber-300" : "text-white/60";

  return (
    <article className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10" aria-label={`Ticket ${t.code}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="font-mono text-[13px] text-white/60">{t.code}</span>
        <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium",
          t.kind === "privacy" ? "bg-violet-500/15 text-violet-200" : t.kind === "callback" ? "bg-sky-500/15 text-sky-200" : t.kind === "sales_lead" ? "bg-emerald-500/15 text-emerald-200" : "bg-white/10 text-white/80")}>
          {t.kind === "privacy" && <ShieldAlert className="h-3 w-3" aria-hidden />}{KIND_LABEL[t.kind]}
        </span>
        {t.product && <span className="text-[13px] text-white/60">{t.product}</span>}
        {mode === "done" && (
          <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium", t.status === "spam" ? "bg-rose-500/15 text-rose-200" : "bg-emerald-500/15 text-emerald-200")}>
            {t.status === "spam" ? <X className="h-3 w-3" aria-hidden /> : <Check className="h-3 w-3" aria-hidden />}{t.status === "spam" ? "Spam" : "Done"}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[15px]">
        {who && <span className="font-semibold text-white">{who}</span>}
        {t.phone && (
          <a href={`tel:${t.phone}`} className="inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap text-sky-300 underline-offset-2 hover:underline sm:min-h-0">
            <Phone className="h-3.5 w-3.5" aria-hidden />{fmtPhone(t.phone)}
          </a>
        )}
        {t.email && (
          <a href={`mailto:${t.email}`} className="inline-flex min-h-[44px] items-center gap-1.5 break-all text-sky-300 underline-offset-2 hover:underline sm:min-h-0">
            <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />{t.email}
          </a>
        )}
        {!who && !t.phone && !t.email && <span className="text-white/60">No contact details were given</span>}
      </div>

      {t.kind === "privacy" && t.privacy_action && (
        <p className="mt-2 text-[14px] font-medium text-violet-200">Request: {PRIVACY_ACTION[t.privacy_action]}</p>
      )}
      {t.issue && <p className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-snug text-white/90">{t.issue}</p>}
      {t.note && <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-white/[0.05] px-3 py-2 text-[13px] text-white/70">{t.note}</p>}

      {mode !== "done" ? (
        <p className={cn("mt-3 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[14px] font-medium", dueTone)}>
          {due.tone === "late" ? <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> : <Clock className="h-4 w-4 shrink-0" aria-hidden />}
          <span>{due.text}</span>
          {due.sub && <span className="whitespace-nowrap font-normal">{due.sub}</span>}
        </p>
      ) : (
        <p className="mt-3 text-[13px] text-white/55">
          Filed {whenWords(t.created_at)}{t.resolved_at ? `, closed ${whenWords(t.resolved_at)}` : ""}
        </p>
      )}

      {noteOpen && mode !== "done" && (
        <div className="mt-3">
          <label htmlFor={`note-${t.code}`} className="sr-only">Note for {t.code}</label>
          <textarea id={`note-${t.code}`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What happened? (saved with the ticket)"
            className="w-full resize-y rounded-xl bg-white/[0.05] px-3 py-2 text-[15px] text-white outline-none ring-1 ring-white/10 placeholder:text-white/50 focus:ring-white/25" />
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {mode === "followup" && (<>
          <button type="button" className={btnPrimary} onClick={() => act("done", null)}><Check className="h-4 w-4" aria-hidden />Done</button>
          <button type="button" className={btnQuiet} onClick={() => act("spam", null)}><X className="h-4 w-4" aria-hidden />Spam</button>
        </>)}
        {mode === "lead" && (<>
          <button type="button" className={btnPrimary} onClick={() => act("done", "Contacted")}><Check className="h-4 w-4" aria-hidden />Contacted</button>
          <button type="button" className={btnQuiet} onClick={() => act("done", "Not a fit")}>Not a fit</button>
          <button type="button" className={btnQuiet} onClick={() => act("spam", null)}><X className="h-4 w-4" aria-hidden />Spam</button>
        </>)}
        {mode === "done" && (
          <button type="button" className={btnQuiet} onClick={() => onAct(t, "open", null)}><RotateCcw className="h-4 w-4" aria-hidden />Reopen</button>
        )}
        {mode !== "done" && (
          <button type="button" aria-expanded={noteOpen} onClick={() => setNoteOpen((o) => !o)}
            className={cn(btnBase, "px-3 text-white/70 hover:text-white")}>
            <MessageSquarePlus className="h-4 w-4" aria-hidden />{noteOpen ? "Hide note" : "Add a note"}
          </button>
        )}
      </div>
    </article>
  );
}
