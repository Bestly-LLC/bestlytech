/**
 * Hunter's three control cards (Campaigns, Settings, Sources), moved out of the old Hunter page so the Pipeline settings sheet can embed them.
 * Self-loading: hunter_overview() (admin only), refreshed every 60 seconds while the tab is visible. A poll never overwrites a value mid-save.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { rpcArgs } from "@/components/admin/roofguard/AvaShared";
import { Switch } from "@/components/ui/switch";
import { Card, NB, NumberField, when } from "./shared";

type Campaign = {
  slug: string; owner: string; name: string; area: string; business_types: string[]; daily_target: number; enabled: boolean;
  queued: number; queued_today: number; checked_ready: number;
};
type Source = { slug: string; name: string; enabled: boolean; notes: string | null; fail_streak: number; last_run_at: string | null; last_ok_at: string | null; last_error: string | null };
type Overview = { settings: { enabled: boolean; min_fit: number; telnyx_daily_cap: number }; campaigns: Campaign[]; sources: Source[]; optouts: number };

export function HunterControls() {
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const writes = useRef(0);

  const load = useCallback(async () => {
    const { data: d, error } = await rpcArgs<Overview>("hunter_overview");
    if (writes.current > 0) return;
    if (error || !d) { setErr("Couldn't load Hunter's controls. Try again in a minute."); return; }
    setErr(null); setData(d);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 60000);
    return () => clearInterval(t);
  }, [load]);

  const write = async (fn: string, args: Record<string, unknown>, ok: string) => {
    writes.current += 1;
    const { error } = await rpcArgs(fn, args);
    writes.current -= 1;
    if (error) { toast.error("Couldn't save. Try again."); return; }
    toast.success(ok);
    void load();
  };

  if (err) return (
    <div role="alert" className="rounded-2xl bg-amber-500/10 p-4 text-[15px] text-amber-100 ring-1 ring-amber-500/30">
      <p>{err}</p>
      <button type="button" onClick={() => void load()} className="mt-2 min-h-[44px] rounded-xl bg-white/10 px-4 font-medium text-white hover:bg-white/15">Retry</button>
    </div>
  );
  if (!data) return <div className="h-[140px] rounded-2xl bg-white/[0.04] ring-1 ring-white/10 motion-safe:animate-pulse" aria-hidden />;
  const s = data.settings;

  return (
    <div className="space-y-4">
      <Card title="Campaigns" hint="Each campaign has its own daily target. The 5:30 AM hand-off tops the queue up to that number and never past it.">
        <ul className="space-y-3">
          {data.campaigns.map((c) => {
            const pct = c.daily_target ? Math.min(100, Math.round((c.queued / c.daily_target) * 100)) : 0;
            return (
              <li key={c.slug} className="rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/10">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[16px] font-medium text-white">{c.name}</p>
                    <p className="text-[13px] text-white/55">{c.area}{" · "}for {c.owner === "maya" ? "Maya" : "Reese"}</p>
                  </div>
                  <Switch checked={c.enabled} onCheckedChange={(v) => void write("hunter_campaign_set", { p_slug: c.slug, p_enabled: v }, v ? `${c.name} is on` : `${c.name} is off`)} aria-label={`${c.name} on or off`} />
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10" role="img" aria-label={`${c.queued} of ${c.daily_target} queued`}>
                    <div className="h-full rounded-full bg-sky-400/80 motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="whitespace-nowrap text-[13px] tabular-nums text-white/70">{c.queued}{NB}of{NB}{c.daily_target} queued</span>
                </div>
                <div className="mt-3">
                  <NumberField label="Daily target" value={c.daily_target} min={0} max={200} suffix="a day"
                    onSave={(n) => void write("hunter_campaign_set", { p_slug: c.slug, p_daily_target: n }, `${c.name} target set to ${n}`)} />
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="Hunter settings" hint="Line-type lookups cost a fraction of a cent each. The cap stops a bad night from running up a bill.">
        <div className="space-y-3">
          <div className="flex min-h-[44px] items-center justify-between gap-3 text-[15px] text-white/85">
            <span>Hunter is running</span>
            <Switch checked={s.enabled} onCheckedChange={(v) => void write("hunter_settings_set", { p_enabled: v }, v ? "Hunter is running" : "Hunter is paused")} aria-label="Hunter on or off" />
          </div>
          <NumberField label="Lowest fit score to check" value={s.min_fit} min={0} max={100} suffix="of 100"
            onSave={(n) => void write("hunter_settings_set", { p_min_fit: n }, `Minimum fit set to ${n}`)} />
          <NumberField label="Line-type lookups a day" value={s.telnyx_daily_cap} min={0} max={1000} suffix="max"
            onSave={(n) => void write("hunter_settings_set", { p_telnyx_daily_cap: n }, `Lookup cap set to ${n}`)} />
        </div>
        <p className="mt-4 rounded-xl bg-white/[0.04] p-3 text-[13px] leading-relaxed text-white/65 ring-1 ring-white/10">
          Do Not Call: Hunter does not scrub the National Do Not Call Registry yet (it needs the FTC registration in the calling compliance plan), so every lead is marked not checked.
          It queues landlines only; mobile numbers are kept for email, and VoIP numbers are not queued. {data.optouts} {data.optouts === 1 ? "number is" : "numbers are"} on the opt-out list, which is checked before anything is added.
        </p>
      </Card>

      <Card title="Sources" hint="Free, public listings only.">
        <ul className="divide-y divide-white/10">
          {data.sources.filter((x) => x.slug !== "jev").map((x) => (
            <li key={x.slug} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-white">{x.name}</p>
                <p className="text-[13px] text-white/55">
                  {x.slug === "apollo" ? "Not connected yet" : `Last good run ${when(x.last_ok_at)}`}
                  {x.fail_streak > 0 && <span className="text-amber-300">{" · "}failed {x.fail_streak} {x.fail_streak === 1 ? "night" : "nights"} running</span>}
                </p>
                {x.last_error && x.fail_streak > 0 && <p className="mt-0.5 break-words text-[12px] text-amber-200/80">{x.last_error}</p>}
              </div>
              <Switch checked={x.enabled} disabled={x.slug === "apollo"} onCheckedChange={(v) => void write("hunter_source_set", { p_slug: x.slug, p_enabled: v }, v ? `${x.name} is on` : `${x.name} is off`)} aria-label={`${x.name} on or off`} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
