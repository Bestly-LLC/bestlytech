/**
 * Shared pieces for the two Avas (personal on /admin/ava, RoofGuard on /admin/roofguard). Each takes a `source`
 * ("ava" | "roofguard") so one component serves both pages and a buyer of RoofGuard copies only the roofguard rows.
 * See docs/ava-inbound-opusplan.md, phase 3.
 *
 *   LineStatus      chip: "Answering calls" or "Not answering, fixing…", from the watchdog (ava_line_health)
 *   MessagesList    who called and left a message: unread dot, urgent / wants-a-call-back tags, tap for the call
 *   MessageSheet    the call behind a message: message, recording, summary, transcript, delete
 *   FollowupsList   calls Ava suggests making. Nothing is dialed until you tap (ava_followup_act)
 *   KnowledgeList   "What Ava can share": the ONLY facts she may use with a caller (ava_knowledge)
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { CollapsibleSection } from "./CollapsibleSection";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  AlarmClock, AlertTriangle, CalendarCheck, CalendarClock, CheckCircle2, Inbox, Lightbulb, Loader2, Mic, PhoneCall, PhoneForwarded, PhoneIncoming, PhoneOutgoing, Plus, ShieldCheck,
} from "lucide-react";
import { CallNo, DeleteCallButton, LiveTranscript, Recording, type Line } from "./AvaCalls";
import { ActionPills, useActions } from "./AvaActions";
import { ScrollSheet } from "./AvaSheet";
import { requestDial } from "./avaDial";
import { checkRoofguardFact } from "@/lib/roofguardRules";

export type Source = "ava" | "roofguard";

/** Small label on calls Ava made in Jared's cloned voice (ava_calls.voice = 'jared'). Icon plus words, apricot like the Orb's glow. */
export function YourVoiceTag({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", className)}
      style={{ background: "rgba(255,162,112,0.16)", color: "#FFA270" }}>
      <Mic className="h-3 w-3" aria-hidden />Your voice
    </span>
  );
}

/** Small label on calls that came through Jared's own cell after he didn't pick up (ava_calls.forwarded). Icon plus words, sky blue. */
export function ForwardedTag({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-300", className)}>
      <PhoneForwarded className="h-3 w-3" aria-hidden />Forwarded
    </span>
  );
}

// ---------- loose table / rpc access (these tables are newer than the generated types) ----------
type Err = { message: string } | null;
interface Q<T> extends PromiseLike<{ data: T[] | null; error: Err }> {
  eq(c: string, v: unknown): Q<T>; neq(c: string, v: unknown): Q<T>; in(c: string, v: unknown[]): Q<T>;
  order(c: string, o: { ascending: boolean }): Q<T>; limit(n: number): Q<T>; maybeSingle(): PromiseLike<{ data: T | null; error: Err }>;
}
interface W extends PromiseLike<{ error: Err }> { eq(c: string, v: unknown): W }
const table = (t: string) => supabase.from(t as never) as unknown as {
  select<T>(c: string): Q<T>; insert(p: object): PromiseLike<{ error: Err }>; update(p: object): W; delete(): W;
};
export const rpcArgs = <T,>(fn: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<{ data: T | null; error: Err }>)(fn, args);

// ---------- formatting (a number never splits from its unit: nbsp; times are 12-hour) ----------
export const fmtPhone = (e164: string | null | undefined) => {
  const d = (e164 ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)})\u00A0${d.slice(3, 6)}-${d.slice(6)}` : e164 ?? "";
};
const mmss = (s: number | null | undefined) => s == null ? "" : `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
const clock12 = (iso: string, o: Intl.DateTimeFormatOptions = {}) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...o })
    .format(new Date(iso)).replace(/\s(AM|PM)/, "\u00A0$1");
