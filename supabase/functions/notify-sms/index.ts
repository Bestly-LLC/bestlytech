import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";
const TO_NUMBER = "+18165007236";
const FROM_NUMBER = "+12139279363";
const ADMIN_EMAIL = "jaredbest@icloud.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function platformBadge(p: string): string {
  const colors: Record<string, string> = {
    Amazon: "#FF9900",
    Shopify: "#96BF48",
    TikTok: "#000000",
  };
  const bg = colors[p] || "#6B7280";
  return `<span style="display:inline-block;background:${bg};color:#fff;font-size:12px;padding:2px 8px;border-radius:4px;margin-right:4px;">${p}</span>`;
}

function buildAdminHtml(intake: any): string {
  const platforms: string[] = intake.selected_platforms?.length ? intake.selected_platforms : [intake.platform || "Amazon"];
  const platformBadges = platforms.map(platformBadge).join("");
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  // Derive the site URL from the Supabase URL for the admin link
  const adminUrl = `https://bestlytech.lovable.app/admin/submissions/${intake.id}`;

  // Count docs
  const docCount = intake._doc_count ?? "?";

  const amazonSection = platforms.includes("Amazon") ? `
    <tr><td colspan="2" style="padding:12px 0 4px;font-weight:600;color:#1a1a2e;font-size:14px;">Amazon</td></tr>
    <tr><td style="color:#6B7280;padding:2px 8px 2px 0;font-size:13px;">Store Name</td><td style="font-size:13px;">${intake.amazon_store_name || "&mdash;"}</td></tr>
    <tr><td style="color:#6B7280;padding:2px 8px 2px 0;font-size:13px;">Category</td><td style="font-size:13px;">${intake.product_category || "&mdash;"}</td></tr>
    <tr><td style="color:#6B7280;padding:2px 8px 2px 0;font-size:13px;">Email</td><td style="font-size:13px;">${intake.amazon_email || "&mdash;"}</td></tr>
    <tr><td style="color:#6B7280;padding:2px 8px 2px 0;font-size:13px;">Seller Plan</td><td style="font-size:13px;">${intake.seller_plan || "&mdash;"}</td></tr>
    <tr><td style="color:#6B7280;padding:2px 8px 2px 0;font-size:13px;">Fulfillment</td><td style="font-size:13px;">${intake.fulfillment_method || "&mdash;"}</td></tr>
  ` : "";

  const shopifySection = platforms.includes("Shopify") ? `
    <tr><td colspan="2" style="padding:12px 0 4px;font-weight:600;color:#1a1a2e;font-size:14px;">Shopify</td></tr>
    <tr><td style="color:#6B7280;padding:2px 8px 2px 0;font-size:13px;">Store Name</td><td style="font-size:13px;">${intake.shopify_store_name || "&mdash;"}</td></tr>
    <tr><td style="color:#6B7280;padding:2px 8px 2px 0;font-size:13px;">Email</td><td style="font-size:13px;">${intake.shopify_email || "&mdash;"}</td></tr>
    <tr><td style="color:#6B7280;padding:2px 8px 2px 0;font-size:13px;">Plan</td><td style="font-size:13px;">${intake.shopify_plan || "&mdash;"}</td></tr>
    <tr><td style="color:#6B7280;padding:2px 8px 2px 0;font-size:13px;">Shipping</td><td style="font-size:13px;">${intake.shipping_method || "&mdash;"}</td></tr>
  ` : "";

  const tiktokSection = platforms.includes("TikTok") ? `
    <tr><td colspan="2" style="padding:12px 0 4px;font-weight:600;color:#1a1a2e;font-size:14px;">TikTok Shop</td></tr>
    <tr><td style="color:#6B7280;padding:2px 8px 2px 0;font-size:13px;">Shop Name</td><td style="font-size:13px;">${intake.tiktok_shop_name || "&mdash;"}</td></tr>
    <tr><td style="color:#6B7280;padding:2px 8px 2px 0;font-size:13px;">Category</td><td style="font-size:13px;">${intake.tiktok_category || "&mdash;"}</td></tr>
    <tr><td style="color:#6B7280;padding:2px 8px 2px 0;font-size:13px;">Email</td><td style="font-size:13px;">${intake.tiktok_email || "&mdash;"}</td></tr>
    <tr><td style="color:#6B7280;padding:2px 8px 2px 0;font-size:13px;">Fulfillment</td><td style="font-size:13px;">${intake.tiktok_fulfillment || "&mdash;"}</td></tr>
  ` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:'Plus Jakarta Sans',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f8;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <!-- Header -->
        <tr><td style="background:#1a1a2e;padding:24px 32px;">
          <table width="100%"><tr>
            <td><span style="color:#ffffff;font-size:20px;font-weight:700;">Bestly</span></td>
            <td align="right"><span style="color:#94a3b8;font-size:12px;">${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span></td>
          </tr></table>
          <p style="color:#e2e8f0;font-size:16px;margin:12px 0 0;font-weight:600;">New Marketplace Setup Submission</p>
        </td></tr>

        <!-- Customer Snapshot -->
        <tr><td style="padding:24px 32px;">
          <table width="100%" style="border-bottom:1px solid #e5e7eb;padding-bottom:16px;margin-bottom:16px;">
            <tr><td style="font-size:18px;font-weight:700;color:#1a1a2e;">${intake.client_name || "Unknown"}</td></tr>
            <tr><td style="font-size:14px;color:#374151;padding-top:4px;">${intake.business_legal_name || ""}</td></tr>
            <tr><td style="padding-top:8px;">
              <a href="mailto:${intake.client_email || ""}" style="color:#2563eb;font-size:13px;text-decoration:none;">${intake.client_email || "&mdash;"}</a>
              &nbsp;&nbsp;
              <a href="tel:${intake.client_phone || ""}" style="color:#2563eb;font-size:13px;text-decoration:none;">${intake.client_phone || ""}</a>
            </td></tr>
            <tr><td style="padding-top:4px;font-size:12px;color:#6B7280;">
              ${intake.preferred_contact_method ? `Prefers: ${intake.preferred_contact_method}` : ""}
              ${intake.client_timezone ? ` &middot; ${intake.client_timezone}` : ""}
            </td></tr>
            <tr><td style="padding-top:8px;">${platformBadges}</td></tr>
          </table>

          <!-- Business Summary -->
          <table width="100%" style="border-bottom:1px solid #e5e7eb;padding-bottom:16px;margin-bottom:16px;">
            <tr><td colspan="2" style="font-weight:600;color:#1a1a2e;font-size:14px;padding-bottom:6px;">Business</td></tr>
            <tr><td style="color:#6B7280;padding:2px 8px 2px 0;font-size:13px;width:120px;">Type</td><td style="font-size:13px;">${intake.business_type || "&mdash;"}</td></tr>
            <tr><td style="color:#6B7280;padding:2px 8px 2px 0;font-size:13px;">State</td><td style="font-size:13px;">${intake.state_of_registration || "&mdash;"}</td></tr>
            <tr><td style="color:#6B7280;padding:2px 8px 2px 0;font-size:13px;">EIN</td><td style="font-size:13px;">${intake.ein || "&mdash;"}</td></tr>
          </table>

          <!-- Per-Platform -->
          <table width="100%" style="border-bottom:1px solid #e5e7eb;padding-bottom:16px;margin-bottom:16px;">
            ${amazonSection}${shopifySection}${tiktokSection}
          </table>

          <!-- Documents Status -->
          <table width="100%" style="margin-bottom:20px;">
            <tr><td style="font-weight:600;color:#1a1a2e;font-size:14px;padding-bottom:6px;">Documents</td></tr>
            <tr><td style="font-size:13px;color:#374151;">${docCount} document(s) uploaded</td></tr>
          </table>

          <!-- CTA Button -->
          <table width="100%"><tr><td align="center" style="padding:8px 0 16px;">
            <a href="${adminUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;font-weight:600;padding:12px 32px;border-radius:8px;text-decoration:none;">View Full Submission</a>
          </td></tr></table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e5e7eb;">
          <table width="100%"><tr>
            <td><a href="mailto:${intake.client_email || ""}" style="color:#2563eb;font-size:12px;text-decoration:none;">Reply to Customer</a></td>
            <td align="right"><span style="color:#9ca3af;font-size:11px;">Bestly LLC &middot; Notification System</span></td>
          </tr></table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildCustomerHtml(intake: any): string {
  const platforms: string[] = intake.selected_platforms?.length ? intake.selected_platforms : [intake.platform || "Amazon"];
  const platformBadges = platforms.map(platformBadge).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:'Plus Jakarta Sans',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f8;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <tr><td style="background:#1a1a2e;padding:24px 32px;">
          <span style="color:#ffffff;font-size:20px;font-weight:700;">Bestly</span>
          <p style="color:#e2e8f0;font-size:16px;margin:12px 0 0;font-weight:600;">Thank You for Your Submission!</p>
        </td></tr>
        <tr><td style="padding:24px 32px;">
          <p style="font-size:15px;color:#374151;line-height:1.6;">
            Hi ${intake.client_name || "there"},
          </p>
          <p style="font-size:14px;color:#374151;line-height:1.6;">
            We've received your marketplace setup request for:
          </p>
          <p style="padding:8px 0;">${platformBadges}</p>
          <table width="100%" style="margin:16px 0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
            <tr><td style="padding:12px 16px;background:#f8fafc;">
              <table width="100%">
                <tr><td style="color:#6B7280;font-size:13px;padding:2px 0;">Business</td><td style="font-size:13px;">${intake.business_legal_name || "&mdash;"}</td></tr>
                ${platforms.includes("Amazon") ? `<tr><td style="color:#6B7280;font-size:13px;padding:2px 0;">Amazon Store</td><td style="font-size:13px;">${intake.amazon_store_name || "&mdash;"}</td></tr>` : ""}
                ${platforms.includes("Shopify") ? `<tr><td style="color:#6B7280;font-size:13px;padding:2px 0;">Shopify Store</td><td style="font-size:13px;">${intake.shopify_store_name || "&mdash;"}</td></tr>` : ""}
                ${platforms.includes("TikTok") ? `<tr><td style="color:#6B7280;font-size:13px;padding:2px 0;">TikTok Shop</td><td style="font-size:13px;">${intake.tiktok_shop_name || "&mdash;"}</td></tr>` : ""}
              </table>
            </td></tr>
          </table>
          <p style="font-size:14px;color:#374151;line-height:1.6;font-weight:600;">What happens next?</p>
          <ul style="font-size:14px;color:#374151;line-height:1.8;padding-left:20px;">
            <li>We'll review your submission within 1&ndash;2 business days</li>
            <li>If any documents are missing, we'll reach out via your preferred contact method</li>
            <li>You'll receive login credentials securely once your accounts are set up</li>
          </ul>
          <p style="font-size:14px;color:#374151;line-height:1.6;">
            If you need to update any information, reply to this email or contact us at
            <a href="mailto:hello@bestly.tech" style="color:#2563eb;text-decoration:none;">hello@bestly.tech</a>.
          </p>
          <p style="font-size:14px;color:#374151;line-height:1.6;margin-top:16px;">
            Best regards,<br><strong>The Bestly Team</strong>
          </p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e5e7eb;">
          <span style="color:#9ca3af;font-size:11px;">Bestly LLC &middot; bestly.tech</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { message, intake, mode } = body;

    // Legacy plain-text mode
    if (message && !intake) {
      return await handleLegacy(message);
    }

    // Rich notification mode
    if (!intake || !intake.id) {
      return new Response(JSON.stringify({ error: "intake object with id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: { sms?: string; admin_email?: string; customer_email?: string } = {};

    // ── SMS via Twilio ──
    try {
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
      if (LOVABLE_API_KEY && TWILIO_API_KEY) {
        const platforms = intake.selected_platforms?.length ? intake.selected_platforms : [intake.platform || "Amazon"];
        const smsBody = `New intake: ${intake.client_name || "Unknown"} - ${intake.business_legal_name || ""} - ${platforms.join(", ")}`;
        const response = await fetch(`${GATEWAY_URL}/Messages.json`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": TWILIO_API_KEY,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ To: TO_NUMBER, From: FROM_NUMBER, Body: smsBody.slice(0, 1600) }),
        });
        results.sms = response.ok ? "sent" : "failed";
      } else {
        results.sms = "skipped";
      }
    } catch (e) {
      console.error("SMS error:", e);
      results.sms = "failed";
    }

    // ── Admin email ──
    try {
      const smtpHost = Deno.env.get("SMTP_HOST");
      const smtpUser = Deno.env.get("SMTP_USER");
      const smtpPass = Deno.env.get("SMTP_PASS");
      const smtpPort = Deno.env.get("SMTP_PORT");

      if (smtpHost && smtpUser && smtpPass && smtpPort) {
        const client = new SMTPClient({
          connection: { hostname: smtpHost, port: parseInt(smtpPort, 10), tls: true, auth: { username: smtpUser, password: smtpPass } },
        });
        await client.send({
          from: smtpUser,
          to: ADMIN_EMAIL,
          subject: `New Marketplace Setup: ${intake.business_legal_name || intake.client_name || "New Submission"}`,
          content: "text/html",
          html: buildAdminHtml(intake),
        });
        await client.close();
        results.admin_email = "sent";
      } else {
        results.admin_email = "skipped";
      }
    } catch (e) {
      console.error("Admin email error:", e);
      results.admin_email = "failed";
    }

    // ── Customer confirmation email ──
    if (intake.client_email && mode !== "admin_only") {
      try {
        const smtpHost = Deno.env.get("SMTP_HOST");
        const smtpUser = Deno.env.get("SMTP_USER");
        const smtpPass = Deno.env.get("SMTP_PASS");
        const smtpPort = Deno.env.get("SMTP_PORT");

        if (smtpHost && smtpUser && smtpPass && smtpPort) {
          const client = new SMTPClient({
            connection: { hostname: smtpHost, port: parseInt(smtpPort, 10), tls: true, auth: { username: smtpUser, password: smtpPass } },
          });
          await client.send({
            from: smtpUser,
            to: intake.client_email,
            subject: "Your Marketplace Setup Request - Bestly",
            content: "text/html",
            html: buildCustomerHtml(intake),
          });
          await client.close();
          results.customer_email = "sent";
        } else {
          results.customer_email = "skipped";
        }
      } catch (e) {
        console.error("Customer email error:", e);
        results.customer_email = "failed";
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Notification error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Legacy handler for backward compatibility
async function handleLegacy(message: string) {
  const results: { sms?: string; email?: string } = {};

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
    if (LOVABLE_API_KEY && TWILIO_API_KEY) {
      const response = await fetch(`${GATEWAY_URL}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": TWILIO_API_KEY,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: TO_NUMBER, From: FROM_NUMBER, Body: message.slice(0, 1600) }),
      });
      results.sms = response.ok ? "sent" : "failed";
    } else {
      results.sms = "skipped";
    }
  } catch (e) {
    console.error("SMS error:", e);
    results.sms = "failed";
  }

  try {
    const smtpHost = Deno.env.get("SMTP_HOST");
    const smtpUser = Deno.env.get("SMTP_USER");
    const smtpPass = Deno.env.get("SMTP_PASS");
    const smtpPort = Deno.env.get("SMTP_PORT");
    if (smtpHost && smtpUser && smtpPass && smtpPort) {
      const client = new SMTPClient({
        connection: { hostname: smtpHost, port: parseInt(smtpPort, 10), tls: true, auth: { username: smtpUser, password: smtpPass } },
      });
      await client.send({ from: smtpUser, to: ADMIN_EMAIL, subject: "New Intake Submission", content: `${message}\n\n-- Sent from Bestly notification system` });
      await client.close();
      results.email = "sent";
    } else {
      results.email = "skipped";
    }
  } catch (e) {
    console.error("Email error:", e);
    results.email = "failed";
  }

  return new Response(JSON.stringify({ success: true, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
