/**
 * Top of /admin/roofguard: Ava's own number (copyable), what she has cost so far (rg_costs, top-right), and the Dial
 * button that opens an iPhone-style keypad. Two kinds of call:
 *   Personal       Ava as "Jared's AI assistant" with a reason you type (edge fn {action:"personal_call"}, admin only)
 *   RoofGuard demo the cold-call script against the fictional Riverside Medical Center ({action:"demo_call"})
 * Either way the call shows up live on the Calls tab within seconds.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, Copy, Delete, Grid3x3, Loader2, Phone } from "lucide-react";
import { LiveTranscript, Recording, type Line } from "./AvaCalls";
import { AvaOrb } from "./AvaOrb";
import { LineStatus, SpendChip } from "./AvaShared";

type Costs = { total: number; today: number; month: number; calls_total: number; voice: number; phone: number; ai: number; number: number;
  minutes: number; calls: number; per_meeting: number | null; rates: { voice_per_min: number; phone_per_min: number; number_monthly: number } };

const usd = (n: number | null | undefined) => n == null ? "–" : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const fmt = (d: string) => {
  const x = d.replace(/\D/g, "").replace(/^1(?=\d{10})/, "").slice(0, 10);
  if (x.length <= 3) return x;
  if (x.length <= 6) return `(${x.slice(0, 3)}) ${x.slice(3)}`;
  return `(${x.slice(0, 3)}) ${x.slice(3, 6)}-${x.slice(6)}`;
};

export function AvaTopBar({ onCalled }: { onCalled: () => void }) {
  // RoofGuard Ava only: her own number and demo calls. Personal calls live on /admin/ava.
  const [num, setNum] = useState<string | null>(null);
  const [costs, setCosts] = useState<Costs | null>(null);
  const [copied, setCopied] = useState(false);
  const [dialOpen, setDialOpen] = useState(false);

  const load = useCallback(async () => {
    const rpc = supabase.rpc as unknown as (f: string) => Promise<{ data: unknown }>;
    const [st, c] = await Promise.all([rpc("rg_call_stats"), rpc("rg_costs")]);
    setNum(((st.data as { settings?: { from_number?: string } } | null)?.settings?.from_number) ?? null);
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
        {!num && (
          <span className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-amber-500/10 px-3.5 text-sm text-amber-200 ring-1 ring-amber-500/30">
            <Phone className="h-4 w-4" aria-hidden />RoofGuard needs its own number before calling
          </span>
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
          className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-emerald-500 px-4 text-[15px] font-semibold text-[#052E1F] transition hover:bg-emerald-400 active:scale-[0.98]">
          <Grid3x3 className="h-4 w-4" aria-hidden />Demo call
        </button>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        <SpendChip source="roofguard" />
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
    </>
  );
}

const KEYS: [string, string][] = [["1", ""], ["2", "ABC"], ["3", "DEF"], ["4", "GHI"], ["5", "JKL"], ["6", "MNO"], ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"], ["", ""], ["0", "+"], ["del", ""]];

export function DialerSheet({ open, onOpenChange, onCalled, kinds = ["personal", "demo"] }: { open: boolean; onOpenChange: (o: boolean) => void; onCalled: () => void; kinds?: ("personal" | "demo")[] }) {
  const [digits, setDigits] = useState("");
  const [mode, setMode] = useState<"personal" | "demo">(kinds[0]);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [connect, setConnect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const clean = digits.replace(/\D/g, "").replace(/^1(?=\d{10})/, "");
  const valid = clean.length === 10;

  useEffect(() => { if (!open) { setErr(null); setBusy(false); } }, [open]);
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

  const call = async () => {
    setBusy(true); setErr(null);
    // personal calls belong to personal Ava (ava-assistant); demos to RoofGuard Ava (roofguard-caller)
    const fn = mode === "personal" ? "ava-assistant" : "roofguard-caller";
    const { data, error } = mode === "personal"
      ? await supabase.functions.invoke(fn, { body: { action: "call", phone: clean, name, purpose, connect } })
      : await supabase.functions.invoke(fn, { body: { action: "demo_call", phone: clean, name } });
    setBusy(false);
    if (error || !data?.ok) {
      let msg = data?.error as string | undefined;
      if (!msg && error && "context" in error) msg = await (error as { context: Response }).context.json().then((j) => j.error).catch(() => undefined);
      setErr(msg ?? "The call didn't go out. Try again in a minute."); return;
    }
    if (data.call_id) setActive({ id: data.call_id, fn, who: name.trim() || fmt(clean) });
    setDigits(""); setName(""); setPurpose(""); setConnect(false);
    onCalled();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="admin-shell flex w-full flex-col overflow-y-auto border-white/10 bg-[#0b0b0d] text-white sm:max-w-md">
        {active ? <InCall call={active} onNew={() => setActive(null)} onDone={() => onOpenChange(false)} /> : <>
        <SheetTitle className="text-white">Dial with Ava</SheetTitle>
        <SheetDescription className="text-white/55">Type or paste a number. Ava calls from her own line and the live transcript shows right here.</SheetDescription>

        {kinds.length > 1 && <div role="tablist" aria-label="Kind of call" className="mt-4 grid grid-cols-2 rounded-xl bg-white/[0.06] p-1 ring-1 ring-white/10">
          {([["personal", "Personal"], ["demo", "RoofGuard demo"]] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => setMode(id)}
              className={cn("min-h-[36px] rounded-lg text-sm font-medium transition-colors", mode === id ? "bg-white text-black shadow-sm" : "text-white/65 hover:text-white")}>{label}</button>
          ))}
        </div>}

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
              <span className="mt-1 block text-[11px] text-white/40">She introduces herself as "Ava, Jared's AI assistant, on a recorded line" and says she's an AI if asked.</span>
            </label>
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
            <p className="text-xs text-white/50">She runs the real cold-call script, with whoever answers playing the facilities director at Riverside Medical Center (made up). It never calls a real prospect.</p>
          )}
          {err && <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</p>}
        </div>

        <button type="button" onClick={() => void call()} disabled={!valid || busy} aria-label="Call"
          className="mx-auto mt-5 grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full bg-[#30D158] text-white shadow-lg transition active:scale-95 disabled:opacity-40">
          {busy ? <Loader2 className="h-7 w-7 animate-spin" /> : <Phone className="h-7 w-7 fill-current" />}
        </button>
        <p className="mt-2 text-center text-[11px] text-white/40">Only call people who'd expect it. Ava's number may show as unknown.</p>
        </>}
      </SheetContent>
    </Sheet>
  );
}

// ---------- in-call screen (same for personal Ava and RoofGuard) ----------
type ActiveCall = { id: string; fn: "ava-assistant" | "roofguard-caller"; who: string };
type LiveState = { status: string; elapsed: number; duration: number | null; transcript: Line[] };
const DONE = new Set(["done", "failed"]);
const clock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;

function InCall({ call, onNew, onDone }: { call: ActiveCall; onNew: () => void; onDone: () => void }) {
  const [st, setSt] = useState<LiveState | null>(null);
  const [miss, setMiss] = useState(0);
  const [base, setBase] = useState({ at: Date.now(), elapsed: 0 });
  const [, force] = useState(0);
  const ended = !!st && DONE.has(st.status);

  // poll every 1.5 sec until the call ends, then once more for the final transcript
  useEffect(() => {
    let stop = false, timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const { data } = await supabase.functions.invoke(call.fn, { body: { action: "live", call_id: call.id } });
      if (stop) return;
      const c = (data?.calls ?? [])[0] as LiveState | undefined;
      if (c) { setSt(c); setBase({ at: Date.now(), elapsed: c.elapsed }); setMiss(0); } else setMiss((m) => m + 1);
      if (!c || !DONE.has(c.status)) timer = setTimeout(tick, 1500);
    };
    void tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [call]);
  useEffect(() => { if (ended) return; const t = setInterval(() => force((n) => n + 1), 1000); return () => clearInterval(t); }, [ended]);

  const secs = ended ? (st?.duration ?? st?.elapsed ?? 0) : base.elapsed + Math.round((Date.now() - base.at) / 1000);
  const label = !st ? (miss > 20 ? "Can't reach the call right now" : "Dialing…")
    : ended ? (st.status === "failed" ? "Call failed" : "Call ended")
    : st.status === "in-progress" || st.status === "processing" ? "On the call" : "Ringing…";

  return (
    <div className="flex min-h-full flex-col">
      <SheetTitle className="sr-only">Call with {call.who}</SheetTitle>
      <SheetDescription className="sr-only">Live transcript of Ava's call</SheetDescription>
      <div className="pt-6 text-center">
        <AvaOrb size={112} speaking={!ended} className="mx-auto mb-2" label={ended ? "Ava, call ended" : "Ava, on the call"} />
        <div className="text-[13px] text-white/50">{call.fn === "roofguard-caller" ? "RoofGuard Ava" : "Ava"} calling</div>
        <div className="mt-1 text-[26px] font-semibold text-white">{call.who}</div>
        <div className={cn("mt-1 inline-flex items-center gap-2 text-[15px]", ended ? "text-white/60" : "text-emerald-300")}>
          {!ended && <span className="h-2 w-2 rounded-full bg-emerald-400 motion-safe:animate-pulse" aria-hidden />}
          <span>{label}</span><span className="font-mono tabular-nums text-white">{clock(secs)}</span>
        </div>
      </div>
      <div className="mt-5 flex-1">
        <LiveTranscript lines={st?.transcript ?? []} live={!ended} them={call.who} className="max-h-[52vh] rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/10" />
      </div>
      {ended && <div className="mt-4"><Recording callId={call.id} fn={call.fn} /></div>}
      <div className="mt-4 grid grid-cols-2 gap-2 pb-2">
        <button type="button" onClick={onNew} className="min-h-[44px] rounded-xl bg-white/10 text-[15px] font-medium text-white hover:bg-white/15">New call</button>
        <button type="button" onClick={onDone} className="min-h-[44px] rounded-xl bg-white text-[15px] font-semibold text-black">Done</button>
      </div>
      {!ended && <p className="text-center text-[11px] text-white/40">You can close this. The call keeps going and shows on the page.</p>}
    </div>
  );
}
