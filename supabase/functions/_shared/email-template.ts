/**
 * Shared branded email template for all Bestly / Cookie Yeti emails.
 * Import with: import { brandedEmail, alertEmail, activationCodeEmail } from "../_shared/email-template.ts";
 */

const BRAND_COLORS = {
  bg: "#f8f9fa",
  cardBg: "#ffffff",
  primary: "#1e3a5f",      // deep navy
  accent: "#4f7cac",       // indigo-blue
  text: "#1a1a2e",
  textMuted: "#6b7280",
  border: "#e5e7eb",
  success: "#059669",
  warning: "#d97706",
  danger: "#dc2626",
  dangerBg: "#fef2f2",
  warningBg: "#fffbeb",
  successBg: "#f0fdf4",
  codeBg: "#f1f5f9",
};

// Logo served from public storage bucket
const LOGO_URL = "https://keowunrxpxlbgebujbao.supabase.co/storage/v1/object/public/email-assets/bestly-logo.png";

function baseLayout(content: string, footerNote?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bestly</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND_COLORS.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND_COLORS.bg};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Header Band -->
          <tr>
            <td style="background:${BRAND_COLORS.primary};border-radius:16px 16px 0 0;padding:28px 32px;text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="vertical-align:middle;padding-right:14px;">
                    <img src="${LOGO_URL}" alt="Bestly" width="44" height="44" style="display:block;width:44px;height:44px;border-radius:10px;transform:rotate(20deg);-webkit-transform:rotate(20deg);-ms-transform:rotate(20deg);" />
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">Bestly</span>
                  </td>
                </tr>
              </table>
              <p style="margin:8px 0 0;font-size:12px;color:rgba(255,255,255,0.6);letter-spacing:0.5px;font-weight:500;">System Monitoring</p>
            </td>
          </tr>

          <!-- Gradient Accent Line -->
          <tr>
            <td style="height:4px;background:linear-gradient(90deg, ${BRAND_COLORS.primary}, ${BRAND_COLORS.accent}, transparent);font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color:${BRAND_COLORS.cardBg};padding:36px 32px;border-left:1px solid ${BRAND_COLORS.border};border-right:1px solid ${BRAND_COLORS.border};">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:${BRAND_COLORS.primary};border-radius:0 0 16px 16px;padding:24px 32px;text-align:center;">
              ${footerNote ? `<p style="margin:0 0 14px;font-size:12px;color:rgba(255,255,255,0.7);line-height:1.5;">${footerNote}</p>` : ""}
              <!-- Trust Badges -->
              <div style="margin-bottom:14px;">
                <span style="display:inline-block;background:rgba(79,124,172,0.2);border:1px solid rgba(79,124,172,0.35);border-radius:20px;padding:5px 14px;margin:3px 4px;font-size:11px;font-weight:600;color:rgba(255,255,255,0.85);letter-spacing:0.3px;">🛡️ GDPR Compliant</span>
                <span style="display:inline-block;background:rgba(79,124,172,0.2);border:1px solid rgba(79,124,172,0.35);border-radius:20px;padding:5px 14px;margin:3px 4px;font-size:11px;font-weight:600;color:rgba(255,255,255,0.85);letter-spacing:0.3px;">🔒 CCPA Ready</span>
                <span style="display:inline-block;background:rgba(79,124,172,0.2);border:1px solid rgba(79,124,172,0.35);border-radius:20px;padding:5px 14px;margin:3px 4px;font-size:11px;font-weight:600;color:rgba(255,255,255,0.85);letter-spacing:0.3px;">✅ Zero Data Resale</span>
              </div>
              <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.5);line-height:1.5;">
                © ${new Date().getFullYear()} Bestly Technologies · Los Angeles, CA
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Activation code email — sent to end users.
 */
