import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { OutcomeBar, RoleChip, WindowChip, catLabel, type Outcome } from "@/components/admin/hunter/scoreUi";
import { rpcArgs } from "@/components/admin/roofguard/AvaShared";
import { NBSP, errText, fit100, isMissing, pct, stamp } from "./lib";
import { STATUS_LABEL, ownerName } from "./LeadsList";
import { PullBackDialog } from "./PullBackDialog";
import { SendToPicker } from "./SendToPicker";
import { btnQuiet } from "./parts";
import type { Detail, LeadRow, PipelineAgent } from "./types";

const obj = (v: unknown): Record<string, unknown> | null => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const human = (k: string) => k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const scalar = (v: unknown): string | null => v == null || v === "" ? null : typeof v === "boolean" ? (v ? "Yes" : "No") : typeof v === "number" || typeof v === "string" ? String(v) : null;
const HIDE = /(^id$|_id$|token|secret|raw|json|phone|email)/i;

function Facts({ title, data, hint }: { title: string; data: Record<string, unknown> | null; hint?: string }) {
  const rows = Object.entries(data ?? {}).map(([k, v]) => [k, scalar(v)] as const).filter(([k, v]) => v && !HIDE.test(k));
  if (!rows.length) return null;
  return (
    <section className="space-y-1.5">
      <h3 className="text-[15px] font-semibold text-white">{title}</h3>
      {hint && <p className="text-[13px] text-white/60">{hint}</p>}
      <dl className="grid grid-cols-2 gap-2">
        {rows.map(([k, v]) => (
          <div key={k} className="min-w-0 rounded-xl bg-white/[0.04] px-3 py-2 ring-1 ring-white/10">
            <dt className="text-[12px] text-white/55">{human(k)}</dt>
            <dd className="break-words text-[14px] text-white">{/^\d{4}-\d\d-\d\dT/.test(v!) ? stamp(v) : v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function LeadSheet({ lead, agents, onClose, onChanged }: { lead: LeadRow | null; agents: PipelineAgent[]; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [pulling, setPulling] = useState(false);
  const key = lead ? `${lead.lead_table}:${lead.id}` : "";

  useEffect(() => {
    if (!lead) return;
    let stop = false;
    setDetail(null); setState("loading");
    void rpcArgs<Detail>("pipeline_lead", { p_table: lead.lead_table, p_id: lead.id }).then(({ data, error }) => {
      if (stop) return;
      if (error) { setState(isMissing(error) ? "missing" : "error"); if (!isMissing(error)) console.warn(errText(error)); return; }
      setDetail(data); setState("ok");
    });
    return () => { stop = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const score = obj(detail?.score);
  const probs = obj(score?.outcome_probs) as Record<Outcome, number> | null;
  const calls = obj(detail?.calls) ?? obj(detail?.call_history);
  const apollo = obj(detail?.apollo);
  const fit = fit100(lead?.fit);

  return (
    <Sheet open={!!lead} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="admin-shell flex h-[100dvh] w-full flex-col gap-0 overflow-hidden border-white/10 bg-[#0b0b0d] p-0 text-white sm:max-w-xl">
        {lead && (<>
          <div className="shrink-0 space-y-1 px-5 pb-3 pr-12 pt-6 text-left">
            <SheetTitle className="break-words text-xl font-semibold leading-tight text-white">{lead.company}</SheetTitle>
            <SheetDescription className="text-sm text-white/60">
              {catLabel(lead.category)}{lead.city ? ` · ${lead.city}${lead.state ? `, ${lead.state}` : ""}` : ""}{" · "}{STATUS_LABEL[lead.status] ?? lead.status}{" · "}{ownerName(lead.owner)}'s lead
            </SheetDescription>
          </div>
          <div data-sheet-scroll className="min-h-0 flex-1 touch-pan-y space-y-5 overflow-y-auto overscroll-contain px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <section className="space-y-2">
              <h3 className="text-[15px] font-semibold text-white">Send to</h3>
              <SendToPicker lead={lead} agents={agents} onDone={() => { onChanged(); onClose(); }} />
              <button type="button" onClick={() => setPulling(true)} className={btnQuiet}>Pull back</button>
            </section>

            <dl className="grid grid-cols-2 gap-2">
              {[
                ["Chance of a decision maker", pct(lead.reach)],
                ["Fit", fit == null ? "–" : `${fit}${NBSP}of${NBSP}100`],
                ["Phone line", lead.phone_present ? (lead.line_type ? human(lead.line_type) : "On file") : "No phone"],
                ["Updated", stamp(lead.updated_at)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-white/[0.04] px-3 py-2 ring-1 ring-white/10"><dt className="text-[12px] text-white/55">{k}</dt><dd className="whitespace-nowrap text-[15px] font-medium text-white">{v}</dd></div>
              ))}
            </dl>

            {state === "loading" && <div className="h-24 rounded-2xl bg-white/[0.04] ring-1 ring-white/10 motion-safe:animate-pulse" aria-hidden />}
            {state === "missing" && <p className="text-[14px] text-white/60">More detail on this lead will show here once it is set up.</p>}
            {state === "error" && <p role="alert" className="rounded-xl bg-amber-500/10 p-3 text-[14px] text-amber-100 ring-1 ring-amber-500/30">Couldn't load this lead's details. Close and open it again.</p>}

            {state === "ok" && (<>
              {score && (
                <section className="space-y-2">
                  <h3 className="text-[15px] font-semibold text-white">Why this score</h3>
                  {probs && <OutcomeBar probs={probs} />}
                  <div className="flex flex-wrap gap-2">
                    {typeof score.dm_role === "string" && <RoleChip role={score.dm_role} />}
                    {typeof score.best_window === "string" && <WindowChip w={score.best_window} />}
                  </div>
                  {typeof score.reason === "string" && <p className="text-[14px] leading-relaxed text-white/75">{score.reason}</p>}
                </section>
              )}
              <Facts title="Company info" hint="From Apollo, when it found the company." data={apollo} />
              <Facts title="Calls so far" data={calls} />
              <Facts title="Details" data={Object.fromEntries(Object.entries(detail ?? {}).filter(([k]) => !["score", "apollo", "calls", "call_history"].includes(k)))} />
            </>)}
          </div>
          <PullBackDialog lead={lead} open={pulling} onClose={() => setPulling(false)} onDone={() => { onChanged(); onClose(); }} />
        </>)}
      </SheetContent>
    </Sheet>
  );
}
