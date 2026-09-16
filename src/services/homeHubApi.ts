// Home Hub API service — everything here is real, nothing is simulated.
//
// Stats:    `home_hub_pihole_stats` — a cron script on bestly-pi pushes a Pi-hole snapshot
//           roughly every 60s (scripts/push_pihole_stats.py).
// Agent:    `home_hub_agent_state` — heartbeat written by the `home-hub-agent` edge function
//           each time the systemd agent on the Pi polls (about every 15s).
// Control:  `home_hub_commands` — the admin enqueues a row, the agent claims it through the
//           edge function, runs it on the LAN and writes the result back. The browser never
//           talks to the LAN directly.
//
// Snapshots: `home_hub_snapshots` — agent >= 1.1.0 pushes read-only Home Assistant and Homebridge
//           snapshots every minute and a host snapshot (IPs, containers, disks) every 5 minutes.
// Access:   `home_hub_inventory` — the access backup (IPs, ports, SSH, paths, where secrets live).
//           Secret VALUES only ever go to Vault via `home_hub_vault_put`; nothing reads them back.

import { supabase } from "@/integrations/supabase/client";

// These tables are not in the generated types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (table: string) => any };

/** Pi pushes every ~60s; anything older than this is treated as stale. */
export const STATS_STALE_MS = 5 * 60_000;
/** Agent polls every ~15s; no heartbeat for this long means it is offline. */
export const AGENT_OFFLINE_MS = 2 * 60_000;

export class HomeHubError extends Error {
  /** True when the database refused access (missing grant or not an admin). */
  readonly accessDenied: boolean;
  constructor(message: string, accessDenied = false) {
    super(message);
    this.accessDenied = accessDenied;
  }
}

function toError(what: string, err: { code?: string; message?: string }): HomeHubError {
  const denied = err.code === "42501" || /permission denied/i.test(err.message ?? "");
  return new HomeHubError(
    denied
      ? `${what}: the database refused access (grant missing for this table).`
      : `${what}: ${err.message ?? "unknown error"}`,
    denied,
  );
}

/* ───────── Pi-hole stats ───────── */

export interface PiholeStats {
  /** Blocking state as reported by Pi-hole in the latest snapshot. */
  status: "enabled" | "disabled" | "unknown";
  totalQueries: number;
  queriesBlocked: number;
  percentBlocked: number;
  domainsOnBlocklist: number;
  activeClients: number;
  topBlocked: { domain: string; hits: number }[];
  topPermitted: { domain: string; hits: number }[];
  hourlyChart: { hour: string; permitted: number; blocked: number }[];
  /** ISO timestamp of the snapshot. */
  capturedAt: string;
}

interface PiholeRow {
  captured_at: string;
  status: string;
  total_queries: number;
  queries_blocked: number;
  percent_blocked: number | string;
  domains_on_blocklist: number;
  active_clients: number;
  top_permitted: { domain: string; hits: number }[] | null;
  top_blocked: { domain: string; hits: number }[] | null;
  hourly_chart: { hour: string; permitted: number; blocked: number }[] | null;
}

/** Latest snapshot, or null when the Pi has never pushed one. Throws on query errors. */
export async function fetchPiholeStats(): Promise<PiholeStats | null> {
  const { data, error } = await db
    .from("home_hub_pihole_stats")
    .select("captured_at, status, total_queries, queries_blocked, percent_blocked, domains_on_blocklist, active_clients, top_permitted, top_blocked, hourly_chart")
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw toError("Couldn't load Pi-hole stats", error);
  if (!data) return null;
  const row = data as PiholeRow;
  return {
    status: row.status === "enabled" || row.status === "disabled" ? row.status : "unknown",
    totalQueries: row.total_queries ?? 0,
    queriesBlocked: row.queries_blocked ?? 0,
    percentBlocked: Number(row.percent_blocked) || 0,
    domainsOnBlocklist: row.domains_on_blocklist ?? 0,
    activeClients: row.active_clients ?? 0,
    topBlocked: Array.isArray(row.top_blocked) ? row.top_blocked : [],
    topPermitted: Array.isArray(row.top_permitted) ? row.top_permitted : [],
    hourlyChart: Array.isArray(row.hourly_chart) ? row.hourly_chart : [],
    capturedAt: row.captured_at,
  };
}

/* ───────── Agent heartbeat ───────── */

export interface AgentState {
  agent: string;
  lastSeenAt: string;
  version: string | null;
  host: string | null;
  features: string[];
}

/** Snapshots, secret backup and self-update arrived in agent 1.1.0. */
export const SNAPSHOT_AGENT_VERSION = "1.1.0";

