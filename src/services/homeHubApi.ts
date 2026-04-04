// Mock API service for Home Hub — replace internals with real Pi API calls later

const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

/* ───────── Types ───────── */
export interface PiholeStats {
  status: "enabled" | "disabled";
  totalQueries: number;
  queriesBlocked: number;
  percentBlocked: number;
  domainsOnBlocklist: number;
  queriesOverTime: { hour: string; allowed: number; blocked: number }[];
  topBlocked: { domain: string; count: number }[];
  topPermitted: { domain: string; count: number }[];
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
  pihole: { status: "enabled" | "disabled"; queriesBlocked: number; percentBlocked: number };
  homeAssistant: { status: "online" | "degraded" | "offline"; devicesOnline: number; activeAutomations: number };
  homebridge: { status: "running" | "stopped" | "error"; accessories: number; pluginsActive: number };
  recentActivity: { id: string; service: string; description: string; timestamp: string }[];
}

/* ───────── Mock data ───────── */
function makeQueryTimeline() {
  const hours: PiholeStats["queriesOverTime"] = [];
  const now = new Date();
  for (let i = 23; i >= 0; i--) {
    const h = new Date(now.getTime() - i * 3600000);
    const allowed = Math.floor(Math.random() * 800 + 200);
    const blocked = Math.floor(Math.random() * 200 + 40);
    hours.push({ hour: h.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), allowed, blocked });
  }
  return hours;
}

/* ───────── Fetch functions ───────── */
export async function fetchPiholeStats(): Promise<PiholeStats> {
  await delay();
  return {
    status: "enabled",
    totalQueries: 48_291,
    queriesBlocked: 12_847,
    percentBlocked: 26.6,
    domainsOnBlocklist: 174_892,
    queriesOverTime: makeQueryTimeline(),
    topBlocked: [
      { domain: "ads.google.com", count: 1842 },
      { domain: "tracking.facebook.net", count: 1203 },
      { domain: "analytics.tiktok.com", count: 987 },
      { domain: "telemetry.microsoft.com", count: 876 },
      { domain: "pixel.adsafeprotected.com", count: 654 },
      { domain: "events.hotjar.io", count: 543 },
      { domain: "cdn.amplitude.com", count: 432 },
      { domain: "stats.wp.com", count: 321 },
    ],
    topPermitted: [
      { domain: "dns.google", count: 3201 },
      { domain: "api.github.com", count: 2104 },
      { domain: "cdn.jsdelivr.net", count: 1876 },
      { domain: "fonts.googleapis.com", count: 1654 },
      { domain: "registry.npmjs.org", count: 1432 },
      { domain: "api.openai.com", count: 1098 },
      { domain: "supabase.co", count: 987 },
      { domain: "apple.com", count: 876 },
    ],
  };
}

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

export async function fetchOverviewStats(): Promise<OverviewStats> {
  await delay();
  return {
    pihole: { status: "enabled", queriesBlocked: 12_847, percentBlocked: 26.6 },
    homeAssistant: { status: "online", devicesOnline: 34, activeAutomations: 19 },
    homebridge: { status: "running", accessories: 5, pluginsActive: 4 },
    recentActivity: [
      { id: "1", service: "Home Assistant", description: "Morning Routine triggered", timestamp: new Date(Date.now() - 7200000).toISOString() },
      { id: "2", service: "Pi-hole", description: "Blocked 1,842 queries from ads.google.com", timestamp: new Date(Date.now() - 5400000).toISOString() },
      { id: "3", service: "Homebridge", description: "SmartRent Lock locked via automation", timestamp: new Date(Date.now() - 3600000).toISOString() },
      { id: "4", service: "Home Assistant", description: "EcoFlow Delta 2 reached 78% charge", timestamp: new Date(Date.now() - 10800000).toISOString() },
      { id: "5", service: "Pi-hole", description: "Gravity list updated — 174,892 domains", timestamp: new Date(Date.now() - 14400000).toISOString() },
      { id: "6", service: "Homebridge", description: "Dyson Pure Cool turned on", timestamp: new Date(Date.now() - 18000000).toISOString() },
      { id: "7", service: "Home Assistant", description: "Low Battery Alert: Smoke Detector", timestamp: new Date(Date.now() - 3600000).toISOString() },
    ],
  };
}

/* ───────── Actions ───────── */
export async function piholeEnable() { await delay(500); return { success: true }; }
export async function piholeDisable() { await delay(500); return { success: true }; }
export async function piholeUpdateGravity() { await delay(2000); return { success: true, domainsOnBlocklist: 175_102 }; }
export async function homebridgeRestart() { await delay(3000); return { success: true }; }
export async function toggleAutomation(id: string, enabled: boolean) { await delay(400); return { id, enabled }; }
