// Home Hub API service
//
// Pi-hole data: reads the latest snapshot from the `home_hub_pihole_stats`
//   Supabase table, which is populated every ~60s by the Pi cron script at
//   scripts/push_pihole_stats.py.
//
// Home Assistant + Homebridge: still mocked — wire up similarly when ready.

import { supabase } from "@/integrations/supabase/client";

const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

/* ───────── Types ───────── */
export interface PiholeStats {
  status: "enabled" | "disabled" | "offline";
  totalQueries: number;
  queriesBlocked: number;
  percentBlocked: number;
  domainsOnBlocklist: number;
  activeClients: number;
  topBlocked: { domain: string; hits: number }[];
  topPermitted: { domain: string; hits: number }[];
  queryTypes: Record<string, number>;
  hourlyChart: { hour: string; permitted: number; blocked: number }[];
  /** ISO timestamp of the last successful push from the Pi */
  capturedAt: string | null;
}

export interface HomeAssistantStats {
  status: "online" | "degraded" | "offline";
  entities: number;
  automations: number;
  activeSensors: number;
  lastAutomationTriggered: string;
  sensors: { name: string; type: string; value: string; status: "ok" | "warning" | "critical" }[];
  automationList: { id: string; name: string; enabled: boolean; lastTriggered: string }[];
  recentActivity: { id: string; description: string; timestamp: string; type: string }[];
}

export interface HomebridgeStats {
  status: "running" | "stopped" | "error";
  uptime: string;
  accessories: { name: string; type: string; status: string; details?: string }[];
  plugins: { name: string; version: string; updateAvailable: string | null }[];
}

export interface OverviewStats {
  pihole: { status: "enabled" | "disabled" | "offline"; queriesBlocked: number; percentBlocked: number; capturedAt: string | null };
  homeAssistant: { status: "online" | "degraded" | "offline"; devicesOnline: number; activeAutomations: number };
  homebridge: { status: "running" | "stopped" | "error"; accessories: number; pluginsActive: number };
  recentActivity: { id: string; service: string; description: string; timestamp: string }[];
}

/* ───────── Pi-hole — Supabase ───────── */

/** Shape of a row in home_hub_pihole_stats (matches migration column names) */
interface PiholeRow {
  id: string;
  captured_at: string;
  status: string;
  total_queries: number;
  queries_blocked: number;
  percent_blocked: number;
  domains_on_blocklist: number;
  active_clients: number;
  top_permitted: { domain: string; hits: number }[] | null;
  top_blocked: { domain: string; hits: number }[] | null;
  query_types: Record<string, number> | null;
  hourly_chart: { hour: string; permitted: number; blocked: number }[] | null;
}

const PIHOLE_OFFLINE: PiholeStats = {
  status: "offline",
  totalQueries: 0,
  queriesBlocked: 0,
  percentBlocked: 0,
  domainsOnBlocklist: 0,
  activeClients: 0,
  topBlocked: [],
  topPermitted: [],
  queryTypes: {},
  hourlyChart: [],
  capturedAt: null,
};

function rowToStats(row: PiholeRow): PiholeStats {
  const status = row.status === "enabled" ? "enabled"
    : row.status === "disabled" ? "disabled"
    : "offline";
  return {
    status,
    totalQueries: row.total_queries,
    queriesBlocked: row.queries_blocked,
    percentBlocked: Number(row.percent_blocked),
    domainsOnBlocklist: row.domains_on_blocklist,
    activeClients: row.active_clients,
    topBlocked: Array.isArray(row.top_blocked) ? row.top_blocked : [],
    topPermitted: Array.isArray(row.top_permitted) ? row.top_permitted : [],
    queryTypes: row.query_types ?? {},
    hourlyChart: Array.isArray(row.hourly_chart) ? row.hourly_chart : [],
    capturedAt: row.captured_at,
  };
}

export async function fetchPiholeStats(): Promise<PiholeStats> {
  const { data, error } = await (supabase as any)
    .from("home_hub_pihole_stats")
    .select("*")
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("fetchPiholeStats error:", error.message);
    return PIHOLE_OFFLINE;
  }
  if (!data) return PIHOLE_OFFLINE;
  return rowToStats(data as PiholeRow);
}

/* ───────── Home Assistant — mocked ───────── */

