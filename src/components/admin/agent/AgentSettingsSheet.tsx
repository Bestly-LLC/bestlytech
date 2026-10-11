/**
 * The Settings sheet for a template agent (the gear button in the top bar).
 *   Status (live or paused), orb color, cost per minute, daily spend cap, Coach on or off: one Save writes them with admin_agent_set.
 *   Run setup again: agent-hub setup re-attaches the post-call webhook (the only thing it ever changes on the voice agent).
 *   Sync calls now: agent-hub sync pulls in any finished call the webhook missed.
 * Paused only changes this app (Switchboard and the Coach skip the agent); it does not hang up or unplug the phone line.
 */
import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, Loader2, RefreshCw, Settings, Wrench } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AvaOrb } from "@/components/admin/roofguard/AvaOrb";
import { ScrollSheet } from "@/components/admin/roofguard/AvaSheet";
import { Switch } from "@/components/ui/switch";
import { announceAgentChanged, btnPrimary, btnQuiet, fieldCls, hub, ring, rpcArgs, type AgentInfo } from "./agentApi";

const HUES = [21, 45, 140, 190, 215, 265, 320, 350];

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-t border-white/10 py-5 first:border-t-0 first:pt-0">
      <h3 className="text-[15px] font-semibold text-white">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-white/60">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-haspopup="dialog"
      className={cn("inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-white/[0.04] px-3.5 text-[15px] font-medium text-white/85 ring-1 ring-white/10 transition hover:bg-white/[0.08] motion-reduce:transition-none", ring)}>
      <Settings className="h-4 w-4" aria-hidden /><span>Settings</span>
    </button>
  );
}

