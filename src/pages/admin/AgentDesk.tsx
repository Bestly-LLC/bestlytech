/**
 * AgentDesk: the page every template phone agent shares (route /admin/agents/:slug; /admin/maya renders it with slug "maya").
 * Plan: docs/agent-template-opusplan.md. Registry: public.voice_agents. Data: admin_agent* RPCs and the agent-hub edge function.
 *
 *   Top bar     orb tinted by orb_hue, name, purpose chip, line number (tap to copy), status lights, live pills, spend chip, settings
 *   Live        a banner with the transcript so far, while a call is happening
 *   Body        modules, in collapsible columns:
 *                 tickets + privacy  Maya's Sales and Service columns, TicketCard and PrivacyCasePanel unchanged
 *                 calls              Messages (Maya) or Calls: numbered rows, call sheet with recording, share, Coach review
 *                 coach, voice, knowledge, and the Prompt (template agents), then "Tailor this agent"
 * Ava and Reese keep their own pages. Nothing here touches them.
 */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, Check, Copy, MessagesSquare, Phone, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { AvaOrb } from "@/components/admin/roofguard/AvaOrb";
import { CollapsibleSection, openSection } from "@/components/admin/roofguard/CollapsibleSection";
import { fmtPhone } from "@/components/admin/roofguard/AvaShared";
import { MayaTicketsModule, Pill, columnBodyCls } from "@/components/admin/maya/MayaTicketColumns";
import { AgentLights } from "@/components/admin/agent/AgentLights";
import { AgentLiveBanners, AgentLivePill, useAgentLive } from "@/components/admin/agent/AgentLive";
import { AgentSettingsSheet, SettingsButton } from "@/components/admin/agent/AgentSettingsSheet";
import { AgentCallsList, callsSummary, useAgentCalls } from "@/components/admin/agent/AgentCalls";
import { AgentCoachSection, useAgentCoach } from "@/components/admin/agent/AgentCoach";
import { AgentVoice } from "@/components/admin/agent/AgentVoice";
import { AgentKnowledge } from "@/components/admin/agent/AgentKnowledge";
import { AgentPrompt } from "@/components/admin/agent/AgentPrompt";
import { AgentTailor } from "@/components/admin/agent/AgentTailor";
import { boxCls, btnQuiet, money, ring, useAgent, useAgentSpend, type AgentSpend } from "@/components/admin/agent/agentApi";

function SpendChip({ spend, onClick }: { spend: AgentSpend | null; onClick: () => void }) {
  const over = !!spend?.over;
  const near = !!spend && !over && spend.cap > 0 && spend.today / spend.cap >= 0.8;
  const tone = over ? "bg-amber-500/10 ring-amber-500/35" : near ? "bg-amber-500/[0.06] ring-amber-500/25" : "bg-white/[0.04] ring-white/10";
  return (
    <button type="button" onClick={onClick} aria-haspopup="dialog" aria-label={spend ? `Today's spend ${money(spend.today)} of ${money(spend.cap)}${over ? ", cap reached" : ""}. Open settings to change the cap.` : "Today's spend, loading"}
      className={cn("inline-flex min-h-[44px] flex-col items-end justify-center rounded-2xl px-3.5 text-right ring-1 hover:bg-white/[0.07]", tone, ring)}>
      <span className="flex items-center gap-1 text-[11px] text-white/50">
        {(over || near) && <AlertTriangle className="h-3 w-3 text-amber-300" aria-hidden />}{over ? "Daily cap reached" : "Today"}
      </span>
      <span className="whitespace-nowrap text-[15px] font-semibold tabular-nums text-white">
        {spend ? <>{money(spend.today)}<span className="font-normal text-white/50">{" of "}{money(spend.cap)}</span></> : "–"}
      </span>
    </button>
  );
}

function LineNumber({ name, e164 }: { name: string; e164: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!e164) return (
    <span className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-white/[0.04] px-3.5 text-[15px] text-white/60 ring-1 ring-white/10">
      <Phone className="h-4 w-4" aria-hidden />Web only, no phone number</span>
  );
  const copy = async () => {
    try { await navigator.clipboard.writeText(fmtPhone(e164).replace(/ /g, " ")); }
    catch { const t = document.createElement("textarea"); t.value = fmtPhone(e164).replace(/ /g, " "); document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button type="button" onClick={() => void copy()} aria-label={`${name}'s number ${fmtPhone(e164)}, copy`}
      className={cn("group inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-white/[0.04] px-3.5 ring-1 ring-white/10 transition hover:bg-white/[0.07]", ring)}>
      <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-500/15 text-emerald-300"><Phone className="h-3.5 w-3.5" aria-hidden /></span>
      <span className="text-left leading-tight"><span className="block text-[11px] text-white/50">{name}'s line</span>
        <span className="block whitespace-nowrap text-[15px] font-semibold tabular-nums text-white">{fmtPhone(e164)}</span></span>
      {copied ? <Check className="h-4 w-4 text-emerald-300" aria-hidden /> : <Copy className="h-4 w-4 text-white/30 group-hover:text-white/60" aria-hidden />}
    </button>
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
        <AvaOrb size={72} hue={agent.orb_hue} speaking={live.length > 0} label={live.length > 0 ? `${agent.name}, on a call now` : agent.name} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[2rem] font-bold leading-[1.1] tracking-[-0.015em] text-white sm:text-3xl">{agent.name}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-white/65">
            <span className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-0.5 text-[13px] font-medium text-white/85">{agent.purpose}</span>
            {agent.status !== "live" && <span className="inline-flex items-center rounded-full bg-amber-400/15 px-2.5 py-0.5 text-[13px] font-medium text-amber-200">{agent.status === "paused" ? "Paused" : "Draft"}</span>}
          </p>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <LineNumber name={agent.name} e164={agent.line_e164} />
        <AgentLights agent={agent} spend={spend} coach={coach.data} onOpenSettings={() => setSettingsOpen(true)} onOpenCoach={() => openSection(`${slug}-coach`)} />
        <AgentLivePill agent={agent} calls={live} />
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <SpendChip spend={spend} onClick={() => setSettingsOpen(true)} />
          <SettingsButton onClick={() => setSettingsOpen(true)} />
          <Link to="/admin/agents/new" className={btnQuiet} aria-label="New agent"><Plus className="h-4 w-4" aria-hidden />New agent</Link>
        </div>
      </div>

      <AgentLiveBanners agent={agent} calls={live} />

      {ticketsOn ? <MayaTicketsModule messages={messagesCol} /> : has("calls") ? <div className="grid grid-cols-1 items-start gap-4">{messagesCol("")}</div> : null}

      <div className="space-y-4">
        {has("coach") && <AgentCoachSection agent={agent} coach={coach.data} err={coach.err} reload={async () => { await coach.reload(); }} />}
        {has("voice") && <AgentVoice agent={agent} />}
        {has("knowledge") && <AgentKnowledge agent={agent} />}
        <AgentPrompt agent={agent} />
        <AgentTailor agent={agent} />
      </div>

      <AgentSettingsSheet agent={agent} open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
