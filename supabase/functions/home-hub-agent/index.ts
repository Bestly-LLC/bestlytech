// Home Hub on-prem agent endpoint.
//
// The Pi has no inbound route from the internet, so control is a queue rather than
// a direct call: the admin enqueues a row in home_hub_commands, the agent running
// on the LAN polls this function, executes locally, and posts the result back.
// Nothing in the browser ever touches the LAN.
//
// Auth: shared secret in x-api-key, held in Vault. Not the anon key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// CORS inline, as in the live v17: only the Pi calls this, server to server.

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// The command contract (docs/home-hub-agent.md). Anything else is failed here and never reaches
// the Pi. Each validator returns an error message, or null when the payload is fine.
type Payload = Record<string, unknown>;
const none = () => null;
const DOMAIN_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;
const MATCH_RE = /^[A-Za-z0-9 ._:@-]{1,64}$/;
const HOST_RE = /^[A-Za-z0-9.:-]{1,253}$/;
const optMatch = (p: Payload, key = "match") =>
  p[key] === undefined || p[key] === null || p[key] === "" || (typeof p[key] === "string" && MATCH_RE.test(p[key] as string))
    ? null
    : `${key} may only contain letters, digits, spaces and . _ : @ -`;
const optDomain = (p: Payload, key = "host") =>
  p[key] === undefined || p[key] === null || p[key] === "" || (typeof p[key] === "string" && DOMAIN_RE.test(p[key] as string))
    ? null
    : `${key} must be a domain name`;
// Automation Maker (Tinker): it may only touch what it made, and never shell/REST/secret plumbing.
const AUTO_ID_RE = /^bestly_[a-z0-9_]{3,60}$/;
const AUTO_PKG_RE = /^bestly_auto_[a-z0-9_]{3,50}$/;
const AUTO_DENY = ["!secret", "!include", "!env_var", "shell_command", "command_line", "rest_command", "python_script",
  "pyscript", "hassio.", "homeassistant.stop", "homeassistant.restart", "recorder.purge"];
