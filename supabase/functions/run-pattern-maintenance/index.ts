import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { alertEmail } from "../_shared/email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendEmail(smtpEmail: string, smtpPassword: string, to: string, subject: string, html: string) {
  const client = new SMTPClient({
    connection: {
      hostname: "mail.privateemail.com",
      port: 465,
      tls: true,
      auth: { username: smtpEmail, password: smtpPassword },
    },
  });

  try {
    await client.send({
      from: smtpEmail,
      to,
      subject,
      html,
    });
    console.log(`Email sent: "${subject}"`);
  } finally {
    await client.close();
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: require maintenance secret OR valid admin Bearer token
  const secret = req.headers.get("x-maintenance-secret");
  const authHeader = req.headers.get("Authorization");
  let authorized = false;

  if (secret && secret === Deno.env.get("MAINTENANCE_SECRET")) {
    authorized = true;
  } else if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (token === serviceRoleKey) {
      authorized = true;
    } else {
      const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData } = await authClient.auth.getUser(token);
      if (userData?.user) {
        const svcCheck = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);
        const { data: isAdmin } = await svcCheck.rpc("has_role", { _user_id: userData.user.id, _role: "admin" });
        if (isAdmin) authorized = true;
      }
    }
  }

  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const smtpEmail = Deno.env.get("PRIVATEMAIL_EMAIL");
    const smtpPassword = Deno.env.get("PRIVATEMAIL_PASSWORD");

    if (!smtpEmail || !smtpPassword) {
      throw new Error("PRIVATEMAIL_EMAIL or PRIVATEMAIL_PASSWORD is not configured");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const [fixResult, reportResult] = await Promise.all([
      supabase.rpc("auto_fix_pattern_issues"),
      supabase.rpc("process_user_reports"),
    ]);

    if (fixResult.error) throw new Error(`auto_fix_pattern_issues failed: ${fixResult.error.message}`);
    if (reportResult.error) throw new Error(`process_user_reports failed: ${reportResult.error.message}`);

    const fixData = fixResult.data as { processed: number; fixed: number; failed: number; details: any[] };
    const reportData = reportResult.data as { total_unresolved: number; newly_resolved: number; priority_domains: any[] };

    console.log(`Maintenance complete — Fixed: ${fixData.fixed}, Failed: ${fixData.failed}, Unresolved reports: ${reportData.total_unresolved}`);

    const timestamp = new Date().toISOString();

    // Send alert if auto-fix had failures
    if (fixData.failed > 0) {
      const failedItems = (fixData.details || [])
        .filter((d: any) => !d.success)
        .map((d: any) => ({
          label: d.domain,
          detail: `${d.selector} · ${d.issue} — ${d.error || "unknown error"}`,
        }));

      const html = alertEmail({
        title: "Pattern Fix Failures",
        severity: "danger",
        summary: `The automated pattern fixer encountered <strong>${fixData.failed} failure(s)</strong> during this maintenance run.`,
        stats: [
          { label: "Processed", value: fixData.processed },
          { label: "Fixed", value: fixData.fixed },
          { label: "Failed", value: fixData.failed },
        ],
        items: failedItems.length > 0 ? failedItems : undefined,
        timestamp,
      });

      const emailTo = Deno.env.get("EMAIL_TO") || "jaredbest@icloud.com";
      await sendEmail(smtpEmail, smtpPassword, emailTo, "Cookie Yeti: Pattern Fix Failures", html);
    }

    // Send alert if there are priority domains (3+ unresolved reports)
    const priorityDomains = reportData.priority_domains || [];
    if (Array.isArray(priorityDomains) && priorityDomains.length > 0) {
      const domainItems = priorityDomains.map((d: any) => ({
        label: d.domain,
        detail: `${d.report_count} reports · last reported ${new Date(d.last_reported).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
      }));

      const html = alertEmail({
        title: "Unresolved Missed Banner Reports",
        severity: "warning",
        summary: `There are <strong>${priorityDomains.length} domain(s)</strong> with 3 or more unresolved missed banner reports requiring attention.`,
        stats: [
          { label: "Unresolved", value: reportData.total_unresolved },
          { label: "Resolved This Run", value: reportData.newly_resolved },
          { label: "Priority Domains", value: priorityDomains.length },
        ],
        items: domainItems,
        timestamp,
      });

      await sendEmail(smtpEmail, smtpPassword, "jaredbest@icloud.com", "Cookie Yeti: Unresolved Missed Banner Reports", html);
    }

    return new Response(
      JSON.stringify({
        success: true,
        fix: { processed: fixData.processed, fixed: fixData.fixed, failed: fixData.failed },
        reports: { total_unresolved: reportData.total_unresolved, newly_resolved: reportData.newly_resolved, priority_count: priorityDomains.length },
        emails_sent: (fixData.failed > 0 ? 1 : 0) + (priorityDomains.length > 0 ? 1 : 0),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Maintenance error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
