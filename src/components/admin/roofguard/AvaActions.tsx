/**
 * Next-action buttons (both Avas). After a call, Ava suggests the next step as pill buttons under the message (rows of
 * ava_actions, made by a database trigger from what the caller wanted):
 *   Find times that work   -> FindTimesSheet: your next free slots; tap one, confirm, Ava calls them back and books it
 *   Call back / Reply by call -> opens the dialer prefilled (you still tap Call)
 *   Done / Dismiss         -> close the suggestions for that call
 * Nothing here dials by itself. The only call it can start is book_call, and only after you confirm a slot.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { AlarmClock, Calendar, CalendarSearch, Check, Loader2, PhoneCall, PhoneForwarded, X } from "lucide-react";
import { ScrollSheet } from "./AvaSheet";
import { requestDial } from "./avaDial";
import { useCalStatus } from "./avaCal";

export type AvaAction = {
  id: string; source: "ava" | "roofguard"; call_id: string; kind: "find_times" | "call_back" | "reply_by_call" | "done" | "dismiss"; label: string;
  payload: { phone?: string | null; name?: string | null; business?: string | null; purpose?: string | null; appointment_purpose?: string | null;
    preferred_times?: string | null; message?: string | null; intent?: string | null; appt_duration_min?: number | null; appt_constraints?: string | null };
  status: "open" | "done" | "dismissed"; created_at: string;
};

export const ACTIONS_EVENT = "ava-actions-changed";
const changed = () => { try { window.dispatchEvent(new Event(ACTIONS_EVENT)); } catch { /* no window */ } };

type Err = { message: string } | null;
interface Q<T> extends PromiseLike<{ data: T[] | null; error: Err }> { eq(c: string, v: unknown): Q<T>; order(c: string, o: { ascending: boolean }): Q<T>; limit(n: number): Q<T> }
interface W extends PromiseLike<{ error: Err }> { eq(c: string, v: unknown): W }
const actionsTable = () => supabase.from("ava_actions" as never) as unknown as { select<T>(c: string): Q<T>; update(p: object): W };

/** The error text from an edge function call that came back non-2xx (the body has the plain-English reason). */
export async function invokeError(error: unknown, data: { error?: string } | null | undefined, fallback: string): Promise<string> {
  if (data?.error) return data.error;
  if (error && typeof error === "object" && "context" in error) {
    const msg = await (error as { context: Response }).context.json().then((j: { error?: string }) => j.error).catch(() => undefined);
    if (msg) return msg;
  }
  return fallback;
}

const usePollEvery = (fn: () => void, ms: number) => {
  useEffect(() => {
    fn();
    const t = setInterval(() => { if (!document.hidden) fn(); }, ms);
    return () => clearInterval(t);
  }, [fn, ms]);
};

/** Open suggestions for one Ava, grouped by call. Refreshes every 20 seconds and right after any button is used. */
export function useActions(source: "ava" | "roofguard") {
  const [rows, setRows] = useState<AvaAction[]>([]);
  const load = useCallback(async () => {
    const { data } = await actionsTable().select<AvaAction>("id, source, call_id, kind, label, payload, status, created_at").eq("source", source).eq("status", "open")
      .order("created_at", { ascending: false }).limit(300);
    if (data) setRows(data);
  }, [source]);
  usePollEvery(load, 20000);
  useEffect(() => { window.addEventListener(ACTIONS_EVENT, load); return () => window.removeEventListener(ACTIONS_EVENT, load); }, [load]);
  const byCall = useMemo(() => {
    const m = new Map<string, AvaAction[]>();
    for (const a of rows) m.set(a.call_id, [...(m.get(a.call_id) ?? []), a]);
    return m;
  }, [rows]);
  return { byCall, reload: load };
}

const ORDER: AvaAction["kind"][] = ["find_times", "call_back", "reply_by_call", "done", "dismiss"];
const pillBase = "inline-flex min-h-[44px] items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[15px] font-medium transition motion-safe:active:scale-[0.98] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60";

const apricot = "bg-[#FFA270] font-semibold text-[#1c1c1e] hover:bg-[#ffb48a]";
const quiet = "bg-white/10 text-white ring-1 ring-white/15 hover:bg-white/15";

/** "Find times": greyed out, with the reason, while the calendar can't be read (the same state the watchdog alerts on). */
function FindTimesPill({ action, onOpen }: { action: AvaAction; onOpen: () => void }) {
  const { status } = useCalStatus();
  const off = !!status && !status.find_times.ok;
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <button type="button" onClick={onOpen} disabled={off} aria-describedby={off ? `ft-${action.id}` : undefined}
        className={cn(pillBase, off ? "bg-white/[0.07] text-white/55 ring-1 ring-white/10" : apricot)}>
        <CalendarSearch className="h-4 w-4" aria-hidden />Find times</button>
      {off && <span id={`ft-${action.id}`} className="max-w-[260px] px-1 text-[12px] leading-snug text-amber-200/90">{status?.find_times.reason}</span>}
    </span>
  );
}

