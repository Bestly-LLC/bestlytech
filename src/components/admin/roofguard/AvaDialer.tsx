/**
 * Top of /admin/roofguard: Ava's own number (copyable), what she has cost so far (rg_costs, top-right), and the Dial
 * button that opens an iPhone-style keypad. Two kinds of call:
 *   Personal       Ava as "Jared's AI assistant" with a reason you type (edge fn {action:"personal_call"}, admin only)
 *   RoofGuard demo the cold-call script against the fictional Riverside Medical Center ({action:"demo_call"})
 * Either way the call shows up live on the Calls tab within seconds, and in the Live button at the top of the page.
 * Also here: the last five numbers dialed from this browser (Recent + one-tap Redial), Redial after a call ends, and
 * the live pill (LivePill) that opens any live call's transcript from anywhere on the page.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, Copy, Delete, Grid3x3, History, Loader2, Phone, PhoneIncoming, RotateCcw } from "lucide-react";
import { LiveTranscript, Recording, type Line } from "./AvaCalls";
import { AvaOrb, AVA_GLOW } from "./AvaOrb";
import { ForwardedTag, LineStatus, SpendChip, YourVoiceTag } from "./AvaShared";
import { SettingsButton } from "./AvaSettings";
import { ACTIONS_EVENT, invokeError } from "./AvaActions";
import { DIAL_EVENT, loadRecents, saveRecent, type DialMode, type DialRequest, type Recent } from "./avaDial";
import { useLiveCalls, type LiveItem, type LiveSource } from "./AvaLive";

type Costs = { total: number; today: number; month: number; calls_total: number; voice: number; phone: number; ai: number; number: number;
  minutes: number; calls: number; per_meeting: number | null; rates: { voice_per_min: number; phone_per_min: number; number_monthly: number } };

const usd = (n: number | null | undefined) => n == null ? "–" : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const fmt = (d: string) => {
  const x = d.replace(/\D/g, "").replace(/^1(?=\d{10})/, "").slice(0, 10);
  if (x.length <= 3) return x;
  if (x.length <= 6) return `(${x.slice(0, 3)}) ${x.slice(3)}`;
  return `(${x.slice(0, 3)}) ${x.slice(3, 6)}-${x.slice(6)}`;
};

export function AvaTopBar({ onCalled, extra, onOpenSettings }: { onCalled: () => void; extra?: ReactNode; onOpenSettings?: () => void }) {
  // RoofGuard Ava only: her own number and demo calls. Personal calls live on /admin/ava.
  const [num, setNum] = useState<string | null>(null);
  // "loading" until the first answer; only a real empty answer shows the no-number warning (a failed load keeps the last number)
  const [numState, setNumState] = useState<"loading" | "ok" | "none" | "error">("loading");
  const [costs, setCosts] = useState<Costs | null>(null);
  const [copied, setCopied] = useState(false);
  const [dialOpen, setDialOpen] = useState(false);
  const [personalOpen, setPersonalOpen] = useState(false);

  const load = useCallback(async () => {
    // bind: calling supabase.rpc detached loses `this` ("undefined is not an object (evaluating 'this.rest')")
    const rpc = supabase.rpc.bind(supabase) as unknown as (f: string) => Promise<{ data: unknown; error: unknown }>;
    const [st, c] = await Promise.all([rpc("rg_call_stats"), rpc("rg_costs")]);
    if (st.error || !st.data) { setNumState((s) => (s === "ok" ? "ok" : "error")); }
    else {
      const n = (st.data as { settings?: { from_number?: string } }).settings?.from_number ?? null;
      setNum(n); setNumState(n ? "ok" : "none");
    }
    if (c.data) setCosts(c.data as Costs);
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 60000); return () => clearInterval(t); }, [load]);

  const copy = async () => {
    if (!num) return;
    await navigator.clipboard.writeText(fmt(num)).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {numState === "loading" && (
          <span className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-white/[0.04] px-3.5 text-sm text-white/50 ring-1 ring-white/10">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />RoofGuard line…
          </span>
        )}
        {numState === "none" && (
          <span className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-amber-500/10 px-3.5 text-sm text-amber-200 ring-1 ring-amber-500/30">
            <Phone className="h-4 w-4" aria-hidden />RoofGuard needs its own number before calling
          </span>
        )}
        {numState === "error" && !num && (
          <button type="button" onClick={() => void load()}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-white/[0.04] px-3.5 text-sm text-white/70 ring-1 ring-white/10 hover:bg-white/[0.07]">
            <Phone className="h-4 w-4" aria-hidden />Couldn't load the line · Retry
          </button>
        )}
        {num && (
          <button type="button" onClick={() => void copy()} aria-label={`RoofGuard Ava's number ${fmt(num)}, copy`}
            className="group inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-white/[0.04] px-3.5 ring-1 ring-white/10 transition hover:bg-white/[0.07]">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-500/15 text-emerald-300"><Phone className="h-3.5 w-3.5" aria-hidden /></span>
            <span className="text-left leading-tight">
              <span className="block text-[11px] text-white/50">RoofGuard line</span>
              <span className="block whitespace-nowrap text-[15px] font-semibold tabular-nums text-white">{fmt(num)}</span>
            </span>
            {copied ? <Check className="h-4 w-4 text-emerald-300" aria-hidden /> : <Copy className="h-4 w-4 text-white/30 group-hover:text-white/60" aria-hidden />}
          </button>
        )}
        <LineStatus source="roofguard" />
        <button type="button" onClick={() => setDialOpen(true)}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-[#FFA270] px-4 text-[15px] font-semibold text-[#1c1c1e] transition hover:bg-[#ffb48a] active:scale-[0.98]">
          <Grid3x3 className="h-4 w-4" aria-hidden />Dial
        </button>
        <LivePill source="roofguard" />

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {extra}
        <SpendChip source="roofguard" />
        {onOpenSettings && <SettingsButton onClick={onOpenSettings} />}
        {!costs && (
          <span className="inline-flex min-h-[44px] flex-col items-end justify-center rounded-2xl bg-white/[0.04] px-3.5 text-right ring-1 ring-white/10">
            <span className="text-[11px] text-white/50">Spent so far</span>
            <span className="text-[15px] font-semibold tabular-nums text-white/60">–</span>
          </span>
        )}
        {costs && (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" aria-label={`Spent so far ${usd(costs.total)}, see breakdown`}
                className="inline-flex min-h-[44px] flex-col items-end justify-center rounded-2xl bg-white/[0.04] px-3.5 text-right ring-1 ring-white/10 transition hover:bg-white/[0.07]">
                <span className="text-[11px] text-white/50">Spent so far</span>
                <span className="whitespace-nowrap text-[15px] font-semibold tabular-nums text-white">{usd(costs.total)}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="admin-shell w-72 border-white/10 bg-[#111114] p-4 text-white">
              <div className="text-[13px] font-semibold">What Ava has cost</div>
              <dl className="mt-2 space-y-1.5 text-sm">
                {[
                  ["Today", costs.today], ["This month (calls)", costs.month],
                  [`Voice, ${costs.minutes} min at ${usd(costs.rates.voice_per_min)}`, costs.voice],
                  [`Phone line minutes`, costs.phone], ["AI model", costs.ai], ["Phone number", costs.number],
                ].map(([k, v]) => (
                  <div key={k as string} className="flex justify-between gap-3"><dt className="text-white/60">{k}</dt><dd className="whitespace-nowrap tabular-nums">{usd(v as number)}</dd></div>
                ))}
                <div className="flex justify-between gap-3 border-t border-white/10 pt-1.5 font-semibold"><dt>Total</dt><dd className="whitespace-nowrap tabular-nums">{usd(costs.total)}</dd></div>
                {costs.per_meeting != null && <div className="flex justify-between gap-3 text-emerald-300"><dt>Per meeting booked</dt><dd className="whitespace-nowrap tabular-nums">{usd(costs.per_meeting)}</dd></div>}
              </dl>
              <p className="mt-2 text-[11px] leading-snug text-white/40">{costs.calls} calls. Estimated: ElevenLabs bills $0.08 a call minute; the AI model's cost comes from each call's record; Telnyx about $0.007 a minute plus $1 a month for the number.</p>
            </PopoverContent>
          </Popover>
        )}
        </div>
      </div>
      <DialerSheet kinds={["demo"]} open={dialOpen} onOpenChange={setDialOpen} onCalled={() => { onCalled(); setTimeout(() => void load(), 90000); }} />
      {/* opened only by Call back / Call again buttons: replying to a caller is a personal-Ava call, not a RoofGuard script */}
      <DialerSheet kinds={["personal"]} open={personalOpen} onOpenChange={setPersonalOpen} onCalled={() => onCalled()} />
    </>
  );
}

