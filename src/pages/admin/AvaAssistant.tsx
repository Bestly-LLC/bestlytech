/**
 * /admin/ava: Jared's personal AI assistant, separate from RoofGuard.
 *   Her line (816) 429-9495: anyone can call, she takes a message, Jared gets a Scout push.
 *   Dial: she calls someone for a reason Jared types.
 * Data: ava_calls, ava_contacts, ava_settings (admin RLS), ava_costs(); edge fn ava-assistant (live, audio, call, setup).
 * Separate on purpose: nothing here reads or writes rg_* (RoofGuard can be split off and sold).
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/admin/PageHeader";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CallNo, DeleteCallButton, ReplyGuard, LiveTranscript, Recording, type Line } from "@/components/admin/roofguard/AvaCalls";
import { DialerSheet } from "@/components/admin/roofguard/AvaDialer";
import { AlertTriangle, Check, CheckCircle2, ChevronRight, Copy, Grid3x3, Inbox, Loader2, Phone, PhoneIncoming, PhoneOutgoing, Plus, RefreshCw, UserRound } from "lucide-react";

type Call = { id: string; direction: "inbound" | "outbound"; phone: string | null; contact_id: string | null; caller_name: string | null; purpose: string | null;
  conversation_id: string | null; status: string; summary: string | null; message: string | null; urgent: boolean; callback_wanted: boolean;
  duration_sec: number | null; transcript: { role: string; message: string | null; time_in_call_secs?: number }[] | null; read_at: string | null; created_at: string;
  deleted_at: string | null; call_no: number | null };
type Contact = { id: string; name: string; phone: string | null; relationship: string | null; notes: string | null };
type Settings = { agent_id: string | null; phone_number_id: string | null; from_number: string; setup_log: { m: string }[] };
type Costs = { total: number; month: number; minutes: number; calls: number; unread: number };
type LiveCall = { conversation_id: string; call_id: string | null; status: string; direction: string; phone: string | null; who: string | null; elapsed: number; transcript: Line[] };

const tbl = (t: string) => supabase.from(t as never) as unknown as {
  select: (c: string) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }> } } & Promise<{ data: unknown[] | null; error: { message: string } | null }>;
  update: (p: object) => { eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }> };
  insert: (p: object) => Promise<{ error: { message: string } | null }>;
};
const fmt = (e164: string | null) => { const d = (e164 ?? "").replace(/\D/g, "").replace(/^1/, ""); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164 ?? ""; };
const toE164 = (v: string) => { const d = v.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, ""); return d.length === 10 ? `+1${d}` : null; };
const usd = (n: number | undefined) => (n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).replace(/ (AM|PM)/, " $1");
const mmss = (s: number | null) => s == null ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const slim = (t: Call["transcript"]): Line[] => (t ?? []).filter((x) => x.message).map((x) => ({ role: x.role, text: x.message as string, t: x.time_in_call_secs ?? 0 }));

export default function AvaAssistant() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [s, setS] = useState<Settings | null>(null);
  const [costs, setCosts] = useState<Costs | null>(null);
  const [live, setLive] = useState<LiveCall[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Call | null>(null);
  const [dial, setDial] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [contactOpen, setContactOpen] = useState<Partial<Contact> | null>(null);

  const load = useCallback(async () => {
    const [c, k, st, co] = await Promise.all([
      tbl("ava_calls").select("*").order("created_at", { ascending: false }).limit(100),
      tbl("ava_contacts").select("*").order("name", { ascending: true }).limit(200),
      tbl("ava_settings").select("agent_id, phone_number_id, from_number, setup_log").order("updated_at", { ascending: false }).limit(1),
      (supabase.rpc as unknown as (f: string) => Promise<{ data: Costs | null }>)("ava_costs"),
    ]);
    const e = c.error ?? k.error ?? st.error;
    if (e) { setErr(e.message); return; }
    setErr(null); setCalls(((c.data ?? []) as Call[]).filter((x) => !x.deleted_at)); setContacts((k.data ?? []) as Contact[]); setS(((st.data ?? [])[0] ?? null) as Settings | null); setCosts(co.data);
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 30000); return () => clearInterval(t); }, [load]);

  // live calls (either direction): every 2 sec while one is going, else every 10
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (stop) return;
      if (!document.hidden) {
        const { data } = await supabase.functions.invoke("ava-assistant", { body: { action: "live" } });
        const next = (data?.calls ?? []) as LiveCall[];
        setLive((prev) => { if (prev.length > next.length) setTimeout(() => void load(), 5000); return next; });
        setTimeout(tick, next.length ? 2000 : 10000);
      } else setTimeout(tick, 10000);
    };
    void tick();
    return () => { stop = true; };
  }, [load]);

  const markRead = async (c: Call) => {
    setOpen(c);
    if (c.message && !c.read_at) {
      await tbl("ava_calls").update({ read_at: new Date().toISOString() }).eq("id", c.id);
      setCalls((cs) => cs.map((x) => (x.id === c.id ? { ...x, read_at: new Date().toISOString() } : x)));
    }
  };
  const runSetup = async () => {
    setBusy(true);
    await (supabase.rpc as unknown as (f: string, a: object) => Promise<unknown>)("ava_action", { p_action: "setup" });
    setTimeout(() => { setBusy(false); void load(); }, 30000);
  };
  const copy = async () => { await navigator.clipboard.writeText(fmt(s?.from_number ?? "")).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  const messages = calls.filter((c) => c.message);
  const ready = !!s?.agent_id && !!s?.phone_number_id;
  const nameOf = (c: Call) => c.caller_name ?? contacts.find((k) => k.id === c.contact_id)?.name ?? (c.phone ? fmt(c.phone) : "Unknown caller");

  return (
    <div className="space-y-5">
      <PageHeader title="Ava" description="Your personal AI assistant. Anyone can call her line and leave you a message; she can also call people for you." />

      {/* top bar: her number, dial, spend */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void copy()} aria-label={`Ava's number ${fmt(s?.from_number ?? null)}, copy`}
          className="group inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-white/[0.04] px-3.5 ring-1 ring-white/10 transition hover:bg-white/[0.07]">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-500/15 text-emerald-300"><Phone className="h-3.5 w-3.5" aria-hidden /></span>
          <span className="text-left leading-tight"><span className="block text-[11px] text-white/50">Ava's line</span>
            <span className="block whitespace-nowrap text-[15px] font-semibold tabular-nums text-white">{fmt(s?.from_number ?? null) || "…"}</span></span>
          {copied ? <Check className="h-4 w-4 text-emerald-300" aria-hidden /> : <Copy className="h-4 w-4 text-white/30 group-hover:text-white/60" aria-hidden />}
        </button>
        <button type="button" onClick={() => setDial(true)} disabled={!ready}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-emerald-500 px-4 text-[15px] font-semibold text-[#052E1F] transition hover:bg-emerald-400 active:scale-[0.98] disabled:opacity-40">
          <Grid3x3 className="h-4 w-4" aria-hidden />Dial</button>
        <div className="ml-auto inline-flex min-h-[44px] flex-col items-end justify-center rounded-2xl bg-white/[0.04] px-3.5 ring-1 ring-white/10" title="ElevenLabs $0.08 a minute + AI model + Telnyx minutes + $1/mo number">
          <span className="text-[11px] text-white/50">Spent so far</span>
          <span className="whitespace-nowrap text-[15px] font-semibold tabular-nums text-white">{usd(costs?.total)}</span>
        </div>
      </div>

      {err && <div className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-200 ring-1 ring-red-500/40">Could not load: {err}</div>}

      {/* status */}
      <div className={cn("flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 ring-1", ready ? "bg-emerald-500/[0.06] ring-emerald-500/25" : "bg-amber-500/[0.06] ring-amber-500/30")}>
        {ready ? <CheckCircle2 className="h-5 w-5 text-emerald-400" aria-hidden /> : <AlertTriangle className="h-5 w-5 text-amber-300" aria-hidden />}
        <span className="text-[15px] text-white">{ready ? "Answering her line and ready to call out" : "Not set up yet"}</span>
        <button type="button" onClick={() => void runSetup()} disabled={busy}
          className="ml-auto inline-flex min-h-[36px] items-center gap-2 rounded-lg px-3 text-sm text-white/75 ring-1 ring-white/15 hover:bg-white/5 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}{ready ? "Re-run setup" : "Set up"}</button>
      </div>

      <ReplyGuard source="ava" />

      {/* live */}
      {live.map((c) => (
        <section key={c.conversation_id} aria-label="Live call" className="rounded-3xl bg-emerald-500/[0.06] ring-1 ring-emerald-500/30">
          <header className="flex flex-wrap items-center gap-3 px-5 pt-4">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400 motion-safe:animate-pulse" aria-hidden />Live</span>
            <span className="text-[17px] font-semibold text-white">{c.who ?? fmt(c.phone) ?? "Caller"}</span>
            <span className="text-sm text-white/55">{c.direction === "outbound" ? "Ava calling" : "Calling Ava"}</span>
            <span className="ml-auto font-mono text-[15px] tabular-nums text-white">{mmss(c.elapsed)}</span>
          </header>
          <LiveTranscript lines={c.transcript} live them={c.who ?? "Them"} className="max-h-[320px] px-5 pb-5 pt-3" />
        </section>
      ))}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* messages */}
        <section aria-label="Messages" className="rounded-3xl bg-white/[0.03] ring-1 ring-white/10">
          <header className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
            <Inbox className="h-4 w-4 text-sky-300" aria-hidden /><h3 className="text-[15px] font-semibold text-white">Messages for you</h3>
            {(costs?.unread ?? 0) > 0 && <span className="ml-auto rounded-full bg-[#0A84FF] px-2 py-0.5 text-xs font-semibold text-white">{costs?.unread} new</span>}
          </header>
          {messages.length === 0 ? <p className="px-4 py-8 text-center text-sm text-white/45">No messages yet. When someone calls Ava's line, it lands here and on your phone.</p> : (
            <ul className="divide-y divide-white/5">
              {messages.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => void markRead(c)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-white/[0.04]">
                    <span className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", c.read_at ? "bg-transparent" : "bg-[#0A84FF]")} aria-label={c.read_at ? undefined : "Unread"} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><CallNo n={c.call_no} /><span className="text-[15px] font-medium text-white">{nameOf(c)}</span>
                        {c.urgent && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] text-rose-300">Urgent</span>}
                        {c.callback_wanted && <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-300">Wants a call back</span>}
                        <span className="ml-auto shrink-0 text-xs text-white/40">{when(c.created_at)}</span></div>
                      <p className="mt-0.5 text-sm text-white/75">{c.message}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* all calls */}
        <section aria-label="All calls" className="rounded-3xl bg-white/[0.03] ring-1 ring-white/10">
          <header className="flex items-center gap-2 border-b border-white/5 px-4 py-3"><Phone className="h-4 w-4 text-emerald-300" aria-hidden /><h3 className="text-[15px] font-semibold text-white">All calls</h3>
            <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-xs tabular-nums text-white/70">{calls.length}</span></header>
          {calls.length === 0 ? <p className="px-4 py-8 text-center text-sm text-white/45">No calls yet.</p> : (
            <ul className="divide-y divide-white/5">
              {calls.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => void markRead(c)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-white/[0.04]">
                    {c.direction === "inbound" ? <PhoneIncoming className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" aria-label="Incoming" /> : <PhoneOutgoing className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-label="Outgoing" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><CallNo n={c.call_no} /><span className="text-[15px] font-medium text-white">{nameOf(c)}</span>
                        <span className="text-xs tabular-nums text-white/40">{mmss(c.duration_sec)}</span>
                        <span className="ml-auto shrink-0 text-xs text-white/40">{when(c.created_at)}</span></div>
                      {c.summary && <p className="mt-0.5 line-clamp-2 text-xs text-white/55">{c.summary}</p>}
                    </div>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-white/25" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* contacts */}
      <section aria-label="People Ava knows" className="rounded-3xl bg-white/[0.03] p-4 ring-1 ring-white/10">
        <div className="mb-2 flex items-center gap-2">
          <UserRound className="h-4 w-4 text-white/60" aria-hidden /><h3 className="text-[15px] font-semibold text-white">People Ava knows</h3>
          <button type="button" onClick={() => setContactOpen({})} className="ml-auto inline-flex min-h-[36px] items-center gap-1 rounded-lg px-3 text-sm text-sky-300 hover:bg-white/5"><Plus className="h-4 w-4" aria-hidden />Add</button>
        </div>
        <p className="mb-2 text-xs text-white/45">When one of these numbers calls, Ava greets them by name.</p>
        <ul className="flex flex-wrap gap-2">
          {contacts.map((k) => (
            <li key={k.id}><button type="button" onClick={() => setContactOpen(k)} className="rounded-xl bg-white/[0.05] px-3 py-2 text-left ring-1 ring-white/10 hover:bg-white/[0.08]">
              <span className="block text-sm font-medium text-white">{k.name}{k.relationship ? <span className="font-normal text-white/50"> · {k.relationship}</span> : null}</span>
              <span className="block text-xs tabular-nums text-white/50">{fmt(k.phone)}</span></button></li>
          ))}
        </ul>
      </section>

      <CallSheet call={open} name={open ? nameOf(open) : ""} onClose={() => setOpen(null)}
        onDeleted={() => { const id = open?.id; setOpen(null); setCalls((cs) => cs.filter((x) => x.id !== id)); void load(); }} />
      <ContactSheet c={contactOpen} onClose={() => setContactOpen(null)} onSaved={() => { setContactOpen(null); void load(); }} />
      <DialerSheet kinds={["personal"]} open={dial} onOpenChange={setDial} onCalled={() => { setTimeout(() => void load(), 3000); }} />
    </div>
  );
}

function CallSheet({ call, name, onClose, onDeleted }: { call: Call | null; name: string; onClose: () => void; onDeleted: () => void }) {
  return (
    <Sheet open={!!call} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="admin-shell w-full overflow-y-auto border-white/10 bg-[#0b0b0d] text-white sm:max-w-xl">
        {call && <>
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2 text-white"><CallNo n={call.call_no} className="text-[13px]" />{name}</SheetTitle>
            <SheetDescription className="text-white/50">{call.direction === "inbound" ? "Called Ava" : "Ava called"} · {when(call.created_at)} · {fmt(call.phone)}{call.duration_sec != null ? ` · ${mmss(call.duration_sec)}` : ""}</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            {call.message && <div className="rounded-2xl bg-sky-500/10 p-4 ring-1 ring-sky-500/25"><div className="text-[11px] font-semibold uppercase tracking-wider text-sky-300">Message for you</div><p className="mt-1 text-[15px] text-white">{call.message}</p></div>}
            {call.purpose && <p className="text-sm text-white/60"><span className="text-white/40">Why she called: </span>{call.purpose}</p>}
            {call.conversation_id && <Recording callId={call.id} fn="ava-assistant" />}
            {call.summary && <p className="text-[15px] leading-relaxed text-white/85">{call.summary}</p>}
            <div><h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">Transcript</h4><LiveTranscript lines={slim(call.transcript)} them={name} /></div>
            <DeleteCallButton rpc="ava_delete_call" callId={call.id} onDeleted={onDeleted} />
          </div>
        </>}
      </SheetContent>
    </Sheet>
  );
}

function ContactSheet({ c, onClose, onSaved }: { c: Partial<Contact> | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Partial<Contact>>({});
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setF(c ?? {}); setErr(null); }, [c]);
  const save = async () => {
    const phone = f.phone ? toE164(f.phone) : null;
    if (!f.name?.trim()) { setErr("Add a name."); return; }
    if (f.phone && !phone) { setErr("Phone should be a 10-digit US number."); return; }
    const row = { name: f.name.trim(), phone, relationship: f.relationship?.trim() || null, notes: f.notes?.trim() || null };
    const { error } = f.id ? await tbl("ava_contacts").update(row).eq("id", f.id) : await tbl("ava_contacts").insert(row);
    if (error) { setErr(error.message); return; }
    onSaved();
  };
  const input = "h-11 w-full rounded-xl bg-white/[0.05] px-3 text-[15px] text-white outline-none ring-1 ring-white/10 placeholder:text-white/35 focus:ring-white/25";
  return (
    <Sheet open={!!c} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="admin-shell w-full border-white/10 bg-[#0b0b0d] text-white sm:max-w-md">
        <SheetTitle className="text-white">{f.id ? "Edit contact" : "New contact"}</SheetTitle>
        <SheetDescription className="text-white/50">Ava greets saved numbers by name and knows how they're related to you.</SheetDescription>
        <div className="mt-4 space-y-3">
          <label className="block"><span className="mb-1 block text-xs text-white/60">Name</span><input className={input} value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Mom" /></label>
          <label className="block"><span className="mb-1 block text-xs text-white/60">Phone</span><input className={input} inputMode="tel" value={f.phone ?? ""} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="(555) 123-4567" /></label>
          <label className="block"><span className="mb-1 block text-xs text-white/60">Relationship</span><input className={input} value={f.relationship ?? ""} onChange={(e) => setF({ ...f, relationship: e.target.value })} placeholder="e.g. mother, business partner" /></label>
          <label className="block"><span className="mb-1 block text-xs text-white/60">Notes for Ava</span><textarea rows={3} className={cn(input, "h-auto py-2")} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Anything that helps her be warm and useful" /></label>
          {err && <p role="alert" className="text-sm text-red-300">{err}</p>}
          <button type="button" onClick={() => void save()} className="inline-flex min-h-[48px] w-full items-center justify-center rounded-2xl bg-white text-[15px] font-semibold text-black active:scale-[0.98]">Save</button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
