/**
 * Live calls for a template agent. useAgentLive polls agent-hub "live" (every 10 seconds, every 3 while a call is in progress), only while
 * the tab is visible. AgentLivePill sits in the top bar and jumps to the banner; AgentLiveBanner shows the transcript so far.
 * When a call goes away it fires "agent:live-ended" so the calls list reloads a few seconds later, once the post-call webhook has landed.
 */
import { useEffect, useRef, useState } from "react";
import { PhoneIncoming, PhoneOutgoing, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { AvaOrb } from "@/components/admin/roofguard/AvaOrb";
import { LiveTranscript, PhasePill, type Line } from "@/components/admin/roofguard/AvaCalls";
import { fmtPhone } from "@/components/admin/roofguard/AvaShared";
import { hub, ring, type AgentInfo } from "./agentApi";
import { LIVE_ENDED } from "./AgentCalls";

export type LiveCallInfo = { conversation_id: string; status: string; direction: "inbound" | "outbound" | "web"; phone: string | null; elapsed: number; transcript: Line[] };

export function useAgentLive(slug: string, enabled: boolean) {
  const [calls, setCalls] = useState<LiveCallInfo[]>([]);
  const prev = useRef(0);
  useEffect(() => {
    if (!enabled) { setCalls([]); return; }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      let next = 10000;
      if (!document.hidden) {
        const r = await hub<{ calls: LiveCallInfo[] }>({ action: "live", slug });
        if (!alive) return;
        if (r.ok) {
          const list = r.data.calls ?? [];
          if (list.length < prev.current) { try { window.dispatchEvent(new CustomEvent(LIVE_ENDED, { detail: slug })); } catch { /* no window */ } }
          prev.current = list.length;
          setCalls(list);
          if (list.length) next = 3000;
        }
      }
      if (alive) timer = setTimeout(() => void tick(), next);
    };
    void tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [slug, enabled]);
  return calls;
}

const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;

/** Ticks the clock locally between polls. */
function useElapsed(elapsed: number) {
  const [base, setBase] = useState({ at: Date.now(), elapsed });
  const [, force] = useState(0);
  useEffect(() => setBase({ at: Date.now(), elapsed }), [elapsed]);
  useEffect(() => { const t = setInterval(() => force((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  return base.elapsed + Math.round((Date.now() - base.at) / 1000);
}

const who = (c: LiveCallInfo) => (c.phone ? fmtPhone(c.phone) : c.direction === "web" ? "Web call" : "Caller");

function PillItem({ agent, c }: { agent: AgentInfo; c: LiveCallInfo }) {
  const secs = useElapsed(c.elapsed);
  return (
    <button type="button" onClick={() => document.getElementById(`${agent.slug}-live`)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" })}
      aria-label={`${agent.name} is on a call with ${who(c)}, ${mmss(secs)}. Jump to the live transcript.`}
      className={cn("inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-emerald-500/10 px-3.5 text-[15px] font-semibold text-emerald-200 ring-1 ring-emerald-500/30 hover:bg-emerald-500/15", ring)}>
      <span className="h-2 w-2 rounded-full bg-emerald-400 motion-safe:animate-pulse" aria-hidden />
      <span className="whitespace-nowrap">Live</span>
      <span className="whitespace-nowrap font-mono tabular-nums text-white">{mmss(secs)}</span>
    </button>
  );
}

export function AgentLivePill({ agent, calls }: { agent: AgentInfo; calls: LiveCallInfo[] }) {
  if (!calls.length) return null;
  return <>{calls.slice(0, 2).map((c) => <PillItem key={c.conversation_id} agent={agent} c={c} />)}</>;
}

function Banner({ agent, c, first }: { agent: AgentInfo; c: LiveCallInfo; first: boolean }) {
  const secs = useElapsed(c.elapsed);
  const Dir = c.direction === "outbound" ? PhoneOutgoing : c.direction === "web" ? Globe : PhoneIncoming;
  return (
    <section id={first ? `${agent.slug}-live` : undefined} aria-label={`Live call with ${who(c)}`} className="overflow-hidden rounded-3xl bg-emerald-500/[0.06] ring-1 ring-emerald-500/30">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pt-4">
        <AvaOrb size={36} hue={agent.orb_hue} speaking />
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400 motion-safe:animate-pulse" aria-hidden />Live
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-300"><Dir className="h-3 w-3" aria-hidden />{c.direction === "outbound" ? "Outgoing" : c.direction === "web" ? "Web" : "Incoming"}</span>
        <span className="text-[17px] font-semibold text-white">{who(c)}</span>
        <span className="ml-auto flex items-center gap-2 text-sm text-white/60">
          <PhasePill status={c.status} turns={c.transcript.length} />
          <span className="whitespace-nowrap font-mono text-[15px] tabular-nums text-white">{mmss(secs)}</span>
        </span>
      </header>
      <LiveTranscript lines={c.transcript} live agent={agent.name} them="Caller" className="max-h-[320px] px-5 pb-5 pt-3" />
    </section>
  );
}

export function AgentLiveBanners({ agent, calls }: { agent: AgentInfo; calls: LiveCallInfo[] }) {
  return <>{calls.map((c, i) => <Banner key={c.conversation_id} agent={agent} c={c} first={i === 0} />)}</>;
}
