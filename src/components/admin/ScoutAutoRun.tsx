import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/*
 * Scout's two switches, stored in scout_settings so the server (admin-chat) enforces them:
 * - Auto-run: Scout does what it suggests (runs Mac jobs, changes data, ships fixes) without a tap.
 * - Paid AI (v30, 2026-10-03): the ONE master switch for Scout's paid Claude use, and it always shows the truth.
 *   On = Scout uses Claude. Off = free AI only. A "Yes, use paid AI" tap in a chat flips it on for an hour; it turns
 *   itself off when that hour ends or the daily cap is hit (scout_paid_tick), and says why. Refreshes every 30 s.
 * Under them: what paid AI actually cost today (ai_spend), chat and background jobs, against the
 * daily caps. Background jobs (to-dos from calls, morning picks, reply drafts) run on the cheapest
 * model and stop at their own cap whatever the switch says.
 */

type Prefs = { auto_run: boolean; paid_ai_ok: boolean; paid_ai_until: string | null; paid_ai_off_reason: string | null; chat_cap_usd: number };
let value: Prefs | null = null;
const subs = new Set<(v: Prefs | null) => void>();
const emit = () => subs.forEach((f) => f(value));
let loading: Promise<void> | null = null;

async function fetchPrefs() {
  const { data } = await (supabase.rpc as any)("scout_prefs");
  if (!data) return;
  value = {
    auto_run: data.auto_run === true,
    paid_ai_ok: data.paid_ai_ok === true,                 // the truth: false once the hour or the cap runs out
    paid_ai_until: data.paid_ai_until ?? null,
    paid_ai_off_reason: data.paid_ai_off_reason ?? null,
    chat_cap_usd: Number(data.chat_cap_usd ?? 5),
  };
  emit();
}
let poll: ReturnType<typeof setInterval> | null = null;
function load() {
  if (!loading) loading = fetchPrefs();
  // The switch can turn itself off (hour up, cap hit, a tap in a chat turns it on), so keep it live.
  if (!poll) poll = setInterval(() => { if (subs.size) fetchPrefs(); }, 30_000);
  return loading;
}

function usePrefs() {
  const [v, setV] = useState<Prefs | null>(value);
  useEffect(() => {
    subs.add(setV);
    load();
    return () => { subs.delete(setV); };
  }, []);
  const set = async (key: keyof Prefs, on: boolean) => {
    if (!value) return;
    const was = value;
    value = { ...value, [key]: on }; emit();
    const fn = key === "auto_run" ? "scout_auto_run_set" : "scout_paid_ai_set";
    const { error } = await (supabase.rpc as any)(fn, { p_on: on });
    if (error) { value = was; emit(); return; }
    fetchPrefs(); // show what the server actually did (e.g. it can't turn on past the cap)
  };
  return { prefs: v, set };
}

export function useScoutAutoRun() {
  const { prefs, set } = usePrefs();
  return { autoRun: prefs ? prefs.auto_run : null, setAutoRun: (on: boolean) => set("auto_run", on) };
}

