import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Cookie Yeti system health check + SMS alerting.
 *
 * v8 (2026-04-28) — issue-only alerting, plus pipeline-stall awareness.
 *
 * Rules from the operator:
 *  - SMS ONLY when something newly fails. No recovery pings, no all-clear.
 *  - Quiet hours 23:00–07:00 PT. Suppress SMS but keep state up to date.
 *  - 2-check hysteresis. No flapping.
 *
 * Thresholds tightened from the original 72h red:
 *  - ai_generator      red 12h (cron runs every 6h)
 *  - pattern_learning  red 24h (writes when AI succeeds for new domains)
 *  - report_ingestion  red 24h (extension reports are user-driven)
 *  - cron_jobs         red  6h (cron writes a heartbeat every 3h)
 *
 * Report Ingestion now uses GREATEST(MAX(created_at), MAX(last_reported)) so
 * brand-new domain reports register as activity — not just duplicate-domain
 * pings (the old MAX(last_reported) signal looked dead for 11 days while
 * legitimate new reports were arriving).
 *
 * Already deployed to Supabase as check-system-health v8. Mirrored here.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";
const TO_NUMBER = Deno.env.get("TWILIO_TO") || "+18165007236";
const FROM_NUMBER = Deno.env.get("TWILIO_FROM") || "+12139279363";

const CONFIRMATION_CHECKS = 2;
const PT_UTC_OFFSET_HOURS = -8;
const QUIET_START_HOUR_PT = 23;
const QUIET_END_HOUR_PT = 7;

const THRESHOLDS = {
  ai_generator:     { red: 12 },
  report_ingestion: { red: 24 },
  pattern_learning: { red: 24 },
  cron_jobs:        { red: 6  },
} as const;

type SystemKey = keyof typeof THRESHOLDS;

interface SystemDefinition {
  name: string;
  key: SystemKey;
  lastRun: string | null;
}

function hoursAgo(date: string | null): number | null {
  if (!date) return null;
  return (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60);
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

function maxDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function inQuietHoursPT(now: Date = new Date()): boolean {
  const utcHour = now.getUTCHours();
  const ptHour = (utcHour + PT_UTC_OFFSET_HOURS + 24) % 24;
  if (QUIET_START_HOUR_PT > QUIET_END_HOUR_PT) {
    return ptHour >= QUIET_START_HOUR_PT || ptHour < QUIET_END_HOUR_PT;
  }
  return ptHour >= QUIET_START_HOUR_PT && ptHour < QUIET_END_HOUR_PT;
}

function setEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) if (!sa.has(x)) return false;
  return true;
}