export async function fetchHomeAssistantStats(): Promise<HomeAssistantStats> {
  await delay();
  return {
    status: "online",
    entities: 147,
    automations: 23,
    activeSensors: 18,
    lastAutomationTriggered: "Morning Routine — 2 hours ago",
    sensors: [
      { name: "EcoFlow Delta 2", type: "battery", value: "78%", status: "ok" },
      { name: "Earthquake Sensor", type: "seismic", value: "No Activity", status: "ok" },
      { name: "Weather Alert", type: "weather", value: "Clear", status: "ok" },
    ],
    automationList: [
      { id: "1", name: "Morning Routine", enabled: true, lastTriggered: new Date(Date.now() - 7200000).toISOString() },
      { id: "2", name: "Away Mode", enabled: true, lastTriggered: new Date(Date.now() - 86400000).toISOString() },
      { id: "3", name: "Night Lights Off", enabled: true, lastTriggered: new Date(Date.now() - 36000000).toISOString() },
      { id: "4", name: "Garage Auto-Close", enabled: false, lastTriggered: new Date(Date.now() - 172800000).toISOString() },
      { id: "5", name: "Low Battery Alert", enabled: true, lastTriggered: new Date(Date.now() - 3600000).toISOString() },
      { id: "6", name: "AC Schedule", enabled: true, lastTriggered: new Date(Date.now() - 14400000).toISOString() },
    ],
    recentActivity: [
      { id: "1", description: "Morning Routine triggered", timestamp: new Date(Date.now() - 7200000).toISOString(), type: "automation" },
      { id: "2", description: "EcoFlow Delta 2 charged to 78%", timestamp: new Date(Date.now() - 10800000).toISOString(), type: "sensor" },
      { id: "3", description: "Low Battery Alert: Smoke Detector", timestamp: new Date(Date.now() - 3600000).toISOString(), type: "alert" },
      { id: "4", description: "AC Schedule activated", timestamp: new Date(Date.now() - 14400000).toISOString(), type: "automation" },
    ],
  };
}

/* ───────── Homebridge — mocked ───────── */

export async function fetchHomebridgeStats(): Promise<HomebridgeStats> {
  await delay();
  return {
    status: "running",
    uptime: "14d 7h 32m",
    accessories: [
      { name: "SmartRent Lock", type: "lock", status: "locked", details: "Front Door" },
      { name: "Dyson Pure Cool", type: "fan", status: "on", details: "Living Room" },
      { name: "SmartRent Thermostat", type: "thermostat", status: "72°F", details: "Hallway" },
      { name: "Ring Doorbell", type: "camera", status: "streaming", details: "Front Porch" },
      { name: "Garage Door", type: "door", status: "closed", details: "Garage" },
    ],
    plugins: [
      { name: "homebridge-smartrent", version: "1.2.4", updateAvailable: null },
      { name: "homebridge-dyson-pure", version: "3.0.1", updateAvailable: "3.1.0" },
      { name: "homebridge-ring", version: "12.1.0", updateAvailable: null },
      { name: "homebridge-config-ui-x", version: "4.56.2", updateAvailable: "4.57.0" },
    ],
  };
}

/* ───────── Overview — Pi-hole from Supabase, rest mocked ───────── */

export async function fetchOverviewStats(): Promise<OverviewStats> {
  const pihole = await fetchPiholeStats();

  return {
    pihole: {
      status: pihole.status,
      queriesBlocked: pihole.queriesBlocked,
      percentBlocked: pihole.percentBlocked,
      capturedAt: pihole.capturedAt,
    },
    homeAssistant: { status: "online", devicesOnline: 34, activeAutomations: 19 },
    homebridge: { status: "running", accessories: 5, pluginsActive: 4 },
    recentActivity: [
      { id: "1", service: "Home Assistant", description: "Morning Routine triggered", timestamp: new Date(Date.now() - 7200000).toISOString() },
      { id: "2", service: "Homebridge", description: "SmartRent Lock locked via automation", timestamp: new Date(Date.now() - 3600000).toISOString() },
      { id: "3", service: "Home Assistant", description: "EcoFlow Delta 2 reached 78% charge", timestamp: new Date(Date.now() - 10800000).toISOString() },
      { id: "4", service: "Homebridge", description: "Dyson Pure Cool turned on", timestamp: new Date(Date.now() - 18000000).toISOString() },
      { id: "5", service: "Home Assistant", description: "Low Battery Alert: Smoke Detector", timestamp: new Date(Date.now() - 3600000).toISOString() },
    ],
  };
}

/* ───────── Actions ───────── */
// Note: enable/disable/gravity still call the Pi-hole API directly, which only
// works when the browser is on the same LAN as the Pi (192.168.0.211).
// These are admin-only actions so LAN-only access is acceptable for now.
export async function piholeEnable() { await delay(500); return { success: true }; }
export async function piholeDisable() { await delay(500); return { success: true }; }
export async function piholeUpdateGravity() { await delay(2000); return { success: true, domainsOnBlocklist: 0 }; }
export async function homebridgeRestart() { await delay(3000); return { success: true }; }
export async function toggleAutomation(id: string, enabled: boolean) { await delay(400); return { id, enabled }; }
