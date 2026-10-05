/**
 * "Your cell" card on /admin/ava: Ava answers the calls Jared doesn't pick up on his own phone.
 * Verizon forwards missed calls to her line (dial *71 816 429 9495); the ava-assistant init hook notices and answers as his assistant,
 * in his cloned voice when he wants. Settings live on ava_settings (forward_enabled, forward_voice); the debug log is ava_init_debug.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { AVA_GLOW } from "./AvaOrb";
import { ForwardedTag, agoText, fmtPhone, whenShort } from "./AvaShared";
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, Mic, PhoneForwarded, Settings, Smartphone } from "lucide-react";
import { CollapsibleSection } from "./CollapsibleSection";

type Err = { message: string } | null;
type CellSettings = { forward_enabled: boolean; forward_enabled_at: string | null; forward_voice: "jared" | "ava"; jared_voice_id: string | null;
  jared_voice_paused_at: string | null; jared_voice_paused_why: string | null; jared_cell: string | null };
type DebugRow = { id: number; at: string; kind: "init" | "post"; keys: unknown; fields: Record<string, string> | null; forwarded: boolean; note: string | null };

// loose access: these columns and tables are newer than the generated types
const from = (t: string) => supabase.from(t as never) as unknown as {
  select: (c: string) => {
    eq: (c: string, v: unknown) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => PromiseLike<{ data: unknown[] | null; error: Err }> } };
    order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => PromiseLike<{ data: unknown[] | null; error: Err }> };
  };
  update: (p: object) => { eq: (c: string, v: unknown) => PromiseLike<{ error: Err }> };
};

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60";

/** On/off switch in the Ava apricot (the green switch elsewhere means "on" for facts; this one is the assistant's own colour). */
export function CellSwitch({ on, busy, onChange, labelledBy }: { on: boolean; busy: boolean; onChange: (v: boolean) => void; labelledBy: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-labelledby={labelledBy} disabled={busy} onClick={() => onChange(!on)}
      className={cn("grid min-h-[44px] min-w-[56px] shrink-0 place-items-center rounded-xl disabled:opacity-60", ring)}>
      <span className="relative block h-[31px] w-[51px] rounded-full transition-colors motion-reduce:transition-none" style={{ background: on ? AVA_GLOW : "rgba(255,255,255,0.2)" }}>
        <span className={cn("absolute left-0 top-[2px] grid h-[27px] w-[27px] place-items-center rounded-full bg-white shadow transition-transform motion-reduce:transition-none", on ? "translate-x-[22px]" : "translate-x-[2px]")}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#1c1c1e]" aria-hidden />}
        </span>
      </span>
    </button>
  );
}

const CELL_EVENT = "ava-cell-changed";

/** Forwarding settings, shared by the Your cell section and the Settings sheet (a save in one refreshes the other). */
function useCellSettings() {
  const [s, setS] = useState<CellSettings | null>(null);
  const [last, setLast] = useState<string | null | undefined>(undefined);
  const [debug, setDebug] = useState<DebugRow[]>([]);
  const [busy, setBusy] = useState<null | "on" | "voice">(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [st, lc, dbg] = await Promise.all([
      from("ava_settings").select("forward_enabled, forward_enabled_at, forward_voice, jared_voice_id, jared_voice_paused_at, jared_voice_paused_why, jared_cell")
        .order("updated_at", { ascending: false }).limit(1),
      from("ava_calls").select("created_at").eq("forwarded", true).order("created_at", { ascending: false }).limit(1),
      from("ava_init_debug").select("id, at, kind, fields, keys, forwarded, note").order("id", { ascending: false }).limit(6),
    ]);
    if (st.error) { setErr(st.error.message); return; }
    setErr(null);
    setS(((st.data ?? [])[0] ?? null) as CellSettings | null);
    setLast(((lc.data ?? [])[0] as { created_at: string } | undefined)?.created_at ?? null);
    setDebug((dbg.data ?? []) as DebugRow[]);
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 30000);
    const h = () => void load();
    window.addEventListener(CELL_EVENT, h);
    return () => { clearInterval(t); window.removeEventListener(CELL_EVENT, h); };
  }, [load]);

  const save = async (patch: Partial<CellSettings>, which: "on" | "voice") => {
    if (!s) return;
    const before = s;
    setBusy(which); setErr(null); setS({ ...s, ...patch });
    const { error } = await from("ava_settings").update(patch).eq("id", true);
    setBusy(null);
    if (error) { setS(before); setErr(`Couldn't save that. ${error.message}`); return; }
    window.dispatchEvent(new Event(CELL_EVENT));
    void load();
  };
  const cloneReady = !!s?.jared_voice_id;
  const paused = !!s?.jared_voice_paused_at;
  const voice: "jared" | "ava" = s?.forward_voice === "jared" && cloneReady ? "jared" : s?.forward_voice === "ava" ? "ava" : cloneReady ? "jared" : "ava";
  return { s, last, debug, busy, err, save, cloneReady, paused, voice, on: !!s?.forward_enabled };
}