/** The suggested next steps for one call, as 44 px pill buttons. Renders nothing when none are open.
 *  Personal Ava gets the full set (appointment: Find times + Call them back; callback: Call back now + Approve for...; question: Reply via Ava call; always Mark done).
 *  RoofGuard's Ava only gets Mark done / Dismiss: its calls are scripts, never a personal call-back from Jared's line. */
export function ActionPills({ source, callId, actions, className }: { source: "ava" | "roofguard"; callId: string; actions: AvaAction[] | undefined; className?: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [times, setTimes] = useState<AvaAction | null>(null);
  const [later, setLater] = useState<AvaAction | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const list = useMemo(() => [...(actions ?? [])].filter((a) => source === "ava" || a.kind === "done" || a.kind === "dismiss").sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)), [actions, source]);
  if (!list.length) return null;

  const close = async (a: AvaAction, status: "done" | "dismissed") => {
    setBusy(a.id); setErr(null);
    const { error } = await actionsTable().update({ status }).eq("call_id", callId).eq("source", source).eq("status", "open");
    setBusy(null);
    if (error) { setErr(error.message); return; }
    changed();
  };
  const dial = (a: AvaAction, kind: "back" | "reply") => {
    const p = a.payload ?? {};
    const said = (p.message ?? "").trim();
    const purpose = kind === "reply"
      ? `Answer their question${said ? `: ${said}` : ""}`
      : `Return their call${said ? `. They said: ${said}` : ""}`;
    requestDial({ mode: "personal", phone: p.phone ?? "", name: p.name ?? "", purpose: purpose.slice(0, 600), closes: { source, callId } });
  };
  const hasBack = list.some((a) => a.kind === "call_back");

  return (
    <div className={cn("flex flex-wrap items-start gap-2", className)} role="group" aria-label="Suggested next steps">
      {list.map((a) => {
        if (a.kind === "find_times") return (
          <span key={a.id} className="contents">
            <FindTimesPill action={a} onOpen={() => setTimes(a)} />
            {!hasBack && (
              <button type="button" onClick={() => dial(a, "back")} className={cn(pillBase, quiet)}><PhoneCall className="h-4 w-4" aria-hidden />Call them back</button>
            )}
          </span>
        );
        if (a.kind === "call_back") return (
          <span key={a.id} className="contents">
            <button type="button" onClick={() => dial(a, "back")} className={cn(pillBase, apricot)}><PhoneCall className="h-4 w-4" aria-hidden />Call back now</button>
            <button type="button" onClick={() => setLater(a)} className={cn(pillBase, quiet)}><AlarmClock className="h-4 w-4" aria-hidden />Approve for…</button>
          </span>
        );
        if (a.kind === "reply_by_call") return (
          <button key={a.id} type="button" onClick={() => dial(a, "reply")} className={cn(pillBase, apricot)}><PhoneForwarded className="h-4 w-4" aria-hidden />Reply via Ava call</button>
        );
        if (a.kind === "done") return (
          <button key={a.id} type="button" onClick={() => void close(a, "done")} disabled={busy === a.id} className={cn(pillBase, quiet)}>
            {busy === a.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}Mark done</button>
        );
        return (
          <button key={a.id} type="button" onClick={() => void close(a, "dismissed")} disabled={busy === a.id} className={cn(pillBase, "text-white/65 hover:bg-white/5")}>
            <X className="h-4 w-4" aria-hidden />Dismiss</button>
        );
      })}
      {err && <p role="alert" className="w-full text-sm text-red-300">{err}</p>}
      {times && <FindTimesSheet action={times} onClose={() => setTimes(null)} />}
      {later && <ApproveSheet action={later} onClose={() => setLater(null)} />}
    </div>
  );
}

// ---------- Approve for... (a scheduled call-back; Ava dials only at the time you picked) ----------
const pad2 = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