const autoId = (p: Payload) => (typeof p.id === "string" && AUTO_ID_RE.test(p.id) ? null : "id must look like bestly_<name>");
const pkgName = (p: Payload) => (typeof p.name === "string" && AUTO_PKG_RE.test(p.name) ? null : "name must look like bestly_auto_<name>");
const autoDeny = (text: string) => {
  const low = String(text ?? "").toLowerCase();
  const hit = AUTO_DENY.find((d) => low.includes(d));
  return hit ? `'${hit}' is not allowed in automations Tinker installs` : null;
};
const ALLOWED: Record<string, Record<string, (p: Payload) => string | null>> = {
  pihole: {
    enable: none,
    disable: (p) => {
      const s = p.seconds;
      if (s === undefined || s === null) return null;
      return typeof s === "number" && Number.isInteger(s) && s >= 0 && s <= 86_400
        ? null
        : "seconds must be a whole number from 0 to 86400";
    },
    update_gravity: none,
    // agent >= 1.5.0
    recent_blocked: (p) => optMatch(p) ?? optMatch(p, "client"),
    allow: (p) => (typeof p.domain === "string" && DOMAIN_RE.test(p.domain) ? null : "allow needs domain"),
    unallow: (p) => (typeof p.domain === "string" && DOMAIN_RE.test(p.domain) ? null : "unallow needs domain"),
  },
  homebridge: { restart: none, refresh: none },
  homeassistant: {
    toggle_automation: (p) =>
      typeof p.automation_id === "string" && /^automation\.[a-z0-9_]+$/.test(p.automation_id) && typeof p.enabled === "boolean"
        ? null
        : "toggle_automation needs automation_id (automation.<id>) and enabled (boolean)",
    refresh: none,
    // agent >= 1.5.4: live Home Assistant reads (laundry, sensors, anything) and allowlisted service calls.
    states: (p) =>
      p.entity_id !== undefined || typeof p.prefix === "string" || typeof p.match === "string"
        ? null
        : "states needs entity_id, prefix (e.g. sensor.laundry) or match",
    call: (p) =>
      typeof p.service === "string" && /^[a-z_]+\.[a-z0-9_]+$/.test(p.service)
        ? null
        : "call needs service like light.turn_on (plus entity_id and optional data)",
    // agent >= 1.4.0: the admin's emergency button. full = charge the EcoFlow DELTA 2 to 100%,
    // storage = back to its storage level, status = read only (battery, limit, NWS alerts).
    ecoflow: (p) =>
      p.mode === undefined || ["full", "storage", "status"].includes(String(p.mode))
        ? null
        : "ecoflow mode must be full, storage or status",
    // agent >= 1.5.3: speak an urgent alert on the HomePods + critical iPhone alert (bestly_announce()).
    announce: (p) =>
      typeof p.message === "string" && p.message.trim().length > 0 && p.message.length <= 400
        ? null
        : "announce needs a message (1-400 characters)",
    // agent >= 1.5.3 (notify patch, 2026-09-27): iPhone notification or Live Activity through the
    // HA companion app. Queued by ha_push() in the database; replaces ntfy.
    notify: (p) => {
      const s = (v: unknown, n: number) => v === undefined || v === null || (typeof v === "string" && v.length <= n);
      if (!(typeof p.title === "string" && p.title.trim().length > 0 && p.title.length <= 120)) return "notify needs a title (1-120 characters)";
      if (!s(p.message, 1000) || !s(p.subtitle, 120) || !s(p.group, 64) || !s(p.tag, 64)) return "notify message, subtitle, group or tag is too long";
      if (p.level != null && !NOTIFY_LEVELS.has(String(p.level))) return "notify level must be passive, active, time-sensitive or critical";
      if (p.url != null && !(typeof p.url === "string" && HTTPS_RE.test(p.url))) return "notify url must be https";
      if (p.actions != null) {
        const a = p.actions;
        const ok = Array.isArray(a) && a.length <= 3 && a.every((x) =>
          x && typeof x === "object" && typeof (x as Payload).title === "string" &&
          typeof (x as Payload).uri === "string" && HTTPS_RE.test((x as Payload).uri as string));
        if (!ok) return "notify actions must be up to 3 of {title, uri (https)}";
      }
      if (p.live != null && (typeof p.live !== "object" || Array.isArray(p.live))) return "notify live must be an object";
      if (p.clear != null && typeof p.clear !== "boolean") return "notify clear must be true or false";
      return null;
    },
    // agent >= 1.6.1: the Automation Maker (Tinker, docs/ha-automator-opusplan.md). Only ids/names Tinker owns.
    catalog: none,
    automation_get: (p) => autoId(p),
    automation_delete: (p) => autoId(p),
    automation_put: (p) =>
      autoId(p) ??
      (p.config && typeof p.config === "object" && !Array.isArray(p.config) ? null : "automation_put needs config (an object)") ??
      autoDeny(JSON.stringify(p.config)),
    package_get: (p) => pkgName(p),
    package_delete: (p) => pkgName(p),
    package_put: (p) =>
      pkgName(p) ??
      (typeof p.yaml === "string" && p.yaml.trim().length > 0 && p.yaml.length <= 40_000 ? null : "package_put needs yaml (1-40000 characters)") ??
      autoDeny(p.yaml as string),
  },
  // agent >= 1.3.0: read-only diagnosis, and the same heal ladder the health loop uses.
  nextcloud: { status: none, restart: none },
  // agent >= 1.5.0: read-only LAN / internet diagnosis from the Pi.
  network: {
    diagnose: (p) => optDomain(p) ?? optMatch(p),
    find_device: (p) => optMatch(p),
    domain: (p) => (typeof p.match === "string" && MATCH_RE.test(p.match) ? null : "domain needs match"),
    ping: (p) => (typeof p.host === "string" && HOST_RE.test(p.host) ? null : "ping needs host"),
    dns: (p) => (typeof p.host === "string" && DOMAIN_RE.test(p.host) ? null : "dns needs host (a domain)"),
    wifi_scan: none,
    speed: none,
  },
  router: { probe: none },
  // Self-update (agent >= 1.1.0). The agent re-checks the sha256 against the file it downloads.
  agent: {
    update: (p) =>
      typeof p.version === "string" && /^\d+\.\d+\.\d+$/.test(p.version) &&
      typeof p.sha256 === "string" && /^[0-9a-f]{64}$/.test(p.sha256)
        ? null
        : "agent.update needs version (x.y.z) and sha256",
    // agent >= 1.2.0
    test_alert: none,
    run_maintenance: (p) => {
      if (p.steps === undefined || p.steps === null) return null;
      return Array.isArray(p.steps) && p.steps.every((s) => typeof s === "string" && MAINT_STEPS.has(s))
        ? null
        : `steps must be a list of: ${[...MAINT_STEPS].join(", ")}`;
    },
  },
};

