/**
 * The "Coach" group inside each page's Settings sheet.
 *   RoofGuard Ava: "Test small rules automatically" (rg_settings.coach_auto_test). Off = the Coach's small rules wait for your tap, like big ones.
 *   Personal Ava:  "New rules need my approval" (ava_settings.coach_needs_approval). Off = the Coach's rules go live on their own.
 *   Both:          the weekly pass (read-only for now: Mondays 10:05 AM Pacific; changing the day and time is coming soon).
 * Saves go through admin_coach_setting_set. A rule you write yourself never waits (it goes live, or starts its test, right away).
 */
import { useCallback, useEffect, useId, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CellSwitch } from "./AvaCell";
import { coachChanged } from "./coachBus";
import { rpc, whenDay12, type Manage, type Source } from "./coachShared";

export function CoachSettingsGroup({ source }: { source: Source }) {
  const uid = useId();
  const [m, setM] = useState<Manage | null>(null);
  const [on, setOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const personal = source === "ava";

  const load = useCallback(async () => {
    const { data, error } = await rpc<Manage>("admin_coach_manage", { p_source: source });
    if (error || !data) { setMsg({ ok: false, text: "Couldn't load the Coach settings." }); return; }
    setM(data); setOn(personal ? data.settings.needs_approval !== false : data.settings.auto_test !== false);
  }, [source, personal]);
  useEffect(() => { void load(); }, [load]);

  const change = async (v: boolean) => {
    setOn(v); setBusy(true); setMsg(null);
    const { error } = await rpc("admin_coach_setting_set", { p_source: source, p_on: v });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: `Couldn't save that. ${error.message}` }); void load(); return; }
    setMsg({ ok: true, text: "Saved" }); setTimeout(() => setMsg(null), 2500); coachChanged(source);
  };

  if (!m) return msg ? <p role="alert" className="text-sm text-red-300">{msg.text}</p> : <Loader2 className="mx-auto h-5 w-5 animate-spin text-white/50" aria-label="Loading" />;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p id={`${uid}-sw`} className="text-[15px] font-medium text-white">{personal ? "New rules need my approval" : "Test small rules automatically"}</p>
          <p className="mt-0.5 text-xs text-white/60">
            {personal
              ? (on ? "The Coach's weekly suggestions wait in Waiting for you until you approve them." : "The Coach's suggestions go live on her next call without waiting for you. You can still pause or delete any rule.")
              : (on ? "A small rule from the Coach starts testing on half her calls on its own. Big ones always wait for you." : "Every rule from the Coach waits in Waiting for you until you start its test.")}
            {" "}Rules you write yourself never wait.</p>
        </div>
        <CellSwitch on={on} busy={busy} labelledBy={`${uid}-sw`} onChange={(v) => void change(v)} />
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={cn("inline-flex items-center gap-1.5 text-sm", msg.ok ? "text-emerald-300" : "text-red-300")}>
        {msg.ok ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <AlertTriangle className="h-4 w-4" aria-hidden />}{msg.text}</p>}

      <div className="rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
        <p className="flex items-center gap-2 text-[15px] font-medium text-white"><CalendarClock className="h-4 w-4 text-white/60" aria-hidden />Weekly pass</p>
        <p className="mt-1 text-sm text-white/80">Mondays at 10:05&nbsp;AM Pacific</p>
        <p className="mt-0.5 text-xs text-white/60">Last pass: {whenDay12(m.last_weekly)}. Picking a different day and time is coming soon; the schedule is fixed for now.</p>
      </div>
    </div>
  );
}