function ApproveSheet({ action, onClose }: { action: AvaAction; onClose: () => void }) {
  const who = (action.payload?.name || action.payload?.business || "them").trim();
  const [at, setAt] = useState(() => { const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0); return toLocalInput(d); });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const preset = (k: "hour" | "tomorrow") => { const d = new Date(); if (k === "hour") d.setHours(d.getHours() + 1, 0, 0, 0); else { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); } setAt(toLocalInput(d)); };
  const go = async () => {
    const when = new Date(at);
    if (!at || Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 60_000) { setErr("Pick a time in the future."); return; }
    setBusy(true); setErr(null);
    const q = supabase.from("ava_followups" as never) as unknown as { select(c: string): { eq(c: string, v: unknown): { eq(c: string, v: unknown): { maybeSingle(): PromiseLike<{ data: { id: string } | null }> } } } };
    const { data: f } = await q.select("id").eq("source", action.source).eq("call_id", action.call_id).maybeSingle();
    if (!f) { setBusy(false); setErr("There's no follow-up for this call yet. Use Call back now instead."); return; }
    const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, a: object) => Promise<{ error: { message: string } | null }>;
    const { error } = await rpc("ava_followup_act", { p_id: f.id, p_action: "approve", p_at: when.toISOString() });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setDone(true); changed();
  };
  return (
    <ScrollSheet open onClose={onClose} className="sm:max-w-md" title={<><AlarmClock className="h-5 w-5 text-[#FFA270]" aria-hidden />Approve a time</>}
      description={<>Ava calls {who} back at the time you pick, and says she's your AI assistant. Nothing is dialed before then.</>}>
      <div className="space-y-3 pt-1">
        {done ? (
          <div role="status" className="rounded-2xl bg-white/[0.05] p-4 ring-1 ring-white/10">
            <p className="text-[15px] font-semibold text-white">Scheduled.</p>
            <p className="mt-1 text-sm text-white/65">You can cancel it any time from Follow-ups on this page.</p>
            <button type="button" onClick={onClose} className="mt-4 min-h-[44px] w-full rounded-xl bg-white text-[15px] font-semibold text-black">Done</button>
          </div>
        ) : (<>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => preset("hour")} className={cn(pillBase, quiet)}>In an hour</button>
            <button type="button" onClick={() => preset("tomorrow")} className={cn(pillBase, quiet)}>Tomorrow 9:00&nbsp;AM</button>
          </div>
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-label="Call back at"
            className="h-11 w-full rounded-xl bg-white/[0.05] px-3 text-[15px] tabular-nums text-white outline-none ring-1 ring-white/10 focus:ring-white/25" />
          {err && <p role="alert" className="text-sm text-red-300">{err}</p>}
          <button type="button" onClick={() => void go()} disabled={busy} className={cn(pillBase, apricot, "w-full")}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Approve</button>
        </>)}
      </div>
    </ScrollSheet>
  );
}

// ---------- Find times that work ----------
type Slot = { start: string; end: string };
const slotDay = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "long", month: "short", day: "numeric" }).format(new Date(iso));
const slotTime = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(/[ \u202f](AM|PM)/, "\u00a0$1");
const slotFull = (iso: string) => `${slotDay(iso)} at ${slotTime(iso)} Pacific`;
const h12 = (h: number) => (h === 0 || h === 24 ? "12:00\u00a0AM" : h === 12 ? "12:00\u00a0PM" : h > 12 ? `${h - 12}:00\u00a0PM` : `${h}:00\u00a0AM`);
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hoursText = (h: { start: number; end: number; days: number[] }) =>
  `${h.days.length === 5 && h.days.join() === "1,2,3,4,5" ? "Weekdays" : h.days.map((d) => DAY_NAMES[d]).join(", ")}, ${h12(h.start)} to ${h12(h.end)}`;
const fmtPhone = (v: string) => { const d = v.replace(/\D/g, "").replace(/^1(?=\d{10})/, "").slice(0, 10); return d.length === 10 ? `(${d.slice(0, 3)})\u00a0${d.slice(3, 6)}-${d.slice(6)}` : v; };
const digits10 = (v: string) => v.replace(/\D/g, "").replace(/^1(?=\d{10})/, "").slice(0, 10);