export function AgentSettingsSheet({ agent, open, onOpenChange }: { agent: AgentInfo; open: boolean; onOpenChange: (o: boolean) => void }) {
  const s = agent.settings ?? {};
  const [status, setStatus] = useState<"live" | "paused">(agent.status === "paused" ? "paused" : "live");
  const [hue, setHue] = useState(agent.orb_hue);
  const [perMin, setPerMin] = useState(String(s.cost_per_min ?? 0.12));
  const [cap, setCap] = useState(String(s.daily_cap ?? 10));
  const [coachOn, setCoachOn] = useState(s.coach_on !== false);
  const [busy, setBusy] = useState<"save" | "setup" | "sync" | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  // Start fresh each time the sheet opens, so an abandoned edit never sticks.
  useEffect(() => {
    if (!open) return;
    const st = agent.settings ?? {};
    setStatus(agent.status === "paused" ? "paused" : "live"); setHue(agent.orb_hue);
    setPerMin(String(st.cost_per_min ?? 0.12)); setCap(String(st.daily_cap ?? 10)); setCoachOn(st.coach_on !== false); setNote(null);
  }, [open, agent]);

  const pm = Number(perMin), dc = Number(cap);
  const pmOk = perMin.trim() !== "" && Number.isFinite(pm) && pm >= 0 && pm <= 5;
  const dcOk = cap.trim() !== "" && Number.isFinite(dc) && dc >= 0 && dc <= 500;
  const dirty = status !== (agent.status === "paused" ? "paused" : "live") || hue !== agent.orb_hue || pm !== (s.cost_per_min ?? 0.12) || dc !== (s.daily_cap ?? 10) || coachOn !== (s.coach_on !== false);

  const save = async () => {
    if (!pmOk || !dcOk) return;
    setBusy("save"); setNote(null);
    const r = await rpcArgs("admin_agent_set", { p_slug: agent.slug, p_patch: { status, orb_hue: hue, settings: { cost_per_min: pm, daily_cap: dc, coach_on: coachOn } } });
    setBusy(null);
    if (r.error) { setNote({ ok: false, text: r.error.message }); return; }
    toast.success("Saved");
    announceAgentChanged(agent.slug);
    onOpenChange(false);
  };

  const setup = async () => {
    setBusy("setup"); setNote(null);
    const r = await hub<{ log?: string[]; attached?: boolean }>({ action: "setup", slug: agent.slug }, "Setup didn't finish. Try again in a minute.");
    setBusy(null);
    if (!r.ok) { setNote({ ok: false, text: r.error }); return; }
    setNote({ ok: true, text: (r.data.log ?? ["Done."]).join(" ") });
    announceAgentChanged(agent.slug);
  };

  const sync = async () => {
    setBusy("sync"); setNote(null);
    const r = await hub<{ listed?: number; added?: number }>({ action: "sync", slug: agent.slug, limit: 100 }, "Couldn't sync calls. Try again in a minute.");
    setBusy(null);
    if (!r.ok) { setNote({ ok: false, text: r.error }); return; }
    const n = r.data.added ?? 0;
    setNote({ ok: true, text: n ? `Added ${n} ${n === 1 ? "call" : "calls"} that hadn't arrived.` : "Every call is already here." });
    announceAgentChanged(agent.slug);
  };

  return (
    <ScrollSheet open={open} onClose={() => onOpenChange(false)} title={<><Settings className="h-5 w-5 text-white/70" aria-hidden />{agent.name} settings</>}
      description={`Everything you set once and forget. ${agent.name}'s greeting and script live under Prompt on the page.`}>
      <div className="pb-6">
        <Group title="Status" hint="Paused only changes this app: Switchboard and the Coach skip the agent. It does not hang up the phone line.">
          <div role="radiogroup" aria-label="Status" className="grid grid-cols-2 gap-2">
            {(["live", "paused"] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={status === v} onClick={() => setStatus(v)}
                className={cn("min-h-[44px] rounded-xl px-4 text-[15px] font-medium ring-1", ring,
                  status === v ? "bg-white text-black ring-white" : "bg-white/[0.05] text-white/80 ring-white/10 hover:bg-white/[0.09]")}>
                {v === "live" ? "Live" : "Paused"}</button>
            ))}
          </div>
        </Group>

        <Group title="Orb color" hint="Tints the glow around the orb on this page and in the sidebar.">
          <div className="flex items-center gap-4">
            <AvaOrb size={56} hue={hue} label={`${agent.name} orb preview`} />
            <div className="min-w-0 flex-1 space-y-2">
              <label className="sr-only" htmlFor="orb-hue">Orb hue, 0 to 359</label>
              <input id="orb-hue" type="range" min={0} max={359} value={hue} onChange={(e) => setHue(Number(e.target.value))}
                className="h-11 w-full cursor-pointer accent-white" style={{ accentColor: `hsl(${hue} 100% 72%)` }} />
              <div className="flex flex-wrap gap-2">
                {HUES.map((h) => (
                  <button key={h} type="button" onClick={() => setHue(h)} aria-label={`Hue ${h}`} aria-pressed={hue === h}
                    className={cn("h-11 w-11 rounded-full ring-2 ring-offset-2 ring-offset-[#0b0b0d]", ring, hue === h ? "ring-white" : "ring-transparent")}
                    style={{ background: `hsl(${h} 100% 72%)` }} />
                ))}
              </div>
            </div>
          </div>
        </Group>

        <Group title="Cost and daily cap" hint="Each call's cost is its minutes times this rate. When today's calls reach the cap, Switchboard warns you. Incoming calls are never blocked.">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="cost-min" className="mb-1 block text-[13px] font-medium text-white">Cost per minute</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-white/50" aria-hidden>$</span>
                <input id="cost-min" inputMode="decimal" autoComplete="off" value={perMin} aria-invalid={!pmOk}
                  onChange={(e) => setPerMin(e.target.value.replace(/[^0-9.]/g, ""))} className={cn(fieldCls, "h-11 pl-7 tabular-nums")} />
              </div>
              <p className={cn("mt-1 text-xs", pmOk ? "text-white/50" : "text-amber-200")}>{pmOk ? "0 to $5" : "Enter 0 to 5."}</p>
            </div>
            <div>
              <label htmlFor="daily-cap" className="mb-1 block text-[13px] font-medium text-white">Daily cap</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-white/50" aria-hidden>$</span>
                <input id="daily-cap" inputMode="decimal" autoComplete="off" value={cap} aria-invalid={!dcOk}
                  onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ""))} className={cn(fieldCls, "h-11 pl-7 tabular-nums")} />
              </div>
              <p className={cn("mt-1 text-xs", dcOk ? "text-white/50" : "text-amber-200")}>{dcOk ? "0 means no cap" : "Enter 0 to 500."}</p>
            </div>
          </div>
        </Group>

        <Group title="Coach" hint="Reads each call over 20 seconds on free AI and suggests habits. Nothing reaches the agent until you approve it.">
          <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-4 rounded-xl bg-white/[0.04] px-4 ring-1 ring-white/10">
            <span className="text-[15px] text-white">Coach is {coachOn ? "on" : "off"}</span>
            <Switch checked={coachOn} onCheckedChange={setCoachOn} aria-label="Coach on or off" />
          </label>
        </Group>

        <div className="flex flex-wrap items-center gap-3 pb-2">
          <button type="button" onClick={() => void save()} disabled={!dirty || !pmOk || !dcOk || busy !== null} className={btnPrimary}>
            {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Save</button>
          {!dirty && <span className="text-xs text-white/50">Nothing changed.</span>}
        </div>

        <Group title="Connection" hint="Run setup again if calls stop arriving. It re-attaches the post-call webhook and changes nothing else on the voice agent.">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void setup()} disabled={busy !== null} className={btnQuiet}>
              {busy === "setup" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Wrench className="h-4 w-4" aria-hidden />}Run setup again</button>
            <button type="button" onClick={() => void sync()} disabled={busy !== null} className={btnQuiet}>
              {busy === "sync" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}Sync calls now</button>
          </div>
        </Group>

        {note && (
          <p role={note.ok ? "status" : "alert"} className={cn("flex items-start gap-2 rounded-xl p-3 text-[14px]", note.ok ? "bg-emerald-500/10 text-emerald-200" : "bg-amber-500/10 text-amber-100")}>
            {note.ok && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}<span>{note.text}</span>
          </p>
        )}
      </div>
    </ScrollSheet>
  );
}
