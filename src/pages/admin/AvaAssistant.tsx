/**
 * /admin/ava: Jared's personal AI assistant, separate from RoofGuard.
 *   Her line (816) 429-9495: anyone can call, she takes a message, Jared gets a Scout push.
 *   Dial: she calls someone for a reason Jared types.
 * Also: "Your cell" (missed calls forwarded to her line) and "Spam & Do Not Call" (AvaCell.tsx, AvaSpam.tsx).
 * Data: ava_calls, ava_contacts, ava_settings (admin RLS), ava_costs(); edge fn ava-assistant (live, audio, call, setup).
 * Separate on purpose: nothing here reads or writes rg_* (RoofGuard can be split off and sold).
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/admin/PageHeader";
import { AvaOrb } from "@/components/admin/roofguard/AvaOrb";
import { VoiceSwitcher } from "@/components/admin/roofguard/VoiceSwitcher";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { CallNo, ReplyGuard, LiveTranscript, type Line } from "@/components/admin/roofguard/AvaCalls";
import { DialerSheet, LivePill } from "@/components/admin/roofguard/AvaDialer";
import { FollowupsList, ForwardedTag, KnowledgeList, LineStatus, MessageSheet, MessagesList, SpendChip, YourVoiceTag, type Msg } from "@/components/admin/roofguard/AvaShared";
import { useLiveCalls, LIVE_ENDED_EVENT } from "@/components/admin/roofguard/AvaLive";
import { AvaCalendars } from "@/components/admin/roofguard/AvaCalendars";
import { AvaCell } from "@/components/admin/roofguard/AvaCell";
import { AvaSpam } from "@/components/admin/roofguard/AvaSpam";
import { VoicePicker } from "@/components/admin/roofguard/AvaVoice";
import { CollapsibleSection } from "@/components/admin/roofguard/CollapsibleSection";
import { AvaSettingsSheet, SettingsButton } from "@/components/admin/roofguard/AvaSettings";
import { CoachSection } from "@/components/admin/roofguard/AvaCoach";
import { ArchivedCalls, useArchiveReload } from "@/components/admin/roofguard/AvaArchive";
import { onOpenCall, takePendingCall } from "@/components/admin/roofguard/coachBus";
import { toast } from "sonner";
import { AlertTriangle, Check, CheckCircle2, ChevronRight, Copy, Grid3x3, Loader2, Phone, PhoneIncoming, PhoneOutgoing, Plus, RefreshCw, UserRound } from "lucide-react";

type Call = { id: string; direction: "inbound" | "outbound"; phone: string | null; contact_id: string | null; caller_name: string | null; purpose: string | null;
  conversation_id: string | null; status: string; summary: string | null; message: string | null; urgent: boolean; callback_wanted: boolean;
  duration_sec: number | null; transcript: { role: string; message: string | null; time_in_call_secs?: number }[] | null; read_at: string | null; created_at: string;
  deleted_at: string | null; archived_at?: string | null; call_no: number | null; voice?: "ava" | "jared"; forwarded?: boolean; booked_slot?: string | null };
type Contact = { id: string; name: string; phone: string | null; relationship: string | null; notes: string | null };
type Settings = { agent_id: string | null; phone_number_id: string | null; from_number: string; setup_log: { m: string }[] };
type Costs = { total: number; month: number; minutes: number; calls: number; unread: number };

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
  const [studio, setStudio] = useState(0);
  const { calls: live } = useLiveCalls("ava");
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Call | null>(null);
  const [dial, setDial] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    setErr(null); setCalls(((c.data ?? []) as Call[]).filter((x) => !x.deleted_at && !x.archived_at)); setContacts((k.data ?? []) as Contact[]); setS(((st.data ?? [])[0] ?? null) as Settings | null); setCosts(co.data);
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 30000); return () => clearInterval(t); }, [load]);
  useArchiveReload("ava", load);

  // a live call just ended: the post-call data (message, next steps) lands a few seconds later
  useEffect(() => {
    const h = (e: Event) => { if ((e as CustomEvent<string>).detail === "ava") setTimeout(() => void load(), 5000); };
    window.addEventListener(LIVE_ENDED_EVENT, h);
    return () => window.removeEventListener(LIVE_ENDED_EVENT, h);
  }, [load]);

  const markRead = async (c: Call) => {
    setOpen(c);
    if (c.message && !c.read_at) {
      await tbl("ava_calls").update({ read_at: new Date().toISOString() }).eq("id", c.id);
      setCalls((cs) => cs.map((x) => (x.id === c.id ? { ...x, read_at: new Date().toISOString() } : x)));
    }
  };
  // the Coach (reviews feed, "See calls" on a rule) asks for a call's sheet
  useEffect(() => onOpenCall("ava", () => {
    const p = takePendingCall("ava");
    if (!p) return;
    const known = calls.find((x) => x.id === p.callId);
    if (known) { void markRead(known); return; }
    void (supabase.from("ava_calls" as never) as unknown as { select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => PromiseLike<{ data: unknown }> } } })
      .select("*").eq("id", p.callId).maybeSingle().then(({ data }) => { if (data) void markRead(data as Call); else toast.error("Couldn't find that call"); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [calls]);
  const runSetup = async () => {
    setBusy(true);
    await (supabase.rpc as unknown as (f: string, a: object) => Promise<unknown>)("ava_action", { p_action: "setup" });
    setTimeout(() => { setBusy(false); void load(); }, 30000);
  };
  const copy = async () => { await navigator.clipboard.writeText(fmt(s?.from_number ?? "")).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  const nameOf = (c: Call) => c.caller_name ?? contacts.find((k) => k.id === c.contact_id)?.name ?? (c.phone ? fmt(c.phone) : "Unknown caller");
  const toMsg = (c: Call): Msg => ({
    id: c.id, source: "ava", call_no: c.call_no, direction: c.direction, name: nameOf(c), phone: c.phone, message: c.message, urgent: c.urgent,
    callback_wanted: c.callback_wanted, read_at: c.read_at, at: c.created_at, summary: c.summary, duration_sec: c.duration_sec, transcript: slim(c.transcript),
    purpose: c.purpose, hasRecording: !!c.conversation_id, forwarded: c.forwarded === true, voice: c.voice, booked: c.booked_slot ?? null });
  const messages: Msg[] = calls.filter((c) => c.message).map(toMsg);
  const ready = !!s?.agent_id && !!s?.phone_number_id;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <AvaOrb size={72} speaking={live.length > 0} label={live.length > 0 ? "Ava, on a call now" : "Ava"} />
        <div className="min-w-0 flex-1">
          <PageHeader title="Ava" description="Your personal AI assistant. Anyone can call her line and leave you a message; she can also call people for you." />
        </div>
      </div>

      {/* top bar: her number, dial, spend */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void copy()} aria-label={`Ava's number ${fmt(s?.from_number ?? null)}, copy`}
          className="group inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-white/[0.04] px-3.5 ring-1 ring-white/10 transition hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-500/15 text-emerald-300"><Phone className="h-3.5 w-3.5" aria-hidden /></span>
          <span className="text-left leading-tight"><span className="block text-[11px] text-white/50">Ava's line</span>
            <span className="block whitespace-nowrap text-[15px] font-semibold tabular-nums text-white">{fmt(s?.from_number ?? null) || "…"}</span></span>
          {copied ? <Check className="h-4 w-4 text-emerald-300" aria-hidden /> : <Copy className="h-4 w-4 text-white/30 group-hover:text-white/60" aria-hidden />}
        </button>
        <button type="button" onClick={() => setDial(true)} disabled={!ready}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-[#30D158] px-4 text-[15px] font-semibold text-[#1c1c1e] transition hover:bg-[#4bdc72] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 motion-safe:active:scale-[0.98] disabled:opacity-40">
          <Grid3x3 className="h-4 w-4" aria-hidden />Dial</button>
        <LivePill source="ava" />
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <VoiceSwitcher source="ava" onMore={() => { setStudio((n) => n + 1); setTimeout(() => document.getElementById("voice-studio-ava")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }} />
          <SpendChip source="ava" />
          <SettingsButton onClick={() => setSettingsOpen(true)} />
          <div className="inline-flex min-h-[44px] flex-col items-end justify-center rounded-2xl bg-white/[0.04] px-3.5 ring-1 ring-white/10" title="ElevenLabs $0.08 a minute + AI model + Telnyx minutes + $1/mo number">
            <span className="text-[11px] text-white/50">Spent so far</span>
            <span className="whitespace-nowrap text-[15px] font-semibold tabular-nums text-white">{usd(costs?.total)}</span>
          </div>
        </div>
      </div>

      {err && <div className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-200 ring-1 ring-red-500/40">Could not load: {err}</div>}

      {/* status */}
      <div className={cn("flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 ring-1", ready ? "bg-emerald-500/[0.06] ring-emerald-500/25" : "bg-amber-500/[0.06] ring-amber-500/30")}>
        {ready ? <CheckCircle2 className="h-5 w-5 text-emerald-400" aria-hidden /> : <AlertTriangle className="h-5 w-5 text-amber-300" aria-hidden />}
        <span className="text-[15px] text-white">{ready ? "Ready to answer and to call out" : "Not set up yet"}</span>
        {ready && <LineStatus source="ava" className="min-h-[44px]" />}
        <button type="button" onClick={() => void runSetup()} disabled={busy}
          className="ml-auto inline-flex min-h-[44px] items-center gap-2 rounded-lg px-3 text-sm text-white/75 ring-1 ring-white/15 hover:bg-white/5 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}{ready ? "Re-run setup" : "Set up"}</button>
      </div>

      <ReplyGuard source="ava" />

      {/* live */}
      {live.map((c) => (
        <section key={c.key} aria-label="Live call" className="rounded-3xl bg-emerald-500/[0.06] ring-1 ring-emerald-500/30">
          <header className="flex flex-wrap items-center gap-3 px-5 pt-4">
            <AvaOrb size={36} speaking />
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400 motion-safe:animate-pulse" aria-hidden />Live</span>
            <span className="text-[17px] font-semibold text-white">{c.who || fmt(c.phone) || "Caller"}</span>
            <span className="text-sm text-white/55">{c.direction === "outbound" ? "Ava calling" : "Calling Ava"}</span>
            {c.forwarded && <ForwardedTag />}
            {c.voice === "jared" && <YourVoiceTag />}
            <span className="ml-auto font-mono text-[15px] tabular-nums text-white">{mmss(c.elapsed)}</span>
          </header>
          <LiveTranscript lines={c.transcript} live them={c.who || "Them"} className="max-h-[320px] min-h-0 px-5 pb-5 pt-3" />
        </section>
      ))}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* messages */}
        <MessagesList items={messages} source="ava" onOpen={(m) => { const c = calls.find((x) => x.id === m.id); if (c) void markRead(c); }} />

        {/* all calls */}
        <section aria-label="All calls" className="rounded-3xl bg-white/[0.03] ring-1 ring-white/10">
          <header className="flex items-center gap-2 border-b border-white/5 px-4 py-3"><Phone className="h-4 w-4 text-emerald-300" aria-hidden /><h3 className="text-[15px] font-semibold text-white">All calls</h3>
            <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-xs tabular-nums text-white/70">{calls.length}</span></header>
          {calls.length === 0 ? <p className="px-4 py-8 text-center text-sm text-white/45">No calls yet.</p> : (
            <ul className="divide-y divide-white/5">
              {calls.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => void markRead(c)} className="flex min-h-[44px] w-full items-start gap-3 px-4 py-3 text-left hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
                    {c.direction === "inbound" ? <PhoneIncoming className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" aria-label="Incoming" /> : <PhoneOutgoing className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-label="Outgoing" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><CallNo n={c.call_no} /><span className="text-[15px] font-medium text-white">{nameOf(c)}</span>
                        {c.forwarded && <ForwardedTag />}
                        {c.voice === "jared" && <YourVoiceTag />}
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

      <ArchivedCalls source="ava" />

      {/* Coach: reviews every call, keeps her playbook (rules you can approve, edit, pause or delete) */}
      <CoachSection source="ava" />

      <div className="grid gap-4 lg:grid-cols-2">
        <FollowupsList source="ava" onChanged={() => void load()} />
        <KnowledgeList source="ava" collapsible />
      </div>

      {/* your cell: missed calls forwarded to Ava; spam calls and Do Not Call evidence */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <AvaCalendars />
        <AvaCell onOpenSettings={() => setSettingsOpen(true)} />
        <AvaSpam />
      </div>

      {/* one Voice section: how Ava sounds, and My voice (record, bank, clone) */}
      <VoicePicker source="ava" openSignal={studio} />

      {/* contacts */}
      <CollapsibleSection id="ava-people" title="People Ava knows" icon={<UserRound className="h-4 w-4 text-white/60" />}
        summary={contacts.length ? <><span className="tabular-nums">{contacts.length}</span>&nbsp;{contacts.length === 1 ? "person" : "people"} she greets by name</> : "Nobody saved yet"}>
        <div className="p-4">
          <div className="mb-2 flex items-center gap-2">
            <p className="text-xs text-white/60">When one of these numbers calls, Ava greets them by name.</p>
            <button type="button" onClick={() => setContactOpen({})} className="ml-auto inline-flex min-h-[44px] items-center gap-1 rounded-lg px-3 text-sm text-sky-300 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"><Plus className="h-4 w-4" aria-hidden />Add</button>
          </div>
          <ul className="flex flex-wrap gap-2">
            {contacts.map((k) => (
              <li key={k.id}><button type="button" onClick={() => setContactOpen(k)} className="min-h-[44px] rounded-xl bg-white/[0.05] px-3 py-2 text-left ring-1 ring-white/10 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
                <span className="block text-sm font-medium text-white">{k.name}{k.relationship ? <span className="font-normal text-white/60"> · {k.relationship}</span> : null}</span>
                <span className="block text-xs tabular-nums text-white/60">{fmt(k.phone)}</span></button></li>
            ))}
          </ul>
        </div>
      </CollapsibleSection>

      <MessageSheet item={open ? toMsg(open) : null} onClose={() => setOpen(null)}
        onDeleted={() => { const id = open?.id; setOpen(null); setCalls((cs) => cs.filter((x) => x.id !== id)); void load(); }} />
      <ContactSheet c={contactOpen} onClose={() => setContactOpen(null)} onSaved={() => { setContactOpen(null); void load(); }} />
      <AvaSettingsSheet source="ava" open={settingsOpen} onOpenChange={setSettingsOpen} />
      <DialerSheet kinds={["personal"]} open={dial} onOpenChange={setDial} onCalled={() => { setTimeout(() => void load(), 3000); }} />
    </div>
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