const MAINT_STEPS = new Set(["agent", "homeassistant", "homebridge", "pihole", "os", "housekeeping"]);
const SNAPSHOT_SOURCES = new Set(["homeassistant", "homebridge", "host", "health"]);
const EVENT_KINDS = new Set(["problem", "resolved", "info"]);
const EVENT_SEVERITIES = new Set(["info", "success", "warning", "error"]);
const NOTIFY_LEVELS = new Set(["passive", "active", "time-sensitive", "critical"]);
const HTTPS_RE = /^https:\/\/[^\s]{1,500}$/;
// The only secrets the agent may back up. Vault names are fixed here, not taken from the Pi.
const BACKUP_SECRETS: Record<string, string> = {
  home_hub_ha_token: "Home Assistant long-lived token (backed up by the Home Hub agent)",
  home_hub_homebridge_password: "Homebridge UI password (backed up by the Home Hub agent)",
  home_hub_homebridge_user: "Homebridge UI username (backed up by the Home Hub agent)",
};
const MAX_BODY_BYTES = 512_000;

function validate(c: { target: string; action: string; payload: unknown }): string | null {
  const check = ALLOWED[c.target]?.[c.action];
  if (!check) return `Not an allowed command: ${c.target}.${c.action}`;
  const payload = c.payload ?? {};
  if (typeof payload !== "object" || Array.isArray(payload)) return "payload must be an object";
  return check(payload as Payload);
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const presented = req.headers.get("x-api-key");
  if (!presented) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "Body too large" }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    SB_SECRET,
  );

  // The key lives in Vault so it never has to be pasted into function settings.
  // An env var still wins if one is set, for local runs.
  const expected =
    Deno.env.get("HOME_HUB_AGENT_KEY") ??
    (await supabase.rpc("get_home_hub_agent_key")).data;
  if (!expected) return json({ error: "Server not configured" }, 500);
  if (presented !== expected) return json({ error: "Unauthorized" }, 401);

  const op = String(body.op ?? "");
  const agent = String(body.agent ?? "home-hub");

  const beat = async () => {
    await supabase.from("home_hub_agent_state").upsert({
      agent,
      last_seen_at: new Date().toISOString(),
      version: body.version ? String(body.version) : null,
      info: (body.info as Record<string, unknown>) ?? null,
    });
  };

  if (op === "heartbeat") {
    await beat();
    return json({ ok: true });
  }

  // Claim up to `max` pending commands and hand them to this agent.
  if (op === "poll") {
    await beat();
    await supabase.rpc("expire_stale_home_hub_commands");

    const max = Math.min(Number(body.max ?? 5) || 5, 20);
    const { data: pending, error: selErr } = await supabase
      .from("home_hub_commands")
      .select("id, target, action, payload")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(max);

    if (selErr) return json({ error: selErr.message }, 500);
    if (!pending?.length) return json({ commands: [] });

    // Refuse anything outside the contract before the agent ever sees it.
    const valid: string[] = [];
    for (const c of pending) {
      const problem = validate(c);
      if (!problem) { valid.push(c.id); continue; }
      await supabase
        .from("home_hub_commands")
        .update({ status: "failed", error: `Rejected by the server: ${problem}`, completed_at: new Date().toISOString() })
        .eq("id", c.id)
        .eq("status", "pending");
    }
    if (!valid.length) return json({ commands: [] });

    const ids = valid;
    const { data: claimed, error: claimErr } = await supabase
      .from("home_hub_commands")
      .update({ status: "running", claimed_at: new Date().toISOString() })
      .in("id", ids)
      .eq("status", "pending")
      .select("id, target, action, payload");

    if (claimErr) return json({ error: claimErr.message }, 500);
    return json({ commands: claimed ?? [] });
  }

  // Report the outcome of one command.
  if (op === "result") {
    await beat();
    const id = String(body.id ?? "");
    if (!id) return json({ error: "Missing id" }, 400);

    const ok = body.status === "done";
    const { error } = await supabase
      .from("home_hub_commands")
      .update({
        status: ok ? "done" : "failed",
        result: ok ? ((body.result as Record<string, unknown>) ?? {}) : null,
        error: ok ? null : String(body.error ?? "Agent reported failure"),
        completed_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // Read-only snapshot of Home Assistant, Homebridge or the host (agent >= 1.1.0).
  if (op === "snapshot") {
    // No heartbeat here: snapshot posts carry no version/info, and poll already beats every 15s.
    const source = String(body.source ?? "");
    if (!SNAPSHOT_SOURCES.has(source)) return json({ error: `Unknown snapshot source: ${source}` }, 400);
    const data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};
    const { error } = await supabase.rpc("home_hub_ingest_snapshot", {
      p_source: source,
      p_ok: body.ok === true,
      p_error: body.error ? String(body.error).slice(0, 1000) : null,
      p_data: data,
    });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // Five-minute network sample (agent >= 1.5.0): router + internet ping, DNS time, WAN state.
  if (op === "net_sample") {
    const s = (body.sample && typeof body.sample === "object" && !Array.isArray(body.sample)) ? body.sample as Payload : {};
    const str = (v: unknown, n = 60) => (typeof v === "string" && v ? v.slice(0, n) : null);
    const { error } = await supabase.from("home_hub_network_samples").insert({
      gateway: str(s.gateway),
      gw_loss_pct: num(s.gw_loss_pct), gw_avg_ms: num(s.gw_avg_ms), gw_max_ms: num(s.gw_max_ms),
      inet_loss_pct: num(s.inet_loss_pct), inet_avg_ms: num(s.inet_avg_ms), inet_max_ms: num(s.inet_max_ms),
      dns_ms: num(s.dns_ms), dns_ok: typeof s.dns_ok === "boolean" ? s.dns_ok : null,
      wan_status: str(s.wan_status), wan_uptime_s: num(s.wan_uptime_s), external_ip: str(s.external_ip),
    });
    if (error) return json({ error: error.message }, 500);
    // Keep 30 days.
    if (Math.random() < 0.02) {
      await supabase.from("home_hub_network_samples").delete()
        .lt("captured_at", new Date(Date.now() - 30 * 86_400_000).toISOString());
    }
    return json({ ok: true });
  }

  // Mirror the agent's own credentials into Vault. Write-only: nothing here ever returns a value.
  if (op === "backup_secrets") {
    const secrets = (body.secrets && typeof body.secrets === "object") ? body.secrets as Record<string, unknown> : {};
    const stored: string[] = [];
    const skipped: string[] = [];
    for (const [name, value] of Object.entries(secrets)) {
      if (!(name in BACKUP_SECRETS) || typeof value !== "string" || !value || value.length > 8000) {
        skipped.push(name);
        continue;
      }
      const { error } = await supabase.rpc("home_hub_vault_put", {
        p_name: name, p_value: value, p_description: BACKUP_SECRETS[name],
      });
      if (error) skipped.push(name); else stored.push(name);
    }
    return json({ stored, skipped });
  }

  // Health events from the agent (>= 1.2.0). home_hub_raise() keeps the issue list and decides
  // what reaches the phone, so a chatty or retrying agent can't spam it.
  if (op === "event") {
    const key = String(body.key ?? "");
    const kind = String(body.kind ?? "");
    const severity = String(body.severity ?? "info");
    if (!/^[a-z0-9_.@\/-]{2,120}$/i.test(key)) return json({ error: "Bad event key" }, 400);
    if (!EVENT_KINDS.has(kind)) return json({ error: `Bad event kind: ${kind}` }, 400);
    if (!EVENT_SEVERITIES.has(severity)) return json({ error: `Bad event severity: ${severity}` }, 400);
    const occurred = typeof body.occurred_at === "string" && !Number.isNaN(Date.parse(body.occurred_at))
      ? body.occurred_at
      : null;
    const { data, error } = await supabase.rpc("home_hub_raise", {
      p_key: key,
      p_kind: kind,
      p_severity: severity,
      p_title: String(body.title ?? key).slice(0, 200),
      p_body: body.body ? String(body.body).slice(0, 3000) : null,
      p_push: body.push === true,
      p_source: "agent",
      p_occurred_at: occurred,
    });
    if (error) return json({ error: error.message }, 500);
    return json(data ?? { ok: true });
  }

  // The newest published agent release, for nightly self-update. Version + hash only.
  if (op === "release_latest") {
    const { data, error } = await supabase.from("home_hub_agent_releases").select("version, sha256");
    if (error) return json({ error: error.message }, 500);
    const parse = (v: string) => v.split(".").map((n) => parseInt(n, 10));
    const newest = (data ?? []).sort((a, b) => {
      const [x, y] = [parse(a.version), parse(b.version)];
      for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i];
      return 0;
    })[0];
    return json(newest ?? {});
  }

  // Hand the agent the source of a published release for agent.update.
  if (op === "release") {
    const version = String(body.version ?? "");
    const { data, error } = await supabase
      .from("home_hub_agent_releases")
      .select("version, sha256, source")
      .eq("version", version)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: `No release ${version}` }, 404);
    return json(data);
  }

  return json({ error: `Unknown op: ${op}` }, 400);
});