function diff(a: string[], b: string[]): string[] {
  const sb = new Set(b);
  return a.filter((x) => !sb.has(x));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const secret = req.headers.get("x-maintenance-secret");
  const authHeader = req.headers.get("Authorization");
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

  try {
    const [aiGenRes, reportCreatedRes, reportLastRes, patternRes, maintenanceRes] = await Promise.all([
      supabase.from("ai_generation_log").select("created_at").order("created_at", { ascending: false }).limit(1),
      supabase.from("missed_banner_reports").select("created_at").order("created_at", { ascending: false }).limit(1),
      supabase.from("missed_banner_reports").select("last_reported").order("last_reported", { ascending: false }).limit(1),
      supabase.from("cookie_patterns").select("created_at").order("created_at", { ascending: false }).limit(1),
      supabase.from("pattern_fix_log").select("created_at").order("created_at", { ascending: false }).limit(1),
    ]);

    const lastAiGen   = aiGenRes.data?.[0]?.created_at ?? null;
    const lastReport  = maxDate(
      reportCreatedRes.data?.[0]?.created_at ?? null,
      reportLastRes.data?.[0]?.last_reported ?? null,
    );
    const lastPattern = patternRes.data?.[0]?.created_at ?? null;
    const lastCron    = maintenanceRes.data?.[0]?.created_at ?? null;

    const systems: SystemDefinition[] = [
      { name: "AI Generator",     key: "ai_generator",     lastRun: lastAiGen   },
      { name: "Report Ingestion", key: "report_ingestion", lastRun: lastReport  },
      { name: "Pattern Learning", key: "pattern_learning", lastRun: lastPattern },
      { name: "Cron Jobs",        key: "cron_jobs",        lastRun: lastCron    },
    ];

    const currentDownNames: string[] = [];
    const currentDownLabels: Record<string, string> = {};
    for (const sys of systems) {
      const h = hoursAgo(sys.lastRun);
      const threshold = THRESHOLDS[sys.key].red;
      if (h === null || h > threshold) {
        currentDownNames.push(sys.name);
        currentDownLabels[sys.name] = h === null ? "never run" : `${formatHours(h)} silent`;
      }
    }

    const { data: alertState } = await supabase
      .from("system_alert_state")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    const prevPending: string[]        = alertState?.pending_systems ?? [];
    const prevPendingCount: number     = alertState?.pending_match_count ?? 0;
    const prevAlertedSystems: string[] = alertState?.last_alerted_systems ?? [];
    const prevConfirmedDown: string[]  = (alertState?.down_systems ?? [])
      .map((s: string) => s.split(" (")[0]);

    let pendingSystems: string[];
    let pendingMatchCount: number;
    if (setEqual(currentDownNames, prevPending)) {
      pendingSystems = prevPending;
      pendingMatchCount = prevPendingCount + 1;
    } else {
      pendingSystems = currentDownNames;
      pendingMatchCount = 1;
    }

    const confirmedDown: string[] =
      pendingMatchCount >= CONFIRMATION_CHECKS ? pendingSystems : prevConfirmedDown;

    // Issue-only SMS: only fire when something NEWLY fails.
    // Recoveries / all-clears never trigger SMS, ever.
    const newlyDown = diff(confirmedDown, prevAlertedSystems);
    const newlyUp   = diff(prevAlertedSystems, confirmedDown);
    const shouldAlert = newlyDown.length > 0;
    const quiet = inQuietHoursPT();

    let smsSent = false;
    let smsBody: string | null = null;
    let nextAlertedSystems = prevAlertedSystems;

    if (newlyDown.length > 0 || newlyUp.length > 0) {
      nextAlertedSystems = confirmedDown;
    }

    if (shouldAlert && !quiet) {
      smsBody = composeMessage({ confirmedDown, newlyDown, currentDownLabels, systems });
      smsSent = await sendSMS(smsBody);
    }

    const now = new Date().toISOString();
    const downSystemsLabeled = confirmedDown.map(
      (n) => `${n} (${currentDownLabels[n] ?? "stale"})`,
    );

    await supabase.from("system_alert_state").upsert({
      id: 1,
      is_down: confirmedDown.length > 0,
      down_systems: downSystemsLabeled,
      pending_systems: pendingSystems,
      pending_match_count: pendingMatchCount,
      last_alerted_systems: nextAlertedSystems,
      last_checked: now,
      last_alert_at: smsSent ? now : (alertState?.last_alert_at ?? null),
      last_alert_sent: smsSent ? now : (alertState?.last_alert_sent ?? null),
      updated_at: now,
    });

    return new Response(
      JSON.stringify({
        status: confirmedDown.length > 0 ? "down" : "ok",
        confirmed_down: confirmedDown,
        pending_systems: pendingSystems,
        pending_match_count: pendingMatchCount,
        newly_down: newlyDown,
        newly_up: newlyUp,
        sms_sent: smsSent,
        sms_suppressed: shouldAlert && quiet,
        sms_body: smsBody,
        quiet_hours: quiet,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("Health check error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

interface MessageInput {
  confirmedDown: string[];
  newlyDown: string[];
  currentDownLabels: Record<string, string>;
  systems: SystemDefinition[];
}

function composeMessage(m: MessageInput): string {
  const { confirmedDown, newlyDown, currentDownLabels, systems } = m;
  const lines: string[] = [];

  lines.push(`🚨 Cookie Yeti — ${newlyDown.length} new failure${newlyDown.length === 1 ? "" : "s"}:`);
  for (const name of newlyDown) {
    lines.push(`• ${name} — ${currentDownLabels[name] ?? "stale"}`);
  }

  const carryOver = confirmedDown.filter((n) => !newlyDown.includes(n));
  if (carryOver.length > 0) {
    lines.push(`Still down: ${carryOver.map((n) => `${n} (${currentDownLabels[n] ?? "stale"})`).join(", ")}`);
  }

  for (const name of newlyDown) {
    const sys = systems.find((s) => s.name === name);
    if (sys?.lastRun) lines.push(`${name} last seen: ${sys.lastRun}`);
  }

  lines.push("Dashboard: bestly.tech/admin");
  return lines.join("\n");
}

async function sendSMS(body: string): Promise<boolean> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
  if (!LOVABLE_API_KEY || !TWILIO_API_KEY) {
    console.error("Twilio credentials not configured");
    return false;
  }
  try {
    const response = await fetch(`${GATEWAY_URL}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TWILIO_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: TO_NUMBER, From: FROM_NUMBER, Body: body.slice(0, 1600) }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      console.error("Twilio error:", JSON.stringify(data));
      return false;
    }
    console.log("SMS sent successfully");
    return true;
  } catch (e) {
    console.error("SMS send failed:", e);
    return false;
  }
}
