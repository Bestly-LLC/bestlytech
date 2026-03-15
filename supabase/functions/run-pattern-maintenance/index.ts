import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendEmail(smtpEmail: string, smtpPassword: string, subject: string, body: string) {
  const client = new SMTPClient({
    connection: {
      hostname: "mail.privateemail.com",
      port: 465,
      tls: true,
      auth: {
        username: smtpEmail,
        password: smtpPassword,
      },
    },
  });

  try {
    await client.send({
      from: smtpEmail,
      to: "jaredbest@icloud.com",
      subject,
      content: body,
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

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const smtpEmail = Deno.env.get("PRIVATEMAIL_EMAIL");
    const smtpPassword = Deno.env.get("PRIVATEMAIL_PASSWORD");

    if (!smtpEmail || !smtpPassword) {
      throw new Error("PRIVATEMAIL_EMAIL or PRIVATEMAIL_PASSWORD is not configured");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Run both RPCs in parallel
    const [fixResult, reportResult] = await Promise.all([
      supabase.rpc("auto_fix_pattern_issues"),
      supabase.rpc("process_user_reports"),
    ]);

    if (fixResult.error) throw new Error(`auto_fix_pattern_issues failed: ${fixResult.error.message}`);
    if (reportResult.error) throw new Error(`process_user_reports failed: ${reportResult.error.message}`);

    const fixData = fixResult.data as { processed: number; fixed: number; failed: number; details: any[] };
    const reportData = reportResult.data as { total_unresolved: number; newly_resolved: number; priority_domains: any[] };

    console.log(`Maintenance complete — Fixed: ${fixData.fixed}, Failed: ${fixData.failed}, Unresolved reports: ${reportData.total_unresolved}`);

    // Send alert if auto-fix had failures
    if (fixData.failed > 0) {
      const failedDetails = (fixData.details || [])
        .filter((d: any) => !d.success)
        .map((d: any) => `  • ${d.domain} — ${d.selector} (${d.issue}): ${d.error}`)
        .join("\n");

      await sendEmail(
        smtpEmail,
        smtpPassword,
        "Cookie Yeti: Pattern Fix Failures",
        `Pattern auto-fixer encountered ${fixData.failed} failure(s).\n\nProcessed: ${fixData.processed}\nFixed: ${fixData.fixed}\nFailed: ${fixData.failed}\n\nFailed items:\n${failedDetails || "(no details available)"}\n\nTimestamp: ${new Date().toISOString()}`
      );
    }

    // Send alert if there are priority domains (3+ unresolved reports)
    const priorityDomains = reportData.priority_domains || [];
    if (Array.isArray(priorityDomains) && priorityDomains.length > 0) {
      const domainList = priorityDomains
        .map((d: any) => `  • ${d.domain} — ${d.report_count} reports (last: ${d.last_reported})`)
        .join("\n");

      await sendEmail(
        smtpEmail,
        smtpPassword,
        "Cookie Yeti: Unresolved Missed Banner Reports",
        `There are ${priorityDomains.length} domain(s) with 3+ unresolved missed banner reports.\n\nTotal unresolved: ${reportData.total_unresolved}\nNewly resolved this run: ${reportData.newly_resolved}\n\nPriority domains:\n${domainList}\n\nTimestamp: ${new Date().toISOString()}`
      );
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
