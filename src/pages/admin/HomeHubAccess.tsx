import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { ActionMenu } from "@/components/admin/ActionMenu";
import { EmptyState } from "@/components/admin/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  fetchInventory, saveInventoryItem, deleteInventoryItem, fetchVaultBackups, putVaultSecret, fetchLatestRelease,
  inventoryAsText, compareVersions, SNAPSHOT_STALE_MS,
  type InventoryItem, type VaultEntry, type HostSnapshot, type AgentRelease,
} from "@/services/homeHubApi";
import {
  ago, HealthBadge, Panel, CopyValue, AgentUpgradeBanner, copyText, useAgent, useCommand, useSnapshot,
} from "@/components/admin/homeHub/shared";
import {
  KeyRound, Copy, Plus, Pencil, Trash2, Download, Server, Router, Boxes, Lock, ShieldCheck, AlertTriangle, ArrowUpCircle, Cpu,
} from "lucide-react";

const KIND_ICON = { device: Server, service: Boxes, network: Router } as const;

const blank = (): InventoryItem => ({
  slug: "", kind: "service", name: "", runs_on: "bestly-pi", lan_ip: null, tailscale_name: null, tailscale_ip: null,
  port: null, url: null, ssh_alias: null, ssh_user: null, ssh_key: null, login_user: null, paths: {}, secret_refs: {}, notes: null, sort: 100,
});

const toLines = (o: Record<string, string>) => Object.entries(o ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n");
function fromLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}
/** A long unbroken random-looking string is almost certainly a secret, not a location. */
function looksLikeSecret(v: string): boolean {
  return (v.match(/[A-Za-z0-9_\-.+/=]{24,}/g) ?? []).some(
    (m) => !m.startsWith("/") && !m.startsWith("~") && /[A-Z]/.test(m) && /[a-z]/.test(m) && /[0-9]/.test(m),
  );
}

function uptime(s?: number | null) {
  if (!s) return null;
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  return d ? `${d}d ${h}h` : `${h}h ${Math.floor((s % 3600) / 60)}m`;
}