export function activationCodeEmail(code: string): string {
  const CY = {
    navy: "#1a365d",
    blue: "#3b82f6",
    cyan: "#0ea5e9",
    ice: "#bfdbfe",
    iceLight: "#e0f2fe",
    bgTop: "#e8f4f8",
    bgBottom: "#f0f7fa",
    headerBg: "#0f2847",
    card: "#ffffff",
    text: "#1e293b",
    muted: "#64748b",
    border: "#93c5fd",
    codeBg: "linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)",
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cookie Yeti — Activation Code</title>
</head>
<body style="margin:0;padding:0;background:linear-gradient(180deg, ${CY.bgTop} 0%, ${CY.bgBottom} 100%);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

          <!-- Header Band -->
          <tr>
            <td style="background:${CY.headerBg};border-radius:16px 16px 0 0;padding:32px 32px 24px;text-align:center;">
              <img src="https://bestlytech.lovable.app/images/cookieyeti-icon.png" alt="Cookie Yeti" width="64" height="64" style="display:block;margin:0 auto 12px;border-radius:14px;" />
              <h1 style="margin:0;font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">Cookie Yeti</h1>
              <p style="margin:6px 0 0;font-size:13px;color:${CY.ice};letter-spacing:0.5px;font-weight:500;">Distraction-Free Browsing, Automatically</p>
            </td>
          </tr>

          <!-- Main Card -->
          <tr>
            <td style="background:${CY.card};padding:36px 32px 32px;border-left:1px solid ${CY.border};border-right:1px solid ${CY.border};">
              <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:${CY.navy};text-align:center;">Your Activation Code</h2>
              <p style="margin:0 0 28px;font-size:14px;color:${CY.muted};line-height:1.6;text-align:center;">
                Enter this code in Cookie Yeti to activate your extension.
              </p>

              <!-- Code Display -->
              <div style="text-align:center;margin:0 0 28px;">
                <div style="display:inline-block;background:${CY.iceLight};border:2px solid ${CY.border};border-radius:14px;padding:20px 44px;position:relative;">
                  <div style="position:absolute;top:8px;left:14px;font-size:16px;opacity:0.3;">❄️</div>
                  <div style="position:absolute;bottom:8px;right:14px;font-size:16px;opacity:0.3;">❄️</div>
                  <span style="font-size:40px;font-weight:800;letter-spacing:10px;color:${CY.navy};font-family:'Courier New',monospace;">${code}</span>
                </div>
              </div>

              <!-- Expiry Notice -->
              <div style="background:${CY.iceLight};border-radius:10px;padding:14px 18px;text-align:center;">
                <p style="margin:0;font-size:13px;color:${CY.muted};line-height:1.5;">
                  ⏱ This code expires in <strong style="color:${CY.navy};">15 minutes</strong>
                </p>
                <p style="margin:6px 0 0;font-size:12px;color:${CY.muted};">
                  If you didn't request this, you can safely ignore this email.
                </p>
              </div>
            </td>
          </tr>

          <!-- Privacy Badge Footer -->
          <tr>
            <td style="background:${CY.headerBg};border-radius:0 0 16px 16px;padding:20px 32px;text-align:center;">
              <div style="display:inline-block;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);border-radius:20px;padding:6px 16px;margin-bottom:12px;">
                <span style="font-size:12px;font-weight:600;color:${CY.ice};letter-spacing:0.3px;">🛡️ 100% Privacy-First</span>
              </div>
              <p style="margin:0;font-size:11px;color:${CY.ice};opacity:0.7;line-height:1.5;">
                Cookie Yeti by Bestly Technologies · Los Angeles, CA
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Alert / admin notification email — for pattern failures, reports, etc.
 */
export function alertEmail(opts: {
  title: string;
  severity: "danger" | "warning" | "info";
  summary: string;
  stats?: { label: string; value: string | number }[];
  items?: { label: string; detail: string }[];
  timestamp?: string;
}): string {
  const severityMap = {
    danger: { color: BRAND_COLORS.danger, bg: BRAND_COLORS.dangerBg, icon: "🔴" },
    warning: { color: BRAND_COLORS.warning, bg: BRAND_COLORS.warningBg, icon: "🟡" },
    info: { color: BRAND_COLORS.accent, bg: "#eff6ff", icon: "🔵" },
  };
  const s = severityMap[opts.severity];

  let statsHtml = "";
  if (opts.stats && opts.stats.length > 0) {
    const cells = opts.stats
      .map(
        (st) => `
      <td style="text-align:center;padding:16px 10px;width:${Math.floor(100 / opts.stats!.length)}%;">
        <div style="background:${BRAND_COLORS.primary};border-radius:12px;padding:16px 12px;">
          <div style="font-size:28px;font-weight:800;color:#ffffff;font-variant-numeric:tabular-nums;line-height:1;">${st.value}</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:0.8px;margin-top:6px;font-weight:600;">${st.label}</div>
        </div>
      </td>`
      )
      .join("");
    statsHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 24px;">
      <tr>${cells}</tr>
    </table>`;
  }

  let itemsHtml = "";
  if (opts.items && opts.items.length > 0) {
    const rows = opts.items
      .map(
        (item, i) => `
      <tr>
        <td style="padding:12px 16px;border-bottom:2px solid ${BRAND_COLORS.accent}22;background:${i % 2 === 0 ? '#ffffff' : BRAND_COLORS.bg};font-size:13px;">
          <strong style="color:${BRAND_COLORS.primary};font-size:13px;">${item.label}</strong><br/>
          <span style="color:${BRAND_COLORS.textMuted};font-size:12px;line-height:1.5;">${item.detail}</span>
        </td>
      </tr>`
      )
      .join("");
    itemsHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px solid ${BRAND_COLORS.accent}33;border-radius:12px;overflow:hidden;margin:20px 0 0;">
      <tr>
        <td style="background:${BRAND_COLORS.primary};padding:10px 16px;">
          <span style="font-size:11px;font-weight:700;color:#ffffff;text-transform:uppercase;letter-spacing:0.8px;">Details</span>
        </td>
      </tr>
      ${rows}
    </table>`;
  }

  const content = `
    <!-- Severity badge -->
    <div style="background:${s.bg};border-left:5px solid ${s.color};border-radius:8px;padding:14px 18px;margin-bottom:24px;">
      <span style="font-size:15px;font-weight:700;color:${s.color};">${s.icon} ${opts.title}</span>
    </div>
    <p style="margin:0 0 4px;font-size:14px;color:${BRAND_COLORS.text};line-height:1.7;">${opts.summary}</p>
    ${statsHtml}
    ${itemsHtml}
    ${opts.timestamp ? `<p style="margin:24px 0 0;font-size:11px;color:${BRAND_COLORS.textMuted};text-align:right;border-top:1px solid ${BRAND_COLORS.border};padding-top:12px;">🕐 ${opts.timestamp}</p>` : ""}`;

  return baseLayout(content, "Automated alert from Cookie Yeti system monitoring.");
}

/**
 * Generic branded email — for any future transactional emails.
 */
export function brandedEmail(opts: {
  heading: string;
  body: string;
  cta?: { label: string; url: string };
  footer?: string;
}): string {
  const ctaHtml = opts.cta
    ? `<div style="text-align:center;margin:28px 0 8px;">
        <a href="${opts.cta.url}" style="display:inline-block;background:${BRAND_COLORS.primary};color:#ffffff;font-size:14px;font-weight:600;padding:12px 32px;border-radius:8px;text-decoration:none;">${opts.cta.label}</a>
      </div>`
    : "";

  const content = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;color:${BRAND_COLORS.text};">${opts.heading}</h1>
    <div style="font-size:14px;color:${BRAND_COLORS.text};line-height:1.7;">${opts.body}</div>
    ${ctaHtml}`;

  return baseLayout(content, opts.footer || "");
}