type Budget = { spent: number; cap: number; total_today?: number };
function useSpend() {
  const [b, setB] = useState<{ chat: Budget; background: Budget } | null>(null);
  useEffect(() => {
    let live = true;
    const read = async () => {
      const [c, g] = await Promise.all([
        (supabase.rpc as any)("ai_budget", { p_scope: "chat" }),
        (supabase.rpc as any)("ai_budget", { p_scope: "background" }),
      ]);
      if (live && c.data && g.data) setB({ chat: c.data, background: g.data });
    };
    read();
    const t = setInterval(read, 60_000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return b;
}
const usd = (n: number) => `$${Number(n || 0).toFixed(2)}`;
const NB = "\u00a0"; // keeps "4:12 PM" and "$5.00 cap" from splitting across lines
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(" ", NB);

function paidCopy(p: Prefs): { title: string; sub: string } {
  const cap = usd(p.chat_cap_usd);
  if (p.paid_ai_ok) {
    return p.paid_ai_until
      ? { title: `Paid AI: on until ${clock(p.paid_ai_until)}`, sub: `Scout is using Claude (paid). Turns itself off at ${clock(p.paid_ai_until)} or at the ${cap}${NB}daily cap.` }
      : { title: "Paid AI: on", sub: `Scout is using Claude (paid) until you turn this off or it hits the ${cap}${NB}daily cap.` };
  }
  switch (p.paid_ai_off_reason) {
    case "cap": return { title: "Paid AI: off (daily cap hit)", sub: `Free AI only until midnight. Today hit the ${cap}${NB}cap.` };
    case "hour_up": return { title: "Paid AI: off (your hour ended)", sub: "Free AI only. Flip this on, or tap \"Yes, use paid AI\" in a chat for another hour." };
    case "watchdog": return { title: "Paid AI: off (forced off)", sub: "The watchdog caught paid spending while this was off and shut it down. Free AI only." };
    default: return { title: "Paid AI: off", sub: "Free AI only. If a job needs Claude, Scout asks first; a yes turns this on for one hour." };
  }
}

/** A switch you can read: a mini track plus its name, in one tappable pill (UI Pro Max: label + state, 40pt+ target). */
function Pill({ on, label, hint, tint = "#34c759", onToggle }: { on: boolean; label: string; hint: string; tint?: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={hint}
      title={hint}
      onClick={onToggle}
      className={cn(
        "scout-press inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-full border pl-1.5 pr-3 text-[0.8125rem] font-medium transition-colors sm:min-h-8",
        on ? "border-white/15 bg-white/[0.08] text-white" : "border-white/10 text-white/60 hover:text-white",
      )}
    >
      <span className="relative h-[1.125rem] w-[1.875rem] shrink-0 rounded-full transition-colors duration-200" style={{ background: on ? tint : "rgba(127,127,127,.35)" }} aria-hidden>
        <span className={cn("absolute top-[0.125rem] h-[0.875rem] w-[0.875rem] rounded-full bg-[#ffffff] shadow transition-[left] duration-200", on ? "left-[0.875rem]" : "left-[0.125rem]")} />
      </span>
      {label}
    </button>
  );
}

/**
 * 2026-10-06 cleanup: the two switches used to be two full rows with a paragraph each (a quarter of the panel on a
 * laptop). Now one row of pills; the explanations and today's spend sit behind the spend button.
 */
export function ScoutAutoRunBar() {
  const { prefs, set } = usePrefs();
  const spend = useSpend();
  const [more, setMore] = useState(false);
  if (!prefs) return null;
  const paid = paidCopy(prefs);
  const paidLabel = prefs.paid_ai_ok
    ? prefs.paid_ai_until ? `Paid AI to ${clock(prefs.paid_ai_until)}` : "Paid AI"
    : prefs.paid_ai_off_reason === "cap" ? "Paid AI · cap hit" : "Paid AI";
  return (
    <div className="border-b border-white/[0.06] px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Pill
          on={prefs.auto_run}
          label="Auto-run"
          hint={prefs.auto_run ? "Auto-run is on: Scout just does it. Tap to turn off." : "Auto-run is off: Scout asks before it changes anything. Tap to turn on."}
          onToggle={() => set("auto_run", !prefs.auto_run)}
        />
        <Pill
          on={prefs.paid_ai_ok}
          label={paidLabel}
          tint="#ff9f0a"
          hint={`${paid.title}. ${paid.sub}`}
          onToggle={() => set("paid_ai_ok", !prefs.paid_ai_ok)}
        />
        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          aria-expanded={more}
          className="ml-auto inline-flex min-h-10 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[0.75rem] tabular-nums text-white/50 hover:text-white sm:min-h-8"
        >
          {spend ? `${usd(spend.chat.spent + spend.background.spent)}${NB}today` : "Spend"}
          <svg viewBox="0 0 10 10" className={cn("h-2.5 w-2.5 transition-transform duration-200", more && "rotate-180")} aria-hidden>
            <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className={cn("scout-collapse", more && "is-open")}>
        <div>
          <div className="space-y-1.5 pt-2 text-[0.75rem] leading-snug text-white/60">
            <p><span className="font-semibold text-white/85">Auto-run {prefs.auto_run ? "on" : "off"}.</span> {prefs.auto_run ? "Scout just does it. No buttons to tap." : "Scout asks you before it changes anything."}</p>
            <p><span className="font-semibold text-white/85">{paid.title}.</span> {paid.sub}</p>
            {spend && (
              <p>
                Spent today: chat {usd(spend.chat.spent)} of {usd(spend.chat.cap)}{NB}cap · background {usd(spend.background.spent)} of {usd(spend.background.cap)}{NB}cap
                {" · "}Cookie Yeti and other AI {usd(Math.max(0, Number(spend.chat.total_today ?? 0) - Number(spend.chat.spent) - Number(spend.background.spent)))}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
