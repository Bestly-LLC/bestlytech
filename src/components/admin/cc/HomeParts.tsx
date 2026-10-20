/**
 * Smaller pieces of the Command Center home: quick actions, Needs you (at most 3), Call next, and the single health dot.
 */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Binoculars, CheckCircle2, ExternalLink, Loader2, MessagesSquare, Phone, Siren, Users, Video } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { startEmergency } from "@/pages/admin/Emergency";
import { openScout } from "@/components/admin/scoutBus";
import { LoadError, Pill, RowLink, SectionHeader, cardCls, divider, focusRing, hairline, inset, rowCls, text, tint } from "@/components/admin/ui";
import { ageWords, type CcBundle, type Live } from "@/lib/commandCenter";

/* ───────── quick actions ───────── */

function Quick({ href, to, onClick, icon: Icon, label, tone, spin }: {
  href?: string; to?: string; onClick?: () => void; icon: typeof Video; label: string; tone?: string; spin?: boolean;
}) {
  const cls = cn(
    "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-4 text-[15px] font-semibold transition active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100",
    tone ?? "bg-white/[0.06] text-white hover:bg-white/[0.1]", focusRing,
  );
  const inner = <><Icon className={cn("h-4 w-4 shrink-0", spin && "animate-spin")} aria-hidden /><span className="whitespace-nowrap">{label}</span></>;
  if (to) return <Link to={to} className={cls}>{inner}</Link>;
  if (href) return <a href={href} target="_blank" rel="noreferrer" className={cls}>{inner}</a>;
  return <button type="button" onClick={onClick} className={cls}>{inner}</button>;
}

/** One tap: charge the EcoFlow to 100%, buzz the phone, open the checklist. Emergency is the only coloured action. */
function EmergencyTile() {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <Quick
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try {
          await startEmergency("general");
        } catch (e) {
          // A failed emergency must never look like a started one.
          setBusy(false);
          toast.error("Couldn't start it", { description: (e as Error).message });
          return;
        }
        setBusy(false);
        nav("/admin/emergency");
      }}
      icon={busy ? Loader2 : Siren}
      spin={busy}
      label={busy ? "Starting" : "Emergency"}
      tone="bg-[#FF453A26] text-[#FF6961] hover:bg-[#FF453A40] bento:bg-[#FF3B301f] bento:text-[#D70015] bento:hover:bg-[#FF3B302e]"
    />
  );
}

export function QuickRow() {
  return (
    <nav aria-label="Quick actions" className="flex flex-wrap gap-2">
      <EmergencyTile />
      <Quick onClick={openScout} icon={Binoculars} label="Ask Scout" />
      <Quick href="https://cloud.bestly.tech/apps/spreed" icon={MessagesSquare} label="Talk" />
      <Quick href="https://studio.bestly.tech" icon={ExternalLink} label="Studio" />
      <Quick to="/partner" icon={Users} label="Eli's portal" />
    </nav>
  );
}

/* ───────── Needs you: the top three real items ───────── */

export interface TodayRow {
  key: string; source: string; severity: string; title: string; detail: string | null; action_label: string | null;
  url: string | null; since: string | null; item_count: number | null; rank: number;
}

export async function loadNeeds(): Promise<TodayRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("admin_today");
  if (error) throw new Error(error.message || "could not load what needs you");
  return (data ?? []) as TodayRow[];
}

const SEV: Record<string, number> = { blocked: 0, critical: 0, error: 0, warning: 1, todo: 2, info: 3 };

