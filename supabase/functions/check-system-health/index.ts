import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";
const TO_NUMBER = "+18165007236";
const FROM_NUMBER = "+12139279363";

// Thresholds in hours
const THRESHOLDS = {
  ai_generator: { amber: 24, red: 72 },
  report_ingestion: { amber: 24, red: 72 },
  pattern_learning: { amber: 24, red: 72 },
  cron_jobs: { amber: 1, red: 4 },
};

function hoursAgo(date: string | null): number | null {
  if (!date) return null;
  return (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60);
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: maintenance secret OR service role Bearer token
  const secret = req.headers.get("x-maintenance-secret");
  const authHeader = req.headers.get("Authorization");
  let authorized = false;

  if (secret && secret === Deno.env.get("MAINTENANCE_SECRET")) {
    authorized = true;
  } else if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      authorized = true;
    }
  }

  // Also check if maintenance secret was passed as Bearer token (from vault)
  if (!authorized && authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    if (token === Deno.env.get("MAINTENANCE_SECRET")) {
      authorized = true;
    }
  }

  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // Query the same data sources the dashboard heartbeat uses
    const [aiGenRes, reportRes, patternRes, maintenanceRes] = await Promise.all([
      supabase.from("ai_generation_log").select("created_at").order("created_at", { ascending: false }).limit(1),
      supabase.from("missed_banner_reports").select("last_reported").order("last_reported", { ascending: false }).limit(1),
      supabase.from("cookie_patterns").select("created_at").order("created_at", { ascending: false }).limit(1),
      supabase.from("pattern_fix_log").select("created_at").order("created_at", { ascending: false }).limit(1),
    ]);

    const lastAiGen = aiGenRes.data?.[0]?.created_at ?? null;
    const lastReport = reportRes.data?.[0]?.last_reported ?? null;
    const lastPattern = patternRes.data?.[0]?.created_at ?? null;
    const lastMaintenance = maintenanceRes.data?.[0]?.created_at ?? null;

    const systems: { name: string; key: keyof typeof THRESHOLDS; lastRun: string | null }[] = [
      { name: "AI Generator", key: "ai_generator", lastRun: lastAiGen },
      { name: "Report Ingestion", key: "report_ingestion", lastRun: lastReport },
      { name: "Pattern Learning", key: "pattern_learning", lastRun: lastPattern },
      { name: "Cron Jobs", key: "cron_jobs", lastRun: lastMaintenance },
    ];

    const downSystems: string[] = [];
    for (const sys of systems) {
      const h = hoursAgo(sys.lastRun);
      const threshold = THRESHOLDS[sys.key].red;
      if (h === null || h > threshold) {
        downSystems.push(`${sys.name} (${h === null ? "never" : formatHours(h) + " ago"})`);
      }
    }

    const isDown = downSystems.length > 0;

    // Get previous alert state
    const { data: alertState } = await supabase
      .from("system_alert_state")
      .select("*")
      .eq("id", 1)
      .single();

    const wasDown = alertState?.is_down ?? false;
    const now = new Date().toISOString();

    // Only send SMS on state transitions
    let smsSent = false;
    if (isDown && !wasDown) {
      // Transition: OK → DOWN
      const msg = `🚨 Cookie Yeti Alert: ${downSystems.join(", ")}. Check admin dashboard.`;
      smsSent = await sendSMS(msg);
    } else if (!isDown && wasDown) {
      // Transition: DOWN → OK
      const msg = `✅ Cookie Yeti: All systems operational.`;
      smsSent = await sendSMS(msg);
    }

    // Upsert alert state
    await supabase.from("system_alert_state").upsert({
      id: 1,
      is_down: isDown,
      down_systems: downSystems,
      last_checked: now,
      last_alert_sent: smsSent ? now : (alertState?.last_alert_sent ?? null),
    });

    return new Response(
      JSON.stringify({
        status: isDown ? "down" : "ok",
        down_systems: downSystems,
        sms_sent: smsSent,
        transition: isDown !== wasDown ? (isDown ? "ok_to_down" : "down_to_ok") : "no_change",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Health check error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

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
      const data = await response.json();
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
