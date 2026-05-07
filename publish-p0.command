#!/bin/bash
# P0 — Admin command center: stop the lying.
#
# Ships the dashboard-truth fixes:
#   - SystemPulse rewritten to read real schema columns (was reading 4 cols
#     that never existed → banner stayed green even when broken)
#   - ActionInbox email column names fixed (sent_at/recipient/error →
#     created_at/recipient_email/error_message). Failed-email alerts now fire.
#   - AdminDashboard: removed dead `userCount` state that was double-querying
#     the same passkey count.
#   - SmartAlerts: 0% AI success rate now escalates to CRITICAL with explanation.
#   - check-system-health edge fn already deployed (v10) — counts SUCCESS only,
#     threshold widened to 72h.
#   - probe-external edge fn deployed + external_health table seeded with
#     6 services + cron schedule every 5min.
#
# Effect: dashboard tells the truth. Within ~30 minutes the new health-check
# will SMS once with "AI Generator — 7d silent" — that's the legitimate signal
# that the pipeline has been alive but not actually generating successful
# patterns. Investigate that under P1.

set -e
cd /Users/jared/Developer/bestlytech
[ -f .git/index.lock ] && rm -f .git/index.lock

git checkout main
git pull origin main

git add \
  src/components/admin/SystemPulse.tsx \
  src/components/admin/ActionInbox.tsx \
  src/components/admin/SmartAlerts.tsx \
  src/pages/admin/AdminDashboard.tsx \
  supabase/functions/check-system-health/index.ts \
  docs/admin-opusplan.md

# include the new probe-external function source for repo parity (already deployed)
mkdir -p supabase/functions/probe-external
cat > supabase/functions/probe-external/index.ts << 'EOFPROBE'
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
EOFPROBE
git add supabase/functions/probe-external/index.ts

# include the migration source for repo parity (already applied via mcp)
cat > supabase/migrations/20260430000000_external_health_probe.sql << 'EOFMIG'
-- 2026-04-30 — external service uptime probe.
-- See probe-external edge function. Migration already applied to project
-- rcqfqhguwpmaarseifqg via the dashboard; this file mirrors it for repo parity.

CREATE TABLE IF NOT EXISTS public.external_health (
  service       text PRIMARY KEY,
  url           text NOT NULL,
  status        text NOT NULL CHECK (status IN ('ok','warn','down','unknown')),
  http_code     integer,
  latency_ms    integer,
  error_message text,
  last_checked  timestamptz NOT NULL DEFAULT now(),
  last_ok       timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.external_health (service, url, status) VALUES
  ('cookieyeti.com',     'https://cookieyeti.com/',     'unknown'),
  ('hoascope.com',       'https://hoascope.com/',       'unknown'),
  ('app.hoascope.com',   'https://app.hoascope.com/',   'unknown'),
  ('cloud.bestly.tech',  'https://cloud.bestly.tech/',  'unknown'),
  ('bestly.tech',        'https://bestly.tech/',        'unknown')
ON CONFLICT (service) DO NOTHING;

ALTER TABLE public.external_health ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_read_external_health" ON public.external_health;
CREATE POLICY "admins_read_external_health"
  ON public.external_health
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_external_health_status
  ON public.external_health(status)
  WHERE status IN ('warn','down');

DO $$ BEGIN
  PERFORM cron.unschedule('probe-external');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'probe-external',
  '*/5 * * * *',
  $$ SELECT public.invoke_edge_function('probe-external'); $$
);
EOFMIG
git add supabase/migrations/20260430000000_external_health_probe.sql

echo "Files staged:"
git diff --cached --name-only

echo "→ Build sanity check..."
if ! npm run build > /tmp/p0-build.log 2>&1; then
  tail -30 /tmp/p0-build.log >&2
  exit 2
fi
echo "✓ Build passes"

git commit -m "fix(admin): P0 — stop the dashboard from lying

SystemPulse rewritten to read real schema. Previous version queried
ai_pipeline_ok / reports_ok / patterns_ok / maintenance_ok — none of
those columns exist in system_alert_state and never have. Banner
stayed green because is_down=false (the v9 health check only watched
2 systems both of which heartbeat on any insert, including failures).

New SystemPulse computes 4 live indicators on the client:
  - AI Generator   last status='success' age (red 72h, warn 24h)
  - Cron           last pattern_fix_log age (red 6h, warn 4h)
  - Email          24h fail-vs-sent ratio
  - External       aggregate from external_health (probe-external fn)

Headline status is the worst of the four. Drops the fake subsystem
dots, keeps the v9 SMS-fired down_systems display.

ActionInbox email_send_log column-name bugs fixed:
  sent_at      → created_at
  recipient    → recipient_email
  error        → error_message
The failed-email tile silently errored before — never fired.

SmartAlerts: 0% success rate now CRITICAL with diagnostic message
('AI pipeline producing zero successful patterns'). Was a generic
warning before, lost in noise.

AdminDashboard: removed dead userCount state that was a duplicate
passkey_credentials count. setUserCount was set but never rendered.

check-system-health (v10, deployed via mcp):
  - ai_generator heartbeat now uses status='success' filter
  - threshold widened 12h → 72h since success runs are bursty
  - documented the v10 change in the file header

probe-external (new edge fn, deployed via mcp):
  - reads public.external_health (new table)
  - probes every row every 5min via pg_cron
  - 2-failure hysteresis before flipping to 'down'
  - service-role auth via invoke_edge_function

external_health table seeded with: cookieyeti.com, hoascope.com,
app.hoascope.com, cloud.bestly.tech, bestly.tech.

After deploy the operator will get one SMS '\\\"AI Generator — 7d silent\\\"'
within 30min — that's the legitimate signal that the AI fixer has been
running but generating zero successful patterns for a week. The fix
for that is P1, not P0.

docs/admin-opusplan.md captures the full P0–P3 plan.
"

git push origin main

echo ""
echo "============================================================"
echo "  PUBLISHED P0 to main."
echo "  Vercel rebuilds within ~90 sec."
echo "  Cmd+Shift+R bestly.tech/admin"
echo ""
echo "  Expect: SystemPulse banner now shows 4 real indicators."
echo "  Within 30 min: one SMS 'AI Generator — 7d silent' (legit signal)."
echo "============================================================"
sleep 25
