import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// v14 (2026-09-23 spend audit): this endpoint is public (the Cookie Yeti extension calls it), and every
// report started ai-generate-pattern, which pays OpenAI. Reports are still always saved, but the AI
// only starts when ai_gate allows it (ai_caps: per-day cap, and per hashed IP per hour). Otherwise the
// domain waits for the scheduled pass, which has its own cap.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// CY-PRIV (server defense-in-depth): reduce any URL to its origin so no path,
// query string, or fragment is ever persisted — even from old/live clients that
// still send full URLs.
function originOnly(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  try { return new URL(s).origin; } catch {
    return /:\/\//.test(s)
      ? s.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]+).*$/, "$1")
      : s.replace(/^([^/?#]+).*$/, "$1");
  }
}

// The caller's IP, hashed (never stored raw), for the per-caller hourly cap.
async function callerKey(req: Request): Promise<string> {
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") ||
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0] || "unknown").trim();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`cy-report:${ip}`));
  return "ip:" + [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { domain, page_url, banner_html, cmp_fingerprint } = await req.json();

    if (!domain || typeof domain !== "string" || domain.trim().length === 0 || domain.length > 253) {
      return new Response(
        JSON.stringify({ error: "domain is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const trimmedDomain = domain.trim().toLowerCase();
    const safePageUrl = originOnly(page_url);
    const safeHtml = typeof banner_html === "string" ? banner_html.slice(0, 60000) : null;

    // 1. Save the report via existing RPC (RPC also normalizes as a backstop)
    const { error: rpcError } = await supabase.rpc("report_missed_banner_with_html", {
      _domain: trimmedDomain,
      _page_url: safePageUrl,
      _banner_html: safeHtml || null,
      _cmp_fingerprint: cmp_fingerprint || "unknown",
    });

    if (rpcError) {
      console.error("RPC error:", rpcError);
      return new Response(
        JSON.stringify({ error: "Failed to save report", detail: rpcError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Trigger AI processing for this domain, if the spend guard allows it
    let aiResult: any = null;
    const noBannerHtml = !safeHtml || safeHtml.trim().length === 0;
    const { data: gate, error: gateErr } = await supabase.rpc("ai_gate", { p_fn: "report-missed-banner", p_who: await callerKey(req) });
    if (gateErr || (gate as any)?.ok !== true) {
      aiResult = { skipped: true, note: "Report saved. AI runs on the next scheduled pass." };
    } else {
      try {
        const aiRes = await fetch(`${supabaseUrl}/functions/v1/ai-generate-pattern`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            domain: trimmedDomain,
            ...(noBannerHtml ? { force_server_fetch: true } : {}),
          }),
        });
        aiResult = await aiRes.json();
      } catch (aiErr: any) {
        console.error("AI processing error (non-fatal):", aiErr.message);
        aiResult = { error: aiErr.message, note: "Report saved, AI will retry later" };
      }
    }

    // 3. Check for persistent no-HTML failures and send email alert
    let emailAlertSent = false;
    if (noBannerHtml) {
      try {
        const { data: report } = await supabase
          .from("missed_banner_reports")
          .select("report_count, resolved")
          .eq("domain", trimmedDomain)
          .single();

        if (report && report.report_count >= 3 && !report.resolved) {
          const emailTo = Deno.env.get("EMAIL_TO") || "jaredbest@icloud.com";
          const emailPayload = {
            to: emailTo,
            from: "noreply@bestly.tech",
            subject: `Cookie Yeti: ${trimmedDomain} needs manual review`,
            html: `
              <div style="font-family:'Plus Jakarta Sans',sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:32px;">
                <div style="background:#1a2766;color:#ffffff;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
                  <h1 style="margin:0;font-size:20px;">🍪 Cookie Yeti Alert</h1>
                </div>
                <div style="background:#ffffff;padding:24px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0;border-top:none;">
                  <p style="color:#334155;font-size:16px;margin:0 0 16px;">
                    <strong>${trimmedDomain}</strong> has been reported <strong>${report.report_count} times</strong> but no banner HTML was captured by the extension.
                  </p>
                  <p style="color:#64748b;font-size:14px;margin:0 0 16px;">
                    The AI generator cannot process this domain without banner HTML. Manual review is needed.
                  </p>
                  <p style="color:#64748b;font-size:14px;margin:0;">
                    Page URL: ${safePageUrl || "Not provided"}<br/>
                    CMP: ${cmp_fingerprint || "unknown"}
                  </p>
                  <div style="margin-top:24px;text-align:center;">
                    <a href="https://bestly.tech/admin/community-learning" style="display:inline-block;background:#1a2766;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Open Dashboard</a>
                  </div>
                </div>
              </div>
            `,
            purpose: "transactional",
            idempotency_key: `manual-review-${trimmedDomain}-${Math.floor(Date.now() / 86400000)}`,
          };

          await supabase.rpc("enqueue_email", {
            queue_name: "transactional_emails",
            payload: emailPayload,
          });
          emailAlertSent = true;
        }
      } catch (alertErr: any) {
        console.error("Email alert error (non-fatal):", alertErr.message);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        domain: trimmedDomain,
        report_saved: true,
        ai_processing: aiResult,
        email_alert_sent: emailAlertSent,
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