/** Real items only (no FYI), same notice raised twice shown once, worst then oldest first. */
export function realNeeds(rows: TodayRow[] | undefined): TodayRow[] {
  const seen = new Set<string>();
  return (rows ?? [])
    .filter((r) => (SEV[r.severity] ?? 3) < 3)
    .sort((a, b) => (SEV[a.severity] ?? 3) - (SEV[b.severity] ?? 3) || (a.since ?? "").localeCompare(b.since ?? ""))
    .filter((r) => { const k = `${r.source}|${r.title.trim().toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export function NeedsYouShort({ needs }: { needs: Live<TodayRow[]> }) {
  const all = useMemo(() => realNeeds(needs.data), [needs.data]);
  const top = all.slice(0, 3);
  return (
    <section aria-labelledby="needs-title">
      <SectionHeader id="needs-title" title="Needs you" aside={all.length > 0 ? <Link to="/admin/needs-you" className={cn("inline-flex min-h-[44px] items-center rounded-md px-1 text-[15px] font-medium sm:min-h-9", tint.blue, focusRing)}>All {all.length}</Link> : undefined} />
      <div className={cn(cardCls, "overflow-hidden")}>
        {needs.loading && !needs.data ? (
          <div className={cn(rowCls, "py-4")} aria-hidden><div className="h-4 w-2/3 animate-pulse rounded bg-white/[0.06]" /></div>
        ) : !needs.data ? (
          <div className={cn(rowCls, "py-3")}><LoadError label="what needs you" onRetry={() => needs.reload()} busy={needs.busy} detail={needs.error} /></div>
        ) : top.length === 0 ? (
          <div className={cn(rowCls, "py-4")}><CheckCircle2 className={cn("h-5 w-5 shrink-0", tint.green)} aria-hidden /><p className={text.title}>You're clear.</p></div>
        ) : (
          <ul className={divider} data-testid="needs-short">
            {top.map((n) => (
              <li key={n.key}>
                <RowLink href={n.url || "/admin/needs-you"}>
                  <div className="min-w-0 flex-1">
                    <p className={cn(text.title, "flex flex-wrap items-center gap-x-2 gap-y-1")}>
                      {(SEV[n.severity] ?? 3) === 0 && <Pill tone="red">Urgent</Pill>}
                      <span>{n.title.replace(/^Ares couldn't fix: /, "")}</span>
                    </p>
                    {n.detail && <p className={cn(text.detail, "mt-0.5")}>{n.detail.split("\n")[0]}</p>}
                  </div>
                </RowLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ───────── Call next ───────── */

const WINDOW: Record<string, string> = { morning: "Best in the morning", afternoon: "Best in the afternoon", evening: "Best in the evening" };

export function CallNext({ cc }: { cc: Live<CcBundle> }) {
  const l = cc.data?.leads;
  return (
    <section aria-labelledby="call-title">
      <SectionHeader id="call-title" title="Call next" aside={l ? <span>{l.maya_queued} queued · {l.rg_found.toLocaleString("en-US")} found</span> : undefined} />
      <div className={cn(cardCls, "overflow-hidden")}>
        {!l ? (
          cc.loading ? <div className={cn(rowCls, "py-4")} aria-hidden><div className="h-4 w-2/3 animate-pulse rounded bg-white/[0.06]" /></div>
            : <div className={cn(rowCls, "py-3")}><LoadError label="leads" onRetry={() => cc.reload()} busy={cc.busy} detail={cc.error} /></div>
        ) : l.next.length === 0 ? (
          <div className={cn(rowCls, "py-4")}><Phone className="h-4 w-4 shrink-0 text-white/50" aria-hidden /><p className={text.title}>Nobody scored and ready to dial right now.</p></div>
        ) : (
          <ul className={divider} data-testid="call-next">
            {l.next.map((x, i) => (
              <li key={i}>
                <RowLink href={x.table === "rg_leads" ? "/admin/roofguard" : "/admin/maya"}>
                  <div className="min-w-0 flex-1">
                    <p className={text.title}>{x.company}</p>
                    <p className={cn(text.detail, "mt-0.5")}>
                      {[x.window ? WINDOW[x.window] ?? `Best ${x.window}` : null, x.table === "rg_leads" ? "RoofGuard" : "Maya"].filter(Boolean).join(" · ")}
                      {x.why ? `. ${x.why}` : ""}
                    </p>
                  </div>
                </RowLink>
              </li>
            ))}
          </ul>
        )}
        <div className={cn("flex min-h-[44px] items-center border-t", hairline, inset)}>
          <Link to="/admin/pipeline" className={cn("inline-flex min-h-[44px] items-center text-[15px] font-medium", tint.blue, focusRing)}>Open Pipeline</Link>
        </div>
      </div>
    </section>
  );
}

/* ───────── the health dot ───────── */

export function HealthDot({ reasons, since }: { reasons: string[]; since?: string | null }) {
  const [open, setOpen] = useState(false);
  const on = reasons.length > 0;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => on && setOpen((v) => !v)}
        aria-expanded={on ? open : undefined}
        aria-label={on ? `${reasons.length} ${reasons.length === 1 ? "problem" : "problems"}. Show what is wrong.` : "All systems healthy"}
        data-testid="health-dot"
        data-on={on ? "true" : "false"}
        className={cn("inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-full px-2", on ? "text-[#FF6961] bento:text-[#D70015]" : "cursor-default text-white/30", focusRing)}
      >
        <span
          className={cn("h-3 w-3 rounded-full", on ? "bg-[#FF453A] bento:bg-[#FF3B30]" : "bg-white/25")}
          style={on ? { boxShadow: "0 0 14px 4px rgba(255,69,58,0.35)" } : undefined}
        />
        {on && <span className="whitespace-nowrap text-[13px] font-semibold">{reasons.length === 1 ? "1 problem" : `${reasons.length} problems`}</span>}
      </button>
      {on && open && (
        <div className={cn(cardCls, "absolute right-0 top-12 z-30 w-[min(22rem,calc(100vw-2rem))] bg-[#1c1c1e] p-4 shadow-xl bento:bg-white")} role="status">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-white/60">What is wrong</p>
          <ul className="mt-2 space-y-2">
            {reasons.map((r, i) => <li key={i} className="text-[15px] leading-snug text-white">{r}</li>)}
          </ul>
          {since && <p className="mt-3 text-[12px] text-white/50">Since {ageWords(since)}</p>}
          <Link to="/admin/overview" className={cn("mt-2 inline-flex min-h-[44px] items-center text-[15px] font-medium", tint.blue, focusRing)}>Open the status board</Link>
        </div>
      )}
    </div>
  );
}
