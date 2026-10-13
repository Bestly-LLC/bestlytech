/**
 * /admin/pipeline: where leads go from found to called. Replaces Leads + Hunter + Jev scores.
 * One scroll, four zones: Today, Flow, Agents, Leads. Settings sit behind the gear. Inbound (the old CRM) is the second tab.
 * Data: pipeline_overview(), pipeline_leads(), ava_errands_list() (all admin only), refreshed every 60 seconds while visible.
 */
import { Suspense, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { lazyPage } from "@/lib/lazyPage";
import { AgentCards } from "@/components/admin/pipeline/AgentCards";
import { AvaErrands } from "@/components/admin/pipeline/AvaErrands";
import { FlowCharts } from "@/components/admin/pipeline/FlowCharts";
import { LeadSheet } from "@/components/admin/pipeline/LeadSheet";
import { LeadsList } from "@/components/admin/pipeline/LeadsList";
import { PipelineSettingsSheet } from "@/components/admin/pipeline/PipelineSettingsSheet";
import { TodayGauges } from "@/components/admin/pipeline/TodayGauges";
import { Gate, Section, Skeleton } from "@/components/admin/pipeline/parts";
import { stamp, usePipelineRpc } from "@/components/admin/pipeline/lib";
import type { LeadRow, Overview } from "@/components/admin/pipeline/types";

const AdminLeads = lazyPage(() => import("./AdminLeads"));

const TABS = [["pipeline", "Pipeline"], ["inbound", "Inbound"]] as const;

function HealthChip({ h }: { h: Overview["health"] | undefined }) {
  const stale = !!h && Date.now() - Date.parse(h.checked_at) > 26 * 3600 * 1000;
  const c = !h ? { tone: "bg-white/[0.05] text-white/60 ring-white/10", Icon: AlertTriangle, text: "No check yet" }
    : !h.ok ? { tone: "bg-amber-500/10 text-amber-200 ring-amber-500/30", Icon: AlertTriangle, text: "Needs a look" }
    : stale ? { tone: "bg-amber-500/10 text-amber-200 ring-amber-500/30", Icon: AlertTriangle, text: "Check is overdue" }
    : { tone: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/25", Icon: CheckCircle2, text: "All running" };
  return (
    <span role="status" className={cn("inline-flex min-h-[44px] items-center gap-2 rounded-2xl px-3.5 ring-1", c.tone)}>
      <c.Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="leading-tight">
        <span className="block whitespace-nowrap text-[15px] font-semibold">{c.text}</span>
        {h && <span className="block text-[12px] opacity-90">Checked {stamp(h.checked_at)}</span>}
      </span>
    </span>
  );
}

export default function Pipeline() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "inbound" ? "inbound" : "pipeline";
  const [settings, setSettings] = useState(false);
  const [lead, setLead] = useState<LeadRow | null>(null);
  const ov = usePipelineRpc<Overview>("pipeline_overview");
  const o = ov.data;
  const agents = o?.agents ?? [];
  const takers = agents.filter((a) => a.kind === "leads").map((a) => ({ slug: a.slug, name: a.name }));
  // After a send or pull back the numbers should follow right away.
  const changed = () => void ov.reload();

  const selectTab = (t: string) => {
    const next = new URLSearchParams(params);
    if (t === "pipeline") { next.delete("tab"); next.delete("sub"); } else next.set("tab", t);
    setParams(next);
  };

  return (
    <div className="min-w-0 space-y-6 pb-24">
      <header className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[2rem] font-bold leading-[1.1] tracking-[-0.015em] text-white sm:text-3xl">Pipeline</h1>
            <p className="mt-1.5 text-[15px] text-white/65">From found to called, in one place.</p>
          </div>
          <div className="flex items-center gap-2">
            <HealthChip h={o?.health} />
            <button type="button" onClick={() => setSettings(true)} aria-label="Pipeline settings"
              className="grid h-11 w-11 place-items-center rounded-2xl bg-white/[0.06] text-white ring-1 ring-white/10 transition-[background-color,transform] duration-100 hover:bg-white/10 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 motion-reduce:active:scale-100">
              <Settings2 className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>
        {o?.health && !o.health.ok && o.health.problems?.length ? (
          <p role="alert" className="rounded-2xl bg-amber-500/10 p-3 text-[15px] text-amber-100 ring-1 ring-amber-500/30">{o.health.problems.join(". ")}</p>
        ) : null}
        <div className="flex rounded-xl bg-white/[0.06] p-1 ring-1 ring-white/10 sm:inline-flex" role="tablist" aria-label="Pipeline sections">
          {TABS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => selectTab(k)}
              className={cn("min-h-[44px] flex-1 rounded-lg px-5 text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 sm:flex-none", tab === k ? "bg-white/15 text-white" : "text-white/65 hover:text-white")}>{label}</button>
          ))}
        </div>
      </header>

      {tab === "inbound" ? (
        <Suspense fallback={<Skeleton h={260} />}><AdminLeads embedded /></Suspense>
      ) : (<>
        <Section title="Today" hint="Counts since midnight, Pacific time.">
          <Gate loading={ov.loading} missing={ov.missing} error={ov.error} hasData={!!o} h={150} onRetry={() => void ov.reload()}>
            {o && <TodayGauges data={o} />}
          </Gate>
        </Section>

        <Section title="Flow" hint="How leads moved through over the last two weeks.">
          <Gate loading={ov.loading} missing={ov.missing} error={ov.error} hasData={!!o} h={260} onRetry={() => void ov.reload()}>
            {o && <FlowCharts data={o} />}
          </Gate>
        </Section>

        <Section title="Agents" hint="Who is calling, and how their queue looks.">
          <Gate loading={ov.loading} missing={ov.missing} error={ov.error} hasData={!!o} h={200} onRetry={() => void ov.reload()}>
            {o && <AgentCards agents={agents} />}
          </Gate>
          <AvaErrands />
        </Section>

        <Section title="Leads" hint="Tap a lead to send it to an agent or pull it back.">
          <LeadsList owners={takers} onOpen={setLead} />
        </Section>
      </>)}

      <LeadSheet lead={lead} agents={agents} onClose={() => setLead(null)} onChanged={changed} />
      <PipelineSettingsSheet open={settings} onClose={() => setSettings(false)} />
    </div>
  );
}
