/**
 * "Sentry off at home" row for the Ready widget. Car Guard turns Sentry off when the car has been parked at
 * N Kings Rd for 10 min (saves battery) and back on when it leaves; guest trips and manual taps are left alone.
 * Data: admin_sentry_home(); switch + "Go live": admin_sentry_home_set(). Commands go through TezLab only.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { focusRing, text, tint } from "@/components/admin/ui";

type SentryHome = {
  enabled: boolean; dry_run: boolean; zone: "home" | "away" | null; zone_since: string | null; override: string | null;
  last_action: string | null; last_action_at: string | null; sentry_on: boolean | null; sentry_at: string | null;
  attempts: number; last_error: string | null; in_trip: boolean; tezlab_up: boolean; problem: boolean;
  settle_eta: string | null; want: string | null; would_send: string | null;
};

/** 12-hour clock in LA time. The space before AM/PM is a no-break space so "3:05 PM" never splits. */
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" }).replace(/\s/g, " ");

function status(s: SentryHome): { line: string; warn?: boolean } {
  if (!s.enabled) return { line: "Off · Sentry follows trip rules only (on between trips, even at home)" };
  if (s.in_trip) return { line: "Guest trip: trip rules apply" };
  if (s.problem) return { line: `Couldn't turn it ${s.want === "on" ? "on" : "off"} · Car Guard told Scout`, warn: true };
  if (!s.tezlab_up) return { line: "TezLab is down · retries when it's back" };
  if (s.dry_run && s.want && s.would_send === "true") return { line: `Test mode: would turn it ${s.want} now (nothing sent)` };
  if (s.override === "manual_on") return { line: "On at home: you turned it on. Back to auto after the car leaves." };
  if (s.override === "manual_off") return { line: "Off while away: you turned it off. Back to auto after the car gets home." };
  if (s.zone === "home") {
    if (s.sentry_on === false) return { line: `Off at home since ${clock(s.last_action === "sentry_off" && s.last_action_at ? s.last_action_at : s.zone_since ?? new Date().toISOString())}` };
    if (s.zone_since && s.settle_eta && Date.parse(s.settle_eta) > Date.now()) return { line: `Home since ${clock(s.zone_since)} · turns off about ${clock(s.settle_eta)}` };
    return { line: s.zone_since ? `Home since ${clock(s.zone_since)} · turning it off next check` : "Home · turning it off next check" };
  }
  if (s.zone === "away") {
    const since = s.zone_since ? ` since ${clock(s.zone_since)}` : "";
    return { line: s.sentry_on === false ? `Away${since} · turning it on next check` : `On · away${since}` };
  }
  return { line: "Waiting for the car's location" };
}

export function SentryHomeRow() {
  const [s, setS] = useState<SentryHome | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { data, error } = await (supabase.rpc("admin_sentry_home" as never) as unknown as Promise<{ data: SentryHome | null; error: unknown }>);
    if (!error && data) setS(data);
  }, []);
  useEffect(() => { void load(); const id = window.setInterval(() => { if (!document.hidden) void load(); }, 60000); return () => window.clearInterval(id); }, [load]);

  const set = async (enabled: boolean, dry?: boolean) => {
    setBusy(true);
    const args = (dry === undefined ? { p_enabled: enabled } : { p_enabled: enabled, p_dry_run: dry }) as never;
    const { data, error } = await (supabase.rpc("admin_sentry_home_set" as never, args) as unknown as Promise<{ data: SentryHome | null; error: { message: string } | null }>);
    setBusy(false);
    if (error || !data) { toast.error(error?.message ?? "Couldn't change it"); return; }
    setS(data);
    toast.success(!enabled ? "Sentry at home is off" : dry === false ? "Live: Sentry goes off when parked at home" : "Sentry at home is on in test mode");
  };

  if (!s) return null;
  const st = status(s);
  return (
    <div className="flex items-start gap-3 border-t border-white/[0.06] px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p id="sentry-home-h" className="text-[15px] text-white">Sentry off at home</p>
          {s.enabled && s.dry_run && (
            <>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[12px] font-medium text-white/70">Test mode</span>
              <button type="button" onClick={() => void set(true, false)} disabled={busy}
                className={cn("min-h-[28px] rounded-md text-[13px] font-semibold text-[#0A84FF] disabled:opacity-50", focusRing)}>Go live</button>
            </>
          )}
        </div>
        <p className={cn(text.detail, "mt-0.5 break-words", st.warn && tint.orange)}>{st.line}</p>
      </div>
      <Switch checked={s.enabled} disabled={busy} aria-labelledby="sentry-home-h" onCheckedChange={(v) => void set(v)} />
    </div>
  );
}