/** The forwarding switch and the voice on those calls. Lives in Settings; the Your cell section shows the state and the setup steps. */
export function CellForwardingControls() {
  const { s, busy, err, save, cloneReady, paused, voice, on } = useCellSettings();
  if (!s) return err ? <p role="alert" className="text-sm text-red-300">{err}</p> : <Loader2 className="mx-auto h-5 w-5 animate-spin text-white/50" aria-label="Loading" />;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p id="ava-cell-switch" className="text-[15px] font-medium text-white">Ava answers my missed calls</p>
          <p className="mt-0.5 text-xs text-white/60">When you don't pick up, the call goes to Ava. She says she's your assistant, on a recorded line, and takes a message. Set up forwarding on your iPhone in the Your cell section first.</p>
        </div>
        <CellSwitch on={on} busy={busy === "on"} labelledBy="ava-cell-switch" onChange={(v) => void save({ forward_enabled: v }, "on")} />
      </div>
      <div>
        <p id="ava-cell-voice" className="mb-1.5 text-[13px] font-medium text-white">Voice on those calls</p>
        <div role="radiogroup" aria-labelledby="ava-cell-voice" className="grid grid-cols-2 gap-1 rounded-xl bg-white/[0.06] p-1 ring-1 ring-white/10">
          {([["jared", "Your voice", Mic], ["ava", "Ava's voice", null]] as const).map(([id, label, Icon]) => {
            const disabled = id === "jared" && !cloneReady;
            const checked = voice === id;
            return (
              <button key={id} type="button" role="radio" aria-checked={checked} aria-disabled={disabled || undefined} disabled={disabled || busy === "voice"}
                onClick={() => { if (!checked) void save({ forward_voice: id }, "voice"); }}
                className={cn("inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed motion-reduce:transition-none", ring,
                  checked ? "text-[#1c1c1e] shadow-sm" : "text-white/70 hover:text-white disabled:text-white/35 disabled:hover:text-white/35")}
                style={checked ? { background: AVA_GLOW } : undefined}>
                {Icon && <Icon className="h-4 w-4" aria-hidden />}{label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs text-white/60">
          {!cloneReady ? "Your voice turns on once you've recorded it, in the Voice section (My voice)."
            : voice === "jared" ? "She sounds like you but always says she's your assistant, on a recorded line. She never says she's you."
            : "She answers in her own voice."}
        </p>
        {cloneReady && paused && voice === "jared" && (
          <p role="alert" className="mt-2 flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-200 ring-1 ring-amber-500/30">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Your voice is switched off after a guard alert, so forwarded calls use Ava's voice for now. Turn it back on in the Voice section (My voice).</span>
          </p>
        )}
      </div>
      {err && <p role="alert" className="text-sm text-red-300">{err}</p>}
    </div>
  );
}

export function AvaCell({ className, onOpenSettings }: { className?: string; onOpenSettings?: () => void }) {
  const { s, last, debug, err, on } = useCellSettings();
  const [showDebug, setShowDebug] = useState(false);
  const cell = fmtPhone(s?.jared_cell ?? "+18165007236");
  const summary = (
    <>
      <span className="whitespace-nowrap tabular-nums">{cell}</span>{" · "}
      <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", on ? "text-emerald-300" : "text-white/60")}>
        {on ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <PhoneForwarded className="h-3 w-3" aria-hidden />}{on ? "Forwarding on" : "Forwarding off"}</span>
    </>
  );

  return (
    <CollapsibleSection id="ava-cell" title="Your cell" icon={<Smartphone className="h-4 w-4" style={{ color: AVA_GLOW }} />} summary={summary} badge={on ? <ForwardedTag /> : undefined} className={className}>
      <div className="space-y-4 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-white/75">
          <span className="min-w-0 flex-1">{on ? "Ava answers the calls you miss on your cell." : "Ava is not answering your missed calls yet."} The switch and her voice on those calls are in Settings.</span>
          {onOpenSettings && <button type="button" onClick={onOpenSettings} className={cn("inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-white/10 px-3.5 text-sm font-medium text-white hover:bg-white/15", ring)}><Settings className="h-4 w-4" aria-hidden />Open Settings</button>}
        </div>

        {/* setup steps */}
        <div className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-white/55">Set it up on your iPhone</h4>
          <ol className="mt-2 space-y-2 text-[15px] text-white/85">
            <li className="flex gap-3"><span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-semibold tabular-nums text-white" aria-hidden>1</span>
              <span>Open Phone and dial <span className="whitespace-nowrap rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[14px] tabular-nums text-white">*71 816 429 9495</span>, then tap Call.</span></li>
            <li className="flex gap-3"><span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-semibold tabular-nums text-white" aria-hidden>2</span>
              <span>Wait for the confirmation tone or message, then hang up.</span></li>
            <li className="flex gap-3"><span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-semibold tabular-nums text-white" aria-hidden>3</span>
              <span>Turn on "Ava answers my missed calls" in Settings.</span></li>
          </ol>
          <p className="mt-3 text-xs text-white/60">To turn forwarding off, dial <span className="whitespace-nowrap font-mono tabular-nums text-white/80">*73</span> and tap Call. Calls you answer yourself never come to Ava.</p>
        </div>

        {/* last forwarded call */}
        <div className="flex items-center gap-2 text-sm">
          <PhoneForwarded className="h-4 w-4 shrink-0 text-sky-300" aria-hidden />
          <span className="text-white/60">Last forwarded call</span>
          <span className="ml-auto text-right tabular-nums text-white">
            {last === undefined ? "…" : last ? <>{whenShort(last)}<span className="text-white/50">{" · "}{agoText(last)}</span></> : "None yet"}
          </span>
        </div>
        {on && last === null && s?.forward_enabled_at && (
          <p className="text-xs text-white/55">Turned on {agoText(s.forward_enabled_at)}. If you dialed the code and nobody has been marked Forwarded after a couple of missed calls, open the log below.</p>
        )}

        {err && <p role="alert" className="text-sm text-red-300">{err}</p>}

        {/* what the phone company sends, for finding out why a call wasn't marked forwarded */}
        <div className="border-t border-white/5 pt-2">
          <button type="button" onClick={() => setShowDebug((v) => !v)} aria-expanded={showDebug}
            className={cn("flex min-h-[44px] w-full items-center gap-2 rounded-lg text-left text-sm text-white/65 hover:text-white", ring)}>
            <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none", showDebug && "rotate-180")} aria-hidden />
            Last calls as the phone company sent them
            <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-xs tabular-nums text-white/70">{debug.length}</span>
          </button>
          {showDebug && (
            debug.length === 0 ? <p className="px-1 pb-2 text-xs text-white/55">Nothing yet. Each call to Ava's line saves what arrived with it, so the first forwarded call shows where the forwarding details are.</p> : (
              <ul className="space-y-2 pb-1">
                {debug.map((d) => {
                  const paths = Object.entries(d.fields ?? {});
                  return (
                    <li key={d.id} className="rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/10">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-white/70">{d.kind === "init" ? "call started" : "call ended"}</span>
                        {d.forwarded ? <ForwardedTag /> : <span className="text-white/55">Not marked forwarded</span>}
                        <span className="ml-auto whitespace-nowrap tabular-nums text-white/55">{whenShort(d.at)}</span>
                      </div>
                      {d.note && <p className="mt-1 break-words text-xs text-white/60">{d.note}</p>}
                      <dl className="mt-2 max-h-40 space-y-0.5 overflow-y-auto overscroll-contain font-mono text-[11px] leading-snug">
                        {paths.length === 0 && <dd className="text-white/50">No fields.</dd>}
                        {paths.map(([k, v]) => <div key={k} className="flex gap-2"><dt className="shrink-0 text-white/50">{k}</dt><dd className="min-w-0 break-all text-white/80">{v}</dd></div>)}
                      </dl>
                    </li>
                  );
                })}
              </ul>
            )
          )}
        </div>
      </div>
    </CollapsibleSection>
  );
}
