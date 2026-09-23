import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/*
 * Scout's two switches, stored in scout_settings so the server (admin-chat) enforces them:
 * - Auto-run: Scout does what it suggests (runs Mac jobs, changes data, ships fixes) without a tap.
 * - Paid AI without asking: Scout uses Claude (paid) straight away. Off = it tries the free AI on
 *   the Mac mini first and asks before spending.
 */

type Prefs = { auto_run: boolean; paid_ai_ok: boolean };
let value: Prefs | null = null;
const subs = new Set<(v: Prefs | null) => void>();
const emit = () => subs.forEach((f) => f(value));
let loading: Promise<void> | null = null;

function load() {
  if (!loading) {
    loading = (async () => {
      const { data } = await (supabase.rpc as any)("scout_prefs");
      value = { auto_run: data?.auto_run === true, paid_ai_ok: data?.paid_ai_ok === true };
      emit();
    })();
  }
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
    if (error) { value = was; emit(); }
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

export function ScoutAutoRunBar() {
  const { prefs, set } = usePrefs();
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
        title={`Paid AI: ${prefs.paid_ai_ok ? "use without asking" : "ask me first"}`}
        sub={prefs.paid_ai_ok
          ? "Scout uses Claude (paid) right away."
          : "Scout tries the free AI on your Mac mini first, and asks before it spends money."}
        on={prefs.paid_ai_ok}
        onToggle={() => set("paid_ai_ok", !prefs.paid_ai_ok)}
      />
    </div>
  );
}