export const whenShort = (iso: string) => clock12(iso);
const whenPT = (iso: string) => clock12(iso, { timeZone: "America/Los_Angeles", timeZoneName: "short" });
export const agoText = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}\u00A0min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}\u00A0hr ago` : new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const inputCls = "h-11 w-full rounded-xl bg-white/[0.05] px-3 text-[15px] text-white outline-none ring-1 ring-white/10 placeholder:text-white/50 focus:ring-white/25";

function usePoll(fn: () => void, ms: number) {
  useEffect(() => {
    fn();
    const t = setInterval(() => { if (!document.hidden) fn(); }, ms);
    return () => clearInterval(t);
  }, [fn, ms]);
}

// ---------- LineStatus ----------
export type LineHealth = { ok: boolean; problems: string[] | null; healed: boolean; checked_at: string; last_ok_at: string | null };
export function useLineHealth(source: Source) {
  const [row, setRow] = useState<LineHealth | null | undefined>(undefined);
  const load = useCallback(async () => {
    const { data } = await table("ava_line_health").select<LineHealth>("ok, problems, healed, checked_at, last_ok_at").eq("source", source).maybeSingle();
    setRow(data ?? null);
  }, [source]);
  usePoll(load, 60000);
  return row;
}

/** Green "Answering calls" or amber "Not answering, fixing…". Icon plus words, never color alone. */
export function LineStatus({ source, className }: { source: Source; className?: string }) {
  const row = useLineHealth(source);
  const stale = !!row && Date.now() - Date.parse(row.checked_at) > 35 * 60000;   // the watchdog runs every 10 minutes
  let tone = "bg-white/[0.05] text-white/60 ring-white/10", Icon = Loader2, text = "Checking the line…", spin = true;
  if (row && row.ok && !stale) { tone = "bg-emerald-500/10 text-emerald-300 ring-emerald-500/25"; Icon = CheckCircle2; text = "Answering calls"; spin = false; }
  else if (row && row.ok && stale) { tone = "bg-amber-500/10 text-amber-200 ring-amber-500/30"; Icon = AlertTriangle; text = "Line check is overdue"; spin = false; }
  else if (row && !row.ok) { tone = "bg-amber-500/10 text-amber-200 ring-amber-500/30"; Icon = AlertTriangle; text = "Not answering, fixing…"; spin = false; }
  const detail = row && !row.ok ? (row.problems ?? []).join("; ") : row ? `Last checked ${agoText(row.checked_at)}` : "";
  return (
    <span role="status" title={detail} className={cn("inline-flex min-h-[44px] items-center gap-2 rounded-2xl px-3.5 ring-1", tone, className)}>
      <Icon className={cn("h-4 w-4 shrink-0", spin && "animate-spin")} aria-hidden />
      <span className="leading-tight">
        <span className="block whitespace-nowrap text-[15px] font-semibold">{text}</span>
        {row && !row.ok && row.problems?.[0] && <span className="block max-w-[260px] truncate text-[11px] opacity-80">{row.problems[0]}</span>}
      </span>
    </span>
  );
}

// ---------- daily spend (money stopper) ----------
// ava_spend / ava_set_spend_cap are admin RPCs (Pacific day, same cost math as "Spent so far"). Over the cap, outgoing calls
// refuse; incoming calls are always answered. The chip and the editor share one refresh event so saving updates the chip.
export type Spend = { source: Source; today: number; cap: number; over: boolean };
const SPEND_EVENT = "ava-spend-changed";
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function useSpend(source: Source) {
  const [row, setRow] = useState<Spend | null>(null);
  const load = useCallback(async () => {
    const { data } = await rpcArgs<Spend>("ava_spend", { p_source: source });
    if (data) setRow(data);
  }, [source]);
  usePoll(load, 60000);
  useEffect(() => {
    const h = () => void load();
    window.addEventListener(SPEND_EVENT, h);
    return () => window.removeEventListener(SPEND_EVENT, h);
  }, [load]);
  return row;
}

/** "Today $3.20 of $20.00". Turns amber near the cap and says "cap reached" over it (icon plus words, never color alone). */
export function SpendChip({ source, className }: { source: Source; className?: string }) {
  const row = useSpend(source);
  const over = !!row?.over;
  const near = !!row && !over && row.cap > 0 && row.today / row.cap >= 0.8;
  const tone = over ? "bg-amber-500/10 ring-amber-500/35" : near ? "bg-amber-500/[0.06] ring-amber-500/25" : "bg-white/[0.04] ring-white/10";
  return (
    <div role="status" className={cn("inline-flex min-h-[44px] flex-col items-end justify-center rounded-2xl px-3.5 ring-1", tone, className)}
      title="Outgoing calls pause when today's spend reaches the cap (Pacific time). Incoming calls are always answered.">
      <span className="flex items-center gap-1 text-[11px] text-white/50">
        {(over || near) && <AlertTriangle className="h-3 w-3 text-amber-300" aria-hidden />}
        {over ? "Daily cap reached" : "Today"}
      </span>
      <span className="whitespace-nowrap text-[15px] font-semibold tabular-nums text-white">
        {row ? <>{money(row.today)}<span className="font-normal text-white/50">{" of "}{money(row.cap)}</span></> : "…"}
      </span>
    </div>
  );
}

/** Editable daily cap. Whole-dollar steps are not required; 0.01 to 1,000. */
export function SpendCapEditor({ source, className }: { source: Source; className?: string }) {
  const row = useSpend(source);
  const [val, setVal] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (row && !dirty) setVal(row.cap.toFixed(2)); }, [row, dirty]);
  const n = Number(val);
  const valid = val.trim() !== "" && Number.isFinite(n) && n >= 0.01 && n <= 1000;
  const save = async () => {
    if (!valid) return;
    setBusy(true); setMsg(null);
    const { error } = await rpcArgs<Spend>("ava_set_spend_cap", { p_source: source, p_cap: Math.round(n * 100) / 100 });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: error.message }); return; }
    setDirty(false); setMsg({ ok: true, text: "Saved" });
    window.dispatchEvent(new Event(SPEND_EVENT));
    setTimeout(() => setMsg(null), 2500);
  };
  const id = `spend-cap-${source}`;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-[13px] font-medium text-white">Daily spend cap</label>
      <div className="flex items-center gap-2">
        <div className="relative w-36">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-white/50" aria-hidden>$</span>
          <input id={id} inputMode="decimal" autoComplete="off" value={val} aria-invalid={dirty && !valid}
            onChange={(e) => { setVal(e.target.value.replace(/[^0-9.]/g, "")); setDirty(true); setMsg(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
            className={cn(inputCls, "pl-7 tabular-nums")} />
        </div>
        <button type="button" onClick={() => void save()} disabled={busy || !dirty || !valid}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-500 px-4 text-[15px] font-semibold text-[#052E1F] transition hover:bg-emerald-400 active:scale-[0.98] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Save</button>
        {msg?.ok && <span role="status" className="inline-flex items-center gap-1 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" aria-hidden />{msg.text}</span>}
      </div>
      <p className={cn("text-xs", msg && !msg.ok ? "text-red-300" : dirty && !valid ? "text-amber-200" : "text-white/50")} role={msg && !msg.ok ? "alert" : undefined}>
        {msg && !msg.ok ? msg.text : dirty && !valid ? "Enter an amount from $0.01 to $1,000."
          : "Outgoing calls stop for the day at this amount (Pacific time). Incoming calls are always answered."}
      </p>
    </div>
  );
}

// ---------- messages ----------
export type Msg = {
  id: string; source: Source; call_no: number | null; direction: "inbound" | "outbound" | "callback"; name: string; phone: string | null;
  message: string | null; urgent: boolean; callback_wanted: boolean; read_at: string | null; at: string; summary: string | null;
  duration_sec: number | null; transcript: Line[]; purpose?: string | null; hasRecording: boolean; company?: string | null; forwarded?: boolean;
  voice?: "ava" | "jared"; booked?: string | null;
};

/** The list itself. The page owns what opening a message does (mark read, show the sheet), so it can reuse its own sheet. */
export function MessagesList({ items, source, onOpen, className }: { items: Msg[]; source: Source; onOpen: (m: Msg) => void; className?: string }) {
  const unread = items.filter((m) => !m.read_at).length;
  const { byCall } = useActions(source);
  return (
    <section aria-label="Messages" className={cn("rounded-3xl bg-white/[0.03] ring-1 ring-white/10", className)}>
      <header className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
        <Inbox className="h-4 w-4 text-sky-300" aria-hidden />
        <h3 className="text-[15px] font-semibold text-white">{source === "ava" ? "Messages for you" : "Messages for the team"}</h3>
        {unread > 0 && <span className="ml-auto rounded-full bg-[#0A84FF] px-2 py-0.5 text-xs font-semibold text-white">{unread}&nbsp;new</span>}
      </header>
      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-white/60">
          No messages yet. When someone calls {source === "ava" ? "Ava's line" : "the RoofGuard line"} and leaves one, it lands here and on your phone.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {items.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => onOpen(m)} className="flex min-h-[44px] w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-white/[0.04] active:bg-white/[0.07] focus-visible:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/50">
                <span className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", m.read_at ? "bg-transparent" : "bg-[#0A84FF]")} role={m.read_at ? undefined : "img"} aria-label={m.read_at ? undefined : "Unread"} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <CallNo n={m.call_no} />
                    <span className="text-[15px] font-medium text-white">{m.name}</span>
                    {m.forwarded && <ForwardedTag />}
                    {m.urgent &&<span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] text-rose-300"><AlertTriangle className="h-3 w-3" aria-hidden />Urgent</span>}
                    {m.callback_wanted && <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-300"><PhoneCall className="h-3 w-3" aria-hidden />Wants a call back</span>}
                    <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-white/55">{whenShort(m.at)}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-white/75">{m.message}</p>
                  {m.booked && <p className="mt-1 flex items-center gap-1.5 text-[13px] font-medium text-[#FFA270]"><CalendarCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />Booked: {whenPT(m.booked)}</p>}
                </div>
              </button>
              <ActionPills source={source} callId={m.id} actions={byCall.get(m.id)} className="pb-3 pl-9 pr-4" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** What the post-call analysis collected beyond the message (intent, business, times, next steps), read straight from the call row. */
type Extras = { next_actions: string | null; appointment_purpose: string | null; preferred_times: string | null; counterpart_business: string | null;
  counterpart_phone: string | null; intent: string | null; booked_slot?: string | null; outcome?: string | null };
const EXTRA_COLS: Record<Source, string> = {
  ava: "next_actions, appointment_purpose, preferred_times, counterpart_business, counterpart_phone, intent, booked_slot",
  roofguard: "next_actions, appointment_purpose, preferred_times, counterpart_business, counterpart_phone, intent, outcome",
};
function useExtras(source: Source, id: string | null) {
  const [x, setX] = useState<Extras | null>(null);
  useEffect(() => {
    setX(null);
    if (!id) return;
    let stop = false;
    void table(source === "ava" ? "ava_calls" : "rg_calls").select<Extras>(EXTRA_COLS[source]).eq("id", id).maybeSingle().then(({ data }) => { if (!stop) setX(data ?? null); });
    return () => { stop = true; };
  }, [source, id]);
  return x;
}
const INTENT_TEXT: Record<string, string> = { appointment: "Wants to set up a time", callback: "Wants a call back", question: "Has a question", info_only: "Passing on information", spam: "Sales or spam", other: "Other" };
const looksLikeNumber = (s: string) => /^[\d(+]/.test(s.trim());

/** The call behind a message. Same sheet for both Avas; `item.source` picks the recording function and the delete.
 *  One scroll surface (ScrollSheet): the header stays put and the body scrolls, transcript included. */
export function MessageSheet({ item, onClose, onDeleted }: { item: Msg | null; onClose: () => void; onDeleted: () => void }) {
  const source = item?.source ?? "ava";
  const x = useExtras(source, item?.id ?? null);
  const { byCall } = useActions(source);
  if (!item) return null;
  const steps = (x?.next_actions ?? "").split(/;\s*/).map((t) => t.trim()).filter(Boolean).slice(0, 3);
  const noCallAgain = !item.phone || x?.outcome === "do_not_call";
  const callAgain = () => {
    const said = (item.message ?? "").trim();
    requestDial({ mode: "personal", phone: item.phone ?? "", name: looksLikeNumber(item.name) ? "" : item.name,
      purpose: (item.purpose?.trim() || (said ? `Follow up on their message: ${said}` : "")).slice(0, 600) });
  };
  return (
    <ScrollSheet open onClose={onClose}
      title={<><CallNo n={item.call_no} className="text-[13px]" />{item.name}{item.forwarded && <ForwardedTag className="font-normal" />}{item.voice === "jared" && <YourVoiceTag className="font-normal" />}</>}
      description={<>
        {item.direction === "inbound" ? (item.forwarded ? "Called your cell, forwarded to Ava" : "Called in") : item.direction === "callback" ? "Ava called back" : "Ava called"} · {whenShort(item.at)}
        {item.phone ? ` · ${fmtPhone(item.phone)}` : ""}{item.duration_sec != null ? ` · ${mmss(item.duration_sec)}` : ""}</>}>
      <div className="space-y-4 pt-1">
        {item.message && (
          <div className="rounded-2xl bg-sky-500/10 p-4 ring-1 ring-sky-500/25">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-sky-300">
              {source === "ava" ? "Message for you" : "Message"}{item.urgent && <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 normal-case tracking-normal text-rose-300"><AlertTriangle className="h-3 w-3" aria-hidden />Urgent</span>}
              {item.callback_wanted && <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 normal-case tracking-normal text-sky-300"><PhoneCall className="h-3 w-3" aria-hidden />Wants a call back</span>}
            </div>
            <p className="mt-1 text-[15px] text-white">{item.message}</p>
          </div>
        )}

        <ActionPills source={source} callId={item.id} actions={byCall.get(item.id)} />
        {x?.booked_slot && (
          <p className="flex items-center gap-2 text-[15px] text-white"><CalendarCheck className="h-4 w-4 text-[#FFA270]" aria-hidden />Booked: {whenPT(x.booked_slot)}</p>
        )}
        {(steps.length > 0 || x?.intent || x?.counterpart_business || x?.preferred_times) && (
          <div className="rounded-2xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/10">
            {x?.intent && <p className="text-sm text-white/85">{INTENT_TEXT[x.intent] ?? x.intent}{x.counterpart_business ? ` · ${x.counterpart_business}` : ""}</p>}
            {x?.preferred_times && <p className="mt-0.5 text-sm text-white/60">Times they mentioned: {x.preferred_times}</p>}
            {steps.length > 0 && <>
              <h4 className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-white/55">Next steps</h4>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-white/80">{steps.map((t) => <li key={t}>{t}</li>)}</ul>
            </>}
          </div>
        )}

        {item.purpose && <p className="text-sm text-white/60"><span className="text-white/55">Why she called: </span>{item.purpose}</p>}
        {item.hasRecording && <Recording callId={item.id} fn={item.source === "ava" ? "ava-assistant" : "roofguard-caller"} />}
        {item.summary && <p className="text-[15px] leading-relaxed text-white/85">{item.summary}</p>}
        {!noCallAgain && (
          <button type="button" onClick={callAgain}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl bg-white/10 text-[15px] font-medium text-white ring-1 ring-white/15 transition hover:bg-white/15 motion-safe:active:scale-[0.98]">
            <PhoneCall className="h-4 w-4" aria-hidden />Call again</button>
        )}
        <div><h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/55">Transcript</h4><LiveTranscript lines={item.transcript} them={item.name} inline /></div>
        <DeleteCallButton rpc={item.source === "ava" ? "ava_delete_call" : "rg_delete_call"} callId={item.id} onDeleted={onDeleted} />
      </div>
    </ScrollSheet>
  );
}

// ---------- RoofGuard's incoming calls and call-backs (rg_inbound_calls) ----------
export type RgIncoming = { id: string; call_no: number | null; direction: "inbound" | "callback"; lead_id: string; company: string | null; phone: string | null;
  caller_name: string | null; message: string | null; urgent: boolean; callback_wanted: boolean; callback_number: string | null; read_at: string | null;
  summary: string | null; duration_sec: number | null; status: string; at: string; transcript: Line[] };

/** Placeholder lead for callers we don't know shows as "Incoming caller": never show that as a company name. */
export const rgIncomingToMsg = (r: RgIncoming): Msg => {
  const company = r.company && !/^inbound caller/i.test(r.company) ? r.company : null;
  return { id: r.id, source: "roofguard", call_no: r.call_no, direction: r.direction, name: r.caller_name ?? company ?? (r.phone ? fmtPhone(r.phone) : "Unknown caller"),
    phone: r.phone, message: r.message, urgent: r.urgent, callback_wanted: r.callback_wanted, read_at: r.read_at, at: r.at, summary: r.summary,
    duration_sec: r.duration_sec, transcript: r.transcript ?? [], hasRecording: true, company };
};

// ---------- follow-ups ----------
type Followup = { id: string; source: Source; call_id: string | null; phone: string; callback_phone: string | null; name: string | null; reason: string | null; due_at: string | null;
  status: "proposed" | "approved" | "dialing" | "done" | "dismissed"; result_call_id: string | null; note: string | null; created_at: string };

/** A withheld caller ID is stored as 'anonymous' - a word, not a number, so there is nothing to dial. */
const WITHHELD = "anonymous";
/** The number this follow-up will actually ring: the one they asked for, else the one they rang from. */
const dialTo = (f: Followup) => (f.callback_phone || "").trim() || (f.phone && f.phone !== WITHHELD ? f.phone : "");
const tenDigits = (v: string) => { const d = v.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, ""); return d.length === 10 ? d : ""; };
/** (555) 123-4567 as you type. */
const typePhone = (v: string) => {
  const d = v.replace(/\D/g, "").replace(/^1(?=\d{10})/, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
};

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function FollowupsList({ source, onChanged, className }: { source: Source; onChanged?: () => void; className?: string }) {
  const [rows, setRows] = useState<Followup[]>([]);
  const [nos, setNos] = useState<Map<string, number>>(new Map());
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await table("ava_followups").select<Followup>("*").eq("source", source).neq("status", "dismissed").order("created_at", { ascending: false }).limit(30);
    if (error) { setErr(error.message); return; }
    setErr(null);
    const list = data ?? [];
    setRows(list);
    const ids = list.map((f) => f.result_call_id).filter((x): x is string => !!x);
    if (ids.length) {
      const { data: calls } = await table(source === "ava" ? "ava_calls" : "rg_calls").select<{ id: string; call_no: number | null }>("id, call_no").in("id", ids);
      setNos(new Map((calls ?? []).filter((c) => c.call_no != null).map((c) => [c.id, c.call_no as number])));
    }
  }, [source]);
  usePoll(load, 20000);

  const act = async (id: string, action: "call_now" | "approve" | "dismiss" | "cancel", at?: string, phone?: string) => {
    // Save the number first: the table's trigger normalises it to +1XXXXXXXXXX and refuses a bad one,
    // so the dialer never sees something it can't call.
    if (phone) {
      const { error: pe } = await table("ava_followups").update({ callback_phone: phone }).eq("id", id);
      if (pe) return pe.message;
    }
    const { error } = await rpcArgs("ava_followup_act", { p_id: id, p_action: action, ...(at ? { p_at: at } : {}) });
    if (error) return error.message;
    await load(); onChanged?.();
    return null;
  };

  const open = rows.filter((f) => f.status !== "done");
  const done = rows.filter((f) => f.status === "done").slice(0, 3);
  return (
    <section aria-label="Follow-ups" className={cn("rounded-3xl bg-white/[0.03] ring-1 ring-white/10", className)}>
      <header className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
        <CalendarClock className="h-4 w-4 text-amber-300" aria-hidden />
        <h3 className="text-[15px] font-semibold text-white">Follow-ups</h3>
        {open.length > 0 && <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-xs tabular-nums text-white/70">{open.length}</span>}
      </header>
      {err && <p role="alert" className="px-4 py-3 text-sm text-red-300">Could not load follow-ups: {err}</p>}
      {rows.length === 0 && !err && (
        <p className="px-4 py-8 text-center text-sm text-white/60">No follow-ups. When a caller asks for a call back, Ava suggests one here. Nothing is dialed until you approve it.</p>
      )}
      <ul className="divide-y divide-white/5">
        {open.map((f) => <FollowupRow key={f.id} f={f} nos={nos} act={act} />)}
        {done.map((f) => <FollowupRow key={f.id} f={f} nos={nos} act={act} />)}
      </ul>
      {rows.length > 0 && <p className="border-t border-white/5 px-4 py-2 text-[11px] text-white/55">Ava only calls after you tap. Suggested calls wait here until you do.</p>}
    </section>
  );
}

function FollowupRow({ f, nos, act }: { f: Followup; nos: Map<string, number>; act: (id: string, a: "call_now" | "approve" | "dismiss" | "cancel", at?: string, phone?: string) => Promise<string | null> }) {
  const [mode, setMode] = useState<null | "now" | "later" | "dismiss">(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [at, setAt] = useState("");
  const to = dialTo(f);
  // No number to call: they rang with the caller ID withheld, or asked for a different line and
  // never gave the digits. Jared types it here instead of hitting a dead end.
  const [newPhone, setNewPhone] = useState("");
  const [editPhone, setEditPhone] = useState(false);
  const askPhone = !to || editPhone;
  const canDial = !!to || !!tenDigits(newPhone);
  const who = f.name?.trim() || (to ? fmtPhone(to) : "Caller");
  const run = async (a: "call_now" | "approve" | "dismiss" | "cancel", when?: string) => {
    setBusy(true); setErr(null);
    const e = await act(f.id, a, when, tenDigits(newPhone) ? newPhone : undefined);
    setBusy(false);
    if (e) setErr(e); else { setMode(null); setEditPhone(false); setNewPhone(""); }
  };
  const PhoneField = () => (
    <label className="mt-2 block">
      <span className="mb-1 block text-xs text-white/70">{to ? "Call a different number instead" : "Number to call"}</span>
      <input type="tel" inputMode="tel" autoComplete="tel" value={newPhone} onChange={(e) => setNewPhone(typePhone(e.target.value))}
        placeholder="(555) 123-4567" aria-label="Number to call" className={cn(inputCls, "tabular-nums")} />
    </label>
  );
  const preset = (kind: "hour" | "tomorrow") => {
    const d = new Date();
    if (kind === "hour") d.setHours(d.getHours() + 1, 0, 0, 0);
    else { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
    setAt(toLocalInput(d));
  };
  const btn = "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-4 text-[15px] font-medium transition motion-safe:active:scale-[0.98] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60";

  const pill = f.status === "proposed" ? { t: "Waiting for you", I: Lightbulb, c: "bg-amber-500/15 text-amber-300" }
    : f.status === "approved" ? { t: "Scheduled", I: AlarmClock, c: "bg-sky-500/15 text-sky-300" }
    : f.status === "dialing" ? { t: "Calling now", I: PhoneOutgoing, c: "bg-emerald-500/15 text-emerald-300" }
    : { t: "Called back", I: CheckCircle2, c: "bg-white/10 text-white/70" };
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[15px] font-medium text-white">{who}</span>
        {to
          ? <span className="whitespace-nowrap text-xs tabular-nums text-white/60">{fmtPhone(to)}{f.callback_phone ? " (asked for)" : ""}</span>
          : <span className="whitespace-nowrap text-xs text-white/60">number withheld</span>}
        <span className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", pill.c)}>
          <pill.I className="h-3 w-3" aria-hidden />{pill.t}</span>
        {f.status === "done" && f.result_call_id && <CallNo n={nos.get(f.result_call_id)} />}
        <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-white/55">
          {f.status === "approved" && f.due_at ? whenPT(f.due_at) : agoText(f.created_at)}</span>
      </div>
      {f.reason && <p className="mt-0.5 line-clamp-2 text-sm text-white/65">{f.reason}</p>}
      {f.note && <p className="mt-0.5 text-xs text-amber-200/80">{f.note}</p>}

      {f.status === "proposed" && mode === null && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => setMode("now")} className={cn(btn, "bg-emerald-500 font-semibold text-[#052E1F] hover:bg-emerald-400")}>
            <PhoneCall className="h-4 w-4" aria-hidden />Call back now</button>
          <button type="button" onClick={() => { preset("hour"); setMode("later"); }} className={cn(btn, "bg-white/10 text-white hover:bg-white/15")}>Approve for…</button>
          <button type="button" onClick={() => setMode("dismiss")} className={cn(btn, "text-white/60 hover:bg-white/5")}>Dismiss</button>
        </div>
      )}
      {f.status === "approved" && mode === null && (
        <div className="mt-2"><button type="button" onClick={() => void run("cancel")} disabled={busy} className={cn(btn, "bg-white/10 text-white hover:bg-white/15")}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Cancel</button></div>
      )}

      {mode === "now" && (
        <div role="alertdialog" aria-label={`Call ${who} now?`} className="mt-2 rounded-2xl bg-emerald-500/[0.07] p-3 ring-1 ring-emerald-500/25">
          <p className="text-[15px] font-semibold text-white">Call {who} now?</p>
          <p className="mt-0.5 text-sm text-white/60">
            {to
              ? <>Ava calls <span className="whitespace-nowrap tabular-nums">{fmtPhone(tenDigits(newPhone) ? newPhone : to)}</span> from her own line as {source_label(f.source)}, and says she&rsquo;s an AI on a recorded line.</>
              : <>They called with their number withheld, so there&rsquo;s nothing to dial. Add the number they asked you to ring.</>}
          </p>
          {askPhone ? <PhoneField /> : (
            <button type="button" onClick={() => setEditPhone(true)} className="mt-1.5 text-xs text-white/60 underline underline-offset-2 hover:text-white">Call a different number</button>
          )}
          {err && <p role="alert" className="mt-2 text-sm text-red-300">{err}</p>}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode(null)} disabled={busy} className={cn(btn, "bg-white/10 text-white hover:bg-white/15")}>Not now</button>
            <button type="button" onClick={() => void run("call_now")} disabled={busy || !canDial} autoFocus className={cn(btn, "bg-[#30D158] font-semibold text-[#052E1F] hover:bg-[#4be071]")}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Call</button>
          </div>
        </div>
      )}
      {mode === "later" && (
        <div role="group" aria-label={`Schedule a call to ${who}`} className="mt-2 rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
          <p className="text-[15px] font-semibold text-white">Approve a time</p>
          {!to && <PhoneField />}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => preset("hour")} className={cn(btn, "bg-white/10 text-white hover:bg-white/15")}>In an hour</button>
            <button type="button" onClick={() => preset("tomorrow")} className={cn(btn, "bg-white/10 text-white hover:bg-white/15")}>Tomorrow, 9:00&nbsp;AM</button>
          </div>
          <label className="mt-2 block"><span className="mb-1 block text-xs text-white/60">Or pick one</span>
            <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className={inputCls} /></label>
          <p className="mt-1 text-[11px] text-white/55">Ava calls at that time. You get a Scout reminder 15&nbsp;minutes before.</p>
          {err && <p role="alert" className="mt-2 text-sm text-red-300">{err}</p>}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode(null)} disabled={busy} className={cn(btn, "bg-white/10 text-white hover:bg-white/15")}>Cancel</button>
            <button type="button" onClick={() => at && void run("approve", new Date(at).toISOString())} disabled={busy || !at || !canDial} className={cn(btn, "bg-white font-semibold text-black hover:bg-white/90")}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Approve</button>
          </div>
        </div>
      )}
      {mode === "dismiss" && (
        <div role="alertdialog" aria-label={`Dismiss the follow-up for ${who}?`} className="mt-2 rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
          <p className="text-[15px] font-semibold text-white">Dismiss this follow-up?</p>
          <p className="mt-0.5 text-sm text-white/60">Ava won't call. The message stays in your list.</p>
          {err && <p role="alert" className="mt-2 text-sm text-red-300">{err}</p>}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode(null)} disabled={busy} className={cn(btn, "bg-white/10 text-white hover:bg-white/15")}>Keep</button>
            <button type="button" onClick={() => void run("dismiss")} disabled={busy} autoFocus className={cn(btn, "bg-white/15 font-semibold text-white hover:bg-white/20")}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Dismiss</button>
          </div>
        </div>
      )}
      {mode === null && err && <p role="alert" className="mt-2 text-sm text-red-300">{err}</p>}
    </li>
  );
}
const source_label = (s: Source) => (s === "ava" ? "Jared's assistant" : "RoofGuard's assistant");

// ---------- What Ava can share ----------
type Fact = { id: string; scope: "personal" | "roofguard" | "both"; topic: string; fact: string; active: boolean; updated_at: string;
  status?: "live" | "pending" | "declined"; proposed_at?: string | null };

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className="grid min-h-[44px] min-w-[56px] shrink-0 place-items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
      <span className={cn("relative block h-[31px] w-[51px] rounded-full transition-colors", on ? "bg-[#30D158]" : "bg-white/20")}>
        <span className={cn("absolute left-0 top-[2px] block h-[27px] w-[27px] rounded-full bg-white shadow transition-transform", on ? "translate-x-[22px]" : "translate-x-[2px]")} />
      </span>
    </button>
  );
}

export function KnowledgeList({ source, className, collapsible }: { source: Source; className?: string; collapsible?: boolean }) {
  const own = source === "ava" ? "personal" : "roofguard";
  const [rows, setRows] = useState<Fact[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<Fact> | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<Fact[]>([]);

  const load = useCallback(async () => {
    const { data, error } = await table("ava_knowledge").select<Fact>("*").in("scope", [own, "both"]).order("topic", { ascending: true });
    if (error) { setErr(error.message); return; }
    setErr(null);
    const all = data ?? [];
    setPending(all.filter((r) => r.status === "pending"));                       // Eli's suggestions: not live until approved
    setRows(all.filter((r) => r.status !== "pending" && r.status !== "declined"));
  }, [own]);
  useEffect(() => { void load(); }, [load]);

  const flip = async (f: Fact, active: boolean) => {
    setRows((rs) => rs.map((r) => (r.id === f.id ? { ...r, active } : r)));
    const { error } = await table("ava_knowledge").update({ active }).eq("id", f.id);
    if (error) { setErr(error.message); void load(); }
  };
  const live = rows.filter((r) => r.active).length;
  const shown = expanded ? rows : rows.slice(0, 4);
  const addBtn = (
    <button type="button" onClick={() => setEdit({ scope: own, active: true })} className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-3 text-sm text-sky-300 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
      <Plus className="h-4 w-4" aria-hidden />Add</button>
  );
  const list = (
    <>
      {source === "roofguard" && pending.length > 0 && <SuggestedByEli items={pending} onDone={() => void load()} />}
      {err && <p role="alert" className="px-4 py-3 text-sm text-red-300">Could not load: {err}</p>}
      {rows.length === 0 && !err && <p className="px-4 py-8 text-center text-sm text-white/60">Nothing yet. Ava takes a message for anything she can't answer.</p>}
      <ul className="divide-y divide-white/5">
        {shown.map((f) => (
          <li key={f.id} className="flex items-start gap-2 pl-4 pr-2">
            <button type="button" onClick={() => setEdit(f)} className={cn("min-h-[44px] min-w-0 flex-1 py-3 text-left", !f.active && "opacity-50")}>
              <span className="flex items-center gap-2"><span className="text-[15px] font-medium text-white">{f.topic}</span>
                {f.scope === "both" && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/60">Both Avas</span>}</span>
              <span className="mt-0.5 line-clamp-2 block text-sm text-white/60">{f.fact}</span>
            </button>
            <Toggle on={f.active} onChange={(v) => void flip(f, v)} label={`${f.topic}: ${f.active ? "on" : "off"}`} />
          </li>
        ))}
      </ul>
      {rows.length > 4 && (
        <button type="button" onClick={() => setExpanded((e) => !e)} className="min-h-[44px] w-full border-t border-white/5 text-sm text-white/60 hover:bg-white/5">
          {expanded ? "Show fewer" : `Show all ${rows.length}`}</button>
      )}
      <p className="border-t border-white/5 px-4 py-2 text-[11px] text-white/55">Ava never shares anything outside this list.</p>
      <FactSheet f={edit} own={own} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} />
    </>
  );
  if (collapsible) {
    return (
      <CollapsibleSection id={`ava-knowledge-${source}`} title="What Ava can share" icon={<ShieldCheck className="h-4 w-4 text-emerald-300" />} className={className}
        badge={pending.length > 0 ? <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs tabular-nums text-amber-200">{pending.length}&nbsp;waiting</span> : undefined}
        summary={err ? "Couldn't load" : <><span className="tabular-nums">{live}</span>&nbsp;of&nbsp;<span className="tabular-nums">{rows.length}</span> facts on</>}>
        <div className="flex justify-end px-2 pt-1">{addBtn}</div>
        {list}
      </CollapsibleSection>
    );
  }
  return (
    <section aria-label="What Ava can share" className={cn("rounded-3xl bg-white/[0.03] ring-1 ring-white/10", className)}>
      <header className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
        <ShieldCheck className="h-4 w-4 text-emerald-300" aria-hidden />
        <h3 className="text-[15px] font-semibold text-white">What Ava can share</h3>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs tabular-nums text-white/70">{live}&nbsp;on</span>
        {pending.length > 0 && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs tabular-nums text-amber-200">{pending.length}&nbsp;waiting</span>}
        <span className="ml-auto">{addBtn}</span>
      </header>
      {list}
    </section>
  );
}

/** Facts Eli suggested. Pending rows are inactive in the database, so Ava cannot say them until Jared approves here. */
function SuggestedByEli({ items, onDone }: { items: Fact[]; onDone: () => void }) {
  const [declining, setDeclining] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const act = async (f: Fact, approve: boolean) => {
    setBusy(f.id); setErr(null);
    const { error } = await rpcArgs("ava_knowledge_review", { p_id: f.id, p_approve: approve, p_note: approve ? null : note.trim() || null });
    setBusy(null);
    if (error) { setErr("Could not save that. Try again."); return; }
    setDeclining(null); setNote(""); onDone();
  };
  return (
    <div className="border-b border-white/5 bg-amber-500/[0.06] px-4 py-3" aria-label="Suggested by Eli">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-200">Suggested by Eli</h4>
      <p className="mt-0.5 text-xs text-white/60">Ava can't say these until you approve them.</p>
      <ul className="mt-2 space-y-3">
        {items.map((f) => {
          const warns = checkRoofguardFact(`${f.topic}. ${f.fact}`);
          return (
            <li key={f.id} className="rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 text-[15px] font-medium text-white">{f.topic}</span>
                {f.proposed_at && <span className="whitespace-nowrap text-xs text-white/55">{new Date(f.proposed_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}</span>}
              </div>
              <p className="mt-0.5 text-sm text-white/75">{f.fact}</p>
              {warns.length > 0 && (
                <ul className="mt-2 space-y-1 rounded-xl bg-amber-500/10 p-2.5 text-sm text-amber-100 ring-1 ring-amber-400/30">
                  {warns.map((w) => <li key={w} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden /><span>{w}</span></li>)}
                </ul>
              )}
              {declining === f.id ? (
                <div className="mt-3 space-y-2">
                  <input className={inputCls} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Why not? Eli sees this (optional)" aria-label="Reason for declining" />
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" disabled={busy === f.id} onClick={() => { setDeclining(null); setNote(""); }} className="min-h-[44px] rounded-xl bg-white/10 text-sm font-medium text-white hover:bg-white/15">Cancel</button>
                    <button type="button" disabled={busy === f.id} onClick={() => void act(f, false)} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#FF453A] text-sm font-semibold text-white disabled:opacity-60">
                      {busy === f.id && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Decline</button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" disabled={busy === f.id} onClick={() => { setDeclining(f.id); setNote(""); }} className="min-h-[44px] rounded-xl bg-white/10 text-sm font-medium text-white hover:bg-white/15 disabled:opacity-60">Decline</button>
                  <button type="button" disabled={busy === f.id} onClick={() => void act(f, true)} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#30D158] text-sm font-semibold text-black disabled:opacity-60">
                    {busy === f.id && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Approve</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {err && <p role="alert" className="mt-2 text-sm text-red-300">{err}</p>}
    </div>
  );
}

function FactSheet({ f, own, onClose, onSaved }: { f: Partial<Fact> | null; own: "personal" | "roofguard"; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Partial<Fact>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  useEffect(() => { setV(f ?? {}); setErr(null); setAsk(false); }, [f]);
  const save = async () => {
    const topic = (v.topic ?? "").trim(), fact = (v.fact ?? "").trim();
    if (!topic) { setErr("Add a topic."); return; }
    if (!fact) { setErr("Add what Ava can say."); return; }
    setBusy(true);
    const row = { topic, fact, scope: v.scope ?? own, active: v.active ?? true };
    const { error } = v.id ? await table("ava_knowledge").update(row).eq("id", v.id) : await table("ava_knowledge").insert(row);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSaved();
  };
  const remove = async () => {
    setBusy(true);
    const { error } = await table("ava_knowledge").delete().eq("id", v.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSaved();
  };
  return (
    <Sheet open={!!f} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="admin-shell w-full overflow-y-auto border-white/10 bg-[#0b0b0d] text-white sm:max-w-md">
        <SheetTitle className="text-white">{v.id ? "Edit fact" : "New fact"}</SheetTitle>
        <SheetDescription className="text-white/50">Anything here can be said out loud to any caller. No passwords, keys, addresses or private details.</SheetDescription>
        <div className="mt-4 space-y-3">
          <label className="block"><span className="mb-1 block text-xs text-white/60">Topic</span>
            <input className={inputCls} value={v.topic ?? ""} maxLength={60} onChange={(e) => setV({ ...v, topic: e.target.value })} placeholder="e.g. Pricing" /></label>
          <label className="block"><span className="mb-1 block text-xs text-white/60">What Ava can say</span>
            <textarea rows={4} className={cn(inputCls, "h-auto py-2")} value={v.fact ?? ""} maxLength={600} onChange={(e) => setV({ ...v, fact: e.target.value })}
              placeholder="One or two plain sentences" /></label>
          <div>
            <span className="mb-1 block text-xs text-white/60">Who can use it</span>
            <div role="radiogroup" aria-label="Who can use it" className="grid grid-cols-2 rounded-xl bg-white/[0.06] p-1 ring-1 ring-white/10">
              {([[own, own === "personal" ? "This Ava" : "RoofGuard Ava"], ["both", "Both Avas"]] as const).map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={(v.scope ?? own) === id} onClick={() => setV({ ...v, scope: id })}
                  className={cn("min-h-[44px] rounded-lg text-sm font-medium transition-colors", (v.scope ?? own) === id ? "bg-white text-black shadow-sm" : "text-white/65 hover:text-white")}>{label}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center rounded-xl bg-white/[0.04] pl-3 ring-1 ring-white/10">
            <span className="min-w-0 flex-1 text-sm text-white">On<span className="block text-[11px] text-white/50">Off keeps it saved but Ava won't use it.</span></span>
            <Toggle on={v.active ?? true} onChange={(a) => setV({ ...v, active: a })} label="On" />
          </div>
          {err && <p role="alert" className="text-sm text-red-300">{err}</p>}
          <button type="button" onClick={() => void save()} disabled={busy} className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-white text-[15px] font-semibold text-black motion-safe:active:scale-[0.98] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Save</button>
          {v.id && !ask && <button type="button" onClick={() => setAsk(true)} className="inline-flex min-h-[44px] w-full items-center justify-center rounded-2xl bg-white/[0.03] text-[15px] font-medium text-[#FF453A] ring-1 ring-white/10 hover:bg-[#FF453A]/10">Delete Fact</button>}
          {v.id && ask && (
            <div role="alertdialog" aria-label="Delete this fact?" className="rounded-2xl bg-[#FF453A]/[0.08] p-4 ring-1 ring-[#FF453A]/30">
              <p className="text-[15px] font-semibold text-white">Delete this fact?</p>
              <p className="mt-0.5 text-sm text-white/60">Ava stops using it right away. Turn it off instead to keep it saved.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setAsk(false)} disabled={busy} className="min-h-[44px] rounded-xl bg-white/10 text-[15px] font-medium text-white hover:bg-white/15">Cancel</button>
                <button type="button" onClick={() => void remove()} disabled={busy} autoFocus className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#FF453A] text-[15px] font-semibold text-white hover:bg-[#ff5a50] disabled:opacity-60">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Delete</button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Small direction badge used where incoming and outgoing calls share a list. */
export function DirIcon({ direction, className }: { direction: "inbound" | "outbound" | "callback"; className?: string }): ReactNode {
  return direction === "inbound"
    ? <PhoneIncoming className={cn("h-4 w-4 shrink-0 text-sky-300", className)} aria-label="Incoming" />
    : <PhoneOutgoing className={cn("h-4 w-4 shrink-0 text-emerald-300", className)} aria-label={direction === "callback" ? "Call back" : "Outgoing"} />;
}
