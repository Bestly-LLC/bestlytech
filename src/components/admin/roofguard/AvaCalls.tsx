/**
 * RoofGuard → Calls: watch Ava work. See docs/roofguard/ava-live-calls-opusplan.md.
 *
 *   Live banner   a call in progress, transcript scrolling (edge fn roofguard-caller {action:"live"}, every 2 sec)
 *   Up next       rg_call_queue(): who she calls next and why (left)
 *   Called        rg_call_board(): every lead she reached, its stage in the cycle and outcome (right)
 *   Follow-ups    rg_followups_list(): callbacks Ava scheduled for herself
 *   Call sheet    rg_lead_calls(lead): every call to one lead, transcript, and the recording ({action:"audio"})
 *
 * Exports LiveTranscript, Recording and StagePill so the partner portal's demo tab reuses them.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AvaOrb } from "./AvaOrb";
import { cn } from "@/lib/utils";
import {
  AlarmClock, Ban, Calendar, CheckCircle2, ChevronRight, CircleDashed, Clock, FlaskConical, Headphones, Loader2,
  Mail, PhoneCall, PhoneIncoming, PhoneMissed, PhoneOff, Play, ShieldAlert, Trash2, UserRound, Voicemail, XCircle,
} from "lucide-react";
import { DirIcon, FollowupsList, KnowledgeList, MessageSheet, MessagesList, rgIncomingToMsg, type Msg, type RgIncoming } from "./AvaShared";
import { ScrollSheet } from "./AvaSheet";

// ---------- types ----------
export type Line = { role: string; text: string; t: number };
type QueueRow = { lead_id: string; company: string; state: string; timezone: string; contact_name: string | null; contact_title: string | null;
  phone: string; line_type: string; attempt: number; max_attempts: number; priority: number; call_status: string;
  next_call_at: string | null; local_time: string; ready_now: boolean; reason: string; total: number };
type BoardRow = { call_id: string; lead_id: string; company: string; state: string; timezone: string; stage: Stage; outcome: string | null;
  summary: string | null; notes: string | null; meeting_times: string | null; meeting_email: string | null; callback_at: string | null;
  dm_name: string | null; dm_title: string | null; opener_key: string | null; duration_sec: number | null; ended_at: string;
  attempt: number; calls: number; is_test: boolean; to_number: string; has_transcript: boolean };
export type LiveCall = { call_id: string; lead_id: string; company: string; contact: string | null; to_number: string; is_test: boolean;
  status: string; elapsed: number; transcript: Line[]; conversation_id?: string | null; direction?: "outbound" | "inbound" | "callback" };
type Followup = { id: string; lead_id: string; company: string; contact_name: string | null; to_number: string; due_at: string; timezone: string;
  is_test: boolean; status: string; note: string | null };
type LeadCall = { call_id: string; outcome: string | null; summary: string | null; notes: string | null; meeting_times: string | null;
  meeting_email: string | null; callback_at: string | null; dm_name: string | null; dm_title: string | null; opener_key: string | null;
  duration_sec: number | null; ended_at: string; attempt: number; is_test: boolean; transcript: Line[] };
type Stage = "booked" | "callback" | "voicemail" | "gatekeeper" | "not_interested" | "dnc" | "bad_number" | "exhausted" | "no_answer" | "other";

const rpcArgs = <T,>(fn: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }>)(fn, args);

// ---------- formatting ----------
const fmtPhone = (e164: string | null) => {
  const d = (e164 ?? "").replace(/\D/g, "").replace(/^1/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164 ?? "";
};
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
/** "Mon, Oct 5 · 11:00 AM CDT" in the lead's own zone (a time never splits from its AM/PM: nbsp) */
const whenThere = (iso: string | null, tz?: string) => iso
  ? new Intl.DateTimeFormat("en-US", { timeZone: tz || undefined, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })
      .format(new Date(iso)).replace(/ (AM|PM)/, " $1")
  : "";
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} hr ago` : new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

// ---------- stage pill (icon + word, never color alone) ----------
const STAGES: Record<Stage, { text: string; cls: string; Icon: typeof CheckCircle2 }> = {
  booked: { text: "Booked", cls: "bg-emerald-500/15 text-emerald-300", Icon: CheckCircle2 },
  callback: { text: "Callback", cls: "bg-sky-500/15 text-sky-300", Icon: AlarmClock },
  voicemail: { text: "Voicemail", cls: "bg-white/10 text-white/75", Icon: Voicemail },
  gatekeeper: { text: "Gatekeeper", cls: "bg-amber-500/15 text-amber-300", Icon: ShieldAlert },
  not_interested: { text: "Not interested", cls: "bg-rose-500/15 text-rose-300", Icon: XCircle },
  dnc: { text: "Do not call", cls: "bg-rose-500/15 text-rose-300", Icon: Ban },
  bad_number: { text: "Bad number", cls: "bg-rose-500/15 text-rose-300", Icon: PhoneOff },
  exhausted: { text: "Out of tries", cls: "bg-white/10 text-white/60", Icon: CircleDashed },
  no_answer: { text: "No answer", cls: "bg-white/10 text-white/60", Icon: PhoneMissed },
  other: { text: "Other", cls: "bg-white/10 text-white/60", Icon: CircleDashed },
};
export function StagePill({ stage }: { stage: Stage | string | null }) {
  const s = STAGES[(stage as Stage) ?? "other"] ?? STAGES.other;
  return <span className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", s.cls)}>
    <s.Icon className="h-3 w-3" aria-hidden />{s.text}</span>;
}
const outcomeStage = (o: string | null): Stage => ({ booked: "booked", callback_set: "callback", voicemail_left: "voicemail",
  gatekeeper_blocked: "gatekeeper", dm_identified: "gatekeeper", not_interested: "not_interested", do_not_call: "dnc",
  wrong_number: "bad_number", no_answer: "no_answer" } as Record<string, Stage>)[o ?? ""] ?? "other";

// ---------- shared pieces ----------
/** Who said what, newest at the bottom; stays pinned while new lines arrive unless the reader scrolls up.
 *  `inline`: no scroller of its own (inside a sheet whose body already scrolls, a second scroller would swallow touch drags).
 *  Otherwise it scrolls at the height its className gives it, and only blocks scroll chaining while it truly overflows. */
export function LiveTranscript({ lines, live, className, them = "Them", inline }: { lines: Line[]; live?: boolean; className?: string; them?: string; inline?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const last = lines[lines.length - 1]?.text;
  useEffect(() => {
    const el = box.current; if (!el || inline) return;
    el.dataset.scrollable = el.scrollHeight > el.clientHeight + 1 ? "true" : "false";
    if (pinned.current) el.scrollTop = el.scrollHeight;
  }, [lines.length, last, inline]);
  return (
    <div ref={box} onScroll={inline ? undefined : (e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
      className={cn("space-y-2", !inline && "overflow-y-auto data-[scrollable=true]:overscroll-contain", className)} aria-live={live ? "polite" : undefined}>
      {lines.length === 0 && <p className="text-sm text-white/45">{live ? "Ringing…" : "No transcript."}</p>}
      {lines.map((l, i) => {
        const ava = l.role === "agent";
        return (
          <div key={i} className={cn("flex", ava ? "justify-start" : "justify-end")}>
            <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-[15px] leading-snug",
              ava ? "rounded-bl-md bg-white/[0.07] text-white" : "rounded-br-md bg-sky-500/20 text-sky-50")}>
              <div className="mb-0.5 text-[11px] font-medium text-white/45">{ava ? "Ava" : them}<span className="tabular-nums"> · {mmss(l.t)}</span></div>
              {l.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The call's audio, fetched through the edge function (the ElevenLabs key never reaches the browser). */
export function Recording({ callId, fn = "roofguard-caller" }: { callId: string; fn?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "missing">("idle");
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => { setUrl(null); setState("idle"); }, [callId]);
  const load = async () => {
    setState("loading");
    const { data: { session } } = await supabase.auth.getSession();
    const base = (import.meta.env.VITE_SUPABASE_URL as string) ?? "";
    const res = await fetch(`${base}/functions/v1/${fn}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token ?? ""}`,
        apikey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "") as string },
      body: JSON.stringify({ action: "audio", call_id: callId }),
    }).catch(() => null);
    if (!res?.ok) { setState("missing"); return; }
    setUrl(URL.createObjectURL(await res.blob()));
    setState("idle");
  };
  if (url) return <audio controls autoPlay src={url} className="h-11 w-full" aria-label="Call recording" />;
  return (
    <button type="button" onClick={() => void load()} disabled={state === "loading"}
      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-medium text-white ring-1 ring-white/15 transition hover:bg-white/15 active:scale-[0.98] disabled:opacity-50">
      {state === "loading" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
      {state === "missing" ? "Recording not ready yet, try again" : "Play recording"}
    </button>
  );
}

// ---------- data ----------
/**
 * Delete a call, shared by RoofGuard and personal Ava so both sheets behave the same.
 * iOS pattern: a red "Delete Call" row, then an inline confirm (no browser dialog).
 * Soft delete in the database (rg_delete_call / ava_delete_call): gone from lists and the scorecard, spend still counts it.
 */
export function DeleteCallButton({ rpc, callId, onDeleted }: { rpc: "rg_delete_call" | "ava_delete_call"; callId: string; onDeleted: () => void }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setAsk(false); setErr(null); }, [callId]);
  const go = async () => {
    setBusy(true); setErr(null);
    const { error } = await rpcArgs<null>(rpc, { p_id: callId });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onDeleted();
  };
  if (!ask) return (
    <button type="button" onClick={() => setAsk(true)}
      className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl bg-white/[0.03] text-[15px] font-medium text-[#FF453A] ring-1 ring-white/10 transition hover:bg-[#FF453A]/10">
      <Trash2 className="h-4 w-4" aria-hidden />Delete Call</button>
  );
  return (
    <div role="alertdialog" aria-label="Delete this call?" className="rounded-2xl bg-[#FF453A]/[0.08] p-4 ring-1 ring-[#FF453A]/30">
      <p className="text-[15px] font-semibold text-white">Delete this call?</p>
      <p className="mt-0.5 text-sm text-white/60">It leaves your call list and scorecard. What it cost still counts in spend.</p>
      {err && <p role="alert" className="mt-2 text-sm text-red-300">{err}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setAsk(false)} disabled={busy}
          className="min-h-[44px] rounded-xl bg-white/10 text-[15px] font-medium text-white hover:bg-white/15">Cancel</button>
        <button type="button" onClick={() => void go()} disabled={busy} autoFocus
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#FF453A] text-[15px] font-semibold text-white hover:bg-[#ff5a50] disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Delete</button>
      </div>
    </div>
  );
}

/**
 * Reply guard: what the watchdog caught on finished calls (ava_reply_incidents, written by a database trigger).
 * Same card on both pages; `source` picks which Ava. Code leaks self-heal (model switch); the rest feed her reviews.
 */
type Incident = { id: string; call_no: number | null; kind: "code_leak" | "no_hangup" | "repeat"; subkind?: string | null; leak?: boolean; excerpt: string | null; healed: string | null; created_at: string };
const KIND_TEXT: Record<Incident["kind"], string> = { code_leak: "Spoke code out loud", no_hangup: "Didn't hang up after goodbye", repeat: "Repeated herself" };
// Money stopper: a long call that gained nothing rides on kind "repeat" (the kind CHECK can't change) with subkind "long_call";
// its excerpt is the plain "4:12 · $0.41", so the row reads "Long call, nothing gained · 4:12 · $0.41".
const isLongCall = (r: Incident) => r.subkind === "long_call";
// Voice clone guard: in a call in Jared's voice she skipped saying she's an AI, or said she was him (also kind "repeat", subkind "impersonation").
const isImpersonation = (r: Incident) => r.subkind === "impersonation";
const incidentText = (r: Incident) => (r.leak ? "Shared something sensitive" : isImpersonation(r) ? "Your voice: broke the AI-disclosure rules" : isLongCall(r) ? "Long call, nothing gained" : KIND_TEXT[r.kind]);
export function ReplyGuard({ source }: { source: "ava" | "roofguard" }) {
  const [rows, setRows] = useState<Incident[]>([]);
  const tbl = () => supabase.from("ava_reply_incidents" as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { is: (c: string, v: null) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: Incident[] | null }> } } } };
    update: (p: object) => { in: (c: string, v: string[]) => Promise<{ error: unknown }> };
  };
  const load = useCallback(async () => {
    const { data } = await tbl().select("id, call_no, kind, subkind, leak, excerpt, healed, created_at").eq("source", source).is("reviewed_at", null).order("created_at", { ascending: false }).limit(6);
    setRows(data ?? []);
  }, [source]);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 60000); return () => clearInterval(t); }, [load]);
  if (!rows.length) return null;
  const done = async () => { await tbl().update({ reviewed_at: new Date().toISOString() }).in("id", rows.map((r) => r.id)); setRows([]); };
  return (
    <section aria-label="Reply guard" className="rounded-2xl bg-amber-500/[0.07] px-4 py-3 ring-1 ring-amber-500/30">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-amber-300" aria-hidden />
        <h3 className="text-[15px] font-semibold text-white">Reply guard caught {rows.length === 1 ? "an issue" : `${rows.length} issues`}</h3>
        <button type="button" onClick={() => void done()} className="ml-auto inline-flex min-h-[36px] items-center rounded-lg px-3 text-sm text-amber-200 hover:bg-white/5">Mark reviewed</button>
      </div>
      <ul className="mt-1 space-y-1.5">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <CallNo n={r.call_no} /><span className="text-white">{incidentText(r)}</span>
            {isLongCall(r) && r.excerpt && <span className="tabular-nums text-white/70">· {r.excerpt}</span>}
            {r.healed && <span className={r.leak || isImpersonation(r) ? "text-amber-200/90" : isLongCall(r) ? "text-white/50" : "text-emerald-300/90"}>· {r.leak || isImpersonation(r) ? "Handled" : isLongCall(r) ? "Noted" : "Fixed"}: {r.healed}</span>}
            {r.excerpt && !isLongCall(r) && <span className="w-full truncate pl-1 text-xs text-white/45">"{r.excerpt.replace(/\s+/g, " ")}"</span>}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] text-white/40">Each one goes into Ava's next self-review so it doesn't happen again.</p>
    </section>
  );
}

/** "#12": every call's number, shared across RoofGuard and personal Ava, so feedback can name one call. */
export function CallNo({ n, className }: { n: number | null | undefined; className?: string }) {
  if (n == null) return null;
  return <span className={cn("shrink-0 rounded-md bg-white/[0.08] px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-white/70", className)} aria-label={`Call ${n}`}>#{n}</span>;
}

/** call id → call number for RoofGuard calls (the board functions predate numbering) */
function useRgCallNos(tick: unknown) {
  const [m, setM] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    void (supabase.from("rg_calls" as never) as unknown as { select: (c: string) => Promise<{ data: { id: string; call_no: number | null }[] | null }> })
      .select("id, call_no").then(({ data }) => setM(new Map((data ?? []).filter((r) => r.call_no != null).map((r) => [r.id, r.call_no as number]))));
  }, [tick]);
  return m;
}

function useEvery(fn: () => void, ms: number) {
  useEffect(() => {
    fn();
    const t = setInterval(() => { if (!document.hidden) fn(); }, ms);
    const vis = () => { if (!document.hidden) fn(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [fn, ms]);
}

function useLive() {
  const [calls, setCalls] = useState<LiveCall[]>([]);
  const [down, setDown] = useState(false);
  const fails = useRef(0);
  const load = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("roofguard-caller", { body: { action: "live" } });
    if (error || !data?.ok) { fails.current += 1; if (fails.current >= 3) setDown(true); return; }
    fails.current = 0; setDown(false);
    setCalls((data.calls ?? []) as LiveCall[]);
  }, []);
  useEvery(load, calls.length ? 2000 : 10000);
  return { calls, down, reload: load };
}

// ---------- page ----------
export function AvaCalls({ callingOn, onOpenSetup }: { callingOn: boolean | null; onOpenSetup: () => void }) {
  const live = useLive();
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<BoardRow | null>(null);
  const [incoming, setIncoming] = useState<RgIncoming[]>([]);
  const [openMsg, setOpenMsg] = useState<Msg | null>(null);
  const nos = useRgCallNos(board);

  const loadCols = useCallback(async () => {
    const [q, b, f, i] = await Promise.all([rpcArgs<QueueRow[]>("rg_call_queue", { p_limit: 150 }), rpcArgs<BoardRow[]>("rg_call_board", { p_limit: 200 }),
      rpcArgs<Followup[]>("rg_followups_list"), rpcArgs<RgIncoming[]>("rg_inbound_calls", { p_limit: 100 })]);
    const e = q.error ?? b.error ?? f.error ?? i.error;
    if (e) { setErr(e.message); return; }
    setErr(null); setQueue(q.data ?? []); setBoard(b.data ?? []); setFollowups(f.data ?? []); setIncoming(i.data ?? []);
  }, []);
  useEvery(loadCols, 30000);

  // when a live call ends, its result lands a few seconds later via the post-call webhook
  const liveCount = live.calls.length;
  const prev = useRef(liveCount);
  useEffect(() => {
    if (liveCount < prev.current) { const t1 = setTimeout(() => void loadCols(), 4000); const t2 = setTimeout(() => void loadCols(), 15000); prev.current = liveCount; return () => { clearTimeout(t1); clearTimeout(t2); }; }
    prev.current = liveCount;
  }, [liveCount, loadCols]);

  const messages = useMemo(() => incoming.filter((r) => r.message).map(rgIncomingToMsg), [incoming]);
  const openMessage = async (m: Msg) => {
    setOpenMsg(m);
    if (!m.read_at) {
      await rpcArgs("rg_mark_read", { p_id: m.id });
      setIncoming((rs) => rs.map((r) => (r.id === m.id ? { ...r, read_at: new Date().toISOString() } : r)));
    }
  };

  const today = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const t = board.filter((r) => Date.parse(r.ended_at) >= start.getTime() && !r.is_test);
    return { calls: t.length, booked: t.filter((r) => r.stage === "booked").length };
  }, [board]);

  return (
    <div className="space-y-4">
      {/* status strip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/10">
        <span className="flex items-center gap-2 text-[15px] font-semibold text-white">
          <AvaOrb size={30} speaking={!!callingOn} className={callingOn ? undefined : "opacity-60 grayscale"} />
          Ava ·{callingOn == null ? "…" : callingOn ? "Calling" : "Paused"}
        </span>
        <span className="text-sm text-white/55"><span className="tabular-nums text-white/80">{today.calls}</span> calls today · <span className="tabular-nums text-white/80">{today.booked}</span> booked</span>
        {!callingOn && callingOn != null && (
          <button type="button" onClick={onOpenSetup} className="ml-auto inline-flex min-h-[36px] items-center gap-1 rounded-lg px-3 text-sm text-sky-300 hover:bg-white/5">
            Setup and go live<ChevronRight className="h-4 w-4" aria-hidden /></button>
        )}
      </div>

      {err && <div className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-200 ring-1 ring-red-500/40">Could not load calls: {err}</div>}
      {live.down && <div className="rounded-2xl bg-amber-500/10 px-4 py-3 text-sm text-amber-200 ring-1 ring-amber-500/30">Live view unavailable right now. Finished calls still show below.</div>}

      {live.calls.map((c) => <LiveBanner key={c.call_id || c.conversation_id || c.to_number} call={c} />)}

      <ReplyGuard source="roofguard" />

      <div className="grid gap-4 lg:grid-cols-2">
        <MessagesList items={messages} source="roofguard" onOpen={(m) => void openMessage(m)} />
        <FollowupsList source="roofguard" onChanged={() => void loadCols()} />
      </div>

      {followups.some((f) => f.status === "scheduled" || f.status === "dialing") && <Followups rows={followups} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <QueueColumn rows={queue} />
        <CalledColumn rows={board} onOpen={setOpen} nos={nos} />
      </div>

      <IncomingCalls rows={incoming} onOpen={(r) => void openMessage(rgIncomingToMsg(r))} />

      <KnowledgeList source="roofguard" />

      <MessageSheet item={openMsg} onClose={() => setOpenMsg(null)} onDeleted={() => { setOpenMsg(null); void loadCols(); }} />
      <CallSheet row={open} nos={nos} onClose={() => setOpen(null)} onDeleted={() => { setOpen(null); void loadCols(); }} />
    </div>
  );
}

// ---------- incoming calls (answered by Ava on the RoofGuard line, and her call-backs) ----------
function IncomingCalls({ rows, onOpen }: { rows: RgIncoming[]; onOpen: (r: RgIncoming) => void }) {
  return (
    <section aria-label="Incoming calls" className="rounded-3xl bg-white/[0.03] ring-1 ring-white/10">
      <header className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
        <PhoneIncoming className="h-4 w-4 text-sky-300" aria-hidden />
        <h3 className="text-[15px] font-semibold text-white">Incoming calls</h3>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs tabular-nums text-white/70">{rows.length}</span>
      </header>
      {rows.length === 0 ? <p className="px-4 py-8 text-center text-sm text-white/45">No one has called the RoofGuard line yet.</p> : (
        <ul className="divide-y divide-white/5">
          {rows.slice(0, 15).map((r) => {
            const m = rgIncomingToMsg(r);
            return (
              <li key={r.id}>
                <button type="button" onClick={() => onOpen(r)} className="flex min-h-[44px] w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.04] focus-visible:bg-white/[0.06] focus-visible:outline-none">
                  <DirIcon direction={r.direction} />
                  <CallNo n={r.call_no} />
                  <span className="min-w-0 flex-1 truncate text-[15px] text-white">{m.name}
                    <span className="ml-2 text-xs text-white/45">{r.direction === "callback" ? "Ava called back" : "Called in"}</span></span>
                  {r.duration_sec != null && <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-white/45">{mmss(r.duration_sec)}</span>}
                  <span className="shrink-0 whitespace-nowrap text-xs text-white/40">{ago(r.at)}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-white/25" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------- live banner ----------
function LiveBanner({ call }: { call: LiveCall }) {
  // tick the timer locally between 2-second polls
  const [base, setBase] = useState({ at: Date.now(), elapsed: call.elapsed });
  const [, force] = useState(0);
  useEffect(() => setBase({ at: Date.now(), elapsed: call.elapsed }), [call.elapsed]);
  useEffect(() => { const t = setInterval(() => force((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const secs = base.elapsed + Math.round((Date.now() - base.at) / 1000);
  const incoming = call.direction === "inbound";
  const label = call.status === "in-progress" || call.status === "processing" ? "On the call" : call.status === "done" ? "Wrapping up" : incoming ? "Answering" : "Ringing";
  return (
    <section aria-label={`Live call with ${call.company}`} className="overflow-hidden rounded-3xl bg-emerald-500/[0.06] ring-1 ring-emerald-500/30">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pt-4">
        <AvaOrb size={36} speaking />
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400 motion-safe:animate-pulse" aria-hidden />Live
        </span>
        {incoming && <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-300"><PhoneIncoming className="h-3 w-3" aria-hidden />Incoming</span>}
        <span className="min-w-0 truncate text-[17px] font-semibold text-white">{call.company}</span>
        {call.contact && <span className="text-sm text-white/60">{call.contact}</span>}
        {call.is_test && <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] text-violet-300"><FlaskConical className="h-3 w-3" aria-hidden />Test</span>}
        <span className="ml-auto flex items-center gap-2 text-sm text-white/60">
          {label}<span className="whitespace-nowrap font-mono text-[15px] tabular-nums text-white">{mmss(secs)}</span>
        </span>
      </header>
      <div className="px-5 pb-1 pt-0.5 text-xs text-white/45">{fmtPhone(call.to_number)}</div>
      <LiveTranscript lines={call.transcript} live className="max-h-[320px] px-5 pb-5 pt-3" />
    </section>
  );
}

// ---------- follow-ups ----------
function Followups({ rows }: { rows: Followup[] }) {
  const up = rows.filter((f) => f.status === "scheduled" || f.status === "dialing");
  return (
    <section aria-label="Scheduled by Ava" className="rounded-3xl bg-sky-500/[0.05] p-4 ring-1 ring-sky-500/25">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-sky-200"><AlarmClock className="h-4 w-4" aria-hidden />Scheduled by Ava</h3>
      <ul className="divide-y divide-white/5">
        {up.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <span className="text-[15px] font-medium text-white">{f.company.replace(" (demo)", "")}</span>
            {f.is_test && <span className="text-[11px] text-violet-300">test · {fmtPhone(f.to_number)}</span>}
            <span className="ml-auto whitespace-nowrap text-sm text-sky-200">{f.status === "dialing" ? "Calling now" : whenThere(f.due_at, "America/Los_Angeles")}</span>
            {f.note && <p className="w-full text-xs text-white/50">{f.note}</p>}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-white/40">Ava calls back on time by herself. You get a Scout reminder 15 minutes before.</p>
    </section>
  );
}

// ---------- columns ----------
function Column({ title, count, icon, children, footer }: { title: string; count: number; icon: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-h-[200px] flex-col rounded-3xl bg-white/[0.03] ring-1 ring-white/10">
      <header className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
        {icon}
        <h3 className="text-[15px] font-semibold text-white">{title}</h3>
        <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-xs tabular-nums text-white/70">{count.toLocaleString()}</span>
      </header>
      <div className="flex-1">{children}</div>
      {footer}
    </section>
  );
}

function QueueColumn({ rows }: { rows: QueueRow[] }) {
  const [shown, setShown] = useState(25);
  const ready = rows.filter((r) => r.ready_now);
  const later = rows.filter((r) => !r.ready_now);
  const total = rows[0]?.total ?? 0;
  const Row = ({ r, i }: { r: QueueRow; i?: number }) => (
    <li className="flex items-start gap-3 px-4 py-3">
      {i != null ? <span className="mt-0.5 w-5 shrink-0 text-right text-xs tabular-nums text-white/40">{i + 1}</span>
        : <Clock className="mt-0.5 h-4 w-4 shrink-0 text-white/30" aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[15px] font-medium text-white">{r.company}</span>
          <span className="shrink-0 text-xs text-white/45">{r.state}</span>
          <span className="ml-auto shrink-0 whitespace-nowrap text-xs tabular-nums text-white/50">{r.local_time.replace(" ", " ")} there</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-white/50">
          {r.contact_name && <span className="inline-flex items-center gap-1"><UserRound className="h-3 w-3" aria-hidden />{r.contact_name}{r.contact_title ? `, ${r.contact_title}` : ""}</span>}
        </div>
        <div className={cn("mt-1 text-xs", r.next_call_at ? "text-sky-300" : r.ready_now ? "text-emerald-300/90" : "text-white/40")}>{r.reason}</div>
      </div>
    </li>
  );
  return (
    <Column title="Up next" count={total} icon={<PhoneCall className="h-4 w-4 text-emerald-300" aria-hidden />}
      footer={later.length > shown ? (
        <button type="button" onClick={() => setShown((n) => n + 25)} className="min-h-[44px] w-full border-t border-white/5 text-sm text-white/60 hover:bg-white/5">Show more</button>
      ) : null}>
      {ready.length > 0 && <>
        <div className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wider text-emerald-300/80">Ready now · {ready.length}</div>
        <ul className="divide-y divide-white/5">{ready.slice(0, 25).map((r, i) => <Row key={r.lead_id} r={r} i={i} />)}</ul>
      </>}
      {later.length > 0 && <>
        <div className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wider text-white/40">{ready.length ? "Later" : "Nobody is in their calling hours right now"}</div>
        <ul className="divide-y divide-white/5">{later.slice(0, shown).map((r) => <Row key={r.lead_id} r={r} />)}</ul>
      </>}
      {rows.length === 0 && <p className="px-4 py-8 text-center text-sm text-white/45">The queue is empty.</p>}
    </Column>
  );
}

const FILTERS: { id: "all" | "booked" | "callback" | "voicemail" | "closed"; label: string; match: (s: Stage) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "booked", label: "Booked", match: (s) => s === "booked" },
  { id: "callback", label: "Callbacks", match: (s) => s === "callback" },
  { id: "voicemail", label: "Voicemail", match: (s) => s === "voicemail" || s === "no_answer" || s === "gatekeeper" },
  { id: "closed", label: "Closed", match: (s) => ["not_interested", "dnc", "bad_number", "exhausted"].includes(s) },
];

function CalledColumn({ rows, onOpen, nos }: { rows: BoardRow[]; onOpen: (r: BoardRow) => void; nos: Map<string, number> }) {
  const [f, setF] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [tests, setTests] = useState(true);
  const shown = rows.filter((r) => (tests || !r.is_test) && FILTERS.find((x) => x.id === f)!.match(r.stage));
  return (
    <Column title="Called" count={rows.filter((r) => tests || !r.is_test).length} icon={<CheckCircle2 className="h-4 w-4 text-sky-300" aria-hidden />}>
      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3" role="tablist" aria-label="Filter calls">
        {FILTERS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={f === x.id} onClick={() => setF(x.id)}
            className={cn("min-h-[32px] rounded-full px-3 text-xs font-medium transition", f === x.id ? "bg-white text-black" : "bg-white/[0.06] text-white/70 hover:bg-white/10")}>
            {x.label}</button>
        ))}
        <label className="ml-auto inline-flex min-h-[32px] cursor-pointer items-center gap-1.5 text-xs text-white/55">
          <input type="checkbox" checked={tests} onChange={(e) => setTests(e.target.checked)} className="h-3.5 w-3.5 accent-violet-400" />Show tests
        </label>
      </div>
      <ul className="mt-2 divide-y divide-white/5">
        {shown.map((r) => (
          <li key={r.call_id}>
            <button type="button" onClick={() => onOpen(r)} className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-white/[0.04] focus-visible:bg-white/[0.06] focus-visible:outline-none">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <CallNo n={nos.get(r.call_id)} />
                  <span className="truncate text-[15px] font-medium text-white">{r.company.replace(" (demo)", "")}</span>
                  <StagePill stage={r.stage} />
                  {r.is_test && <span className="inline-flex items-center gap-1 text-[11px] text-violet-300"><FlaskConical className="h-3 w-3" aria-hidden />Test</span>}
                  <span className="ml-auto shrink-0 text-xs text-white/40">{ago(r.ended_at)}</span>
                </div>
                <div className="mt-1 text-xs text-white/60">
                  {r.stage === "booked" && r.meeting_times ? <span className="text-emerald-300/90">Meeting: {r.meeting_times}</span>
                    : r.stage === "callback" && r.callback_at ? <span className="text-sky-300">Call back {whenThere(r.callback_at, r.timezone)}</span>
                    : null}
                </div>
                {r.summary && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-white/50">{r.summary}</p>}
                <div className="mt-1 text-[11px] text-white/35">
                  {r.dm_name ? `${r.dm_name} · ` : ""}{r.calls > 1 ? `${r.calls} calls · ` : ""}{r.duration_sec != null ? mmss(r.duration_sec) : ""}
                </div>
              </div>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-white/25" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className="px-4 py-8 text-center text-sm text-white/45">{rows.length ? "Nothing in this filter." : "No calls yet. Finished calls show up here."}</p>}
    </Column>
  );
}

// ---------- call sheet ----------
function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <span className="mt-0.5 text-white/40">{icon}</span>
      <div className="min-w-0"><div className="text-[11px] uppercase tracking-wider text-white/40">{label}</div><div className="text-sm text-white">{children}</div></div>
    </div>
  );
}

function CallSheet({ row, nos, onClose, onDeleted }: { row: BoardRow | null; nos: Map<string, number>; onClose: () => void; onDeleted: () => void }) {
  const [calls, setCalls] = useState<LeadCall[] | null>(null);
  const [pick, setPick] = useState(0);
  useEffect(() => {
    setCalls(null); setPick(0);
    if (!row) return;
    void rpcArgs<LeadCall[]>("rg_lead_calls", { p_lead: row.lead_id }).then(({ data }) =>
      setCalls((data ?? []).filter((c) => c.is_test === row.is_test)));
  }, [row]);
  const c = calls?.[pick];
  if (!row) return null;
  return (
    <ScrollSheet open onClose={onClose}
      title={<>{row.company.replace(" (demo)", "")}<StagePill stage={row.stage} /></>}
      description={<>{row.state} · {fmtPhone(row.to_number)}{row.is_test ? " · test call" : ""}</>}>
      <div className="pt-1">
          {calls && calls.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto" role="tablist" aria-label="Calls to this lead">
              {calls.map((x, i) => (
                <button key={x.call_id} type="button" role="tab" aria-selected={pick === i} onClick={() => setPick(i)}
                  className={cn("min-h-[36px] shrink-0 rounded-full px-3 text-xs", pick === i ? "bg-white text-black" : "bg-white/[0.06] text-white/70")}>
                  {nos.get(x.call_id) != null ? `#${nos.get(x.call_id)} · ` : ""}{i === 0 ? "Latest" : ago(x.ended_at)}</button>
              ))}
            </div>
          )}

          {!calls && <div className="mt-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-white/40" aria-label="Loading" /></div>}
          {c && (
            <div className="mt-4 space-y-5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-white/50">
                <CallNo n={nos.get(c.call_id)} /><StagePill stage={outcomeStage(c.outcome)} /><span>{whenThere(c.ended_at, row.timezone)}</span>
                {c.duration_sec != null && <span className="tabular-nums">· {mmss(c.duration_sec)}</span>}
                {c.opener_key && <span>· opener: {c.opener_key.replace(/^dm_/, "")}</span>}
              </div>
              <Recording callId={c.call_id} />
              {c.summary && <p className="text-[15px] leading-relaxed text-white/85">{c.summary}</p>}
              <div className="divide-y divide-white/5 rounded-2xl bg-white/[0.03] px-4 ring-1 ring-white/10">
                {c.dm_name && <Fact icon={<UserRound className="h-4 w-4" />} label="Decision maker">{c.dm_name}{c.dm_title ? `, ${c.dm_title}` : ""}</Fact>}
                {c.meeting_times && <Fact icon={<Calendar className="h-4 w-4" />} label="Meeting times">{c.meeting_times}</Fact>}
                {c.meeting_email && <Fact icon={<Mail className="h-4 w-4" />} label="Email">{c.meeting_email}</Fact>}
                {c.callback_at && <Fact icon={<AlarmClock className="h-4 w-4" />} label="Call back">{whenThere(c.callback_at, row.timezone)}</Fact>}
                {c.notes && <Fact icon={<Headphones className="h-4 w-4" />} label="Notes">{c.notes}</Fact>}
              </div>
              <div>
                <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/55">Transcript</h4>
                <LiveTranscript lines={c.transcript ?? []} inline />
              </div>
              <DeleteCallButton rpc="rg_delete_call" callId={c.call_id} onDeleted={onDeleted} />
            </div>
          )}
          {calls && calls.length === 0 && <p className="mt-8 text-sm text-white/60">No details for this call yet.</p>}
      </div>
    </ScrollSheet>
  );
}
