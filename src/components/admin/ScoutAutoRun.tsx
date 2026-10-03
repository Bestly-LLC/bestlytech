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

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200",
        on ? "bg-[#34c759]" : "bg-[#3a3a40] bento:bg-[#d9d7d0]",
      )}
    >
      <span className={cn("absolute top-0.5 h-6 w-6 rounded-full bg-[#ffffff] shadow transition-[left] duration-200", on ? "left-[1.375rem]" : "left-0.5")} />
    </button>
  );
}

function Row({ title, sub, on, onToggle }: { title: string; sub: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-white">{title}</p>
        <p className="text-[0.6875rem] leading-snug text-white/55">{sub}</p>
      </div>
      <Switch on={on} label={title} onToggle={onToggle} />
    </div>
  );
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

export function ScoutAutoRunBar() {
  const { prefs, set } = usePrefs();
  const spend = useSpend();
  if (!prefs) return null;
  return (
    <div className="border-b border-white/[0.06] px-3 py-1">
      <Row
        title={`Auto-run is ${prefs.auto_run ? "on" : "off"}`}
        sub={prefs.auto_run ? "Scout just does it. No buttons to tap." : "Scout asks you before it changes anything."}
        on={prefs.auto_run}
        onToggle={() => set("auto_run", !prefs.auto_run)}
      />
      <Row
        {...paidCopy(prefs)}
        on={prefs.paid_ai_ok}
        onToggle={() => set("paid_ai_ok", !prefs.paid_ai_ok)}
      />
      {spend && (
        <p className="pb-1.5 text-[0.6875rem] leading-snug text-white/55">
          Spent today: chat {usd(spend.chat.spent)} of {usd(spend.chat.cap)} cap · background jobs {usd(spend.background.spent)} of {usd(spend.background.cap)} cap
          {" · "}Cookie Yeti and other AI {usd(Math.max(0, Number(spend.chat.total_today ?? 0) - Number(spend.chat.spent) - Number(spend.background.spent)))}
        </p>
      )}
    </div>
  );
}
