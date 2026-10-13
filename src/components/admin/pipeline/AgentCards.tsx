import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { NBSP, time12 } from "./lib";
import { Empty, Panel } from "./parts";
import type { Outcomes, PipelineAgent } from "./types";

const OUT: Array<{ key: keyof Outcomes; label: string; color: string }> = [
  { key: "booked", label: "Booked", color: "#34d399" },
  { key: "answered", label: "Answered", color: "#38bdf8" },
  { key: "voicemail", label: "Voicemail", color: "#fbbf24" },
  { key: "not_interested", label: "Not interested", color: "#a1a1aa" },
  { key: "other", label: "Other", color: "#52525b" },
];

function OutcomeStrip({ o }: { o: Outcomes }) {
  const total = OUT.reduce((a, x) => a + (o?.[x.key] ?? 0), 0);
  if (!total) return <Empty>No calls yet today.</Empty>;
  return (
    <div>
      <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label={`Call outcomes today: ${OUT.map((x) => `${x.label} ${o[x.key] ?? 0}`).join(", ")}`}>
        {OUT.map((x) => (o[x.key] ?? 0) > 0 ? <span key={x.key} className="h-full" style={{ width: `${(o[x.key] / total) * 100}%`, background: x.color }} /> : null)}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-white/75">
        {OUT.map((x) => (
          <li key={x.key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="h-2 w-2 rounded-full" style={{ background: x.color }} aria-hidden />{x.label}{NBSP}<span className="tabular-nums text-white">{o[x.key] ?? 0}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OpenLink({ a }: { a: PipelineAgent }) {
  const to = a.page_url || `/admin/agents/${a.slug}`;
  return (
    <Link to={to} className="inline-flex min-h-[44px] items-center gap-1 rounded-xl px-2 text-[14px] font-medium text-sky-300 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50">
      Open {a.name}<ChevronRight className="h-4 w-4" aria-hidden />
    </Link>
  );
}

function AgentCard({ a }: { a: PipelineAgent }) {
  const short = a.kind === "leads" && a.queued < a.target;
  const pct = a.target > 0 ? Math.min(100, Math.round((a.queued / a.target) * 100)) : 0;
  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-x-2">
        <div className="min-w-0">
          <h3 className="text-[18px] font-semibold text-white">{a.name}</h3>
          <p className="text-[14px] text-white/60">{a.purpose}</p>
        </div>
        <OpenLink a={a} />
      </div>
      {a.kind === "leads" ? (
        <>
          <div>
            <p className="text-[14px] text-white/80">
              Waiting to be called: <span className={cn("whitespace-nowrap font-semibold tabular-nums", short ? "text-orange-300" : "text-white")}>{a.queued}{NBSP}ready</span>
              <span className="text-white/50">{" · "}</span><span className="whitespace-nowrap tabular-nums">{a.target}{NBSP}a{NBSP}day</span>
            </p>
            {short && (
              <>
                <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-white/10" role="img" aria-label={`${a.queued} leads ready, ${a.target} a day wanted`}>
                  <div className="h-full rounded-full bg-orange-400 motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1 text-[13px] text-orange-200">Not enough for a full day. Send more leads or wait for tonight's run.</p>
              </>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white/[0.04] px-3 py-2 ring-1 ring-white/10"><dd className="text-[22px] font-semibold tabular-nums leading-none text-white">{a.calls_today}</dd><dt className="mt-1 text-[12px] text-white/60">Calls today</dt></div>
            <div className="rounded-xl bg-white/[0.04] px-3 py-2 ring-1 ring-white/10"><dd className="whitespace-nowrap text-[18px] font-semibold leading-tight text-white">{time12(a.next_call_at, "None set")}</dd><dt className="mt-1 text-[12px] text-white/60">Next call</dt></div>
          </dl>
          <OutcomeStrip o={a.outcomes} />
        </>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white/[0.04] px-3 py-2 ring-1 ring-white/10"><dd className="text-[22px] font-semibold tabular-nums leading-none text-white">{a.calls_today}</dd><dt className="mt-1 text-[12px] text-white/60">Calls today</dt></div>
          </dl>
          <OutcomeStrip o={a.outcomes} />
        </>
      )}
    </Panel>
  );
}

export function AgentCards({ agents }: { agents: PipelineAgent[] }) {
  const list = agents.filter((a) => a.kind !== "errands");
  if (!list.length) return <Empty>No agents are taking leads yet. Turn one on in Settings.</Empty>;
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{list.map((a) => <AgentCard key={a.slug} a={a} />)}</div>;
}
