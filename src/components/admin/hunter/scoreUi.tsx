/**
 * The pieces of a Jev score: the priority ring, the outcome-odds bar with its legend, and the small chips.
 * Dark admin theme. Colour never carries meaning alone: every colour has a label and a number beside it.
 * Contrast (on the card background, about #16161a): text-white/70 and brighter is 7:1 or better; the tone colours below are the 300 and 400 steps.
 */
import { CalendarClock, Sparkles, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { NB, glue } from "./shared";

export type Outcome = "decision_maker" | "gatekeeper" | "voicemail" | "no_answer" | "wrong_number";
export type ScoreRow = {
  id: string; owner: "maya" | "reese"; lead_id: string; scorer: "jev" | "free_ai"; model: string | null;
  p_reach_dm: number; outcome_probs: Record<Outcome, number>; dm_role: string; best_window: string; p_fit: number; priority: number;
  reason: string; inputs: Record<string, unknown>; latency_ms: number | null; scored_at: string;
  company: string; category: string | null; place: string | null; campaign_slug: string | null; campaign: string; status: string; line_type: string | null;
};

export const OUTCOMES: Array<{ key: Outcome; label: string; bar: string; dot: string }> = [
  { key: "decision_maker", label: "Decision maker", bar: "bg-emerald-400", dot: "bg-emerald-400" },
  { key: "gatekeeper", label: "Gatekeeper", bar: "bg-sky-400", dot: "bg-sky-400" },
  { key: "voicemail", label: "Voicemail", bar: "bg-amber-400", dot: "bg-amber-400" },
  { key: "no_answer", label: "No answer", bar: "bg-zinc-400", dot: "bg-zinc-400" },
  { key: "wrong_number", label: "Wrong number", bar: "bg-rose-400", dot: "bg-rose-400" },
];

export const WINDOW_LABEL: Record<string, string> = {
  morning: "Mornings, 8 to 11 AM", midday: "Midday, 11 AM to 1 PM", afternoon: "Afternoons, 1 to 4 PM", late: "Late afternoons, 4 to 6 PM",
};
export const WINDOW_SHORT: Record<string, string> = { morning: "Morning", midday: "Midday", afternoon: "Afternoon", late: "Late" };
export const ROLE_LABEL: Record<string, string> = { owner: "Owner", manager: "Manager", office_manager: "Office manager", unknown: "Role unknown" };
export const CATEGORY_LABEL: Record<string, string> = {
  auto_repair: "Auto repair", salon: "Salon", home_services: "Home services", clinic: "Clinic", hospital: "Hospital", casino: "Casino",
};
export const catLabel = (c: string | null | undefined) => c ? (CATEGORY_LABEL[c] ?? c.replace(/_/g, " ").replace(/^\w/, (x) => x.toUpperCase())) : "Business";

export const pct = (p: number | null | undefined) => p == null ? "–" : `${Math.round(p * 100)}%`;
export const score100 = (priority: number) => Math.round(priority * 100);
export const topOutcome = (o: Record<Outcome, number>): Outcome => OUTCOMES.reduce((b, x) => ((o[x.key] ?? 0) > (o[b] ?? 0) ? x.key : b), "decision_maker" as Outcome);

/** Priority 0 to 100 as a ring. The number is the truth; the arc and tone only help the eye. */
export function PriorityRing({ value, size = 52 }: { value: number; size?: number }) {
  const r = (size - 8) / 2, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, value));
  const tone = v >= 35 ? "text-emerald-400" : v >= 15 ? "text-sky-400" : "text-zinc-400";
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={`Priority ${v} out of 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={4} className="stroke-white/10" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={4} strokeLinecap="round" className={cn("stroke-current motion-safe:transition-[stroke-dashoffset] motion-safe:duration-500", tone)}
          strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} />
      </svg>
      <span className="absolute text-[15px] font-semibold tabular-nums text-white">{v}</span>
    </span>
  );
}

/** One bar for the five ways a call can end, with a legend that carries the numbers. */
export function OutcomeBar({ probs, legend = true }: { probs: Record<Outcome, number>; legend?: boolean }) {
  const summary = OUTCOMES.map((o) => `${o.label} ${pct(probs[o.key])}`).join(", ");
  return (
    <div>
      <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label={`Call outcome odds: ${summary}`}>
        {OUTCOMES.map((o) => {
          const w = Math.max(0, (probs[o.key] ?? 0) * 100);
          return w > 0.4 ? <span key={o.key} className={cn("h-full first:rounded-l-full last:rounded-r-full", o.bar)} style={{ width: `${w}%` }} /> : null;
        })}
      </div>
      {legend && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] leading-tight text-white/75">
          {OUTCOMES.map((o) => (
            <li key={o.key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className={cn("h-2 w-2 rounded-full", o.dot)} aria-hidden />
              {o.label}{NB}<span className="tabular-nums text-white">{pct(probs[o.key])}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const chip = "inline-flex min-h-[28px] items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium leading-tight ring-1";

export function WindowChip({ w }: { w: string }) {
  return <span className={cn(chip, "bg-white/[0.05] text-white/85 ring-white/10")}><CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />{glue(WINDOW_LABEL[w] ?? w)}</span>;
}
export function RoleChip({ role }: { role: string }) {
  return <span className={cn(chip, "bg-white/[0.05] text-white/85 ring-white/10")}><UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden />{ROLE_LABEL[role] ?? role}</span>;
}
export function ScorerBadge({ scorer }: { scorer: "jev" | "free_ai" }) {
  return scorer === "jev"
    ? <span className={cn(chip, "bg-violet-500/15 text-violet-200 ring-violet-400/30")}><Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />Jev</span>
    : <span className={cn(chip, "bg-white/[0.04] text-white/75 ring-white/10")}>Free AI estimate</span>;
}

const STATUS: Record<string, { text: string; tone: string }> = {
  queued: { text: "Queued", tone: "bg-sky-500/15 text-sky-200 ring-sky-400/30" },
  called: { text: "Called", tone: "bg-amber-500/15 text-amber-200 ring-amber-400/30" },
  booked: { text: "Booked", tone: "bg-emerald-500/15 text-emerald-200 ring-emerald-400/30" },
  checked: { text: "Ready", tone: "bg-white/[0.05] text-white/80 ring-white/10" },
  new: { text: "New", tone: "bg-white/[0.05] text-white/80 ring-white/10" },
  rejected: { text: "Passed", tone: "bg-white/[0.04] text-white/65 ring-white/10" },
  opted_out: { text: "Opted out", tone: "bg-rose-500/15 text-rose-200 ring-rose-400/30" },
};
export function StatusChip({ status }: { status: string }) {
  const s = STATUS[status] ?? { text: status, tone: "bg-white/[0.05] text-white/80 ring-white/10" };
  return <span className={cn(chip, s.tone)}>{s.text}</span>;
}