export default function HomeHubAccess() {
  const { agent, online, now } = useAgent();
  const host = useSnapshot<HostSnapshot>("host");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [vault, setVault] = useState<VaultEntry[]>([]);
  const [release, setRelease] = useState<AgentRelease | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ item: InventoryItem; paths: string; refs: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<InventoryItem | null>(null);
  const [secretOpen, setSecretOpen] = useState(false);
  const [secret, setSecret] = useState({ name: "", value: "", description: "" });
  const [confirmUpdate, setConfirmUpdate] = useState(false);

  const load = useCallback(async () => {
    const [inv, v, r] = await Promise.allSettled([fetchInventory(), fetchVaultBackups(), fetchLatestRelease()]);
    if (inv.status === "fulfilled") { setItems(inv.value); setLoadError(null); } else setLoadError((inv.reason as Error).message);
    if (v.status === "fulfilled") setVault(v.value);
    if (r.status === "fulfilled") setRelease(r.value);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  const { busy, run } = useCommand(load);

  const h = host.snap?.data ?? null;
  const pi = items.find((i) => i.slug === "bestly-pi");
  const hostStale = host.snap ? now - new Date(host.snap.capturedAt).getTime() > SNAPSHOT_STALE_MS * 2 : false;
  const updateReady = !!release && !!agent && compareVersions(release.version, agent.version) > 0 && compareVersions(agent.version, "1.1.0") >= 0;

  const exportText = useMemo(() => inventoryAsText(items, h, vault), [items, h, vault]);

  const download = () => {
    const url = URL.createObjectURL(new Blob([exportText], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `home-hub-access-backup-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const save = async () => {
    if (!editing) return;
    const item = { ...editing.item, paths: fromLines(editing.paths), secret_refs: fromLines(editing.refs) };
    if (!item.name.trim()) { toast.error("Give it a name."); return; }
    if (!item.slug) item.slug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    const leaked = [...Object.values(item.secret_refs), ...Object.values(item.paths), item.notes ?? ""].find(looksLikeSecret);
    if (leaked) {
      toast.error("That looks like an actual password or token. Store it with “Back up a secret” instead, and write where it lives here.");
      return;
    }
    setSaving(true);
    try {
      await saveInventoryItem(item);
      toast.success(`${item.name} saved to the backup`);
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const storeSecret = async () => {
    const name = `home_hub_${secret.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
    if (name.length < 11 || !secret.value) { toast.error("Add a name and the value."); return; }
    setSaving(true);
    try {
      await putVaultSecret(name, secret.value, secret.description.trim() || undefined);
      toast.success(`Stored in Vault as ${name}. It can't be read back from here.`);
      setSecret({ name: "", value: "", description: "" });
      setSecretOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Access backup"
        description="Every IP, port, login and path for the home setup. Secrets live in Vault; this page only says where."
        actions={
          <>
            <Button onClick={() => copyText(exportText, "Full backup copied")} disabled={loading}>
              <Copy className="h-4 w-4 mr-1.5" aria-hidden />Copy full backup
            </Button>
            <Button variant="outline" className="border-white/15 text-white/85 hover:text-white hover:bg-white/5" onClick={() => setEditing({ item: blank(), paths: "", refs: "" })}>
              <Plus className="h-4 w-4 mr-1.5" aria-hidden />Add
            </Button>
            <ActionMenu
              label="More backup actions"
              items={[
                { group: "Backup", label: "Download as Markdown", icon: Download, onSelect: download },
                { group: "Backup", label: "Back up a secret to Vault", icon: KeyRound, onSelect: () => setSecretOpen(true) },
                ...(updateReady ? [{ group: "Pi agent", label: `Update agent to v${release!.version}`, icon: ArrowUpCircle, disabled: !online || !!busy, onSelect: () => setConfirmUpdate(true) }] : []),
              ]}
            />
          </>
        }
      />

      <AgentUpgradeBanner agent={agent} />
      {loadError && <p role="alert" className="text-sm text-red-300">{loadError}</p>}

      {/* What the Pi itself reports: the part that stays true even if every note is wrong. */}
      <Panel
        title="Reported by the Pi"
        icon={<Cpu className="h-4 w-4 text-white/60" aria-hidden />}
        right={host.snap ? <HealthBadge health={hostStale ? "warn" : "ok"} label={`Checked ${ago(host.snap.capturedAt, now)}`} /> : <HealthBadge health="warn" label="Waiting for agent 1.1" />}
      >
        {!host.snap || !h ? (
          <p className="text-sm text-white/60">After the one-time upgrade, the Pi reports its own IPs, gateway, containers and disks here every 5 minutes, and keeps the backup below in sync automatically.</p>
        ) : (
          <>
            {pi && h.lan_ip && pi.lan_ip !== h.lan_ip && (
              <p className="mb-3 text-sm text-amber-200 inline-flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" aria-hidden />The Pi reports {h.lan_ip}, the backup says {pi.lan_ip}.</p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6">
              <div>
                <CopyValue label="Hostname" value={h.hostname} />
                <CopyValue label="LAN IP" value={h.lan_ip} />
                <CopyValue label="Router / gateway" value={h.gateway} />
              </div>
              <div>
                <CopyValue label="Tailscale IP" value={h.tailscale_ip} />
                <CopyValue label="Tailscale name" value={h.tailscale?.dns_name} />
                <CopyValue label="OS" value={[h.os, h.arch].filter(Boolean).join(" · ")} mono={false} />
              </div>
              <div className="text-sm text-white/80 space-y-1.5 py-2">
                <p><span className="text-white/60">Up</span> {uptime(h.uptime_seconds) ?? "?"}{h.cpu_temp_c != null ? ` · ${h.cpu_temp_c}°C` : ""}</p>
                {h.memory_mb?.MemTotal && <p><span className="text-white/60">Memory free</span> {Math.round((h.memory_mb.MemAvailable ?? 0) / 1024 * 10) / 10} of {Math.round(h.memory_mb.MemTotal / 1024 * 10) / 10} GB</p>}
                {(h.disks ?? []).map((dsk) => <p key={dsk.mount}><span className="text-white/60">Disk {dsk.mount}</span> {dsk.used_gb} of {dsk.total_gb} GB used</p>)}
                {(h.listening ?? []).length > 0 && <p className="break-words"><span className="text-white/60">Open ports</span> {(h.listening ?? []).join(", ")}</p>}
              </div>
            </div>
            {(h.containers ?? []).length > 0 && (
              <div className="mt-4">
                <p className="text-xs uppercase tracking-wide text-white/60 mb-1.5">Containers</p>
                <ul className="divide-y divide-white/[0.05]">
                  {(h.containers ?? []).map((c) => (
                    <li key={c.name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2">
                      <span className="text-sm text-white/90 font-mono">{c.name}</span>
                      <span className={`text-xs ${c.state === "running" ? "text-green-300" : "text-amber-300"}`}>{c.status}</span>
                      <span className="w-full text-xs text-white/60 break-all">{c.image}{c.ports ? ` · ${c.ports}` : ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Panel>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-56 rounded-2xl bg-white/[0.04]" />)}</div>
      ) : items.length === 0 ? (
        <Panel><EmptyState icon={Server} title="Nothing in the backup yet" description="Add the Pi, its services and the router." /></Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {items.map((i) => {
            const Icon = KIND_ICON[i.kind] ?? Server;
            return (
              <Panel
                key={i.id}
                title={i.name}
                icon={<Icon className="h-4 w-4 text-white/60" aria-hidden />}
                right={
                  <div className="flex items-center gap-1">
                    {i.verified_at && <span className="text-xs text-white/60 hidden sm:inline">verified {ago(i.verified_at, now)}</span>}
                    <ActionMenu
                      label={`Actions for ${i.name}`}
                      items={[
                        { label: "Edit", icon: Pencil, onSelect: () => setEditing({ item: { ...i }, paths: toLines(i.paths), refs: toLines(i.secret_refs) }) },
                        { label: "Copy this entry", icon: Copy, onSelect: () => copyText(inventoryAsText([i], null, []), `${i.name} copied`) },
                        { label: "Delete", icon: Trash2, destructive: true, onSelect: () => setDeleting(i) },
                      ]}
                    />
                  </div>
                }
              >
                {i.runs_on && <p className="text-xs text-white/60 -mt-2 mb-2">Runs on {i.runs_on}</p>}
                <CopyValue label="URL" value={i.url} />
                <CopyValue label="LAN IP" value={i.lan_ip && i.port && i.kind === "service" ? `${i.lan_ip}:${i.port}` : i.lan_ip} />
                <CopyValue label="Tailscale" value={i.tailscale_ip ? `${i.tailscale_ip}${i.port && i.kind === "service" ? `:${i.port}` : ""}${i.tailscale_name ? ` (${i.tailscale_name})` : ""}` : null} />
                <CopyValue label="SSH" value={i.ssh_alias ? `ssh ${i.ssh_alias}` : null} />
                <CopyValue label="SSH without the alias" value={i.ssh_user && i.lan_ip ? `ssh ${i.ssh_user}@${i.lan_ip}` : null} />
                <CopyValue label="SSH key" value={i.ssh_key} mono={false} />
                <CopyValue label="Login user" value={i.login_user} />
                {Object.entries(i.paths ?? {}).map(([k, v]) => <CopyValue key={k} label={k} value={v} />)}
                {Object.keys(i.secret_refs ?? {}).length > 0 && (
                  <div className="mt-3 rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
                    <p className="text-xs text-white/60 mb-1 inline-flex items-center gap-1"><Lock className="h-3.5 w-3.5" aria-hidden />Where the secrets live</p>
                    {Object.entries(i.secret_refs).map(([k, v]) => (
                      <p key={k} className="text-sm text-white/85"><span className="text-white/60">{k}:</span> {v}</p>
                    ))}
                  </div>
                )}
                {i.notes && <p className="text-sm text-white/70 mt-3 whitespace-pre-wrap">{i.notes}</p>}
                {(i.history ?? []).length > 0 && (
                  <details className="mt-3 text-xs text-white/60">
                    <summary className="cursor-pointer">Previous addresses ({(i.history ?? []).length})</summary>
                    <ul className="mt-1 space-y-0.5">
                      {(i.history ?? []).slice().reverse().map((x) => (
                        <li key={x.at}>{new Date(x.at).toLocaleDateString()}: {[x.lan_ip, x.tailscale_ip].filter(Boolean).join(" · ")}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </Panel>
            );
          })}
        </div>
      )}

      <Panel
        title="Secrets in Vault"
        icon={<ShieldCheck className="h-4 w-4 text-white/60" aria-hidden />}
        right={<Button size="sm" variant="outline" className="border-white/15 text-white/85 hover:text-white hover:bg-white/5" onClick={() => setSecretOpen(true)}><KeyRound className="h-3.5 w-3.5 mr-1.5" aria-hidden />Back up a secret</Button>}
      >
        {vault.length === 0 ? (
          <p className="text-sm text-white/60">None yet. The upgraded Pi agent backs up the Home Assistant token and Homebridge login here on its own.</p>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {vault.map((v) => (
              <li key={v.name} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-white/90 font-mono break-all">{v.name}</p>
                  {v.description && <p className="text-xs text-white/60">{v.description}</p>}
                </div>
                <span className="text-xs text-white/60 shrink-0">updated {ago(v.updated_at, now)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-white/60 mt-3">Write-only from here. To recover a value, ask Claude to read it from Supabase Vault by name.</p>
      </Panel>

      {/* Edit / add */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.item.id ? `Edit ${editing.item.name}` : "Add to the backup"}</DialogTitle>
            <DialogDescription>Addresses, logins and paths. Never paste a password or token here.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-3">
              {([
                ["name", "Name", "col-span-2"], ["runs_on", "Runs on", ""],
                ["lan_ip", "LAN IP", ""], ["port", "Port", ""], ["tailscale_ip", "Tailscale IP", ""], ["tailscale_name", "Tailscale name", ""],
                ["url", "URL", "col-span-2"], ["ssh_alias", "SSH alias", ""], ["ssh_user", "SSH user", ""],
                ["ssh_key", "SSH key location", "col-span-2"], ["login_user", "Login username", "col-span-2"],
              ] as const).map(([key, label, span]) => (
                <div key={key} className={`space-y-1 ${span}`}>
                  <Label htmlFor={`inv-${key}`}>{label}</Label>
                  <Input
                    id={`inv-${key}`}
                    value={String(editing.item[key] ?? "")}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const val = key === "port" ? (raw ? Number(raw.replace(/\D/g, "")) || null : null) : (raw || null);
                      setEditing({ ...editing, item: { ...editing.item, [key]: val } as InventoryItem });
                    }}
                  />
                </div>
              ))}
              <div className="space-y-1 col-span-2">
                <Label htmlFor="inv-kind">Kind</Label>
                <select
                  id="inv-kind"
                  value={editing.item.kind}
                  onChange={(e) => setEditing({ ...editing, item: { ...editing.item, kind: e.target.value as InventoryItem["kind"] } })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="device">Device</option>
                  <option value="service">Service</option>
                  <option value="network">Network</option>
                </select>
              </div>
              <div className="space-y-1 col-span-2">
                <Label htmlFor="inv-paths">Paths (one per line, “Label: /path”)</Label>
                <Textarea id="inv-paths" rows={3} value={editing.paths} onChange={(e) => setEditing({ ...editing, paths: e.target.value })} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label htmlFor="inv-refs">Where secrets live (“Password: Vault home_hub_x”)</Label>
                <Textarea id="inv-refs" rows={2} value={editing.refs} onChange={(e) => setEditing({ ...editing, refs: e.target.value })} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label htmlFor="inv-notes">Notes</Label>
                <Textarea id="inv-notes" rows={3} value={editing.item.notes ?? ""} onChange={(e) => setEditing({ ...editing, item: { ...editing.item, notes: e.target.value || null } })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !editing}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Secret: write-only */}
      <Dialog open={secretOpen} onOpenChange={setSecretOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Back up a secret</DialogTitle>
            <DialogDescription>Goes straight into Supabase Vault, encrypted. Nobody can read it back from this page.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="sec-name">Name</Label>
              <div className="flex items-center gap-1.5"><span className="text-sm text-white/60 font-mono">home_hub_</span><Input id="sec-name" placeholder="router_admin_password" value={secret.name} onChange={(e) => setSecret({ ...secret, name: e.target.value })} /></div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sec-value">Value</Label>
              <Input id="sec-value" type="password" autoComplete="off" value={secret.value} onChange={(e) => setSecret({ ...secret, value: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sec-desc">What it is (optional)</Label>
              <Input id="sec-desc" placeholder="Verizon router admin login" value={secret.description} onChange={(e) => setSecret({ ...secret, description: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSecretOpen(false)}>Cancel</Button>
            <Button onClick={storeSecret} disabled={saving}>{saving ? "Storing…" : "Store in Vault"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>It's removed from the backup. Copy it first if you might need it.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={async () => {
                if (!deleting?.id) return;
                try { await deleteInventoryItem(deleting.id); toast.success(`${deleting.name} deleted`); load(); }
                catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
              }}
            >Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmUpdate} onOpenChange={setConfirmUpdate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update the Pi agent to v{release?.version}?</AlertDialogTitle>
            <AlertDialogDescription>The Pi downloads it, checks the fingerprint, and restarts the agent. Takes under a minute. The old version is kept on the Pi.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => release && run("agent-update", "agent", "update", { version: release.version, sha256: release.sha256 }, "Agent update")}>Update</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
