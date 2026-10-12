/**
 * AgentDesk: the page every template phone agent shares (route /admin/agents/:slug; /admin/maya renders it with slug "maya").
 * Plan: docs/agent-template-opusplan.md. Registry: public.voice_agents. Data: admin_agent* RPCs and the agent-hub edge function.
 *
 *   Header      orb tinted by orb_hue, name, "Purpose · status" subtitle, live pills, one Settings button (2026-10-11 cleanup)
 *   Glance      one inset card, three cells: the line (tap to copy, phone icon to call), Status lights, today's spend
 *   Live        a banner with the transcript so far, while a call is happening
 *   Body        modules, in collapsible columns:
 *                 tickets + privacy  Maya's Sales and Service columns, TicketCard and PrivacyCasePanel unchanged;
 *                                    other agents get only their own Service tickets (no Sales column)
 *                 calls              Messages (Maya) or Calls: numbered rows, call sheet with recording, share, Coach review
 *   Setup       coach, voice, knowledge, the Prompt and "Tailor this agent", grouped under one heading, all collapsed by default
 * Ava and Reese keep their own pages. Nothing here touches them.
 */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, Check, ChevronRight, Copy, Globe, MessagesSquare, Phone, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { AvaOrb } from "@/components/admin/roofguard/AvaOrb";
import { CollapsibleSection, openSection } from "@/components/admin/roofguard/CollapsibleSection";
import { fmtPhone } from "@/components/admin/roofguard/AvaShared";
import { MayaTicketsModule, Pill, columnBodyCls } from "@/components/admin/maya/MayaTicketColumns";
import { AgentLights } from "@/components/admin/agent/AgentLights";
import { AgentLiveBanners, AgentLivePill, useAgentLive } from "@/components/admin/agent/AgentLive";
import { AgentSettingsSheet } from "@/components/admin/agent/AgentSettingsSheet";
import { AgentCallsList, callsSummary, useAgentCalls } from "@/components/admin/agent/AgentCalls";
import { AgentCoachSection, useAgentCoach } from "@/components/admin/agent/AgentCoach";
import { AgentVoice } from "@/components/admin/agent/AgentVoice";
import { AgentKnowledge } from "@/components/admin/agent/AgentKnowledge";
import { AgentPrompt } from "@/components/admin/agent/AgentPrompt";
import { AgentTailor } from "@/components/admin/agent/AgentTailor";
import { CallSafetyCard } from "@/components/admin/CallSafetyCard";
import { boxCls, btnQuiet, money, ring, useAgent, useAgentSpend, type AgentSpend } from "@/components/admin/agent/agentApi";

const cellCls = "flex min-h-[68px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.04] motion-reduce:transition-none";
const cellLabel = "block text-[13px] text-white/50";
const cellValue = "mt-0.5 block whitespace-nowrap text-[17px] font-semibold tabular-nums text-white";

/** Today's spend, as a glance-card cell. Tap opens Settings (where the cap lives). */
function SpendCell({ spend, onClick }: { spend: AgentSpend | null; onClick: () => void }) {
  const over = !!spend?.over;
  const near = !!spend && !over && spend.cap > 0 && spend.today / spend.cap >= 0.8;
  return (
    <button type="button" onClick={onClick} aria-haspopup="dialog" aria-label={spend ? `Today's spend ${money(spend.today)} of ${money(spend.cap)}${over ? ", cap reached" : ""}. Open settings to change the cap.` : "Today's spend, loading"}
      className={cn(cellCls, ring, over ? "bg-amber-500/10 hover:bg-amber-500/15" : near && "bg-amber-500/[0.06]")}>
      <span className="min-w-0 flex-1 leading-tight">
        <span className={cn(cellLabel, "flex items-center gap-1")}>
          {(over || near) && <AlertTriangle className="h-3 w-3 text-amber-300" aria-hidden />}{over ? "Daily cap reached" : "Spent today"}
        </span>
        <span className={cellValue}>
          {spend ? <>{money(spend.today)}<span className="font-normal text-white/45">{" of "}{money(spend.cap)}</span></> : "–"}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-white/30" aria-hidden />
    </button>
  );
}

