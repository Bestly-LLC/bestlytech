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
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <span style="font-size:22px;font-weight:700;color:${BRAND_COLORS.primary};letter-spacing:-0.5px;">Bestly</span>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td style="background-color:${BRAND_COLORS.cardBg};border-radius:12px;border:1px solid ${BRAND_COLORS.border};box-shadow:0 1px 3px rgba(0,0,0,0.06);padding:36px 32px;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;font-size:12px;color:${BRAND_COLORS.textMuted};line-height:1.5;">
                ${footerNote || ""}
              </p>
              <p style="margin:8px 0 0;font-size:11px;color:${BRAND_COLORS.textMuted};">
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
  const content = `
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:600;color:${BRAND_COLORS.text};">Your activation code</h1>
    <p style="margin:0 0 24px;font-size:14px;color:${BRAND_COLORS.textMuted};line-height:1.5;">
      Enter the code below in Cookie Yeti to activate your extension.
    </p>
    <div style="text-align:center;margin:0 0 24px;">
      <div style="display:inline-block;background:${BRAND_COLORS.codeBg};border:2px dashed ${BRAND_COLORS.accent};border-radius:10px;padding:16px 40px;">
        <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:${BRAND_COLORS.primary};font-family:'Courier New',monospace;">${code}</span>
      </div>
    </div>
    <p style="margin:0;font-size:13px;color:${BRAND_COLORS.textMuted};line-height:1.5;text-align:center;">
      This code expires in <strong style="color:${BRAND_COLORS.text};">15 minutes</strong>. If you didn't request this, you can safely ignore this email.
    </p>`;

  return baseLayout(content, "Cookie Yeti — Privacy-first cookie banner management.");
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
      <td style="text-align:center;padding:12px 8px;width:${Math.floor(100 / opts.stats!.length)}%;">
        <div style="font-size:24px;font-weight:700;color:${BRAND_COLORS.text};font-variant-numeric:tabular-nums;">${st.value}</div>
        <div style="font-size:11px;color:${BRAND_COLORS.textMuted};text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;">${st.label}</div>
      </td>`
      )
      .join("");
    statsHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND_COLORS.bg};border-radius:8px;margin:16px 0 20px;">
      <tr>${cells}</tr>
    </table>`;
  }

  let itemsHtml = "";
  if (opts.items && opts.items.length > 0) {
    const rows = opts.items
      .map(
        (item) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid ${BRAND_COLORS.border};font-size:13px;">
          <strong style="color:${BRAND_COLORS.text};">${item.label}</strong><br/>
          <span style="color:${BRAND_COLORS.textMuted};font-size:12px;">${item.detail}</span>
        </td>
      </tr>`
      )
      .join("");
    itemsHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BRAND_COLORS.border};border-radius:8px;overflow:hidden;margin:16px 0 0;">
      ${rows}
    </table>`;
  }

  const content = `
    <!-- Severity badge -->
    <div style="background:${s.bg};border-left:4px solid ${s.color};border-radius:6px;padding:12px 16px;margin-bottom:20px;">
      <span style="font-size:14px;font-weight:600;color:${s.color};">${s.icon} ${opts.title}</span>
    </div>
    <p style="margin:0 0 4px;font-size:14px;color:${BRAND_COLORS.text};line-height:1.6;">${opts.summary}</p>
    ${statsHtml}
    ${itemsHtml}
    ${opts.timestamp ? `<p style="margin:20px 0 0;font-size:11px;color:${BRAND_COLORS.textMuted};text-align:right;">Timestamp: ${opts.timestamp}</p>` : ""}`;

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