const KEYS: [string, string][] = [["1", ""], ["2", "ABC"], ["3", "DEF"], ["4", "GHI"], ["5", "JKL"], ["6", "MNO"], ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"], ["", ""], ["0", "+"], ["del", ""]];
const digits10 = (v: string) => v.replace(/\D/g, "").replace(/^1(?=\d{10})/, "").slice(0, 10);
const frame = "admin-shell flex h-[100dvh] w-full flex-col gap-0 overflow-hidden border-white/10 bg-[#0b0b0d] p-0 text-white sm:max-w-md";
const pad = "px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6";

/** Everything needed to place (or place again) one call. */
type CallParams = { mode: DialMode; phone: string; name: string; purpose: string; company: string; connect: boolean; voice?: "jared" };

export function DialerSheet({ open, onOpenChange, onCalled, kinds = ["personal", "demo"] }: { open: boolean; onOpenChange: (o: boolean) => void; onCalled: () => void; kinds?: ("personal" | "demo")[] }) {
  const [digits, setDigits] = useState("");
  const [mode, setMode] = useState<"personal" | "demo">(kinds[0]);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [purpose, setPurpose] = useState("");
  const [connect, setConnect] = useState(false);
  const [useVoice, setUseVoice] = useState(false);
  const [voiceInfo, setVoiceInfo] = useState<{ id: string | null; paused: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [recents, setRecents] = useState<Recent[]>([]);
  const hasPersonal = kinds.includes("personal");
  const [err, setErr] = useState<string | null>(null);
  const clean = digits10(digits);
  const valid = clean.length === 10;
  const closes = useRef<DialRequest["closes"] | null>(null);
  const kindKey = kinds.join(",");
  const openRef = useRef(onOpenChange);
  openRef.current = onOpenChange;

  useEffect(() => { if (!open) { setErr(null); setBusy(false); } }, [open]);
  useEffect(() => { if (open) setRecents(loadRecents(mode)); }, [open, mode]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      if (/^\d$/.test(e.key)) setDigits((d) => (d + e.key).slice(0, 11));
      if (e.key === "Backspace") setDigits((d) => d.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const [active, setActive] = useState<ActiveCall | null>(null);
  useEffect(() => { if (!open) setActive(null); }, [open]);

  // Call again / Call back / Reply by call: open prefilled (this sheet only answers the kinds of call it offers)
  useEffect(() => {
    const h = (e: Event) => {
      const r = (e as CustomEvent<DialRequest>).detail;
      if (!r || !kindKey.split(",").includes(r.mode)) return;
      setMode(r.mode); setDigits(digits10(r.phone ?? "")); setName((r.name ?? "").slice(0, 40)); setPurpose((r.purpose ?? "").slice(0, 600)); setCompany((r.company ?? "").slice(0, 60));
      setConnect(false); setUseVoice(false); setErr(null); setActive(null);
      closes.current = r.closes ?? null;
      openRef.current(true);
    };
    window.addEventListener(DIAL_EVENT, h);
    return () => window.removeEventListener(DIAL_EVENT, h);
  }, [kindKey]);

  // "Use my voice" is only offered once a cloned voice exists, and stays off after the impersonation guard paused it
  useEffect(() => {
    if (!open || !hasPersonal) return;
    let stop = false;
    void (async () => {
      const q = supabase.from("ava_settings" as never) as unknown as { select: (c: string) => { limit: (n: number) => Promise<{ data: { jared_voice_id: string | null; jared_voice_paused_at: string | null }[] | null }> } };
      const { data } = await q.select("jared_voice_id, jared_voice_paused_at").limit(1);
      if (stop) return;
      const r = data?.[0];
      setVoiceInfo({ id: r?.jared_voice_id ?? null, paused: !!r?.jared_voice_paused_at });
    })();
    return () => { stop = true; };
  }, [open, hasPersonal]);
  const voiceReady = !!voiceInfo?.id && !voiceInfo.paused;
  const voiceOn = useVoice && voiceReady;

  const [redialBusy, setRedialBusy] = useState(false);
  const [redialErr, setRedialErr] = useState<string | null>(null);

  /** Places one call. Used by the Call button, Redial on the keypad, and Redial on the in-call screen. */
  const place = async (pr: CallParams): Promise<string | null> => {
    // personal calls belong to personal Ava (ava-assistant); demos to RoofGuard Ava (roofguard-caller)
    const fn = pr.mode === "personal" ? "ava-assistant" : "roofguard-caller";
    const voice = pr.mode === "personal" && pr.voice === "jared" && voiceReady ? "jared" : undefined;
    const { data, error } = pr.mode === "personal"
      ? await supabase.functions.invoke(fn, { body: { action: "call", phone: pr.phone, name: pr.name, purpose: pr.purpose, connect: pr.connect, ...(voice ? { voice } : {}) } })
      : await supabase.functions.invoke(fn, { body: { action: "demo_call", phone: pr.phone, name: pr.name, company: pr.company.trim() } });
    if (error || !data?.ok) return invokeError(error, data, "The call didn't go out. Try again in a minute.");
    setRecents(saveRecent(pr.mode, { phone: pr.phone, name: pr.name, purpose: pr.purpose, company: pr.company, connect: pr.connect, ...(voice ? { voice } : {}) }));
    if (data.call_id) setActive({ id: data.call_id, fn, who: pr.name.trim() || fmt(pr.phone), voice: voice ?? "ava", redial: { ...pr, ...(voice ? { voice } : { voice: undefined }) } });
    // a Call back / Reply by call button: that call is made, so the suggestions for the message are finished
    const c = closes.current; closes.current = null;
    if (c) {
      const t = supabase.from("ava_actions" as never) as unknown as { update: (p: object) => { eq: (c: string, v: unknown) => { eq: (c: string, v: unknown) => { eq: (c: string, v: unknown) => Promise<unknown> } } } };
      await t.update({ status: "done" }).eq("call_id", c.callId).eq("source", c.source).eq("status", "open");
      try { window.dispatchEvent(new Event(ACTIONS_EVENT)); } catch { /* no window */ }
    }
    onCalled();
    return null;
  };

  const call = async () => {
    // like the iPhone keypad: pressing Call with nothing typed fills in the last number (a second press places the call)
    if (!clean && last) { refill(last); return; }
    if (!valid) return;
    setBusy(true); setErr(null);
    const msg = await place({ mode, phone: clean, name, purpose, company, connect, ...(voiceOn ? { voice: "jared" as const } : {}) });
    setBusy(false);
    if (msg) { setErr(msg); return; }
    setDigits(""); setName(""); setCompany(""); setPurpose(""); setConnect(false); setUseVoice(false);
  };
  const redialFromCall = async (pr: CallParams) => {
    setRedialBusy(true); setRedialErr(null);
    const msg = await place(pr);
    setRedialBusy(false);
    if (msg) setRedialErr(msg);
  };
  const refill = (r: Recent) => { setDigits(r.phone); setName(r.name); setPurpose(r.purpose); setCompany(r.company); setConnect(r.connect === true); setUseVoice(r.voice === "jared"); setErr(null); };
  const last = recents[0];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={frame}>
        {active ? <div className={cn("flex min-h-0 flex-1 flex-col", pad)}>
          <InCall call={active} onNew={() => { setActive(null); setRedialErr(null); }} onDone={() => onOpenChange(false)}
            onRedial={active.redial ? () => void redialFromCall(active.redial as CallParams) : undefined} redialBusy={redialBusy} redialErr={redialErr} />
        </div> : <div data-sheet-scroll className={cn("flex min-h-0 flex-1 touch-pan-y flex-col overflow-y-auto overscroll-contain", pad)}>
        <SheetTitle className="text-white">Dial with Ava</SheetTitle>
        <SheetDescription className="text-white/55">Type or paste a number. Ava calls from her own line and the live transcript shows right here.</SheetDescription>

        {kinds.length > 1 && <div role="tablist" aria-label="Kind of call" className="mt-4 grid grid-cols-2 rounded-xl bg-white/[0.06] p-1 ring-1 ring-white/10">
          {([["personal", "Personal"], ["demo", "RoofGuard"]] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => setMode(id)}
              className={cn("min-h-[36px] rounded-lg text-sm font-medium transition-colors", mode === id ? "bg-white text-black shadow-sm" : "text-white/65 hover:text-white")}>{label}</button>
          ))}
        </div>}

        {last && (
          <section aria-label="Recent calls" className="mt-4">
            <button type="button" onClick={() => refill(last)} disabled={busy}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#FFA270] px-4 text-[15px] font-semibold text-[#1c1c1e] transition hover:bg-[#ffb48a] motion-safe:active:scale-[0.98] disabled:opacity-50">
              <RotateCcw className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">Redial {last.name.trim() || fmt(last.phone)}</span>
            </button>
            <h3 className="mb-1.5 mt-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/55"><History className="h-3.5 w-3.5" aria-hidden />Recent</h3>
            <ul className="flex flex-wrap gap-2">
              {recents.map((r) => (
                <li key={r.phone} className="min-w-0 max-w-full">
                  <button type="button" onClick={() => refill(r)} aria-label={`Fill in ${r.name.trim() || fmt(r.phone)}, ${fmt(r.phone)}`}
                    className="flex min-h-[44px] max-w-full flex-col justify-center rounded-xl bg-white/[0.06] px-3 py-1.5 text-left ring-1 ring-white/10 transition hover:bg-white/[0.1] motion-safe:active:scale-[0.98]">
                    <span className="truncate text-[14px] font-medium leading-tight text-white">{r.name.trim() || fmt(r.phone)}{r.name.trim() ? <span className="font-normal tabular-nums text-white/55">{"  "}{fmt(r.phone)}</span> : null}</span>
                    {(r.purpose || r.company) && <span className="mt-0.5 max-w-[240px] truncate text-[12px] leading-tight text-white/55">{r.purpose || r.company}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <input value={fmt(digits)} onChange={(e) => setDigits(e.target.value.replace(/\D/g, "").slice(0, 11))} inputMode="tel" type="tel" aria-label="Phone number"
          placeholder="Enter number" className="mt-5 w-full bg-transparent text-center text-[32px] font-light tabular-nums tracking-wide text-white outline-none placeholder:text-white/25" />

        <div className="mx-auto mt-3 grid w-full max-w-[280px] grid-cols-3 gap-x-6 gap-y-3" role="group" aria-label="Keypad">
          {KEYS.map(([k, sub], i) => k === "" ? <span key={i} /> : k === "del" ? (
            <button key={i} type="button" onClick={() => setDigits((d) => d.slice(0, -1))} aria-label="Delete digit" disabled={!digits}
              className="grid h-[72px] w-[72px] place-items-center justify-self-center rounded-full text-white/70 transition hover:text-white active:bg-white/10 disabled:opacity-0"><Delete className="h-6 w-6" /></button>
          ) : (
            <button key={i} type="button" onClick={() => setDigits((d) => (d + k).slice(0, 11))} aria-label={k}
              className="flex h-[72px] w-[72px] flex-col items-center justify-center justify-self-center rounded-full bg-white/[0.09] transition active:bg-white/25">
              <span className="text-[30px] font-normal leading-none text-white">{k}</span>
              {sub && <span className="mt-0.5 text-[9px] font-semibold tracking-[0.18em] text-white/60">{sub}</span>}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-white/60">Their name <span className="text-white/40">(optional)</span></span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={mode === "personal" ? "e.g. Mom" : "e.g. Bill"}
              className="h-11 w-full rounded-xl bg-white/[0.05] px-3 text-[15px] text-white outline-none ring-1 ring-white/10 placeholder:text-white/35 focus:ring-white/25" />
          </label>
          {mode === "personal" ? (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-white/60">What should Ava call about?</span>
              <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={600} rows={3}
                placeholder="e.g. Introduce yourself as my new assistant and say hi. Or: confirm Thursday's 2 PM meeting."
                className="w-full rounded-xl bg-white/[0.05] px-3 py-2 text-[15px] text-white outline-none ring-1 ring-white/10 placeholder:text-white/35 focus:ring-white/25" />
              <span className="mt-1 block text-[11px] text-white/40">{voiceOn
                ? <>She opens with "Hey, it's Jared's AI assistant, using his voice." and says she's an AI if asked.</>
                : <>She introduces herself as "Ava, Jared's AI assistant, on a recorded line" and says she's an AI if asked.</>}</span>
            </label>
          ) : null}
          {mode === "personal" ? (
            <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5 ring-1 ring-white/10">
              <span className="min-w-0 flex-1">
                <span id="use-my-voice-label" className={cn("block text-sm font-medium", voiceReady ? "text-white" : "text-white/55")}>Use my voice</span>
                <span id="use-my-voice-help" className="block text-[11px] text-white/50">
                  She'll say she's your AI assistant.
                  {voiceInfo && !voiceInfo.id && <> Record your voice first, in Ava's voice further down this page.</>}
                  {voiceInfo?.id && voiceInfo.paused && <> Voice mode is off after a guard alert. Turn it back on in Ava's voice.</>}
                </span>
              </span>
              <button type="button" role="switch" aria-checked={voiceOn} aria-labelledby="use-my-voice-label" aria-describedby="use-my-voice-help"
                disabled={!voiceReady} onClick={() => setUseVoice((v) => !v)}
                className="grid min-h-[44px] min-w-[56px] shrink-0 place-items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-not-allowed disabled:opacity-40">
                <span className={cn("relative block h-[31px] w-[51px] rounded-full transition-colors", voiceOn ? "" : "bg-white/20")} style={voiceOn ? { background: AVA_GLOW } : undefined}>
                  <span className={cn("absolute left-0 top-[2px] block h-[27px] w-[27px] rounded-full bg-white shadow transition-transform", voiceOn ? "translate-x-[22px]" : "translate-x-[2px]")} />
                </span>
              </button>
            </div>
          ) : null}
          {mode === "personal" ? (
            <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5 ring-1 ring-white/10">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-white">Connect me</span>
                <span className="block text-[11px] text-white/50">Ava checks they're free, then transfers the call to your cell (816)&nbsp;500-7236.</span>
              </span>
              <button type="button" role="switch" aria-checked={connect} aria-label="Connect me" onClick={() => setConnect((c) => !c)}
                className={cn("relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors", connect ? "bg-[#30D158]" : "bg-white/20")}>
                <span className={cn("absolute left-0 top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-transform", connect ? "translate-x-[22px]" : "translate-x-[2px]")} />
              </button>
            </label>
          ) : (
            <div className="space-y-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-white/60">Company <span className="text-white/40">(optional)</span></span>
                <input value={company} onChange={(e) => setCompany(e.target.value)} maxLength={60} placeholder="e.g. Westside Self Storage"
                  className="h-11 w-full rounded-xl bg-white/[0.05] px-3 text-[15px] text-white outline-none ring-1 ring-white/10 placeholder:text-white/35 focus:ring-white/25" />
              </label>
              <p className="text-xs text-white/50">She runs the RoofGuard script for this company. Leave it blank to use the practice facility (Riverside Medical Center). Leads already on the call list are called by the queue, not from here.</p>
            </div>
          )}
          {err && <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</p>}
        </div>

        <button type="button" onClick={() => void call()} disabled={(!valid && !(clean === "" && last)) || busy} aria-label={clean === "" && last ? `Fill in the last number, ${fmt(last.phone)}` : "Call"}
          className="mx-auto mt-5 grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full bg-[#30D158] text-white shadow-lg transition active:scale-95 disabled:opacity-40">
          {busy ? <Loader2 className="h-7 w-7 animate-spin" /> : <Phone className="h-7 w-7 fill-current" />}
        </button>
        <p className="mt-2 text-center text-[11px] text-white/50">{clean === "" && last ? "Press Call to fill in the last number, then again to call." : "Only call people who'd expect it. Ava's number may show as unknown."}</p>
        </div>}
      </SheetContent>
    </Sheet>
  );
}

// ---------- in-call screen (same for personal Ava and RoofGuard) ----------
/** `id` is the call row (empty for a live call that has no row yet, such as an incoming one: then `conversationId` finds it). */
export type ActiveCall = { id: string; conversationId?: string | null; fn: "ava-assistant" | "roofguard-caller"; who: string; voice?: "ava" | "jared"; kind?: string;
  incoming?: boolean; forwarded?: boolean; redial?: CallParams };
type LiveState = { status: string; elapsed: number; duration: number | null; transcript: Line[] };
const DONE = new Set(["done", "failed"]);
const clock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;

/** One scroll surface: the orb and timer stay put, the transcript is the only thing that scrolls, the buttons stay at the bottom. */
function InCall({ call, onNew, onDone, onRedial, redialBusy, redialErr }: { call: ActiveCall; onNew?: () => void; onDone: () => void; onRedial?: () => void; redialBusy?: boolean; redialErr?: string | null }) {
  const [st, setSt] = useState<LiveState | null>(null);
  const [miss, setMiss] = useState(0);
  const [base, setBase] = useState({ at: Date.now(), elapsed: 0 });
  const [, force] = useState(0);
  const ended = !!st && DONE.has(st.status);

  // poll every 1.5 sec until the call ends, then once more for the final transcript
  useEffect(() => {
    let stop = false, timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const body = call.id ? { action: "live", call_id: call.id } : { action: "live", conversation_id: call.conversationId };
      const { data } = await supabase.functions.invoke(call.fn, { body });
      if (stop) return;
      const c = (data?.calls ?? [])[0] as LiveState | undefined;
      if (c) { setSt(c); setBase({ at: Date.now(), elapsed: c.elapsed }); setMiss(0); } else setMiss((m) => m + 1);
      if (!c || !DONE.has(c.status)) timer = setTimeout(tick, 1500);
    };
    void tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [call.id, call.conversationId, call.fn]);
  useEffect(() => { if (ended) return; const t = setInterval(() => force((n) => n + 1), 1000); return () => clearInterval(t); }, [ended]);

  const secs = ended ? (st?.duration ?? st?.elapsed ?? 0) : base.elapsed + Math.round((Date.now() - base.at) / 1000);
  const label = !st ? (miss > 20 ? "Can't reach the call right now" : call.incoming ? "Connecting…" : "Dialing…")
    : ended ? (st.status === "failed" ? "Call failed" : "Call ended")
    : st.status === "in-progress" || st.status === "processing" ? "On the call" : call.incoming ? "Answering" : "Ringing…";
  const who = call.fn === "roofguard-caller" ? "RoofGuard Ava" : "Ava";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetTitle className="sr-only">Call with {call.who}</SheetTitle>
      <SheetDescription className="sr-only">Live transcript of Ava's call</SheetDescription>
      <div className="shrink-0 text-center">
        <AvaOrb size={96} speaking={!ended} className="mx-auto mb-2" label={ended ? "Ava, call ended" : "Ava, on the call"} />
        <div className="flex items-center justify-center gap-2 text-[13px] text-white/50">
          {call.incoming ? <><PhoneIncoming className="h-3.5 w-3.5" aria-hidden />{who} answering{call.kind ? ` · ${call.kind}` : ""}</> : <>{who} calling{call.kind ? ` · ${call.kind}` : ""}</>}
        </div>
        <div className="mt-1 text-[26px] font-semibold text-white">{call.who}</div>
        {(call.voice === "jared" || call.forwarded) && <div className="mt-1 flex justify-center gap-2">{call.forwarded && <ForwardedTag />}{call.voice === "jared" && <YourVoiceTag />}</div>}
        <div className={cn("mt-1 inline-flex items-center gap-2 text-[15px]", ended ? "text-white/60" : "text-[#FFA270]")}>
          {!ended && <span className="h-2 w-2 rounded-full bg-[#FFA270] motion-safe:animate-pulse" aria-hidden />}
          <span>{label}</span><span className="font-mono tabular-nums text-white">{clock(secs)}</span>
        </div>
      </div>
      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        <LiveTranscript lines={st?.transcript ?? []} live={!ended} them={call.who} className="min-h-0 flex-1 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/10" />
      </div>
      {ended && call.id && <div className="mt-3 shrink-0"><Recording callId={call.id} fn={call.fn} /></div>}
      {redialErr && <p role="alert" className="mt-3 shrink-0 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-300">{redialErr}</p>}
      <div className="mt-3 grid shrink-0 gap-2">
        {ended && onRedial && (
          <button type="button" onClick={onRedial} disabled={redialBusy}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#FFA270] text-[15px] font-semibold text-[#1c1c1e] transition hover:bg-[#ffb48a] motion-safe:active:scale-[0.98] disabled:opacity-50">
            {redialBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}Call again</button>
        )}
        <div className={cn("grid gap-2", onNew ? "grid-cols-2" : "grid-cols-1")}>
          {onNew && <button type="button" onClick={onNew} className="min-h-[44px] rounded-xl bg-white/10 text-[15px] font-medium text-white hover:bg-white/15">New call</button>}
          <button type="button" onClick={onDone} className="min-h-[44px] rounded-xl bg-white text-[15px] font-semibold text-black">Done</button>
        </div>
      </div>
      {!ended && <p className="mt-2 shrink-0 text-center text-[11px] text-white/40">You can close this. The call keeps going and shows on the page.</p>}
    </div>
  );
}

/** The in-call screen on its own, for calls started somewhere other than the dialer (the voice picker's "Call me with this voice", the live pill). */
export function InCallSheet({ call, onClose }: { call: ActiveCall | null; onClose: () => void }) {
  return (
    <Sheet open={!!call} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className={frame}>
        {call && <div className={cn("flex min-h-0 flex-1 flex-col", pad)}><InCall key={call.id || call.conversationId || "live"} call={call} onDone={onClose} /></div>}
      </SheetContent>
    </Sheet>
  );
}

// ---------- the live pill: any live call (incoming, outgoing, forwarded), from anywhere on the page ----------
const ACCENT_BG = "rgba(255,162,112,0.14)";
const ACCENT_RING = "rgba(255,162,112,0.45)";

function LivePillItem({ c, onOpen }: { c: LiveItem; onOpen: (c: LiveItem) => void }) {
  const [base, setBase] = useState({ at: Date.now(), elapsed: c.elapsed });
  const [, force] = useState(0);
  useEffect(() => setBase({ at: Date.now(), elapsed: c.elapsed }), [c.elapsed]);
  useEffect(() => { const t = setInterval(() => force((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const secs = base.elapsed + Math.round((Date.now() - base.at) / 1000);
  const dir = c.direction === "inbound" ? "Incoming" : "Outgoing";
  return (
    <button type="button" onClick={() => onOpen(c)} aria-label={`${dir} live call with ${c.who}, ${clock(secs)}. Open the live transcript`}
      className="inline-flex min-h-[44px] max-w-full items-center gap-2 rounded-2xl px-3.5 text-[15px] ring-1 transition hover:brightness-110 motion-safe:active:scale-[0.98]"
      style={{ background: ACCENT_BG, boxShadow: `inset 0 0 0 1px ${ACCENT_RING}` }}>
      <span className="h-2 w-2 shrink-0 rounded-full bg-[#FFA270] motion-safe:animate-pulse" aria-hidden />
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-[#FFA270]">Live</span>
      <span className="min-w-0 max-w-[150px] truncate font-medium text-white">{c.who}</span>
      <span className="shrink-0 whitespace-nowrap font-mono text-[14px] tabular-nums text-white/80">{clock(secs)}</span>
    </button>
  );
}

/** Shows only while a call is live. Tap it to watch the transcript, wherever you are on the page. */
export function LivePill({ source }: { source: LiveSource }) {
  const { calls } = useLiveCalls(source);
  const [open, setOpen] = useState<ActiveCall | null>(null);
  if (!calls.length && !open) return null;
  const fn = source === "ava" ? "ava-assistant" : "roofguard-caller";
  const openCall = (c: LiveItem) => setOpen({ id: c.call_id ?? "", conversationId: c.conversation_id, fn, who: c.who, voice: c.voice, incoming: c.direction === "inbound", forwarded: c.forwarded,
    kind: c.forwarded ? "forwarded from your cell" : c.direction === "callback" ? "call back" : undefined });
  return (
    <>
      {calls.slice(0, 2).map((c) => <LivePillItem key={c.key} c={c} onOpen={openCall} />)}
      <InCallSheet call={open} onClose={() => setOpen(null)} />
    </>
  );
}
