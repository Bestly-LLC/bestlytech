import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * probe-external v4 (2026-05-03) - optional NTFY_TOKEN auth.
 * v3 (2026-05-01) - ntfy push on flip-to-down.
 * v2 (2026-04-30) - probe + DB write.
 *
 * Scheduled every 5 minutes by the external_health_probe migration.
 *
 * Status rules:
 *   ok    - HTTP 2xx within timeout
 *   warn  - HTTP 3xx (unexpected), 4xx, or latency > 4000ms
 *   down  - TCP fail, TLS fail, timeout, DNS fail, or HTTP 5xx (after 2 fails)
 *
 * Sends ONE ntfy push when a service flips ok/warn -> down (after hysteresis).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TIMEOUT_MS = 8000;
const LATENCY_WARN_MS = 4000;
const CONFIRM_FAILURES = 2;

const NTFY_BASE = "https://ntfy.sh";
const NTFY_TOPIC_DEFAULT = "bestly-sysalert-7q2k9mx4";
const CLICK_URL = "https://bestly.tech/status";

type Status = "ok" | "warn" | "down" | "unknown";

interface ProbeResult {
  status: Status;
  http_code: number | null;
  latency_ms: number | null;
  error_message: string | null;
}

async function probeOne(url: string): Promise<ProbeResult> {
  const start = Date.now();
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ac.signal,
      headers: { "User-Agent": "BestlyExternalProbe/1.0 (+admin@bestly.tech)" },
    });
    const latency = Date.now() - start;
    let status: Status;
    if (res.status >= 200 && res.status < 400) {
      status = latency > LATENCY_WARN_MS ? "warn" : "ok";
    } else if (res.status >= 400 && res.status < 500) {
      status = "warn";
    } else {
      status = "down";
    }
    return {
      status,
      http_code: res.status,
      latency_ms: latency,
      error_message: status === "ok" ? null : `HTTP ${res.status}`,
    };
  } catch (err: any) {
    const latency = Date.now() - start;
    const isTimeout = err.name === "AbortError" || err.name === "TimeoutError";
    return {
      status: "down",
      http_code: null,
      latency_ms: latency,
      error_message: isTimeout ? `Timeout after ${TIMEOUT_MS}ms` : (err.message || "network error"),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function sendNtfy(title: string, body: string, priority: 1|2|3|4|5 = 4): Promise<boolean> {
  const topic = Deno.env.get("NTFY_TOPIC") || NTFY_TOPIC_DEFAULT;
  const ntfyToken = Deno.env.get("NTFY_TOKEN");
  const headers: Record<string, string> = {
    "Title": title,
    "Priority": String(priority),
    "Tags": "warning,globe_with_meridians",
    "Click": CLICK_URL,
  };
  if (ntfyToken) headers["Authorization"] = `Bearer ${ntfyToken}`;
  try {
    const res = await fetch(`${NTFY_BASE}/${topic}`, { method: "POST", headers, body });
    return res.ok;
  } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  const secret = req.headers.get("x-maintenance-secret");
  let authorized = false;
  if (secret && secret === Deno.env.get("MAINTENANCE_SECRET")) authorized = true;
  if (!authorized && authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) authorized = true;
    if (!authorized && token === Deno.env.get("MAINTENANCE_SECRET")) authorized = true;
  }
  const isCronCall = !authHeader && !secret && req.method === "POST";
  if (!authorized && !isCronCall) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: services, error: loadErr } = await supabase
    .from("external_health")
    .select("service, url, status, consecutive_failures, last_ok");

  if (loadErr || !services) {
    return new Response(
      JSON.stringify({ error: loadErr?.message || "failed to load services" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const results: Array<Record<string, unknown>> = [];
  const newlyDown: Array<{ service: string; reason: string }> = [];

  await Promise.all(services.map(async (svc: any) => {
    const probe = await probeOne(svc.url);
    const isFailure = probe.status === "down";
    const newConsecFails = isFailure ? (svc.consecutive_failures ?? 0) + 1 : 0;
    let finalStatus: Status = probe.status;
    if (isFailure && newConsecFails < CONFIRM_FAILURES) finalStatus = "warn";
    const wasDown = svc.status === "down";
    const isNowDown = finalStatus === "down";
    if (isNowDown && !wasDown) {
      newlyDown.push({ service: svc.service, reason: probe.error_message ?? "unknown" });
    }
    const now = new Date().toISOString();
    const update = {
      status: finalStatus,
      http_code: probe.http_code,
      latency_ms: probe.latency_ms,
      error_message: probe.error_message,
      last_checked: now,
      last_ok: finalStatus === "ok" ? now : svc.last_ok ?? null,
      consecutive_failures: newConsecFails,
    };
    const { error: upErr } = await supabase.from("external_health").update(update).eq("service", svc.service);
    results.push({ service: svc.service, url: svc.url, ...update, update_error: upErr?.message ?? null });
  }));

  let pushSent = false;
  if (newlyDown.length > 0) {
    const title = `External outage - ${newlyDown.length} service${newlyDown.length === 1 ? "" : "s"} down`;
    const body = newlyDown.map((d) => `- ${d.service}: ${d.reason}`).join("\n");
    pushSent = await sendNtfy(title, body, 5);
  }

  return new Response(
    JSON.stringify({ probed: results.length, newly_down: newlyDown, push_sent: pushSent, results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
