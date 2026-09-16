import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, XCircle, Copy, Check, ArrowUpCircle } from "lucide-react";
import {
  enqueueCommand, waitForCommand, isCommandFinished, describeCommand, fetchAgentState, isAgentOnline,
  agentSupportsSnapshots, fetchSnapshot, SNAPSHOT_AGENT_VERSION, HomeHubError,
  type AgentState, type CommandTarget, type Snapshot, type SnapshotSource,
} from "@/services/homeHubApi";
import { pollInterval } from "@/lib/polling";

export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export type Health = "ok" | "warn" | "down";

export function HealthBadge({ health, label }: { health: Health; label: string }) {
  const tone = health === "ok" ? "text-green-300 bg-green-500/10 border-green-500/25"
    : health === "warn" ? "text-amber-300 bg-amber-500/10 border-amber-500/25"
    : "text-red-300 bg-red-500/10 border-red-500/25";
  const Icon = health === "ok" ? CheckCircle2 : health === "warn" ? AlertTriangle : XCircle;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
}

export function Panel({ title, icon, right, children, className = "" }: { title?: string; icon?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-6 ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between gap-3 mb-4">
          {title && <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-white">{icon}{title}</h3>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4">
      <p className="text-xs text-white/60">{label}</p>
      <p className="text-2xl font-semibold text-white tabular-nums mt-1 break-words">{value}</p>
      {hint && <p className="text-xs text-white/60 mt-1">{hint}</p>}
    </div>
  );
}

export async function copyText(text: string, what = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(what);
  } catch {
    toast.error("Couldn't copy. Select the text and copy it manually.");
  }
}

/** A value with a copy button. Monospace, wraps on phones. */
export function CopyValue({ label, value, mono = true }: { label: string; value: string | number | null | undefined; mono?: boolean }) {
  const [done, setDone] = useState(false);
  if (value === null || value === undefined || value === "") return null;
  const text = String(value);
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-white/[0.05] last:border-0">
      <div className="min-w-0">
        <p className="text-xs text-white/60">{label}</p>
        <p className={`text-sm text-white/90 break-all ${mono ? "font-mono" : ""}`}>{text}</p>
      </div>
      <Button
        type="button" variant="ghost" size="icon" aria-label={`Copy ${label}`}
        className="h-9 w-9 shrink-0 text-white/60 hover:text-white hover:bg-white/5"
        onClick={async () => { await copyText(text, `${label} copied`); setDone(true); setTimeout(() => setDone(false), 1500); }}
      >
        {done ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      </Button>
    </div>
  );
}

/** Agent heartbeat, refreshed every 30s. */
export function useAgent() {
  const [agent, setAgent] = useState<AgentState | null>(null);
  const [error, setError] = useState<HomeHubError | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const load = useCallback(async () => {
    try { setAgent(await fetchAgentState()); setError(null); }
    catch (e) { setError(e instanceof HomeHubError ? e : new HomeHubError(String(e))); }
    setNow(Date.now());
    setLoaded(true);
  }, []);
  useEffect(() => {
    load();
    const iv = setInterval(load, pollInterval(30_000));
    return () => clearInterval(iv);
  }, [load]);
  return { agent, error, loaded, now, online: isAgentOnline(agent, now), reload: load };
}

/** Queue a command, wait for the Pi's answer, toast the outcome. */
export function useCommand(onDone?: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async (key: string, target: CommandTarget, action: string, payload: Record<string, unknown> = {}, label = "Command") => {
    setBusy(key);
    const t = toast.loading(`${label}: sent to the Pi…`);
    try {
      const queued = await enqueueCommand(target, action, payload);
      const final = await waitForCommand(queued.id, { timeoutMs: 120_000 });
      if (final && isCommandFinished(final)) {
        if (final.status === "done") toast.success(`${label}: ${describeCommand(final)}`, { id: t });
        else toast.error(`${label}: ${describeCommand(final)}`, { id: t });
      } else {
        toast.message(`${label}: still running on the Pi. It will show up in Recent commands.`, { id: t });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { id: t });
    } finally {
      setBusy(null);
      onDone?.();
    }
  }, [onDone]);
  return { busy, run };
}

export const AGENT_UPGRADE_PROMPT = `Upgrade the Bestly Home Hub agent on bestly-pi to ${SNAPSHOT_AGENT_VERSION}.
1. In the bestlytech repo, pull main.
2. scp -r scripts/home-hub-agent bestly-pi-lan:/tmp/ && ssh bestly-pi-lan 'sudo /tmp/home-hub-agent/install.sh'
   (install.sh keeps the existing /etc/bestly/home-hub-agent.json and restarts the service.)
3. Check journalctl -u bestly-home-hub-agent -n 30 shows "agent ${SNAPSHOT_AGENT_VERSION} starting" and "secret backup: ...".
4. In Supabase project rcqfqhguwpmaarseifqg confirm home_hub_agent_state.version = '${SNAPSHOT_AGENT_VERSION}' and rows for homeassistant, homebridge and host in home_hub_snapshots within 5 minutes.
Never print the agent config or any token or password.`;

/** Shown while the Pi still runs an agent that can't send snapshots. */
export function AgentUpgradeBanner({ agent }: { agent: AgentState | null }) {
  if (!agent || agentSupportsSnapshots(agent)) return null;
  return (
    <div role="status" className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <ArrowUpCircle className="h-5 w-5 text-amber-300 shrink-0 mt-0.5 hidden sm:block" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-100">One-time Pi upgrade needed</p>
          <p className="text-sm text-amber-100/80 mt-1">
            The Pi runs agent v{agent.version ?? "?"}. Live data needs v{SNAPSHOT_AGENT_VERSION}. After this, updates install from here with no SSH.
          </p>
          <p className="text-sm text-amber-100/80 mt-2"><strong className="text-amber-100">Next step:</strong> paste the prompt into Claude on your Mac.</p>
        </div>
        <Button size="sm" onClick={() => copyText(AGENT_UPGRADE_PROMPT, "Upgrade prompt copied")} className="shrink-0 self-start">
          <Copy className="h-3.5 w-3.5 mr-1.5" aria-hidden />Copy prompt
        </Button>
      </div>
    </div>
  );
}

/** Latest snapshot for one source, refreshed every 30s. */
export function useSnapshot<T>(source: SnapshotSource) {
  const [snap, setSnap] = useState<Snapshot<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    try {
      setSnap(await fetchSnapshot<T>(source));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoaded(true);
  }, [source]);
  useEffect(() => {
    load();
    const iv = setInterval(load, pollInterval(30_000));
    return () => clearInterval(iv);
  }, [load]);
  return { snap, error, loaded, reload: load };
}
