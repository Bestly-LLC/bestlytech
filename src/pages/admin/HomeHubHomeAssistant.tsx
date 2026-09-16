import { useMemo, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { ActionMenu } from "@/components/admin/ActionMenu";
import { EmptyState } from "@/components/admin/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { SNAPSHOT_STALE_MS, type HaSnapshot } from "@/services/homeHubApi";
import {
  ago, HealthBadge, Panel, Stat, AgentUpgradeBanner, useAgent, useCommand, useSnapshot, type Health,
} from "@/components/admin/homeHub/shared";
import { Home, RefreshCw, ExternalLink, Search, Zap, AlertTriangle, ArrowUpCircle, Loader2, Lightbulb } from "lucide-react";

const LAN_URL = "http://192.168.1.211:8123";
const TAILSCALE_URL = "http://100.79.2.74:8123";

const DOMAIN_LABELS: Record<string, string> = {
  light: "Lights", switch: "Switches", climate: "Climate", lock: "Locks", cover: "Covers", fan: "Fans",
  media_player: "Media", camera: "Cameras", person: "People", weather: "Weather", vacuum: "Vacuums",
  alarm_control_panel: "Alarm",
};

export default function HomeHubHomeAssistant() {
  const { agent, online, now } = useAgent();
  const { snap, error, loaded, reload } = useSnapshot<HaSnapshot>("homeassistant");
  const { busy, run } = useCommand(reload);
  const [query, setQuery] = useState("");

  const d = snap?.data ?? {};
  const stale = snap ? now - new Date(snap.capturedAt).getTime() > SNAPSHOT_STALE_MS : false;
  const health: Health = !snap ? "down" : !snap.ok || stale ? (snap.fails >= 3 || stale ? "down" : "warn") : "ok";
  const healthLabel = !snap ? "No data" : stale ? "Stale" : !snap.ok ? "Not responding" : "Running";

  const q = query.trim().toLowerCase();
  const automations = useMemo(
    () => (d.automations ?? []).filter((a) => !q || a.name.toLowerCase().includes(q) || a.entity_id.includes(q)),
    [d.automations, q],
  );
  const devicesByDomain = useMemo(() => {
    const groups = new Map<string, NonNullable<HaSnapshot["devices"]>>();
    for (const dev of d.devices ?? []) {
      if (q && !dev.name.toLowerCase().includes(q) && !dev.entity_id.includes(q)) continue;
      if (!groups.has(dev.domain)) groups.set(dev.domain, []);
      groups.get(dev.domain)!.push(dev);
    }
    return [...groups.entries()];
  }, [d.devices, q]);

  const canControl = online && !!snap;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Home Assistant"
        description={snap ? `Snapshot from the Pi ${ago(snap.capturedAt, now)}` : "Live state from Home Assistant on bestly-pi"}
        actions={
          <>
            <Button asChild variant="outline" className="border-white/15 text-white/85 hover:text-white hover:bg-white/5">
              <a href={LAN_URL} target="_blank" rel="noreferrer">Open Home Assistant <ExternalLink className="h-4 w-4 ml-1.5" aria-hidden /></a>
            </Button>
            <ActionMenu
              label="More Home Assistant actions"
              items={[
                { group: "Open", label: "Open over Tailscale", icon: ExternalLink, onSelect: () => { window.open(TAILSCALE_URL, "_blank", "noreferrer"); } },
                { group: "Data", label: busy === "refresh" ? "Refreshing…" : "Refresh from the Pi now", icon: RefreshCw, disabled: !online || !!busy, onSelect: () => run("refresh", "homeassistant", "refresh", {}, "Home Assistant") },
              ]}
            />
          </>
        }
      />

      <AgentUpgradeBanner agent={agent} />

      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}

      {!loaded ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-2xl bg-white/[0.04]" />)}</div>
      ) : !snap ? (
        <Panel>
          <EmptyState icon={Home} title="No Home Assistant data yet" description="It appears here within a minute of the Pi agent upgrade." />
        </Panel>
      ) : (
        <>
          {!snap.ok && (
            <div role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm text-red-200">
              <strong className="text-red-100">Home Assistant isn't answering the Pi</strong> ({snap.fails} checks in a row). {snap.error}
              <span className="block text-red-200/80 mt-1">Showing the last good snapshot below.</span>
            </div>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Status" value={<HealthBadge health={health} label={healthLabel} />} hint={d.version ? `Version ${d.version}` : undefined} />
            <Stat label="Entities" value={(d.entity_count ?? 0).toLocaleString()} hint={`${d.integrations ?? 0} integrations loaded`} />
            <Stat label="Automations" value={`${(d.automations ?? []).filter((a) => a.on).length} on`} hint={`of ${(d.automations ?? []).length}`} />
            <Stat
              label="Needs a look"
              value={(d.unavailable_count ?? 0) + (d.updates ?? []).length}
              hint={`${d.unavailable_count ?? 0} unavailable · ${(d.updates ?? []).length} updates`}
            />
          </div>

          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/55" aria-hidden />
            <Input
              aria-label="Search automations and devices" placeholder="Search automations and devices…"
              value={query} onChange={(e) => setQuery(e.target.value)}
              className="pl-9 bg-white/[0.03] border-white/[0.08] text-white placeholder:text-white/55 h-9 text-sm"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="Automations" icon={<Zap className="h-4 w-4 text-white/60" aria-hidden />}>
              {automations.length === 0 ? (
                <p className="text-sm text-white/60">{q ? "No automations match." : "No automations in Home Assistant yet."}</p>
              ) : (
                <ul className="divide-y divide-white/[0.06]">
                  {automations.map((a) => (
                    <li key={a.entity_id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm text-white/90 truncate">{a.name}</p>
                        <p className="text-xs text-white/60">{a.last_triggered ? `Last ran ${ago(a.last_triggered, now)}` : "Never ran"}</p>
                      </div>
                      {busy === a.entity_id ? (
                        <Loader2 className="h-4 w-4 text-white/60 animate-spin" aria-label="Switching" />
                      ) : (
                        <Switch
                          checked={a.on}
                          disabled={!canControl || !!busy}
                          aria-label={`${a.on ? "Turn off" : "Turn on"} ${a.name}`}
                          onCheckedChange={(on) => run(a.entity_id, "homeassistant", "toggle_automation", { automation_id: a.entity_id, enabled: on }, a.name)}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {!online && <p className="text-xs text-amber-300 mt-3">The Pi agent is offline, so switches are paused.</p>}
            </Panel>

            <div className="space-y-4">
              {((d.unavailable ?? []).length > 0 || (d.updates ?? []).length > 0) && (
                <Panel title="Needs a look" icon={<AlertTriangle className="h-4 w-4 text-amber-300" aria-hidden />}>
                  {(d.updates ?? []).length > 0 && (
                    <ul className="mb-3 space-y-1.5">
                      {(d.updates ?? []).map((u) => (
                        <li key={u.entity_id} className="flex items-center gap-2 text-sm text-white/85">
                          <ArrowUpCircle className="h-4 w-4 text-sky-300 shrink-0" aria-hidden />
                          <span className="truncate">{u.name}</span>
                          <span className="text-xs text-white/60 shrink-0 ml-auto">{u.installed} → {u.latest}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {(d.unavailable ?? []).length > 0 && (
                    <>
                      <p className="text-xs text-white/60 mb-1.5">Unavailable ({d.unavailable_count})</p>
                      <ul className="flex flex-wrap gap-1.5">
                        {(d.unavailable ?? []).map((u) => (
                          <li key={u.entity_id} className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-white/75">{u.name}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </Panel>
              )}

              <Panel title="Devices" icon={<Lightbulb className="h-4 w-4 text-white/60" aria-hidden />}>
                {devicesByDomain.length === 0 ? (
                  <p className="text-sm text-white/60">{q ? "No devices match." : "No lights, switches, climate or locks reported."}</p>
                ) : (
                  <div className="space-y-4">
                    {devicesByDomain.map(([domain, list]) => (
                      <div key={domain}>
                        <p className="text-xs uppercase tracking-wide text-white/60 mb-1">{DOMAIN_LABELS[domain] ?? domain} · {list.length}</p>
                        <ul className="divide-y divide-white/[0.05]">
                          {list.map((dev) => (
                            <li key={dev.entity_id} className="flex items-center justify-between gap-3 py-2">
                              <span className="text-sm text-white/85 truncate">{dev.name}</span>
                              <span className={`text-xs shrink-0 ${dev.state === "on" || dev.state === "unlocked" ? "text-amber-200" : dev.state === "unavailable" ? "text-red-300" : "text-white/65"}`}>
                                {dev.state}{dev.temp != null ? ` · ${dev.temp}°` : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
