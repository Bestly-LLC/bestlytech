/**
 * "Spam & Do Not Call" on /admin/ava. Ava plays along with telemarketers for up to two minutes and learns who is behind the call;
 * each spam call lands on a company row (ava_spam_companies, merged by the database). Two calls from one company in 12 months to a
 * number on the Do Not Call list may be a claim (47 U.S.C. 227(c)(5)). Here Jared sees the evidence, copies the FTC complaint text,
 * and drafts the demand letter from a fixed template. Nothing is ever sent or filed from here: he does that himself.
 *   edge actions (ava-assistant): spam_complaint, spam_letter, evidence.  Recordings: private bucket ava-evidence.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { ScrollSheet } from "./AvaSheet";
import { CallNo, LiveTranscript, Recording, type Line } from "./AvaCalls";
import { ForwardedTag, fmtPhone } from "./AvaShared";
import {
  Archive, Ban, Check, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Eye, FileText, Loader2, PhoneForwarded, Scale, ShieldCheck,
} from "lucide-react";

type Err = { message: string } | null;
export type SpamStatus = "tracking" | "threshold" | "letter_drafted" | "complaint_filed" | "settled" | "closed";
type Company = { id: string; name: string | null; website: string | null; callback_numbers: string[] | null; caller_ids: string[] | null; first_seen: string; last_seen: string;
  calls_12mo: number; status: SpamStatus; notes: string | null };
type SpamCall = { id: string; call_no: number | null; created_at: string; phone: string | null; forwarded: boolean; robocall: boolean; spam_offer: string | null; spam_caller_name: string | null;
  spam_callback_number: string | null; spam_website: string | null; summary: string | null; duration_sec: number | null; conversation_id: string | null; evidence_path: string | null;
  evidence_at: string | null; evidence_error: string | null; transcript: { role: string; message: string | null; time_in_call_secs?: number }[] | null };

const JARED_CELL = "+18165007236";
const DNC_FORM = "https://www.donotcall.gov/report.html";
const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60";
const btn = cn("inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-medium transition motion-safe:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50", ring);
const btnQuiet = cn(btn, "bg-white/10 text-white hover:bg-white/15");
const btnMain = cn(btn, "bg-white font-semibold text-black hover:bg-white/90");

const STATUS: Record<SpamStatus, { label: string; Icon: typeof Eye; tone: string }> = {
  tracking: { label: "Tracking", Icon: Eye, tone: "bg-white/10 text-white/70" },
  threshold: { label: "Possible claim", Icon: Scale, tone: "bg-amber-500/15 text-amber-300" },
  letter_drafted: { label: "Letter drafted", Icon: FileText, tone: "bg-sky-500/15 text-sky-300" },
  complaint_filed: { label: "Complaint filed", Icon: CheckCircle2, tone: "bg-emerald-500/15 text-emerald-300" },
  settled: { label: "Settled", Icon: ShieldCheck, tone: "bg-emerald-500/15 text-emerald-300" },
  closed: { label: "Closed", Icon: Archive, tone: "bg-white/10 text-white/60" },
};
const STATUS_ORDER: SpamStatus[] = ["tracking", "threshold", "letter_drafted", "complaint_filed", "settled", "closed"];

// loose access: these tables are newer than the generated types
const from = (t: string) => supabase.from(t as never) as unknown as {
  select: (c: string) => {
    eq: (c: string, v: unknown) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => PromiseLike<{ data: unknown[] | null; error: Err }> } };
    order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => PromiseLike<{ data: unknown[] | null; error: Err }> };
  };
  update: (p: object) => { eq: (c: string, v: unknown) => PromiseLike<{ error: Err }> };
};

const ptTime = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })
  .format(new Date(iso)).replace(/\s(AM|PM)/, " $1");
const ptDay = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" }).format(new Date(iso));
const slim = (t: SpamCall["transcript"]): Line[] => (t ?? []).filter((x) => x.message).map((x) => ({ role: x.role, text: x.message as string, t: x.time_in_call_secs ?? 0 }));

type Edge = { ok: boolean; error: string; data: Record<string, unknown> };
async function edge(body: Record<string, unknown>): Promise<Edge> {
  let msg = "Something went wrong. Try again.";
  const { data, error } = await supabase.functions.invoke("ava-assistant", { body });
  if (error) {
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = String(j.error); } catch { /* keep the generic message */ }
    return { ok: false, error: msg, data: {} };
  }
  if (data && data.ok === false) return { ok: false, error: String(data.error ?? msg), data: {} };
  return { ok: true, error: "", data: (data ?? {}) as Record<string, unknown> };
}

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export function StatusPill({ status, className }: { status: SpamStatus; className?: string }) {
  const s = STATUS[status] ?? STATUS.tracking;
  return <span className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", s.tone, className)}><s.Icon className="h-3 w-3" aria-hidden />{s.label}</span>;
}