/** The agent's phone line, as a glance-card cell: tap the number to copy it, tap the phone to call it (handy for a test call). */
function LineCell({ name, e164 }: { name: string; e164: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!e164) return (
    <div className={cn(cellCls, "hover:bg-transparent")}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.07] text-white/60"><Globe className="h-4 w-4" aria-hidden /></span>
      <span className="min-w-0 flex-1 leading-tight"><span className={cellLabel}>{name}'s line</span>
        <span className="mt-0.5 block text-[17px] font-semibold text-white/70">Web only</span></span>
    </div>
  );
  const pretty = fmtPhone(e164);
  const plain = pretty.replace(/\u00A0/g, " ");
  const copy = async () => {
    try { await navigator.clipboard.writeText(plain); }
    catch { const t = document.createElement("textarea"); t.value = plain; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex items-center">
      <button type="button" onClick={() => void copy()} aria-label={`${name}'s number ${plain}. Copy`} className={cn(cellCls, "group flex-1", ring)}>
        <span className="min-w-0 flex-1 leading-tight"><span className={cellLabel}>{copied ? "Copied" : `${name}'s line`}</span>
          <span className={cellValue}>{pretty}</span></span>
        {copied ? <Check className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden /> : <Copy className="h-4 w-4 shrink-0 text-white/30 group-hover:text-white/60" aria-hidden />}
      </button>
      <a href={`tel:${e164}`} aria-label={`Call ${name}`} title={`Call ${name}`}
        className={cn("mr-3 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-300 transition-colors hover:bg-emerald-500/25 motion-safe:active:scale-[0.97] motion-reduce:transition-none", ring)}>
        <Phone className="h-4 w-4" aria-hidden />
      </a>
    </div>
  );
}

