/**
 * Status lights for a template agent: one pill in the top bar (same look as AvaStatusLights) that says whether everything running
 * the agent is fine. Four lights: Line (Switchboard's last check), Calls in (webhook attached, last sync), Coach, Spend.
 * Tap it for the list. Color is never the only signal: every light has an icon and a word, and the pill has an aria-label that spells it out.
 * Computed in the browser from data the page already loads (admin_agent, admin_agent_spend, admin_agent_coach), so it costs no extra calls.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, MinusCircle, PauseCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { agoText } from "@/components/admin/roofguard/AvaShared";
import { summarize, type Light, type LightState } from "@/components/admin/roofguard/AvaStatusLights";
import { money, ring, type AgentInfo, type AgentSpend } from "./agentApi";
import type { CoachData } from "./AgentCoach";

const NB = " ";
const TONE: Record<LightState, { dot: string; text: string; word: string; Icon: typeof CheckCircle2 }> = {
  ok: { dot: "bg-emerald-400", text: "text-emerald-300", word: "Good", Icon: CheckCircle2 },
  warn: { dot: "bg-amber-300", text: "text-amber-200", word: "Needs a look", Icon: AlertTriangle },
  down: { dot: "bg-red-400", text: "text-red-300", word: "Down", Icon: XCircle },
  off: { dot: "bg-white/35", text: "text-white/60", word: "Off", Icon: MinusCircle },
};
const STALE_MS = 35 * 60000;      // Switchboard runs every 10 minutes

export function agentLights(a: AgentInfo, spend: AgentSpend | null, coach: CoachData | null): Light[] {
  const now = new Date().toISOString();
  const h = a.health;
  const stale = (iso: string | null | undefined) => !iso || Date.now() - Date.parse(iso) > STALE_MS;

  let line: Light;
  if (a.status === "paused") line = { key: "line", label: "Line", state: "off", word: "Paused", detail: `${a.name} is paused here, so Switchboard and the Coach skip this agent. Calls still ring through until you change the agent on the voice platform.`, checked_at: h?.checked_at ?? now };
  else if (a.status === "draft") line = { key: "line", label: "Line", state: "off", word: "Draft", detail: `${a.name} is a draft and has no live line yet.`, checked_at: h?.checked_at ?? now };
  else if (!h) line = { key: "line", label: "Line", state: "off", word: "Not checked", detail: "Switchboard has not checked this line yet. It runs every 10 minutes.", checked_at: now };
  else if (!h.ok) line = { key: "line", label: "Line", state: "down", detail: (h.problems ?? []).join(" ") || "Switchboard found a problem and is fixing it.", checked_at: h.checked_at };
  else if (stale(h.checked_at)) line = { key: "line", label: "Line", state: "warn", word: "Check overdue", detail: `Switchboard last checked ${agoText(h.checked_at)}. It should run every 10 minutes.`, checked_at: h.checked_at };
  else line = { key: "line", label: "Line", state: "ok", word: "Answering", detail: h.healed ? `Fixed something on the last check: ${(h.problems ?? []).join(" ")}` : `Voice agent, phone number and tools are all in place. Checked ${agoText(h.checked_at)}.`, checked_at: h.checked_at };

  let calls: Light;
  if (!a.webhook) calls = { key: "calls", label: "Calls in", state: "down", detail: "The post-call webhook is not set up, so finished calls only arrive when Switchboard syncs. Open Settings and run setup again.", checked_at: now };
  else if (!h?.last_sync_at) calls = { key: "calls", label: "Calls in", state: "warn", word: "Not synced", detail: "Calls arrive as they end. The first sync has not run yet.", checked_at: now };
  else if (stale(h.last_sync_at)) calls = { key: "calls", label: "Calls in", state: "warn", word: "Sync overdue", detail: `Last sync ${agoText(h.last_sync_at)}. New calls still arrive the moment they end.`, checked_at: h.last_sync_at };
  else calls = { key: "calls", label: "Calls in", state: "ok", word: "Arriving", detail: `Calls land the moment they end. ${a.calls_total} so far. Synced ${agoText(h.last_sync_at)}.`, checked_at: h.last_sync_at };

  let co: Light;
  if (a.settings?.coach_on === false) co = { key: "coach", label: "Coach", state: "off", detail: "The Coach is off for this agent. Turn it on in Settings.", checked_at: now };
  else if (!coach) co = { key: "coach", label: "Coach", state: "off", word: "Loading", detail: "Reading the Coach's notes.", checked_at: now };
  else {
    const n = coach.proposed.length;
    co = { key: "coach", label: "Coach", state: "ok", word: "On",
      detail: `${coach.reviews_7d ? `Reviewed ${coach.reviews_7d} ${coach.reviews_7d === 1 ? "call" : "calls"} this week, average ${coach.avg_score_7d ?? "–"} out of 10.` : "No calls reviewed this week yet."}${n ? ` ${n} playbook ${n === 1 ? "line is" : "lines are"} waiting for you.` : ""}`, checked_at: now };
  }

  let sp: Light;
  if (!spend) sp = { key: "spend", label: "Spend", state: "off", word: "Loading", detail: "Adding up today's calls.", checked_at: now };
  else if (spend.over) sp = { key: "spend", label: "Spend", state: "down", word: "Over the cap", detail: `${money(spend.today)} today against a ${money(spend.cap)} cap. Raise the cap in Settings if that is expected.`, checked_at: now };
  else if (spend.cap > 0 && spend.today / spend.cap >= 0.8) sp = { key: "spend", label: "Spend", state: "warn", word: "Near the cap", detail: `${money(spend.today)} of ${money(spend.cap)} today.`, checked_at: now };
  else sp = { key: "spend", label: "Spend", state: "ok", detail: `${money(spend.today)} of ${money(spend.cap)} today. ${money(spend.month)} this month.`, checked_at: now };

  return [line, calls, co, sp];
}

function Dot({ state, className }: { state: LightState; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/40", TONE[state].dot, state === "down" && "motion-safe:animate-pulse", className)} />;
}

function Row({ l, act, onGo }: { l: Light; act: { label: string; run: () => void } | null; onGo: (run: () => void) => void }) {
  const t = TONE[l.state];
  const Icon = l.word === "Paused" ? PauseCircle : t.Icon;
  return (
    <li className="flex gap-3 py-3">
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center"><Dot state={l.state} className="h-3 w-3" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[15px] font-semibold text-white">{l.label}</span>
          <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium", t.text)}><Icon className="h-3.5 w-3.5" aria-hidden />{l.word ?? t.word}</span>
        </div>
        <p className="mt-0.5 text-[13px] leading-snug text-white/70 [overflow-wrap:anywhere]">{l.detail}</p>
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

export function AgentLights({ agent, spend, coach, onOpenSettings, onOpenCoach }:
  { agent: AgentInfo; spend: AgentSpend | null; coach: CoachData | null; onOpenSettings: () => void; onOpenCoach: () => void }) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const lights = useMemo(() => agentLights(agent, spend, coach), [agent, spend, coach]);
  const sum = useMemo(() => summarize(lights), [lights]);
  const who = agent.name;
  const go = (run: () => void) => { setOpen(false); setTimeout(run, mobile ? 250 : 60); };
  const actionFor = (l: Light) => {
    if (l.key === "coach") return l.state === "off" ? { label: "Settings", run: onOpenSettings } : { label: "Coach", run: onOpenCoach };
    if (l.key === "spend" || l.key === "calls" || (l.key === "line" && l.state !== "ok")) return { label: "Settings", run: onOpenSettings };
    return null;
  };
  const pillCls = cn("inline-flex min-h-[44px] items-center gap-2.5 rounded-2xl px-3.5 ring-1 transition-colors motion-reduce:transition-none", ring,
    sum.tone === "down" ? "bg-red-500/10 ring-red-500/35 hover:bg-red-500/15" : sum.tone === "warn" ? "bg-amber-500/10 ring-amber-500/30 hover:bg-amber-500/15" : "bg-white/[0.04] ring-white/10 hover:bg-white/[0.07]");
  const label = `${who} status: ${sum.word.replace(NB, " ")}. ${lights.length} checks, ${sum.ok} good${sum.warn ? `, ${sum.warn} needing a look` : ""}${sum.down ? `, ${sum.down} down` : ""}${sum.off ? `, ${sum.off} off` : ""}. Tap for details.`;
  const trigger = (
    <button type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} className={pillCls} onClick={mobile ? () => setOpen(true) : undefined}>
      <span className="flex items-center gap-1" aria-hidden>{lights.map((l) => <Dot key={l.key} state={l.state} />)}</span>
      <span className={cn("whitespace-nowrap text-[15px] font-semibold", sum.tone === "down" ? "text-red-200" : sum.tone === "warn" ? "text-amber-100" : sum.tone === "off" ? "text-white/70" : "text-white")}>{sum.word}</span>
    </button>
  );
  const list = <ul className="divide-y divide-white/10">{lights.map((l) => <Row key={l.key} l={l} act={actionFor(l)} onGo={go} />)}</ul>;

  if (mobile) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="admin-shell max-h-[85dvh] overflow-y-auto rounded-t-3xl border-white/10 bg-[#0b0b0d] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 text-white">
            <SheetTitle className="text-left text-lg font-semibold text-white">{who} status</SheetTitle>
            <SheetDescription className="text-left text-xs text-white/55">Everything that keeps {who} running. It refreshes every minute.</SheetDescription>
            <div className="mt-2">{list}</div>
          </SheetContent>
        </Sheet>
      </>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="admin-shell max-h-[min(80dvh,640px)] w-[400px] max-w-[calc(100vw-2rem)] overflow-y-auto border-white/10 bg-[#111114] p-4 text-white">
        <div className="mb-1 flex items-baseline"><span className="text-[15px] font-semibold text-white">{who} status</span><span className="ml-2 text-xs text-white/55">Refreshes every minute</span></div>
        {list}
      </PopoverContent>
    </Popover>
  );
}
