// Home Hub on-prem agent endpoint.
//
// The Pi has no inbound route from the internet, so control is a queue rather than
// a direct call: the admin enqueues a row in home_hub_commands, the agent running
// on the LAN polls this function, executes locally, and posts the result back.
// Nothing in the browser ever touches the LAN.
//
// Auth: shared secret in x-api-key, held in Vault. Not the anon key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  },
  homebridge: { restart: none, refresh: none },
  homeassistant: {
    toggle_automation: (p) =>
      typeof p.automation_id === "string" && /^automation\.[a-z0-9_]+$/.test(p.automation_id) && typeof p.enabled === "boolean"
        ? null
        : "toggle_automation needs automation_id (automation.<id>) and enabled (boolean)",
    refresh: none,
  },
  // Self-update (agent >= 1.1.0). The agent re-checks the sha256 against the file it downloads.
  agent: {
    update: (p) =>
      typeof p.version === "string" && /^\d+\.\d+\.\d+$/.test(p.version) &&
      typeof p.sha256 === "string" && /^[0-9a-f]{64}$/.test(p.sha256)
        ? null
        : "agent.update needs version (x.y.z) and sha256",
  },
};

const SNAPSHOT_SOURCES = new Set(["homeassistant", "homebridge", "host"]);
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
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
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
