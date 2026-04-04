import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { alertEmail } from "../_shared/email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
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
    const serviceRoleKey2 = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (token === serviceRoleKey2) {
      authorized = true;
    } else {
      const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData } = await authClient.auth.getUser(token);
      if (userData?.user) {
        const svcCheck = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey2);
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: candidates, error: fetchErr } = await supabase
      .from("missed_banner_reports")
      .select("*")
      .eq("resolved", false)
      .lt("ai_attempts", 5)
      .or(`ai_processed_at.is.null,ai_processed_at.lt.${twentyFourHoursAgo}`)
      .order("report_count", { ascending: false })
      .limit(10);

    if (fetchErr) throw fetchErr;
    if (!candidates || candidates.length === 0) {
      return new Response(
        JSON.stringify({ message: "No candidates for retry", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const domains = candidates.map((c: any) => c.domain);
    const { data: allLogs } = await supabase
      .from("ai_generation_log")
      .select("domain, status")
      .in("domain", domains)
      .order("created_at", { ascending: false });

    const failedDomains = new Set(
      (allLogs ?? [])
        .filter((l: any) => ["needs_manual_review", "failed_not_cookie_banner", "error"].includes(l.status))
        .map((l: any) => l.domain)
    );

    const loggedDomains = new Set((allLogs ?? []).map((l: any) => l.domain));
    const neverProcessed = new Set(domains.filter((d: string) => !loggedDomains.has(d)));

    const retryable = candidates.filter(
      (c: any) => failedDomains.has(c.domain) || neverProcessed.has(c.domain)
    );

    let processed = 0;
    let succeeded = 0;
    let stillFailed = 0;
    let permanentlyFailed = 0;
    const results: any[] = [];
    const permFailedDomains: string[] = [];

    for (const candidate of retryable) {
      processed++;

      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/ai-generate-pattern`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ domain: candidate.domain, is_retry: true }),
        });

        const data = await res.json();
        const result = data.results?.[0];

        if (result?.status?.startsWith("success")) {
          succeeded++;
          results.push({ domain: candidate.domain, status: result.status });
        } else {
          const newAttempts = (candidate.ai_attempts || 0) + 1;
          if (newAttempts >= 5) {
            permanentlyFailed++;
            permFailedDomains.push(candidate.domain);
            await supabase.from("ai_generation_log").insert({
              domain: candidate.domain,
              status: "permanently_failed",
              error_message: `Exhausted ${newAttempts} retry attempts. Last result: ${result?.status || "unknown"}`,
              ai_model: "auto-retry",
            });
            results.push({ domain: candidate.domain, status: "permanently_failed" });
          } else {
            stillFailed++;
            results.push({ domain: candidate.domain, status: result?.status || "still_failing", attempts: newAttempts });
          }
        }
      } catch (err: any) {
        stillFailed++;
        results.push({ domain: candidate.domain, status: "retry_error", error: err.message });
      }
    }

    // Send email alert if any domains permanently failed
    if (permFailedDomains.length > 0) {
      const smtpEmail = Deno.env.get("PRIVATEMAIL_EMAIL");
      const smtpPassword = Deno.env.get("PRIVATEMAIL_PASSWORD");

      if (smtpEmail && smtpPassword) {
        try {
          const html = alertEmail({
            title: "Domains Permanently Failed",
            severity: "danger",
            summary: `<strong>${permFailedDomains.length} domain(s)</strong> exhausted all 5 AI retry attempts and have been marked as permanently failed. Manual pattern creation is required.`,
            stats: [
              { label: "Permanently Failed", value: permFailedDomains.length },
              { label: "Total Processed", value: processed },
              { label: "Succeeded", value: succeeded },
              { label: "Still Failing", value: stillFailed },
            ],
            items: permFailedDomains.map((d) => ({
              label: d,
              detail: "Exhausted 5 AI retry attempts",
            })),
            timestamp: new Date().toISOString(),
          });

          const client = new SMTPClient({
            connection: {
              hostname: "mail.privateemail.com",
              port: 465,
              tls: true,
              auth: { username: smtpEmail, password: smtpPassword },
            },
          });

          const emailTo = Deno.env.get("EMAIL_TO") || "jaredbest@icloud.com";
          try {
            await client.send({
              from: smtpEmail,
              to: emailTo,
              subject: "Cookie Yeti: Domains Permanently Failed",
              html,
            });
            console.log(`Alert email sent for ${permFailedDomains.length} permanently failed domain(s)`);
          } finally {
            await client.close();
          }
        } catch (emailErr: any) {
          console.error("Failed to send permanently_failed alert email:", emailErr.message);
        }
      }
    }

    return new Response(
      JSON.stringify({
        processed,
        succeeded,
        still_failed: stillFailed,
        permanently_failed: permanentlyFailed,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
