import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Cookie Yeti system health check + ntfy alerting.
 *
 * v18 (2026-05-03) - optional NTFY_TOKEN env for authenticated push (lifts IP rate limit).
 * v17 (2026-05-01) - diagnostic.
 * v16 (2026-05-01) - ASCII-only header values.
 * v15 (2026-05-01) - ntfy switch (em-dash bug).
 * v14 (2026-05-01) - SWITCH FROM TWILIO/SMS to ntfy.sh PUSH NOTIFICATIONS.
 *
 * Rules:
 *  - PUSH ONLY when something newly fails. No recovery, no all-clear.
 *  - Quiet hours 23:00-07:00 PT - push suppressed (state still updated).
 *  - 2-check hysteresis. No flapping.
 *  - If NTFY_TOKEN set, sent as Authorization: Bearer for ntfy.sh authed quota.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const NTFY_BASE = "https://ntfy.sh";
const NTFY_TOPIC_DEFAULT = "bestly-sysalert-7q2k9mx4";
const CLICK_URL = "https://bestly.tech/admin";

const CONFIRMATION_CHECKS = 2;
const PT_UTC_OFFSET_HOURS = -8;
const QUIET_START_HOUR_PT = 23;
const QUIET_END_HOUR_PT = 7;

const THRESHOLDS = {
  ai_generator: { red: 72 },
  cron_jobs:    { red: 6  },
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
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const [aiGenRes, maintenanceRes] = await Promise.all([
      supabase.from("ai_generation_log").select("created_at").order("created_at", { ascending: false }).limit(1),
      supabase.from("pattern_fix_log").select("created_at").order("created_at", { ascending: false }).limit(1),
    ]);

    const lastAiGen = aiGenRes.data?.[0]?.created_at ?? null;
    const lastCron  = maintenanceRes.data?.[0]?.created_at ?? null;

    const systems: SystemDefinition[] = [
      { name: "AI Generator", key: "ai_generator", lastRun: lastAiGen },
      { name: "Cron Jobs",    key: "cron_jobs",    lastRun: lastCron  },
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

    const newlyDown = diff(confirmedDown, prevAlertedSystems);
    const newlyUp   = diff(prevAlertedSystems, confirmedDown);
    const shouldAlert = newlyDown.length > 0;
    const quiet = inQuietHoursPT();

    let pushSent = false;
    let pushBody: string | null = null;
    let nextAlertedSystems = prevAlertedSystems;

    if (shouldAlert && !quiet) {
      const m = composeMessage({ confirmedDown, newlyDown, currentDownLabels, systems });
      pushBody = m.body;
      pushSent = await sendNtfy({
        title: m.title,
        body: m.body,
        priority: 5,
        tags: ["rotating_light", "cookie"],
      });
    }

    if (pushSent || (newlyUp.length > 0 && !shouldAlert)) {
      nextAlertedSystems = confirmedDown;
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
      last_alert_at: pushSent ? now : (alertState?.last_alert_at ?? null),
      last_alert_sent: pushSent ? now : (alertState?.last_alert_sent ?? null),
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
        push_sent: pushSent,
        push_suppressed: shouldAlert && quiet,
        push_body: pushBody,
        quiet_hours: quiet,
        channel: "ntfy",
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

function composeMessage(m: MessageInput): { title: string; body: string } {
  const { confirmedDown, newlyDown, currentDownLabels, systems } = m;
  const title = `Cookie Yeti - ${newlyDown.length} new failure${newlyDown.length === 1 ? "" : "s"}`;
  const lines: string[] = [];
  for (const name of newlyDown) {
    lines.push(`- ${name}: ${currentDownLabels[name] ?? "stale"}`);
  }
  const carryOver = confirmedDown.filter((n) => !newlyDown.includes(n));
  if (carryOver.length > 0) {
    lines.push(`Still down: ${carryOver.map((n) => `${n} (${currentDownLabels[n] ?? "stale"})`).join(", ")}`);
  }
  for (const name of newlyDown) {
    const sys = systems.find((s) => s.name === name);
    if (sys?.lastRun) lines.push(`${name} last seen: ${sys.lastRun}`);
  }
  return { title, body: lines.join("\n") };
}

interface NtfyOpts {
  title: string;
  body: string;
  priority?: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
}

async function sendNtfy(opts: NtfyOpts): Promise<boolean> {
  const topic = Deno.env.get("NTFY_TOPIC") || NTFY_TOPIC_DEFAULT;
  const ntfyToken = Deno.env.get("NTFY_TOKEN");
  const headers: Record<string, string> = {
    "Title": opts.title,
    "Priority": String(opts.priority ?? 3),
    "Tags": (opts.tags ?? []).join(","),
    "Click": CLICK_URL,
  };
  if (ntfyToken) headers["Authorization"] = `Bearer ${ntfyToken}`;
  try {
    const res = await fetch(`${NTFY_BASE}/${topic}`, {
      method: "POST",
      headers,
      body: opts.body,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error(`ntfy ${res.status}:`, t);
      return false;
    }
    return true;
  } catch (e) {
    console.error("ntfy push failed:", e);
    return false;
  }
}
