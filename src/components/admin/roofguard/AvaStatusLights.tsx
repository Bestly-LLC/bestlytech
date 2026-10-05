/**
 * Status lights: one pill in each Ava page's top bar (next to the LivePill) that says whether everything running Ava is fine.
 *   The pill is a row of small dots, one per thing (phone line, voice agent, background jobs, coach, spend, and on the personal page
 *   calendars, cell forwarding and the morning brief; on RoofGuard, calling), plus a short word: "All good", "1 needs a look", "2 down".
 *   Tap it for the list: dot + icon + name + status word, a one-line detail, when it was checked, and a link to where you fix it.
 * Data: one admin SQL call, ava_status_lights(source), polled every 60 seconds. No edge functions.
 * Color is never the only signal: every light has an icon and a word in the list, and the pill has an aria-label that spells it out.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Loader2, MinusCircle, PauseCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { rpcArgs, type Source } from "./AvaShared";
import { openCoach } from "./coachBus";
import { openSection } from "./CollapsibleSection";

export type LightState = "ok" | "warn" | "down" | "off";
export type Light = { key: string; label: string; state: LightState; word?: string; detail: string; checked_at: string; items?: { name: string; state: LightState; detail: string }[] };

const NB = "\u00A0";
/** Fire this (window event) to refresh the lights right away, e.g. after Re-run setup finishes. */
export const LIGHTS_REFRESH = "ava:lights-refresh";
const TONE: Record<LightState, { dot: string; text: string; word: string; Icon: typeof CheckCircle2 }> = {
  ok: { dot: "bg-emerald-400", text: "text-emerald-300", word: "Good", Icon: CheckCircle2 },
  warn: { dot: "bg-amber-300", text: "text-amber-200", word: "Needs a look", Icon: AlertTriangle },
  down: { dot: "bg-red-400", text: "text-red-300", word: "Down", Icon: XCircle },
  off: { dot: "bg-white/35", text: "text-white/60", word: "Off", Icon: MinusCircle },
};
const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60";

/** 1:33 PM, local time, with a no-break space so "PM" never lands alone on a line. */
const clock = (iso: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)).replace(/\s(AM|PM)$/i, `${NB}$1`);
const checkedText = (iso: string) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const same = new Date(t).toDateString() === new Date().toDateString();
  return same ? `Checked ${clock(iso)}` : `Checked ${new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" }).replace(" ", NB)}, ${clock(iso)}`;
};
const wordOf = (l: Light) => l.word ?? TONE[l.state].word;

export function summarize(lights: Light[]) {
  const down = lights.filter((l) => l.state === "down").length;
  const warn = lights.filter((l) => l.state === "warn").length;
  const off = lights.filter((l) => l.state === "off").length;
  const notSetUp = lights.some((l) => l.key === "agent" && l.state === "off");
  let word = "All good", tone: LightState = "ok";
  if (down > 0) { word = `${down}${NB}down`; tone = "down"; }
  else if (warn > 0) { word = `${warn}${NB}${warn === 1 ? "needs a look" : "need a look"}`; tone = "warn"; }
  else if (notSetUp) { word = "Not set up"; tone = "off"; }
  return { down, warn, off, ok: lights.length - down - warn - off, word, tone };
}

/** The lights, polled once a minute. `undefined` until the first answer, `null` when the call failed and there is nothing to show. */
export function useAvaLights(source: Source) {
  const [lights, setLights] = useState<Light[] | null | undefined>(undefined);
  const load = useCallback(async () => {
    const { data, error } = await rpcArgs<Light[]>("ava_status_lights", { p_source: source });
    if (Array.isArray(data)) setLights(data);
    else if (error) setLights((cur) => (cur === undefined ? null : cur));   // a failed refresh keeps the last good list
  }, [source]);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 60000);
    const h = () => void load();
    window.addEventListener(LIGHTS_REFRESH, h);
    return () => { clearInterval(t); window.removeEventListener(LIGHTS_REFRESH, h); };
  }, [load]);
  return { lights, reload: load };
}

type Props = { source: Source; onOpenSettings: () => void; onOpenSetup?: () => void; className?: string };

/** Where each light's fix lives. Lights without a place to go (the line, the jobs) get no link. */
function actionFor(l: Light, source: Source, p: Pick<Props, "onOpenSettings" | "onOpenSetup">): { label: string; run: () => void } | null {
  switch (l.key) {
    case "agent": return { label: l.state === "off" ? "Set up" : "Settings", run: p.onOpenSettings };
    case "spend": return { label: "Settings", run: p.onOpenSettings };
    case "brief": return { label: "Settings", run: p.onOpenSettings };
    case "coach": return { label: "Coach", run: () => openCoach(source) };
    case "calendars": return { label: "Calendars", run: () => openSection("ava-calendars") };
    case "cell": return { label: "Your cell", run: () => openSection("ava-cell") };
    case "calling": return p.onOpenSetup ? { label: "Setup", run: p.onOpenSetup } : null;
    default: return null;
  }
}