export default function AgentDesk({ slug: slugProp }: { slug?: string }) {
  const params = useParams();
  const slug = slugProp ?? params.slug ?? "";
  const { data: agent, err, reload } = useAgent(slug);
  const { data: spend } = useAgentSpend(slug);
  const coach = useAgentCoach(slug);
  const calls = useAgentCalls(slug);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const live = useAgentLive(slug, !!agent && agent.kind === "template" && agent.status !== "draft" && !!agent.elevenlabs_agent_id);

  if (!agent) {
    return (
      <div className="space-y-4 pb-24">
        {err ? (
          <div role="alert" className="rounded-2xl bg-amber-500/10 p-5 text-[15px] text-amber-100 ring-1 ring-amber-500/30">
            <p>{/no such agent/i.test(err) ? `There is no agent called "${slug}".` : "Couldn't load this agent. Try again in a minute."}</p>
            <div className="mt-3 flex gap-2"><button type="button" onClick={() => void reload()} className={btnQuiet}>Retry</button>
              <Link to="/admin" className={btnQuiet}>Back to the Command Center</Link></div>
          </div>
        ) : (
          <div className="space-y-4" aria-busy="true" aria-label="Loading">
            <div className="h-[72px] w-72 rounded-2xl bg-white/[0.04] motion-safe:animate-pulse" aria-hidden />
            <div className="h-[56px] rounded-2xl bg-white/[0.04] motion-safe:animate-pulse" aria-hidden />
            <div className="h-[260px] rounded-3xl bg-white/[0.04] motion-safe:animate-pulse" aria-hidden />
          </div>
        )}
      </div>
    );
  }

  if (agent.kind !== "template") {
    return (
      <div className="space-y-3 pb-24">
        <h1 className="text-[2rem] font-bold leading-[1.1] tracking-[-0.015em] text-white">{agent.name}</h1>
        <p className={boxCls}>{agent.name} has a page of its own.{agent.page_url && <> <Link to={agent.page_url} className="text-sky-300 underline-offset-2 hover:underline">Open {agent.name}</Link></>}</p>
      </div>
    );
  }

  const has = (m: string) => agent.modules.includes(m);
  const sum = callsSummary(calls.rows);
  const ticketsOn = has("tickets");
  const messagesCol = (orderCls: string) => (
    <CollapsibleSection id={`${slug}-col-messages`} defaultOpen className={orderCls} bodyClassName={columnBodyCls}
      title={ticketsOn ? "Messages" : "Calls"} icon={<MessagesSquare className="h-5 w-5 text-violet-300" />} summary={sum.summary}
      badge={calls.rows ? <Pill n={sum.today} label={`${sum.today} calls today${sum.unread ? `, ${sum.unread} unread` : ""}`} /> : null}>
      <AgentCallsList agent={agent} rows={calls.rows} err={calls.err} busy={calls.busy} load={calls.load} setRows={(f) => calls.setRows(f)} />
    </CollapsibleSection>
  );

  return (
    <div className="space-y-5 pb-24">
      <header className="flex items-center gap-4">
        <AvaOrb size={64} hue={agent.orb_hue} speaking={live.length > 0} label={live.length > 0 ? `${agent.name}, on a call now` : agent.name} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[2rem] font-bold leading-[1.1] tracking-[-0.015em] text-white">{agent.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[15px] text-white/55">
            <span>{agent.purpose}</span>
            <span aria-hidden>·</span>
            <span className={agent.status === "live" ? "text-emerald-300" : "text-amber-200"}>{agent.status === "live" ? "Live" : agent.status === "paused" ? "Paused" : "Draft"}</span>
            <AgentLivePill agent={agent} calls={live} />
          </p>
        </div>
        <button type="button" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog" aria-label={`${agent.name} settings`} title="Settings"
          className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/[0.06] text-white/80 ring-1 ring-white/10 transition-colors hover:bg-white/[0.1] hover:text-white motion-safe:active:scale-[0.97] motion-reduce:transition-none", ring)}>
          <Settings className="h-5 w-5" aria-hidden />
        </button>
      </header>

      <div aria-label={`${agent.name} at a glance`}
        className="grid grid-cols-1 divide-y divide-white/[0.08] overflow-hidden rounded-3xl bg-white/[0.03] ring-1 ring-white/10 md:grid-cols-3 md:divide-x md:divide-y-0">
        <LineCell name={agent.name} e164={agent.line_e164} />
        <AgentLights cell agent={agent} spend={spend} coach={coach.data} onOpenSettings={() => setSettingsOpen(true)} onOpenCoach={() => openSection(`${slug}-coach`)} />
        <SpendCell spend={spend} onClick={() => setSettingsOpen(true)} />
      </div>

      <AgentLiveBanners agent={agent} calls={live} />

      {ticketsOn ? <MayaTicketsModule messages={messagesCol} agent={{ slug: agent.slug, name: agent.name }} /> : has("calls") ? <div className="grid grid-cols-1 items-start gap-4">{messagesCol("")}</div> : null}

      {/* Call Guard (docs/call-guard-opusplan.md): what Maya's outbound dialer will be allowed to call. Only Maya makes outbound calls for Bestly. */}
      {slug === "maya" && <CallSafetyCard seller="bestly" who="Maya" />}

      {/* Setup: everything that changes how the agent works, out of the way of the daily desk. All rows start collapsed. */}
      <section aria-labelledby={`${slug}-setup-h`} className="space-y-2 pt-3">
        <h2 id={`${slug}-setup-h`} className="px-1 text-[13px] font-semibold uppercase tracking-[0.06em] text-white/45">Setup</h2>
        {has("coach") && <AgentCoachSection agent={agent} coach={coach.data} err={coach.err} reload={async () => { await coach.reload(); }} />}
        {has("voice") && <AgentVoice agent={agent} />}
        {has("knowledge") && <AgentKnowledge agent={agent} />}
        <AgentPrompt agent={agent} />
        <AgentTailor agent={agent} />
      </section>

      <AgentSettingsSheet agent={agent} open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