export function FindTimesSheet({ action, onClose }: { action: AvaAction; onClose: () => void }) {
  const p = action.payload ?? {};
  const purpose = (p.appointment_purpose || p.purpose || "").trim();
  const who = (p.business || p.name || "them").trim();
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [mins, setMins] = useState<number | null>(null);
  const [cons, setCons] = useState<string | null>(null);
  const { status: cal } = useCalStatus();
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<Slot | null>(null);
  const [phone, setPhone] = useState(p.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let stop = false;
    void (async () => {
      const { data, error } = await supabase.functions.invoke("ava-assistant", { body: { action: "free_slots", action_id: action.id, purpose } });
      if (stop) return;
      if (error || !data?.ok) { setErr(await invokeError(error, data, "Couldn't read your calendar. Try again in a minute.")); return; }
      setSlots(data.slots as Slot[]); setMins(data.duration_min ?? null); setCons(data.constraints ?? null);
    })();
    return () => { stop = true; };
  }, [purpose, action.id]);

  const valid = digits10(phone).length === 10;
  const go = async () => {
    if (!pick || !valid) return;
    setBusy(true); setErr(null);
    const { data, error } = await supabase.functions.invoke("ava-assistant", { body: { action: "book_call", action_id: action.id, slot_start: pick.start, phone: digits10(phone) } });
    setBusy(false);
    if (error || !data?.ok) { setErr(await invokeError(error, data, "The call didn't go out. Try again in a minute.")); return; }
    setSent(true); changed();
  };

  const byDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots ?? []) m.set(slotDay(s.start), [...(m.get(slotDay(s.start)) ?? []), s]);
    return [...m.entries()];
  }, [slots]);

  return (
    <ScrollSheet open onClose={onClose} className="sm:max-w-md"
      title={<><Calendar className="h-5 w-5 text-[#FFA270]" aria-hidden />Find times that work</>}
      description={<>{purpose ? <>For {purpose}. </> : null}Up to six open slots in the next two weeks{mins ? <>, {mins}&nbsp;minutes each</> : null}{cons ? <>, matching "{cons}"</> : null}. {cal ? `${hoursText(cal.hours)} Pacific.` : ""} Ava only sees free or busy, never what's on your calendar.</>}>
      {sent ? (
        <div role="status" className="rounded-2xl bg-white/[0.05] p-4 ring-1 ring-white/10">
          <p className="text-[15px] font-semibold text-white">Ava is calling {who} now.</p>
          <p className="mt-1 text-sm text-white/65">She offers {pick ? slotFull(pick.start) : "that time"} and two backups. When they agree, it goes on your calendar and you get a push. You can watch it live from the Live button at the top of the page.</p>
          <button type="button" onClick={onClose} className="mt-4 min-h-[44px] w-full rounded-xl bg-white text-[15px] font-semibold text-black">Done</button>
        </div>
      ) : (
        <div className="space-y-4 pt-1">
          {!slots && !err && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-white/50" aria-label="Reading your calendar" /></div>}
          {err && <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</p>}
          {slots && slots.length === 0 && <p className="py-8 text-center text-sm text-white/60">No open slots in the next two weeks{cons ? " that match what they asked for" : ""}. Widen your hours in the Calendars card, or call them back to talk it through.</p>}
          {byDay.map(([day, list]) => (
            <div key={day}>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/55">{day}</h3>
              <div className="grid grid-cols-2 gap-2">
                {list.map((s) => (
                  <button key={s.start} type="button" onClick={() => { setPick(s); setErr(null); }} aria-pressed={pick?.start === s.start} disabled={busy}
                    className={cn("min-h-[48px] rounded-xl px-3 text-[15px] font-medium tabular-nums transition motion-safe:active:scale-[0.98]",
                      pick?.start === s.start ? "bg-[#FFA270] text-[#1c1c1e]" : "bg-white/[0.07] text-white ring-1 ring-white/10 hover:bg-white/[0.11]")}>
                    {slotTime(s.start)}</button>
                ))}
              </div>
            </div>
          ))}
          {pick && (
            <div role="alertdialog" aria-label="Confirm the call" className="rounded-2xl bg-white/[0.05] p-4 ring-1 ring-white/10">
              <p className="text-[15px] font-semibold text-white">Ava will call {who} back and book {slotFull(pick.start)}. Go?</p>
              <p className="mt-1 text-xs text-white/55">She says she's your AI assistant on a recorded line. If that time doesn't work she offers the next two free ones.</p>
              <label className="mt-3 block"><span className="mb-1 block text-xs font-medium text-white/60">Number to call</span>
                <input value={fmtPhone(phone)} onChange={(e) => setPhone(e.target.value)} inputMode="tel" type="tel" placeholder="(555) 123-4567"
                  className="h-11 w-full rounded-xl bg-white/[0.05] px-3 text-[15px] tabular-nums text-white outline-none ring-1 ring-white/10 placeholder:text-white/40 focus:ring-white/25" /></label>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setPick(null)} disabled={busy} className="min-h-[44px] rounded-xl bg-white/10 text-[15px] font-medium text-white hover:bg-white/15">Not yet</button>
                <button type="button" onClick={() => void go()} disabled={busy || !valid} autoFocus
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#FFA270] text-[15px] font-semibold text-[#1c1c1e] hover:bg-[#ffb48a] disabled:opacity-50">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Go</button>
              </div>
            </div>
          )}
        </div>
      )}
    </ScrollSheet>
  );
}
