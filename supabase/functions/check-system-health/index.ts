import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Cookie Yeti system health check + SMS alerting.
 *
 * Design notes (2026-04-28 rewrite):
 *
 *  - Alerts fire on CHANGES to the SET of down systems, not on a global boolean.
 *    Previously, once is_down=true from system A, system B going down silently
 *    produced no alert. Now newly-down and newly-recovered systems each
 *    surface, and SMS calls out which ones changed.
 *
 *  - Hysteresis: a state change requires the same set on 2 consecutive checks
 *    before we treat it as confirmed. Kills oscillation when a metric sits
 *    near its threshold (the original 4h cron threshold flapped against the
 *    cron's natural 3h cadence).
 *
 *  - Quiet hours (23:00–07:00 Pacific): we still update is_down/down_systems
 *    so the dashboard reflects reality, but we suppress SMS. The first check
 *    after 07:00 sees the unchanged-yet-unalerted state and fires a single
 *    summary SMS covering everything that happened overnight.
 *
 *  - Cron threshold raised 4h → 6h (= two missed 3h cycles). Other thresholds
 *    unchanged.
 *
 *  - Phone numbers via env (TWILIO_TO / TWILIO_FROM) with the previous
 *    hardcoded values as fallback so the function keeps working until the
 *    env vars are populated.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";
const TO_NUMBER = Deno.env.get("TWILIO_TO") || "+18165007236";
const FROM_NUMBER = Deno.env.get("TWILIO_FROM") || "+12139279363";

// Hysteresis: require this many consecutive matching readings before a
// confirmed state change.
const CONFIRMATION_CHECKS = 2;

// Quiet hours in PT (Pacific, UTC-7 during DST, UTC-8 standard). We use a
// fixed UTC offset of -8 — DST drift on the boundary is a one-hour edge
// case for a phone-alert window and not worth the tz library.
const PT_UTC_OFFSET_HOURS = -8;
const QUIET_START_HOUR_PT = 23; // 11 PM
const QUIET_END_HOUR_PT = 7;    // 7 AM (exclusive)

// Thresholds in hours
const THRESHOLDS = {
  ai_generator: { amber: 24, red: 72 },
  report_ingestion: { amber: 24, red: 72 },
  pattern_learning: { amber: 24, red: 72 },
  cron_jobs: { amber: 2, red: 6 }, // raised from 4 → 6 to give room for cron's 3h cadence
} as const;

type SystemKey = keyof typeof THRESHOLDS;

interface SystemDefinition {
  name: string;       // human-readable label, e.g. "AI Generator"
  key: SystemKey;     // matches THRESHOLDS
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

function inQuietHoursPT(now: Date = new Date()): boolean {
  const utcHour = now.getUTCHours();
  const ptHour = (utcHour + PT_UTC_OFFSET_HOURS + 24) % 24;
  if (QUIET_START_HOUR_PT > QUIET_END_HOUR_PT) {
    // Wraps midnight: e.g. 23..7
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
  // items in a but not b
  const sb = new Set(b);
  return a.filter((x) => !sb.has(x));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: maintenance secret OR service role Bearer token (or maintenance secret AS bearer)
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
    // ---------- Pull latest heartbeats ----------
    const [aiGenRes, reportRes, patternRes, maintenanceRes] = await Promise.all([
      supabase.from("ai_generation_log").select("created_at").order("created_at", { ascending: false }).limit(1),
      supabase.from("missed_banner_reports").select("last_reported").order("last_reported", { ascending: false }).limit(1),
      supabase.from("cookie_patterns").select("created_at").order("created_at", { ascending: false }).limit(1),
      supabase.from("pattern_fix_log").select("created_at").order("created_at", { ascending: false }).limit(1),
    ]);

    const lastAiGen = aiGenRes.data?.[0]?.created_at ?? null;
    const lastReport = reportRes.data?.[0]?.last_reported ?? null;
    const lastPattern = patternRes.data?.[0]?.created_at ?? null;
    const lastCron = maintenanceRes.data?.[0]?.created_at ?? null;

    const systems: SystemDefinition[] = [
      { name: "AI Generator",     key: "ai_generator",     lastRun: lastAiGen   },
      { name: "Report Ingestion", key: "report_ingestion", lastRun: lastReport  },
      { name: "Pattern Learning", key: "pattern_learning", lastRun: lastPattern },
      { name: "Cron Jobs",        key: "cron_jobs",        lastRun: lastCron    },
    ];

    // System NAMES that are currently down (no timestamp, for set comparison)
    const currentDownNames: string[] = [];
    // System NAMES + age, for human-readable messages
    const currentDownLabels: Record<string, string> = {};
    for (const sys of systems) {
      const h = hoursAgo(sys.lastRun);
      const threshold = THRESHOLDS[sys.key].red;
      if (h === null || h > threshold) {
        currentDownNames.push(sys.name);
        currentDownLabels[sys.name] = h === null
          ? "never run"
          : `${formatHours(h)} silent`;
      }
    }

    // ---------- Read previous state (with hysteresis tracking) ----------
    const { data: alertState } = await supabase
      .from("system_alert_state")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    const prevPending: string[]         = alertState?.pending_systems ?? [];
    const prevPendingCount: number       = alertState?.pending_match_count ?? 0;
    const prevAlertedSystems: string[]   = alertState?.last_alerted_systems ?? [];
    const prevConfirmedDown: string[]    = (alertState?.down_systems ?? [])
      .map((s: string) => s.split(" (")[0]); // strip the "(94h ago)" suffix

    // ---------- Hysteresis ----------
    let pendingSystems: string[];
    let pendingMatchCount: number;
    if (setEqual(currentDownNames, prevPending)) {
      pendingSystems = prevPending;
      pendingMatchCount = prevPendingCount + 1;
    } else {
      pendingSystems = currentDownNames;
      pendingMatchCount = 1;
    }

    // Confirmed state = pending state, but only after CONFIRMATION_CHECKS
    // consecutive readings agree. Until confirmed, we keep the previously
    // confirmed state.
    let confirmedDown: string[] =
      pendingMatchCount >= CONFIRMATION_CHECKS ? pendingSystems : prevConfirmedDown;

    // ---------- Decide whether to alert ----------
    const newlyDown = diff(confirmedDown, prevAlertedSystems);
    const newlyUp   = diff(prevAlertedSystems, confirmedDown);
    const hasChange = newlyDown.length > 0 || newlyUp.length > 0;
    const quiet = inQuietHoursPT();

    let smsSent = false;
    let smsBody: string | null = null;
    let nextAlertedSystems = prevAlertedSystems;
    if (hasChange && !quiet) {
      smsBody = composeMessage({ confirmedDown, newlyDown, newlyUp, currentDownLabels, systems });
      smsSent = await sendSMS(smsBody);
      if (smsSent) nextAlertedSystems = confirmedDown;
    }

    // ---------- Persist ----------
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
        sms_suppressed: hasChange && quiet,
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
  newlyUp: string[];
  currentDownLabels: Record<string, string>;
  systems: SystemDefinition[];
}

function composeMessage(m: MessageInput): string {
  const { confirmedDown, newlyDown, newlyUp, currentDownLabels, systems } = m;
  const lines: string[] = [];

  if (confirmedDown.length === 0) {
    // Full recovery
    lines.push("✅ Cookie Yeti: all systems operational.");
    if (newlyUp.length > 0) {
      lines.push(`Recovered: ${newlyUp.join(", ")}.`);
    }
    return lines.join("\n");
  }

  // Header: how many down + which are new this alert
  if (newlyDown.length > 0) {
    lines.push(`🚨 Cookie Yeti — ${newlyDown.length} new failure${newlyDown.length === 1 ? "" : "s"}:`);
    for (const name of newlyDown) {
      lines.push(`• ${name} — ${currentDownLabels[name] ?? "stale"}`);
    }
  } else {
    lines.push(`🚨 Cookie Yeti — ${confirmedDown.length} system${confirmedDown.length === 1 ? "" : "s"} down:`);
  }

  // Systems still down but not new
  const carryOver = confirmedDown.filter((n) => !newlyDown.includes(n));
  if (carryOver.length > 0) {
    lines.push(`Still down: ${carryOver.map((n) => `${n} (${currentDownLabels[n] ?? "stale"})`).join(", ")}`);
  }

  if (newlyUp.length > 0) {
    lines.push(`Recovered: ${newlyUp.join(", ")}`);
  }

  // Last-run footer for newly down systems (helps triage)
  for (const name of newlyDown) {
    const sys = systems.find((s) => s.name === name);
    if (sys?.lastRun) {
      lines.push(`${name} last seen: ${sys.lastRun}`);
    }
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
