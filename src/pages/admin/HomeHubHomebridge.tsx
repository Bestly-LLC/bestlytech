import { useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { ActionMenu } from "@/components/admin/ActionMenu";
import { EmptyState } from "@/components/admin/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SNAPSHOT_STALE_MS, type HbSnapshot } from "@/services/homeHubApi";
import {
  ago, HealthBadge, Panel, Stat, AgentUpgradeBanner, useAgent, useCommand, useSnapshot, type Health,
} from "@/components/admin/homeHub/shared";
import { RefreshCw, ExternalLink, Puzzle, Network, ListRestart, ArrowUpCircle, Loader2, Boxes } from "lucide-react";

const LAN_URL = "http://192.168.1.211:8581";
const TAILSCALE_URL = "http://100.79.2.74:8581";

export default function HomeHubHomebridge() {
  const { agent, online, now } = useAgent();
  const { snap, error, loaded, reload } = useSnapshot<HbSnapshot>("homebridge");
  const { busy, run } = useCommand(reload);
  const [confirmRestart, setConfirmRestart] = useState(false);

  const d = snap?.data ?? {};
  const stale = snap ? now - new Date(snap.capturedAt).getTime() > SNAPSHOT_STALE_MS : false;
  // The Homebridge UI reports "up" or "ok" depending on its version.
  const running = d.status === "up" || d.status === "ok";
  const up = snap?.ok && running;
  const health: Health = !snap ? "down" : stale || snap.fails >= 3 ? "down" : up ? "ok" : "warn";
  const healthLabel = !snap ? "No data" : stale ? "Stale" : !snap.ok ? "Not responding" : running ? "Running" : (d.status ?? "Unknown");
  const pluginUpdates = (d.plugins ?? []).filter((p) => p.update_available);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Homebridge"
        description={snap ? `Snapshot from the Pi ${ago(snap.capturedAt, now)}` : "Live state from Homebridge on bestly-pi"}
        actions={
          <>
            <Button
              onClick={() => setConfirmRestart(true)}
              disabled={!online || !!busy}
            >
              {busy === "restart" ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden /> : <ListRestart className="h-4 w-4 mr-1.5" aria-hidden />}
              Restart Homebridge
            </Button>
            <ActionMenu
              label="More Homebridge actions"
              items={[
                { group: "Open", label: "Open Homebridge (home Wi-Fi)", icon: ExternalLink, onSelect: () => { window.open(LAN_URL, "_blank", "noreferrer"); } },
                { group: "Open", label: "Open over Tailscale", icon: ExternalLink, onSelect: () => { window.open(TAILSCALE_URL, "_blank", "noreferrer"); } },
                { group: "Data", label: busy === "refresh" ? "Refreshing…" : "Refresh from the Pi now", icon: RefreshCw, disabled: !online || !!busy, onSelect: () => run("refresh", "homebridge", "refresh", {}, "Homebridge") },
              ]}
            />
          </>
        }
      />

      <AgentUpgradeBanner agent={agent} />
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {!online && agent && <p className="text-sm text-amber-300">The Pi agent is offline, so restart is paused.</p>}

      {!loaded ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-2xl bg-white/[0.04]" />)}</div>
      ) : !snap ? (
        <Panel><EmptyState icon={Boxes} title="No Homebridge data yet" description="It appears here within a minute of the Pi agent upgrade." /></Panel>
      ) : (
        <>
          {!snap.ok && (
            <div role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm text-red-200">
              <strong className="text-red-100">Homebridge isn't answering the Pi</strong> ({snap.fails} checks in a row). {snap.error}
              <span className="block text-red-200/80 mt-1">Try Restart Homebridge. Showing the last good snapshot below.</span>
            </div>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Status" value={<HealthBadge health={health} label={healthLabel} />} hint={d.installed_version ? `Homebridge ${d.installed_version}` : undefined} />
            <Stat
              label="Homebridge update"
              value={d.update_available ? "Available" : "Up to date"}
              hint={d.update_available ? `${d.installed_version} → ${d.latest_version}` : d.ui_installed_version ? `UI ${d.ui_installed_version}` : undefined}
            />
            <Stat label="Plugins" value={(d.plugins ?? []).length} hint={pluginUpdates.length ? `${pluginUpdates.length} with updates` : "All current"} />
            <Stat
              label="Accessories"
              value={d.accessory_count ?? "—"}
              hint={d.accessory_count == null ? "Homebridge hides this unless insecure mode is on" : `${(d.child_bridges ?? []).length} child bridges`}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="Plugins" icon={<Puzzle className="h-4 w-4 text-white/60" aria-hidden />}>
              {(d.plugins ?? []).length === 0 ? (
                <p className="text-sm text-white/60">No plugins reported.</p>
              ) : (
                <ul className="divide-y divide-white/[0.06]">
                  {(d.plugins ?? []).map((p) => (
                    <li key={p.package} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm text-white/90 truncate">{p.name}{p.disabled ? <span className="text-white/60"> · disabled</span> : null}</p>
                        <p className="text-xs text-white/60 truncate font-mono">{p.package}</p>
                      </div>
                      <span className={`inline-flex items-center gap-1 text-xs shrink-0 ${p.update_available ? "text-sky-300" : "text-white/65"}`}>
                        {p.update_available && <ArrowUpCircle className="h-3.5 w-3.5" aria-hidden />}
                        {p.installed}{p.update_available ? ` → ${p.latest}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <div className="space-y-4">
              <Panel title="Child bridges" icon={<Network className="h-4 w-4 text-white/60" aria-hidden />}>
                {(d.child_bridges ?? []).length === 0 ? (
                  <p className="text-sm text-white/60">None. Every plugin runs on the main bridge.</p>
                ) : (
                  <ul className="divide-y divide-white/[0.06]">
                    {(d.child_bridges ?? []).map((c) => (
                      <li key={`${c.plugin}-${c.name}`} className="flex items-center justify-between gap-3 py-2.5">
                        <span className="text-sm text-white/85 truncate">{c.name}</span>
                        <HealthBadge health={c.status === "ok" ? "ok" : c.status === "pending" ? "warn" : "down"} label={c.status ?? "unknown"} />
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              {(d.accessories ?? []).length > 0 && (
                <Panel title="Accessories">
                  <ul className="flex flex-wrap gap-1.5">
                    {(d.accessories ?? []).map((a, i) => (
                      <li key={`${a.name}-${i}`} className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-white/75">{a.name}{a.type ? ` · ${a.type}` : ""}</li>
                    ))}
                  </ul>
                </Panel>
              )}
            </div>
          </div>
        </>
      )}

      <AlertDialog open={confirmRestart} onOpenChange={setConfirmRestart}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restart Homebridge?</AlertDialogTitle>
            <AlertDialogDescription>HomeKit accessories from Homebridge go unresponsive for about a minute while it restarts.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => run("restart", "homebridge", "restart", {}, "Homebridge restart")}>Restart</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
