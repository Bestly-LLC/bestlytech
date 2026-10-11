/**
 * /admin/hunter: Hunter, Bestly's lead-generation employee (free, no Claude tokens).
 * Finds local service businesses every night for Maya's cold-calling campaigns, reads their websites, scores the fit,
 * checks the phone line type and tops each campaign's queue up to its daily target.
 *   Campaigns   daily target and on/off per campaign (hunter_campaign_set)
 *   Settings    pause everything, the minimum fit score, the daily cap on paid line-type lookups (hunter_settings_set)
 *   Sources     where leads come from, last good run, last error (hunter_source_set)
 *   Runs        what each step did most recently
 * Data: hunter_overview() (admin only), queue health from hunter_health (written by the 6 AM check).
 * Compliance: the National Do Not Call Registry is not scrubbed yet, so every lead is stored as "not checked".
 * Nothing here touches RoofGuard or Reese.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Crosshair, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { rpcArgs } from "@/components/admin/roofguard/AvaShared";
import { Switch } from "@/components/ui/switch";

type Campaign = {
  slug: string; owner: string; name: string; area: string; business_types: string[]; daily_target: number; enabled: boolean;
  queued: number; queued_today: number; checked_ready: number;
};
type Source = { slug: string; name: string; enabled: boolean; notes: string | null; fail_streak: number; last_run_at: string | null; last_ok_at: string | null; last_error: string | null };
type Run = { id: number; started_at: string; step: string; campaign_slug: string | null; source: string | null; found: number; deduped: number; checked: number; rejected: number; queued: number; error: string | null };
type Overview = {
  settings: { enabled: boolean; min_fit: number; telnyx_daily_cap: number };
  campaigns: Campaign[]; sources: Source[]; funnel: Record<string, number>; optouts: number; recent_runs: Run[];
};
type Health = { ok: boolean; problems: string[] | null; healed: boolean; checked_at: string };

const NB = " ";
const STEP_LABEL: Record<string, string> = { find: "Find", read: "Read sites", check: "Line type", handoff: "Hand off" };
const FUNNEL: Array<[string, string]> = [["new", "New"], ["checked", "Checked"], ["queued", "Queued"], ["called", "Called"], ["booked", "Booked"], ["rejected", "Rejected"], ["opted_out", "Opted out"]];

const when = (iso: string | null) => iso
  ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(/\s(AM|PM)/, `${NB}$1`)
  : "never";

function Stat({ label, value, warn }: { label: string; value: number | string | undefined; warn?: boolean }) {
  return (
    <div className={cn("rounded-2xl px-3 py-3 ring-1", warn ? "bg-orange-500/10 ring-orange-500/30" : "bg-white/[0.04] ring-white/10")}>
      <div className={cn("text-[26px] font-semibold leading-none tabular-nums", warn ? "text-orange-300" : "text-white")}>{value ?? "–"}</div>
      <div className={cn("mt-1.5 text-[12px]", warn ? "text-orange-200" : "text-white/60")}>{label}</div>
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10 sm:p-5">
      <h2 className="text-[17px] font-semibold text-white">{title}</h2>
      {hint && <p className="mt-1 text-[14px] text-white/60">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function NumberField({ label, value, min, max, onSave, suffix }: { label: string; value: number; min: number; max: number; onSave: (n: number) => void; suffix?: string }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < min || n > max) { setV(String(value)); toast.error(`${label} must be ${min} to ${max}.`); return; }
    if (n !== value) onSave(n);
  };
  return (
    <label className="flex items-center justify-between gap-3 text-[15px] text-white/85">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <input inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/[^\d]/g, ""))} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="h-11 w-20 rounded-xl bg-white/[0.06] px-3 text-right text-[15px] tabular-nums text-white outline-none ring-1 ring-white/10 focus:ring-white/30"
          aria-label={label} />
        {suffix && <span className="text-[13px] text-white/55">{suffix}</span>}
      </span>
    </label>
  );
}

export default function Hunter() {
  const [data, setData] = useState<Overview | null>(null);
  const [health, setHealth] = useState<Health | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const writes = useRef(0);   // a poll must not overwrite a value that was just saved

  const load = useCallback(async () => {
    const { data: d, error } = await rpcArgs<Overview>("hunter_overview");
    if (writes.current > 0) return;
    if (error || !d) { setErr("Couldn't load Hunter. Try again in a minute."); return; }
    setErr(null); setData(d);
    const h = await supabase.from("hunter_health").select("ok, problems, healed, checked_at").eq("source", "hunter").maybeSingle();
    setHealth((h.data as Health | null) ?? null);
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

  const s = data?.settings;
  const queued = data?.campaigns.filter((c) => c.owner === "maya").reduce((a, c) => a + c.queued, 0);
  const today = data?.campaigns.filter((c) => c.owner === "maya").reduce((a, c) => a + c.queued_today, 0);
  const target = data?.campaigns.filter((c) => c.owner === "maya" && c.enabled).reduce((a, c) => a + c.daily_target, 0);
  const ready = data?.campaigns.reduce((a, c) => a + c.checked_ready, 0);

  const stale = !!health && Date.now() - Date.parse(health.checked_at) > 26 * 3600 * 1000;
  const chip = health === undefined
    ? { tone: "bg-white/[0.05] text-white/60 ring-white/10", Icon: Loader2, text: "Checking…", spin: true }
    : health === null
      ? { tone: "bg-white/[0.05] text-white/60 ring-white/10", Icon: AlertTriangle, text: "No check yet", spin: false }
      : !health.ok
        ? { tone: "bg-amber-500/10 text-amber-200 ring-amber-500/30", Icon: AlertTriangle, text: "Needs a look", spin: false }
        : stale
          ? { tone: "bg-amber-500/10 text-amber-200 ring-amber-500/30", Icon: AlertTriangle, text: "Check is overdue", spin: false }
          : { tone: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/25", Icon: CheckCircle2, text: "Queue OK", spin: false };

  return (
    <div className="space-y-5 pb-24">
      <header className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-[2rem] font-bold leading-[1.1] tracking-[-0.015em] text-white sm:text-3xl">
              <Crosshair className="h-7 w-7 text-white/70" aria-hidden />Hunter
            </h1>
            <p className="mt-1.5 text-[15px] text-white/65">Lead Generation{" · "}finds leads for Maya every night, free</p>
          </div>
          <span role="status" title={health?.problems?.join("; ") ?? ""} className={cn("inline-flex min-h-[44px] items-center gap-2 rounded-2xl px-3.5 ring-1", chip.tone)}>
            <chip.Icon className={cn("h-4 w-4 shrink-0", chip.spin && "animate-spin")} aria-hidden />
            <span className="leading-tight">
              <span className="block whitespace-nowrap text-[15px] font-semibold">{chip.text}</span>
              {health && <span className="block text-[11px] opacity-80">Checked {when(health.checked_at)}</span>}
            </span>
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Hunter at a glance">
          <Stat label="Queued for Maya" value={queued} warn={data != null && (target ?? 0) > 0 && (queued ?? 0) < (target ?? 0) * 0.5} />
          <Stat label="Added today" value={today} />
          <Stat label="Daily target" value={target} />
          <Stat label="Landlines waiting" value={ready} />
        </div>
        {s && !s.enabled && <p className="rounded-2xl bg-amber-500/10 p-3 text-[15px] text-amber-100 ring-1 ring-amber-500/30">Hunter is paused. Nothing is found, checked or queued until you turn it back on.</p>}
      </header>

      {err && (
        <div role="alert" className="rounded-2xl bg-amber-500/10 p-4 text-[15px] text-amber-100 ring-1 ring-amber-500/30">
          <p>{err}</p>
          <button type="button" onClick={() => void load()} className="mt-2 min-h-[44px] rounded-xl bg-white/10 px-4 font-medium text-white hover:bg-white/15">Retry</button>
        </div>
      )}
      {!data && !err && Array.from({ length: 3 }, (_, i) => <div key={i} className="h-[140px] rounded-2xl bg-white/[0.04] ring-1 ring-white/10 motion-safe:animate-pulse" aria-hidden />)}

      {data && (<>
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

        <Card title="Settings" hint="Line-type lookups cost a fraction of a cent each. The cap stops a bad night from running up a bill.">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 text-[15px] text-white/85">
              <span>Hunter is running</span>
              <Switch checked={s!.enabled} onCheckedChange={(v) => void write("hunter_settings_set", { p_enabled: v }, v ? "Hunter is running" : "Hunter is paused")} aria-label="Hunter on or off" />
            </div>
            <NumberField label="Lowest fit score to check" value={s!.min_fit} min={0} max={100} suffix="of 100"
              onSave={(n) => void write("hunter_settings_set", { p_min_fit: n }, `Minimum fit set to ${n}`)} />
            <NumberField label="Line-type lookups a day" value={s!.telnyx_daily_cap} min={0} max={1000} suffix="max"
              onSave={(n) => void write("hunter_settings_set", { p_telnyx_daily_cap: n }, `Lookup cap set to ${n}`)} />
          </div>
          <p className="mt-4 rounded-xl bg-white/[0.04] p-3 text-[13px] leading-relaxed text-white/65 ring-1 ring-white/10">
            Do Not Call: Hunter does not scrub the National Do Not Call Registry yet (it needs the FTC registration in the calling compliance plan), so every lead is marked not checked.
            It queues landlines only; mobile numbers are kept for email, and VoIP numbers are not queued. {data.optouts} {data.optouts === 1 ? "number is" : "numbers are"} on the opt-out list, which is checked before anything is added.
          </p>
        </Card>

        <Card title="Sources" hint="Free, public listings only.">
          <ul className="divide-y divide-white/10">
            {data.sources.map((x) => (
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

        <Card title="Where leads stand">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {FUNNEL.map(([k, label]) => (
              <div key={k} className="rounded-xl bg-white/[0.04] px-3 py-2.5 ring-1 ring-white/10">
                <dd className="text-[20px] font-semibold tabular-nums text-white">{data.funnel[k] ?? 0}</dd>
                <dt className="text-[12px] text-white/60">{label}</dt>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="Recent runs">
          {data.recent_runs.length === 0 ? <p className="text-[15px] text-white/65">Nothing has run yet. The first nightly run starts at 10 PM.</p> : (
            <ul className="divide-y divide-white/10 text-[14px]">
              {data.recent_runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                  <span className="text-white/85">{STEP_LABEL[r.step] ?? r.step}{r.source ? ` · ${r.source}` : ""}{r.campaign_slug ? ` · ${r.campaign_slug.replace("maya-", "")}` : ""}</span>
                  <span className="tabular-nums text-white/55">
                    {r.error ? <span className="text-amber-300">failed</span> : `${r.found} found · ${r.checked} checked · ${r.queued} queued`}{" · "}{when(r.started_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </>)}
    </div>
  );
}
