/**
 * The Coach for a template agent (same look as Ava's CoachSection, simpler data): a 7-day average score, what it is working on,
 * recent reviews, playbook lines waiting for Approve / Skip, and the lines that are on (Turn off).
 * Data: admin_agent_coach(slug). Approve and Turn off change the agent's live prompt, so they call agent-hub playbook_push
 * after saving: only the block between <!-- playbook --> markers is rewritten. Nothing reaches the agent without a tap here.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, GraduationCap, Loader2, Target, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CollapsibleSection } from "@/components/admin/roofguard/CollapsibleSection";
import { CallNo } from "@/components/admin/roofguard/AvaCalls";
import { whenWords } from "@/components/admin/maya/mayaFormat";
import { AGENT_CHANGED, announceAgentChanged, boxCls, btnPrimary, btnQuiet, hub, ring, rpcArgs, type AgentInfo } from "./agentApi";

const APRICOT = "#FFA270";

export type CoachReview = { id: string; call_id: string; call_no: number | null; started_at: string | null; caller_name: string | null; phone: string | null;
  score: number; went_well: string | null; fix: string | null; created_at: string };
export type PlayLine = { id: string; agent_slug: string; line: string; why: string | null; status: "proposed" | "on" | "off"; created_at: string };
export type CoachData = { avg_score_7d: number | null; reviews_7d: number; reviews: CoachReview[]; proposed: PlayLine[]; on: PlayLine[] };

export function useAgentCoach(slug: string) {
  const [data, setData] = useState<CoachData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await rpcArgs<CoachData>("admin_agent_coach", { p_slug: slug });
    if (r.error) { setErr(r.error.message); return; }
    setErr(null); setData(r.data);
  }, [slug]);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 120000);
    const h = (e: Event) => { if ((e as CustomEvent<string>).detail === slug) void load(); };
    window.addEventListener(AGENT_CHANGED, h);
    return () => { clearInterval(t); window.removeEventListener(AGENT_CHANGED, h); };
  }, [load, slug]);
  return { data, err, reload: load };
}

const scoreTone = (n: number) => n >= 8 ? "bg-emerald-400/15 text-emerald-300" : n >= 5 ? "bg-amber-400/15 text-amber-200" : "bg-rose-400/15 text-rose-300";
const Score = ({ n }: { n: number }) => <span className={cn("inline-flex shrink-0 items-center whitespace-nowrap rounded-lg px-2 py-0.5 text-[13px] font-semibold tabular-nums", scoreTone(n))} aria-label={`Score ${n} out of 10`}>{n}/10</span>;

export function AgentCoachSection({ agent, coach, err, reload }: { agent: AgentInfo; coach: CoachData | null; err: string | null; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);

  const decide = async (line: PlayLine, status: "on" | "off", ok: string) => {
    setBusy(line.id);
    const r = await rpcArgs("admin_agent_playbook_set", { p_id: line.id, p_status: status });
    if (r.error) { setBusy(null); toast.error("Couldn't save that. Try again."); return; }
    // The agent's prompt only needs a rewrite when a line goes on or comes off.
    if (line.status === "on" || status === "on") {
      const p = await hub({ action: "playbook_push", slug: agent.slug }, "Saved, but couldn't update the live prompt.");
      if (!p.ok) toast.error(`${p.error} It will catch up the next time a line changes.`);
      else toast.success(ok);
    } else toast.success(ok);
    setBusy(null);
    announceAgentChanged(agent.slug);
    await reload();
  };

  const waiting = coach?.proposed.length ?? 0;
  const last = coach?.reviews.find((r) => r.fix);
  const summary = !coach ? "Loading"
    : coach.reviews_7d ? `${coach.avg_score_7d ?? "–"} out of 10 this week · ${waiting ? `${waiting} ${waiting === 1 ? "line" : "lines"} waiting` : "nothing waiting"}`
    : "Waiting for the first reviewed call";

  return (
    <CollapsibleSection id={`${agent.slug}-coach`} anchorId={`${agent.slug}-coach`} defaultOpen={false} bodyClassName="space-y-4 p-4"
      title="Coach" icon={<span className="grid h-8 w-8 place-items-center rounded-xl" style={{ background: `${APRICOT}26`, color: APRICOT }}><GraduationCap className="h-4 w-4" aria-hidden /></span>}
      summary={summary}
      badge={coach && coach.reviews_7d > 0 && coach.avg_score_7d != null ? <Score n={Math.round(coach.avg_score_7d)} /> : waiting ? <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-[13px] font-semibold text-amber-200">{waiting}</span> : null}>
      <p className="text-[13px] leading-snug text-white/60">
        Reads every call over 20 seconds on free AI, scores it out of 10, and suggests short habits for {agent.name}. A habit only reaches {agent.name} when you tap Approve.
      </p>
      {err && !coach && <p role="alert" className="rounded-2xl bg-amber-500/10 p-4 text-[15px] text-amber-100 ring-1 ring-amber-500/30">Couldn't load the Coach's notes. Try again in a minute.</p>}

      {last && (
        <div className="flex items-start gap-3 rounded-2xl px-4 py-3" style={{ background: `${APRICOT}12`, boxShadow: `inset 0 0 0 1px ${APRICOT}30` }}>
          <Target className="mt-0.5 h-4 w-4 shrink-0" style={{ color: APRICOT }} aria-hidden />
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.04em]" style={{ color: APRICOT }}>Working on</div>
            <p className="mt-0.5 text-[0.9375rem] leading-snug text-white">{last.fix}</p>
          </div>
        </div>
      )}

      <div>
        <h4 className="mb-2 text-[0.8125rem] font-semibold text-white/80">Waiting for you{waiting ? <span className="font-normal text-white/60"> · {waiting}</span> : null}</h4>
        {waiting === 0 && <p className={boxCls}>Nothing waiting. Every Monday morning the Coach suggests up to 3 habits from the week's calls.</p>}
        <ul className="space-y-2">
          {coach?.proposed.map((p) => (
            <li key={p.id} className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10">
              <p className="text-[15px] leading-snug text-white">{p.line}</p>
              {p.why && <p className="mt-1 text-[13px] leading-snug text-white/60">{p.why}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={busy === p.id} onClick={() => void decide(p, "on", "Approved. It goes live on the next call.")} className={btnPrimary}>
                  {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}Approve</button>
                <button type="button" disabled={busy === p.id} onClick={() => void decide(p, "off", "Skipped")} className={btnQuiet}><X className="h-4 w-4" aria-hidden />Skip</button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {coach && coach.on.length > 0 && (
        <div>
          <h4 className="mb-2 text-[0.8125rem] font-semibold text-white/80">In use now<span className="font-normal text-white/60"> · {coach.on.length}</span></h4>
          <ul className="space-y-2">
            {coach.on.map((p) => (
              <li key={p.id} className="flex items-start gap-3 rounded-2xl bg-emerald-500/[0.06] p-4 ring-1 ring-emerald-500/20">
                <p className="min-w-0 flex-1 text-[15px] leading-snug text-white">{p.line}</p>
                <button type="button" disabled={busy === p.id} onClick={() => void decide(p, "off", "Turned off")} className={cn(btnQuiet, "shrink-0")}>
                  {busy === p.id && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Turn off</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h4 className="mb-2 text-[0.8125rem] font-semibold text-white/80">Recent reviews</h4>
        {coach && coach.reviews.length === 0 && <p className={boxCls}>No calls reviewed yet. The Coach reviews each call over 20 seconds a few minutes after it ends.</p>}
        <ul className="space-y-2">
          {coach?.reviews.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("agent:open-call", { detail: r.call_id }))}
                className={cn("block w-full rounded-2xl bg-white/[0.04] p-4 text-left ring-1 ring-white/10 hover:bg-white/[0.07]", ring)}>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Score n={r.score} /><CallNo n={r.call_no} />
                  <span className="text-[13px] text-white/60">{r.started_at ? whenWords(r.started_at) : ""}</span>
                </span>
                {r.went_well && <span className="mt-2 block text-[14px] leading-snug text-white/80"><span className="text-emerald-300">Went well</span>{" · "}{r.went_well}</span>}
                {r.fix && <span className="mt-1 block text-[14px] leading-snug text-white/80"><span className="text-amber-200">Next time</span>{" · "}{r.fix}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </CollapsibleSection>
  );
}