/** "2+ calls": the point where a Do Not Call claim may exist. Icon plus words. */
function ThresholdBadge() {
  return <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300"><Scale className="h-3 w-3" aria-hidden />2+ calls</span>;
}

export function AvaSpam({ className }: { className?: string }) {
  const [rows, setRows] = useState<Company[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await from("ava_spam_companies").select("*").order("last_seen", { ascending: false }).limit(100);
    if (error) { setErr(error.message); setLoaded(true); return; }
    setErr(null); setRows((data ?? []) as Company[]); setLoaded(true);
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 30000); return () => clearInterval(t); }, [load]);

  const claims = rows.filter((r) => r.calls_12mo >= 2 && (r.status === "threshold" || r.status === "tracking")).length;
  const current = rows.find((r) => r.id === open) ?? null;

  return (
    <section aria-label="Spam and Do Not Call" className={cn("rounded-3xl bg-white/[0.03] ring-1 ring-white/10", className)}>
      <header className="flex flex-wrap items-center gap-2 border-b border-white/5 px-4 py-3">
        <Ban className="h-4 w-4 text-rose-300" aria-hidden />
        <h3 className="text-[15px] font-semibold text-white">Spam &amp; Do Not Call</h3>
        {claims > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300"><Scale className="h-3 w-3" aria-hidden /><span className="tabular-nums">{claims}</span>&nbsp;possible {claims === 1 ? "claim" : "claims"}</span>}
        <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-xs tabular-nums text-white/70">{rows.length}</span>
      </header>
      {err && <p role="alert" className="px-4 py-3 text-sm text-red-300">Could not load: {err}</p>}
      {loaded && rows.length === 0 && !err && (
        <p className="px-4 py-8 text-center text-sm text-white/60">No spam calls yet. When a telemarketer calls, Ava plays along for up to two minutes, learns who's behind it, and keeps the recording here. At two calls from one company you may have a Do Not Call claim.</p>
      )}
      {rows.length > 0 && (
        <ul className="divide-y divide-white/5">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setOpen(r.id)}
                className="flex min-h-[44px] w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-white/[0.04] active:bg-white/[0.07] focus-visible:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/50">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[15px] font-medium text-white">{r.name ?? "Company not given"}</span>
                    {r.calls_12mo >= 2 && <ThresholdBadge />}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/60">
                    <span className="tabular-nums text-white/80">{r.calls_12mo}&nbsp;{r.calls_12mo === 1 ? "call" : "calls"}</span>
                    <span aria-hidden>·</span>
                    <span className="whitespace-nowrap">Last {ptDay(r.last_seen)}</span>
                    <StatusPill status={r.status} className="ml-auto" />
                  </div>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-white/25" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-white/5 px-4 py-2 text-[11px] text-white/55">Counts are calls in the last 12 months. Ava never files or sends anything for you.</p>
      <CompanySheet company={current} onClose={() => setOpen(null)} onChanged={() => void load()} />
    </section>
  );
}

// ---------- one company ----------
function CompanySheet({ company, onClose, onChanged }: { company: Company | null; onClose: () => void; onChanged: () => void }) {
  return (
    company ? (
      <ScrollSheet open onClose={onClose}
        title={<>{company.name ?? "Company not given"}{company.calls_12mo >= 2 && <ThresholdBadge />}</>}
        description={<><span className="tabular-nums">{company.calls_12mo}</span>&nbsp;{company.calls_12mo === 1 ? "call" : "calls"} in 12 months · first {ptDay(company.first_seen)} · last {ptDay(company.last_seen)}</>}>
        <CompanyBody key={company.id} co={company} onChanged={onChanged} />
      </ScrollSheet>
    ) : null
  );
}

function CompanyBody({ co, onChanged }: { co: Company; onChanged: () => void }) {
  const [calls, setCalls] = useState<SpamCall[] | null>(null);
  const [callsErr, setCallsErr] = useState<string | null>(null);
  const [notes, setNotes] = useState(co.notes ?? "");
  const [notesBusy, setNotesBusy] = useState(false);
  const [notesMsg, setNotesMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "complaint" | "letter" | "filed" | "status">(null);
  const [err, setErr] = useState<string | null>(null);
  const [complaint, setComplaint] = useState<{ text: string; copied: boolean } | null>(null);
  const [letter, setLetter] = useState<{ text: string; copied: boolean } | null>(null);
  const [askFiled, setAskFiled] = useState(false);

  const loadCalls = useCallback(async () => {
    const { data, error } = await from("ava_calls").select("id, call_no, created_at, phone, forwarded, robocall, spam_offer, spam_caller_name, spam_callback_number, spam_website, summary, duration_sec, conversation_id, evidence_path, evidence_at, evidence_error, transcript")
      .eq("spam_company_id", co.id).order("created_at", { ascending: true }).limit(100);
    if (error) { setCallsErr(error.message); return; }
    setCallsErr(null); setCalls((data ?? []) as SpamCall[]);
  }, [co.id]);
  useEffect(() => { void loadCalls(); }, [loadCalls]);

  const cellCalls = (calls ?? []).filter((c) => c.forwarded).length;
  const offers = [...new Set((calls ?? []).map((c) => c.spam_offer).filter((x): x is string => !!x))];
  const names = [...new Set((calls ?? []).map((c) => c.spam_caller_name).filter((x): x is string => !!x))];
  const numbers = [...new Set([...(co.callback_numbers ?? []), ...(calls ?? []).map((c) => c.spam_callback_number).filter((x): x is string => !!x)])];
  const callerIds = [...new Set([...(co.caller_ids ?? []), ...(calls ?? []).map((c) => c.phone).filter((x): x is string => !!x)])];

  const setStatus = async (status: SpamStatus) => {
    setBusy("status"); setErr(null);
    const { error } = await from("ava_spam_companies").update({ status, updated_at: new Date().toISOString() }).eq("id", co.id);
    setBusy(null);
    if (error) { setErr(`Couldn't save the status. ${error.message}`); return; }
    onChanged();
  };
  const copyComplaint = async () => {
    setBusy("complaint"); setErr(null);
    const r = await edge({ action: "spam_complaint", company_id: co.id });
    setBusy(null);
    if (!r.ok) { setErr(r.error); return; }
    const text = String(r.data.text ?? "");
    setComplaint({ text, copied: await copyText(text) });
  };
  const draftLetter = async () => {
    setBusy("letter"); setErr(null);
    const r = await edge({ action: "spam_letter", company_id: co.id });
    setBusy(null);
    if (!r.ok) { setErr(r.error); return; }
    const text = String(r.data.text ?? "");
    setLetter({ text, copied: false });
    onChanged();
  };
  const filed = async () => {
    setBusy("filed"); setErr(null);
    const { error } = await from("ava_spam_companies").update({ status: "complaint_filed", updated_at: new Date().toISOString() }).eq("id", co.id);
    setBusy(null);
    if (error) { setErr(`Couldn't save that. ${error.message}`); return; }
    setAskFiled(false); onChanged();
  };
  const saveNotes = async () => {
    setNotesBusy(true); setNotesMsg(null);
    const { error } = await from("ava_spam_companies").update({ notes: notes.trim() || null, updated_at: new Date().toISOString() }).eq("id", co.id);
    setNotesBusy(false);
    if (error) { setNotesMsg(`Couldn't save. ${error.message}`); return; }
    setNotesMsg("Saved"); onChanged(); setTimeout(() => setNotesMsg(null), 2500);
  };

  return (
    <>
      <div className="space-y-5 pt-1">
        <div className="flex flex-wrap items-center gap-2"><StatusPill status={co.status} /></div>

        {/* captured details */}
        <div className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-white/55">What Ava learned</h4>
          <dl className="mt-2 space-y-1.5 text-[15px]">
            <Detail label="Website" value={co.website} />
            <Detail label="Call-back number" value={numbers.length ? numbers.map((n) => fmtPhone(n)).join(", ") : null} tabular />
            <Detail label="Caller ID" value={callerIds.length ? callerIds.map((n) => fmtPhone(n)).join(", ") : null} tabular />
            <Detail label="Caller name" value={names.join(", ") || null} />
            <Detail label="Selling" value={offers.join("; ") || null} />
          </dl>
        </div>

        {/* actions */}
        <div className="space-y-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-white/55">Do Not Call</h4>
          {calls && cellCalls === 0 && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-200 ring-1 ring-amber-500/30">
              <PhoneForwarded className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>None of these calls is marked Forwarded. The Do Not Call list covers your cell, not Ava's line, so only calls that came through your cell count. Open each one below and tap "Came through my cell" for the ones that did.</span>
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => void copyComplaint()} disabled={busy === "complaint"} className={btnQuiet}>
              {busy === "complaint" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : complaint?.copied ? <Check className="h-4 w-4 text-emerald-300" aria-hidden /> : null}
              {complaint?.copied ? "Copied" : "Copy complaint"}</button>
            <a href={DNC_FORM} target="_blank" rel="noopener noreferrer" className={btnQuiet}><ExternalLink className="h-4 w-4" aria-hidden />Open donotcall.gov</a>
            <button type="button" onClick={() => setAskFiled(true)} disabled={busy === "filed" || co.status === "complaint_filed"} className={btnQuiet}>
              <CheckCircle2 className="h-4 w-4" aria-hidden />{co.status === "complaint_filed" ? "Filed" : "I filed it"}</button>
            <button type="button" onClick={() => void draftLetter()} disabled={busy === "letter"} className={btnQuiet}>
              {busy === "letter" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />}Draft letter</button>
          </div>
          {askFiled && (
            <div role="alertdialog" aria-label="Mark the complaint as filed?" className="rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
              <p className="text-[15px] font-semibold text-white">Did you file it on donotcall.gov?</p>
              <p className="mt-0.5 text-sm text-white/60">This only marks it done here. Ava doesn't file anything.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setAskFiled(false)} disabled={busy === "filed"} className={btnQuiet}>Not yet</button>
                <button type="button" onClick={() => void filed()} disabled={busy === "filed"} autoFocus className={btnMain}>
                  {busy === "filed" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Yes, I filed it</button>
              </div>
            </div>
          )}
          {complaint && (
            <div className="rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
              <p role="status" className="mb-1.5 text-xs text-white/60">{complaint.copied ? "Copied. Paste it into the form on donotcall.gov." : "Couldn't copy automatically. Select the text below and copy it."}</p>
              <textarea readOnly rows={10} value={complaint.text} onFocus={(e) => e.currentTarget.select()}
                className="w-full resize-y rounded-xl bg-black/30 p-3 font-mono text-[12px] leading-relaxed text-white/85 outline-none ring-1 ring-white/10 focus:ring-white/25" aria-label="Complaint text" />
            </div>
          )}
          {err && <p role="alert" className="text-sm text-red-300">{err}</p>}
        </div>

        {/* evidence */}
        <div>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/55">Evidence ({calls?.length ?? 0})</h4>
          {callsErr && <p role="alert" className="text-sm text-red-300">Could not load the calls: {callsErr}</p>}
          {!calls && !callsErr && <p className="flex items-center gap-2 text-sm text-white/55"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading…</p>}
          <ul className="space-y-3">
            {(calls ?? []).map((c, i) => <EvidenceCall key={c.id} c={c} n={i + 1} onChanged={() => { void loadCalls(); onChanged(); }} />)}
          </ul>
        </div>

        {/* status + notes */}
        <div className="space-y-3 border-t border-white/5 pt-4">
          <label className="block"><span className="mb-1 block text-xs text-white/60">Status</span>
            <span className="relative block">
              <select value={co.status} disabled={busy === "status"} onChange={(e) => void setStatus(e.target.value as SpamStatus)}
                className="h-11 w-full appearance-none rounded-xl bg-white/[0.05] pl-3 pr-9 text-[15px] text-white outline-none ring-1 ring-white/10 focus:ring-white/25 disabled:opacity-60">
                {STATUS_ORDER.map((s) => <option key={s} value={s} className="bg-[#1c1c1e] text-white">{STATUS[s].label}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" aria-hidden />
            </span></label>
          <label className="block"><span className="mb-1 block text-xs text-white/60">Notes</span>
            <textarea rows={3} value={notes} maxLength={2000} onChange={(e) => { setNotes(e.target.value); setNotesMsg(null); }}
              placeholder="Letters sent, replies, settlement offers…"
              className="w-full rounded-xl bg-white/[0.05] px-3 py-2 text-[15px] text-white outline-none ring-1 ring-white/10 placeholder:text-white/50 focus:ring-white/25" /></label>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => void saveNotes()} disabled={notesBusy || notes === (co.notes ?? "")} className={btnQuiet}>
              {notesBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Save notes</button>
            {notesMsg && <span role="status" className={cn("text-sm", notesMsg === "Saved" ? "text-emerald-300" : "text-red-300")}>{notesMsg}</span>}
          </div>
          <p className="text-[11px] text-white/50">Not legal advice. A Do Not Call claim depends on your number being registered and on there being no business relationship with the caller. Check with a lawyer before you send anything.</p>
        </div>
      </div>

      <LetterSheet letter={letter} onClose={() => setLetter(null)} onCopied={() => setLetter((l) => (l ? { ...l, copied: true } : l))} />
    </>
  );
}

function Detail({ label, value, tabular }: { label: string; value: string | null; tabular?: boolean }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-sm text-white/55">{label}</dt>
      <dd className={cn("min-w-0 flex-1 break-words", value ? "text-white" : "text-white/55", tabular && "tabular-nums")}>{value ?? "Not given"}</dd>
    </div>
  );
}

// ---------- one call as evidence ----------
function EvidenceCall({ c, n, onChanged }: { c: SpamCall; n: number; onChanged: () => void }) {
  const [showText, setShowText] = useState(false);
  const [busy, setBusy] = useState<null | "cell" | "copy">(null);
  const [err, setErr] = useState<string | null>(null);

  const setCell = async (forwarded: boolean) => {
    setBusy("cell"); setErr(null);
    const { error } = await from("ava_calls").update({ forwarded, forwarded_from: forwarded ? JARED_CELL : null }).eq("id", c.id);
    setBusy(null);
    if (error) { setErr(`Couldn't save that. ${error.message}`); return; }
    onChanged();
  };
  const saveCopy = async () => {
    setBusy("copy"); setErr(null);
    const r = await edge({ action: "evidence", call_id: c.id });
    setBusy(null);
    if (!r.ok) { setErr(r.error); return; }
    onChanged();
  };

  return (
    <li className="rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs font-semibold tabular-nums text-white/55">Call&nbsp;{n}</span>
        <CallNo n={c.call_no} />
        {c.forwarded && <ForwardedTag />}
        {c.robocall && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/70">Recording</span>}
        <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-white/60">{ptTime(c.created_at)}</span>
      </div>
      <p className="mt-1 text-xs text-white/60"><span className="tabular-nums">{fmtPhone(c.phone) || "Unknown number"}</span>{c.spam_offer ? ` · ${c.spam_offer}` : ""}</p>
      {c.summary && <p className="mt-1.5 text-sm text-white/80">{c.summary}</p>}

      <div className="mt-2.5">
        <EvidenceAudio c={c} />
        {!c.evidence_path && c.conversation_id && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void saveCopy()} disabled={busy === "copy"} className={cn(btnQuiet, "min-h-[44px] text-sm")}>
              {busy === "copy" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Save a permanent copy now</button>
            <span className="text-xs text-white/55">{c.evidence_error ? `Not saved yet: ${c.evidence_error}. It keeps trying.` : "It saves on its own a minute after the call."}</span>
          </div>
        )}
        {c.evidence_path && c.evidence_at && <p className="mt-1.5 flex items-center gap-1 text-[11px] text-emerald-300/90"><ShieldCheck className="h-3 w-3" aria-hidden />Permanent copy saved {ptTime(c.evidence_at)}</p>}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {!c.forwarded ? (
          <button type="button" onClick={() => void setCell(true)} disabled={busy === "cell"} className={cn(btnQuiet, "text-sm")}>
            {busy === "cell" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PhoneForwarded className="h-4 w-4 text-sky-300" aria-hidden />}Came through my cell</button>
        ) : (
          <button type="button" onClick={() => void setCell(false)} disabled={busy === "cell"} className={cn(btn, "text-sm text-white/60 hover:bg-white/5")}>
            {busy === "cell" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Didn't come through my cell</button>
        )}
        <button type="button" onClick={() => setShowText((v) => !v)} aria-expanded={showText} className={cn(btn, "text-sm text-white/70 hover:bg-white/5")}>
          <ChevronDown className={cn("h-4 w-4 transition-transform motion-reduce:transition-none", showText && "rotate-180")} aria-hidden />Transcript</button>
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-red-300">{err}</p>}
      {showText && <LiveTranscript lines={slim(c.transcript)} them="Caller" inline className="mt-2" />}
    </li>
  );
}

/** The permanent copy (private bucket, signed link) when there is one; otherwise the live recording from the voice platform. */
function EvidenceAudio({ c }: { c: SpamCall }) {
  const [url, setUrl] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    let alive = true;
    setUrl(null); setBad(false);
    if (!c.evidence_path) return;
    void supabase.storage.from("ava-evidence").createSignedUrl(c.evidence_path, 3600).then(({ data, error }) => {
      if (!alive) return;
      if (error || !data?.signedUrl) setBad(true); else setUrl(data.signedUrl);
    });
    return () => { alive = false; };
  }, [c.evidence_path]);

  if (c.evidence_path && !bad) {
    return url
      ? <audio controls preload="none" src={url} className="h-11 w-full" aria-label={`Recording of call ${c.call_no ?? ""}`} />
      : <p className="flex items-center gap-2 text-sm text-white/55"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading the recording…</p>;
  }
  return c.conversation_id ? <Recording callId={c.id} fn="ava-assistant" /> : <p className="text-sm text-white/55">No recording for this call.</p>;
}

// ---------- the demand-letter draft ----------
function LetterSheet({ letter, onClose, onCopied }: { letter: { text: string; copied: boolean } | null; onClose: () => void; onCopied: () => void }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [letter?.text]);
  const copy = async () => { if (!letter) return; if (await copyText(letter.text)) onCopied(); else setFailed(true); };
  return (
    letter ? (
      <ScrollSheet open onClose={onClose} title="Demand letter draft" description="Filled in from the calls on file. Fill in the brackets, read every line, and send it yourself.">
          <div className="space-y-3 pt-1">
            <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-sm font-medium text-amber-200 ring-1 ring-amber-500/30">
              <FileText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Draft. Not legal advice. Review before sending.</p>
            <textarea readOnly rows={22} value={letter.text} onFocus={(e) => e.currentTarget.select()} aria-label="Letter text"
              className="w-full resize-y rounded-xl bg-black/30 p-3 font-mono text-[12px] leading-relaxed text-white/85 outline-none ring-1 ring-white/10 focus:ring-white/25" />
            <button type="button" onClick={() => void copy()} className={btnMain}>
              {letter.copied ? <Check className="h-4 w-4" aria-hidden /> : null}{letter.copied ? "Copied" : "Copy"}</button>
            {failed && <p role="alert" className="text-sm text-red-300">Couldn't copy automatically. Select the text and copy it.</p>}
            <p className="text-[11px] text-white/50">Ava never sends this. The company's status is now Letter drafted.</p>
          </div>
      </ScrollSheet>
    ) : null
  );
}