function Dot({ state, className }: { state: LightState; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/40", TONE[state].dot, state === "down" && "motion-safe:animate-pulse", className)} />;
}

function LightRow({ l, act, onGo }: { l: Light; act: { label: string; run: () => void } | null; onGo: (run: () => void) => void }) {
  const t = TONE[l.state];
  const Icon = l.word === "Paused" ? PauseCircle : t.Icon;
  return (
    <li className="flex gap-3 py-3">
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center"><Dot state={l.state} className="h-3 w-3" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[15px] font-semibold text-white">{l.label}</span>
          <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium", t.text)}><Icon className="h-3.5 w-3.5" aria-hidden />{wordOf(l)}</span>
        </div>
        <p className="mt-0.5 text-[13px] leading-snug text-white/70 [overflow-wrap:anywhere]">{l.detail}</p>
        {l.items && l.items.length > 0 && (
          <ul className="mt-1.5 space-y-1">
            {l.items.map((it) => {
              const IT = TONE[it.state];
              return <li key={it.name} className={cn("flex items-start gap-1.5 text-xs leading-snug [overflow-wrap:anywhere]", IT.text)}><IT.Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{it.detail}</li>;
            })}
          </ul>
        )}
        <p className="mt-1 text-[11px] tabular-nums text-white/50">{checkedText(l.checked_at)}</p>
      </div>
      {act && (
        <button type="button" onClick={() => onGo(act.run)} aria-label={`${act.label}, for ${l.label}`}
          className={cn("-mr-2 inline-flex min-h-[44px] shrink-0 items-center gap-0.5 self-start rounded-xl px-2.5 text-[13px] font-medium text-[#FFA270] hover:bg-white/[0.06]", ring)}>
          {act.label}<ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      )}
    </li>
  );
}

function LightsList({ lights, source, p, onGo }: { lights: Light[]; source: Source; p: Pick<Props, "onOpenSettings" | "onOpenSetup">; onGo: (run: () => void) => void }) {
  return (
    <ul className="divide-y divide-white/10">
      {lights.map((l) => <LightRow key={l.key} l={l} act={actionFor(l, source, p)} onGo={onGo} />)}
    </ul>
  );
}

export function AvaStatusLights({ source, onOpenSettings, onOpenSetup, className }: Props) {
  const { lights, reload } = useAvaLights(source);
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const sum = useMemo(() => (lights ? summarize(lights) : null), [lights]);
  const who = source === "ava" ? "Ava" : "RoofGuard Ava";

  const go = (run: () => void) => { setOpen(false); setTimeout(run, mobile ? 250 : 60); };
  const pillCls = cn("inline-flex min-h-[44px] items-center gap-2.5 rounded-2xl px-3.5 ring-1 transition-colors motion-reduce:transition-none", ring,
    sum?.tone === "down" ? "bg-red-500/10 ring-red-500/35 hover:bg-red-500/15" : sum?.tone === "warn" ? "bg-amber-500/10 ring-amber-500/30 hover:bg-amber-500/15"
      : "bg-white/[0.04] ring-white/10 hover:bg-white/[0.07]", className);

  if (lights === undefined) {
    return <span role="status" aria-label={`${who} status, checking`} className={cn(pillCls, "text-sm text-white/55")}><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Checking…</span>;
  }
  if (lights === null || !sum) {
    return (
      <button type="button" onClick={() => void reload()} aria-label={`${who} status could not load. Try again`} className={cn(pillCls, "text-sm text-white/70")}>
        <AlertTriangle className="h-4 w-4 text-amber-300" aria-hidden />Status unavailable<span className="text-white/45">· Retry</span>
      </button>
    );
  }

  const label = `${who} status: ${sum.word.replace(NB, " ")}. ${lights.length} checks, ${sum.ok} good${sum.warn ? `, ${sum.warn} needing a look` : ""}${sum.down ? `, ${sum.down} down` : ""}${sum.off ? `, ${sum.off} off` : ""}. Tap for details.`;
  const trigger = (
    <button type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} className={pillCls} onClick={mobile ? () => setOpen(true) : undefined}>
      <span className="flex items-center gap-1" aria-hidden>{lights.map((l) => <Dot key={l.key} state={l.state} />)}</span>
      <span className={cn("whitespace-nowrap text-[15px] font-semibold", sum.tone === "down" ? "text-red-200" : sum.tone === "warn" ? "text-amber-100" : sum.tone === "off" ? "text-white/70" : "text-white")}>{sum.word}</span>
    </button>
  );
  const p = { onOpenSettings, onOpenSetup };
  const heading = <><span className="text-[15px] font-semibold text-white">{who} status</span><span className="ml-2 text-xs text-white/55">Refreshes every minute</span></>;

  if (mobile) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="admin-shell max-h-[85dvh] overflow-y-auto rounded-t-3xl border-white/10 bg-[#0b0b0d] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 text-white">
            <SheetTitle className="text-left text-lg font-semibold text-white">{who} status</SheetTitle>
            <SheetDescription className="text-left text-xs text-white/55">Everything that keeps her running. It refreshes every minute.</SheetDescription>
            <div className="mt-2"><LightsList lights={lights} source={source} p={p} onGo={go} /></div>
          </SheetContent>
        </Sheet>
      </>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="admin-shell max-h-[min(80dvh,640px)] w-[400px] max-w-[calc(100vw-2rem)] overflow-y-auto border-white/10 bg-[#111114] p-4 text-white">
        <div className="mb-1 flex items-baseline">{heading}</div>
        <LightsList lights={lights} source={source} p={p} onGo={go} />
      </PopoverContent>
    </Popover>
  );
}
