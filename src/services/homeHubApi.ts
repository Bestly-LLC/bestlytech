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
// Home Assistant and Homebridge were removed from the dashboard (2026-09-15): nothing feeds
// their state into Supabase, so those pages only ever showed hardcoded data.

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
  const info = (data.info ?? {}) as { host?: string };
  return { agent: data.agent, lastSeenAt: data.last_seen_at, version: data.version ?? null, host: info.host ?? null };
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
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await db
    .from("home_hub_commands")
    .insert({ target: "pihole", action, payload, requested_by: auth.user?.email ?? null })
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