export function compareVersions(a: string | null | undefined, b: string | null | undefined): number {
  const pa = (a ?? "0").split(".").map((n) => Number(n) || 0);
  const pb = (b ?? "0").split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

export function agentSupportsSnapshots(agent: AgentState | null): boolean {
  return !!agent && compareVersions(agent.version, SNAPSHOT_AGENT_VERSION) >= 0;
}

/** The most recently seen agent, or null when no agent has ever checked in. */
export async function fetchAgentState(): Promise<AgentState | null> {
  const { data, error } = await db
    .from("home_hub_agent_state")
    .select("agent, last_seen_at, version, info")
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw toError("Couldn't load agent status", error);
  if (!data) return null;
  const info = (data.info ?? {}) as { host?: string; features?: string[] };
  return {
    agent: data.agent, lastSeenAt: data.last_seen_at, version: data.version ?? null, host: info.host ?? null,
    features: Array.isArray(info.features) ? info.features : [],
  };
}

export function isAgentOnline(agent: AgentState | null, now = Date.now()): boolean {
  return !!agent && now - new Date(agent.lastSeenAt).getTime() < AGENT_OFFLINE_MS;
}

/* ───────── Command queue ───────── */

export type CommandStatus = "pending" | "running" | "done" | "failed" | "expired";
export type PiholeAction = "enable" | "disable" | "update_gravity";

export interface HomeHubCommand {
  id: string;
  target: string;
  action: string;
  payload: Record<string, unknown>;
  status: CommandStatus;
  requestedBy: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

const COMMAND_COLUMNS = "id, target, action, payload, status, requested_by, result, error, created_at, completed_at";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToCommand(r: any): HomeHubCommand {
  return {
    id: r.id,
    target: r.target,
    action: r.action,
    payload: r.payload ?? {},
    status: r.status,
    requestedBy: r.requested_by ?? null,
    result: r.result ?? null,
    error: r.error ?? null,
    createdAt: r.created_at,
    completedAt: r.completed_at ?? null,
  };
}

export function isCommandFinished(c: HomeHubCommand): boolean {
  return c.status === "done" || c.status === "failed" || c.status === "expired";
}

export async function fetchRecentCommands(limit = 10, target?: string): Promise<HomeHubCommand[]> {
  let q = db.from("home_hub_commands").select(COMMAND_COLUMNS).order("created_at", { ascending: false }).limit(limit);
  if (target) q = q.eq("target", target);
  const { data, error } = await q;
  if (error) throw toError("Couldn't load command history", error);
  return (data ?? []).map(rowToCommand);
}

/** Queue a Pi-hole command for the agent. Resolves with the inserted row. */
export async function enqueuePiholeCommand(action: PiholeAction, payload: Record<string, unknown> = {}): Promise<HomeHubCommand> {
  return enqueueCommand("pihole", action, payload);
}

export type CommandTarget = "pihole" | "homeassistant" | "homebridge" | "agent";

/** Queue any command in the contract (docs/home-hub-agent.md). The server rejects anything else. */
export async function enqueueCommand(target: CommandTarget, action: string, payload: Record<string, unknown> = {}): Promise<HomeHubCommand> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await db
    .from("home_hub_commands")
    .insert({ target, action, payload, requested_by: auth.user?.email ?? null })
    .select(COMMAND_COLUMNS)
    .maybeSingle();
  if (error) throw toError("Couldn't queue the command", error);
  if (!data) throw new HomeHubError("Couldn't queue the command: the database accepted nothing (check admin access).", true);
  return rowToCommand(data);
}

async function fetchCommand(id: string): Promise<HomeHubCommand | null> {
  const { data, error } = await db.from("home_hub_commands").select(COMMAND_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw toError("Couldn't read command status", error);
  return data ? rowToCommand(data) : null;
}

/**
 * Poll a queued command until the agent finishes it or `timeoutMs` passes.
 * Returns the last known row; callers check `isCommandFinished`.
 */
export async function waitForCommand(id: string, { timeoutMs = 90_000, intervalMs = 2_500 } = {}): Promise<HomeHubCommand | null> {
  const deadline = Date.now() + timeoutMs;
  let last: HomeHubCommand | null = null;
  while (Date.now() < deadline) {
    last = await fetchCommand(id);
    if (last && isCommandFinished(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}

export const ACTION_LABELS: Record<string, string> = {
  enable: "Resume blocking",
  disable: "Pause blocking",
  update_gravity: "Update blocklists",
  restart: "Restart",
  refresh: "Refresh snapshot",
  toggle_automation: "Switch automation",
  update: "Update agent",
};

export const TARGET_LABELS: Record<string, string> = {
  pihole: "Pi-hole",
  homeassistant: "Home Assistant",
  homebridge: "Homebridge",
  agent: "Agent",
};

/** Human-readable outcome of a command, using whatever the agent reported. */
export function describeCommand(c: HomeHubCommand): string {
  if (c.status === "failed") return c.error || "The agent reported a failure.";
  if (c.status === "expired") return c.error || "No agent picked this up in time.";
  if (c.status === "pending") return "Waiting for the Pi to pick this up…";
  if (c.status === "running") return "Running on the Pi…";
  const r = c.result ?? {};
  const text = [r.message, r.output, r.stdout, r.detail].find((v) => typeof v === "string" && v.trim());
  return typeof text === "string" ? text.trim() : "Done.";
}

/* ───────── Snapshots ───────── */

export type SnapshotSource = "homeassistant" | "homebridge" | "host";

export interface Snapshot<T> {
  source: SnapshotSource;
  capturedAt: string;
  ok: boolean;
  error: string | null;
  /** Failed reads in a row. The data is the last good read when this is above 0. */
  fails: number;
  data: T;
}

export interface HaSnapshot {
  version?: string;
  location_name?: string;
  time_zone?: string;
  state?: string;
  safe_mode?: boolean;
  integrations?: number;
  entity_count?: number;
  domains?: Record<string, number>;
  automations?: { entity_id: string; name: string; on: boolean; last_triggered: string | null }[];
  devices?: { entity_id: string; name: string; state: string; domain: string; last_changed: string | null; temp?: number | null; unit?: string | null }[];
  unavailable?: { entity_id: string; name: string }[];
  unavailable_count?: number;
  updates?: { entity_id: string; name: string; installed: string | null; latest: string | null }[];
  batteries?: { entity_id: string; name: string; state: string }[];
}

export interface HbSnapshot {
  status?: string | null;
  installed_version?: string | null;
  latest_version?: string | null;
  update_available?: boolean | null;
  ui_installed_version?: string | null;
  ui_update_available?: boolean | null;
  plugins?: { name: string; package: string; installed: string | null; latest: string | null; update_available: boolean | null; disabled: boolean | null }[];
  child_bridges?: { name: string; plugin: string; status: string; paired: boolean | null }[];
  accessory_count?: number | null;
  accessories?: { name: string; type: string }[];
  errors?: Record<string, string>;
}

export interface HostSnapshot {
  hostname?: string;
  lan_ip?: string | null;
  gateway?: string | null;
  interface?: string | null;
  tailscale_ip?: string | null;
  tailscale?: { dns_name?: string; online?: boolean };
  os?: string | null;
  kernel?: string;
  arch?: string;
  python?: string;
  uptime_seconds?: number | null;
  load?: number[];
  memory_mb?: { MemTotal?: number; MemAvailable?: number };
  cpu_temp_c?: number | null;
  disks?: { mount: string; total_gb: number; used_gb: number }[];
  containers?: { name: string; image: string; state: string; status: string; ports: string }[];
  listening?: number[];
  agent_version?: string;
}

export async function fetchSnapshot<T>(source: SnapshotSource): Promise<Snapshot<T> | null> {
  const { data, error } = await db
    .from("home_hub_snapshots")
    .select("source, captured_at, ok, error, fails, data")
    .eq("source", source)
    .maybeSingle();
  if (error) throw toError("Couldn't load the snapshot", error);
  if (!data) return null;
  return { source: data.source, capturedAt: data.captured_at, ok: data.ok, error: data.error ?? null, fails: data.fails ?? 0, data: (data.data ?? {}) as T };
}

/** Snapshots come every minute; older than this means the agent stopped sending them. */
export const SNAPSHOT_STALE_MS = 5 * 60_000;

/* ───────── Access backup ───────── */

export interface InventoryItem {
  id?: string;
  slug: string;
  kind: "device" | "service" | "network";
  name: string;
  runs_on: string | null;
  lan_ip: string | null;
  tailscale_name: string | null;
  tailscale_ip: string | null;
  port: number | null;
  url: string | null;
  ssh_alias: string | null;
  ssh_user: string | null;
  ssh_key: string | null;
  login_user: string | null;
  paths: Record<string, string>;
  secret_refs: Record<string, string>;
  notes: string | null;
  history?: { at: string; lan_ip: string | null; tailscale_ip: string | null }[];
  sort: number;
  source?: string;
  verified_at?: string | null;
  updated_at?: string;
  updated_by?: string | null;
}

const INVENTORY_COLUMNS = "id, slug, kind, name, runs_on, lan_ip, tailscale_name, tailscale_ip, port, url, ssh_alias, ssh_user, ssh_key, login_user, paths, secret_refs, notes, history, sort, source, verified_at, updated_at, updated_by";

export async function fetchInventory(): Promise<InventoryItem[]> {
  const { data, error } = await db.from("home_hub_inventory").select(INVENTORY_COLUMNS).order("sort").order("name");
  if (error) throw toError("Couldn't load the access backup", error);
  return (data ?? []) as InventoryItem[];
}

export async function saveInventoryItem(item: InventoryItem): Promise<InventoryItem> {
  const { data: auth } = await supabase.auth.getUser();
  const { history, verified_at, updated_at, source, ...rest } = item;
  const row = { ...rest, source: "manual", updated_by: auth.user?.email ?? null, updated_at: new Date().toISOString() };
  const q = item.id
    ? db.from("home_hub_inventory").update(row).eq("id", item.id)
    : db.from("home_hub_inventory").insert(row);
  const { data, error } = await q.select(INVENTORY_COLUMNS).maybeSingle();
  if (error) throw toError("Couldn't save", error);
  if (!data) throw new HomeHubError("Couldn't save: the database accepted nothing (check admin access).", true);
  return data as InventoryItem;
}

export async function deleteInventoryItem(id: string): Promise<void> {
  const { data, error } = await db.from("home_hub_inventory").delete().eq("id", id).select("id");
  if (error) throw toError("Couldn't delete", error);
  if (!data?.length) throw new HomeHubError("Couldn't delete: nothing was removed (check admin access).", true);
}

export interface VaultEntry { name: string; description: string | null; updated_at: string }

export async function fetchVaultBackups(): Promise<VaultEntry[]> {
  const { data, error } = await (supabase as unknown as { rpc: (fn: string, args?: unknown) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }> })
    .rpc("home_hub_vault_list");
  if (error) throw toError("Couldn't list Vault backups", error);
  return (data ?? []) as VaultEntry[];
}

/** Write-only: stores or replaces a secret in Vault. The value never comes back to the browser. */
export async function putVaultSecret(name: string, value: string, description?: string): Promise<void> {
  const { error } = await (supabase as unknown as { rpc: (fn: string, args?: unknown) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }> })
    .rpc("home_hub_vault_put", { p_name: name, p_value: value, p_description: description ?? null });
  if (error) throw toError("Couldn't store the secret", error);
}

export interface AgentRelease { version: string; sha256: string; notes: string | null; created_at: string }

export async function fetchLatestRelease(): Promise<AgentRelease | null> {
  const { data, error } = await db.from("home_hub_agent_releases").select("version, sha256, notes, created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return null;
  return (data ?? null) as AgentRelease | null;
}

/** Plain-text export of the whole backup, for pasting into a password manager or a new Claude chat. */
export function inventoryAsText(items: InventoryItem[], host: HostSnapshot | null, vault: VaultEntry[]): string {
  const lines: string[] = [`# Bestly Home Hub access backup (${new Date().toISOString().slice(0, 10)})`, ""];
  for (const i of items) {
    lines.push(`## ${i.name}${i.runs_on ? ` (on ${i.runs_on})` : ""}`);
    const f = (k: string, v: unknown) => { if (v !== null && v !== undefined && v !== "") lines.push(`- ${k}: ${v}`); };
    f("LAN IP", i.lan_ip); f("Tailscale", [i.tailscale_name, i.tailscale_ip].filter(Boolean).join(" / "));
    f("Port", i.port); f("URL", i.url);
    if (i.ssh_alias || i.ssh_user) f("SSH", `${i.ssh_alias ? `ssh ${i.ssh_alias}` : ""}${i.ssh_user && i.lan_ip ? ` (or ssh ${i.ssh_user}@${i.lan_ip})` : ""}`);
    f("SSH key", i.ssh_key); f("Login user", i.login_user);
    for (const [k, v] of Object.entries(i.paths ?? {})) f(k, v);
    for (const [k, v] of Object.entries(i.secret_refs ?? {})) f(`${k} (where it lives)`, v);
    f("Notes", i.notes);
    lines.push("");
  }
  if (host) {
    lines.push("## Reported by the Pi", `- Hostname: ${host.hostname ?? "?"}`, `- LAN IP: ${host.lan_ip ?? "?"}`, `- Gateway: ${host.gateway ?? "?"}`, `- Tailscale: ${host.tailscale_ip ?? "?"}${host.tailscale?.dns_name ? ` (${host.tailscale.dns_name})` : ""}`);
    for (const c of host.containers ?? []) lines.push(`- Container ${c.name}: ${c.image} · ${c.status}${c.ports ? ` · ${c.ports}` : ""}`);
    lines.push("");
  }
  if (vault.length) {
    lines.push("## Secrets backed up in Supabase Vault (names only)");
    for (const v of vault) lines.push(`- ${v.name}: ${v.description ?? ""} (updated ${v.updated_at.slice(0, 10)})`);
  }
  return lines.join("\n");
}
