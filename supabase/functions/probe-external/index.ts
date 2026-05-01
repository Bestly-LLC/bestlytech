import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * probe-external — checks each row in public.external_health and writes status.
 *
 * Scheduled every 5 minutes by the external_health_probe migration.
 *
 * Status rules:
 *   ok    — HTTP 2xx within timeout
 *   warn  — HTTP 3xx (unexpected), 4xx, or latency > 4000ms
 *   down  — TCP fail, TLS fail, timeout, DNS fail, or HTTP 5xx
 *
 * 2-failure hysteresis on `consecutive_failures` before flipping to `down`,
 * so a single network blip doesn't page the operator.
 *
 * Auth: service-role Bearer (cron passes via invoke_edge_function) OR
 *       x-maintenance-secret header.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TIMEOUT_MS = 8000;
const LATENCY_WARN_MS = 4000;
const CONFIRM_FAILURES = 2;

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
  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: services, error: loadErr } = await supabase
    .from("external_health")
    .select("service, url, consecutive_failures, last_ok");

  if (loadErr || !services) {
    return new Response(
      JSON.stringify({ error: loadErr?.message || "failed to load services" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const results: Array<Record<string, unknown>> = [];

  await Promise.all(
    services.map(async (svc: any) => {
      const probe = await probeOne(svc.url);
      const isFailure = probe.status === "down";
      const newConsecFails = isFailure ? (svc.consecutive_failures ?? 0) + 1 : 0;

      let finalStatus: Status = probe.status;
      if (isFailure && newConsecFails < CONFIRM_FAILURES) {
        finalStatus = "warn";
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

      const { error: upErr } = await supabase
        .from("external_health")
        .update(update)
        .eq("service", svc.service);

      results.push({
        service: svc.service,
        url: svc.url,
        ...update,
        update_error: upErr?.message ?? null,
      });
    }),
  );

  return new Response(
    JSON.stringify({ probed: results.length, results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
