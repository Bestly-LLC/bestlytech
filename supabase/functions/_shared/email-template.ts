/**
 * Shared branded email template for all Bestly / Cookie Yeti emails.
 * Import with: import { brandedEmail, alertEmail, activationCodeEmail } from "../_shared/email-template.ts";
 */

const BRAND = {
  bg: "#f8f9fa",
  card: "#ffffff",
  primary: "#1e3a5f",
  accent: "#4f7cac",
  text: "#1a1a2e",
  muted: "#6b7280",
  border: "#e5e7eb",
  success: "#059669",
  warning: "#d97706",
  danger: "#dc2626",
  dangerBg: "#fef2f2",
  warningBg: "#fffbeb",
  successBg: "#f0fdf4",
};

const LOGO_URL = "https://keowunrxpxlbgebujbao.supabase.co/storage/v1/object/public/email-assets/bestly-logo.png";
const DASHBOARD_URL = "https://bestlytech.lovable.app/admin";

// Google Fonts import for Plus Jakarta Sans
const FONT_IMPORT = `<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">`;
const FONT_STACK = "'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

function baseLayout(content: string, footerNote?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
${FONT_IMPORT}
<title>Bestly</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:${FONT_STACK};-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td style="background:${BRAND.primary};border-radius:16px 16px 0 0;padding:28px 32px;text-align:center;">
<a href="https://bestly.tech" style="text-decoration:none;">
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
<tr>
<td style="vertical-align:middle;padding-right:14px;">
<img src="${LOGO_URL}" alt="Bestly" width="44" height="44" style="display:block;width:44px;height:44px;border-radius:10px;" />
</td>
<td style="vertical-align:middle;">
<span style="font-size:26px;font-weight:800;color:#fff;letter-spacing:-0.5px;font-family:${FONT_STACK};">Bestly</span>
</td>
</tr>
</table>
</a>
<p style="margin:8px 0 0;font-size:12px;color:rgba(255,255,255,0.6);letter-spacing:0.5px;font-weight:500;">System Monitoring</p>
</td></tr>
<tr><td style="height:4px;background:linear-gradient(90deg,${BRAND.primary},${BRAND.accent},transparent);font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="background:${BRAND.card};padding:36px 32px;border-left:1px solid ${BRAND.border};border-right:1px solid ${BRAND.border};">
${content}
</td></tr>
<tr><td style="background:${BRAND.card};padding:0 32px 28px;border-left:1px solid ${BRAND.border};border-right:1px solid ${BRAND.border};text-align:center;">
<a href="${DASHBOARD_URL}" style="display:inline-block;background:${BRAND.primary};color:#fff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;font-family:${FONT_STACK};">Open Dashboard</a>
</td></tr>
<tr><td style="background:${BRAND.primary};border-radius:0 0 16px 16px;padding:24px 32px;text-align:center;">
${footerNote ? `<p style="margin:0 0 14px;font-size:12px;color:rgba(255,255,255,0.7);line-height:1.5;">${footerNote}</p>` : ""}
<div style="margin-bottom:14px;">
<span style="display:inline-block;background:rgba(79,124,172,0.2);border:1px solid rgba(79,124,172,0.35);border-radius:20px;padding:5px 14px;margin:3px 4px;font-size:11px;font-weight:600;color:rgba(255,255,255,0.85);letter-spacing:0.3px;">&#128737; GDPR Compliant</span>
<span style="display:inline-block;background:rgba(79,124,172,0.2);border:1px solid rgba(79,124,172,0.35);border-radius:20px;padding:5px 14px;margin:3px 4px;font-size:11px;font-weight:600;color:rgba(255,255,255,0.85);letter-spacing:0.3px;">&#128274; CCPA Ready</span>
<span style="display:inline-block;background:rgba(79,124,172,0.2);border:1px solid rgba(79,124,172,0.35);border-radius:20px;padding:5px 14px;margin:3px 4px;font-size:11px;font-weight:600;color:rgba(255,255,255,0.85);letter-spacing:0.3px;">&#9989; Zero Data Resale</span>
</div>
<p style="margin:0;font-size:11px;color:rgba(255,255,255,0.5);line-height:1.5;">&copy; ${new Date().getFullYear()} Bestly Technologies &middot; Los Angeles, CA</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/**
 * Activation code email — sent to end users (Cookie Yeti brand).
 */
export function activationCodeEmail(code: string): string {
  const CY = {
    navy: "#1a365d",
    ice: "#bfdbfe",
    iceLight: "#e0f2fe",
    bgTop: "#e8f4f8",
    bgBottom: "#f0f7fa",
    header: "#0f2847",
    muted: "#64748b",
    border: "#93c5fd",
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
${FONT_IMPORT}
<title>Cookie Yeti</title>
</head>
<body style="margin:0;padding:0;background:linear-gradient(180deg,${CY.bgTop},${CY.bgBottom});font-family:${FONT_STACK};-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
<tr><td style="background:${CY.header};border-radius:16px 16px 0 0;padding:32px 32px 24px;text-align:center;">
<img src="https://bestlytech.lovable.app/images/cookieyeti-icon.png" alt="Cookie Yeti" width="64" height="64" style="display:block;margin:0 auto 12px;border-radius:14px;" />
<h1 style="margin:0;font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px;font-family:${FONT_STACK};">Cookie Yeti</h1>
<p style="margin:6px 0 0;font-size:13px;color:${CY.ice};letter-spacing:0.5px;font-weight:500;">Distraction-Free Browsing, Automatically</p>
</td></tr>
<tr><td style="background:#fff;padding:36px 32px 32px;border-left:1px solid ${CY.border};border-right:1px solid ${CY.border};">
<h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:${CY.navy};text-align:center;font-family:${FONT_STACK};">Your Activation Code</h2>
<p style="margin:0 0 28px;font-size:14px;color:${CY.muted};line-height:1.6;text-align:center;">Enter this code in Cookie Yeti to activate your extension.</p>
<div style="text-align:center;margin:0 0 28px;">
<div style="display:inline-block;background:${CY.iceLight};border:2px solid ${CY.border};border-radius:14px;padding:20px 44px;">
<span style="font-size:40px;font-weight:800;letter-spacing:10px;color:${CY.navy};font-family:'Courier New',monospace;">${code}</span>
</div>
</div>
<div style="background:${CY.iceLight};border-radius:10px;padding:14px 18px;text-align:center;">
<p style="margin:0;font-size:13px;color:${CY.muted};line-height:1.5;">&#9201; This code expires in <strong style="color:${CY.navy};">15 minutes</strong></p>
<p style="margin:6px 0 0;font-size:12px;color:${CY.muted};">If you didn't request this, you can safely ignore this email.</p>
</div>
</td></tr>
<tr><td style="background:${CY.header};border-radius:0 0 16px 16px;padding:20px 32px;text-align:center;">
<div style="display:inline-block;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);border-radius:20px;padding:6px 16px;margin-bottom:12px;">
<span style="font-size:12px;font-weight:600;color:${CY.ice};letter-spacing:0.3px;">&#128737; 100% Privacy-First</span>
</div>
<p style="margin:0;font-size:11px;color:${CY.ice};opacity:0.7;line-height:1.5;">Cookie Yeti by Bestly Technologies &middot; Los Angeles, CA</p>
</td></tr>
</table>
</td></tr>
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
  const sev = {
    danger: { color: BRAND.danger, bg: BRAND.dangerBg, icon: "&#128308;" },
    warning: { color: BRAND.warning, bg: BRAND.warningBg, icon: "&#128993;" },
    info: { color: BRAND.accent, bg: "#eff6ff", icon: "&#128309;" },
  }[opts.severity];

  let statsHtml = "";
  if (opts.stats && opts.stats.length > 0) {
    const w = Math.floor(100 / opts.stats.length);
    const cells = opts.stats.map((st) =>
      `<td style="text-align:center;padding:16px 10px;width:${w}%;"><div style="background:${BRAND.primary};border-radius:12px;padding:16px 12px;"><div style="font-size:28px;font-weight:800;color:#fff;line-height:1;">${st.value}</div><div style="font-size:10px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:0.8px;margin-top:6px;font-weight:600;">${st.label}</div></div></td>`
    ).join("");
    statsHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 24px;"><tr>${cells}</tr></table>`;
  }

  let itemsHtml = "";
  if (opts.items && opts.items.length > 0) {
    const rows = opts.items.map((item, i) =>
      `<tr><td style="padding:12px 16px;border-bottom:2px solid ${BRAND.accent}22;background:${i % 2 === 0 ? "#fff" : BRAND.bg};font-size:13px;"><strong style="color:${BRAND.primary};">${item.label}</strong><br/><span style="color:${BRAND.muted};font-size:12px;line-height:1.5;">${item.detail}</span></td></tr>`
    ).join("");
    itemsHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px solid ${BRAND.accent}33;border-radius:12px;overflow:hidden;margin:20px 0 0;"><tr><td style="background:${BRAND.primary};padding:10px 16px;"><span style="font-size:11px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:0.8px;">Details</span></td></tr>${rows}</table>`;
  }

  const content = `<div style="background:${sev.bg};border-left:5px solid ${sev.color};border-radius:8px;padding:14px 18px;margin-bottom:24px;"><span style="font-size:15px;font-weight:700;color:${sev.color};">${sev.icon} ${opts.title}</span></div>
<p style="margin:0 0 4px;font-size:14px;color:${BRAND.text};line-height:1.7;">${opts.summary}</p>
${statsHtml}${itemsHtml}${opts.timestamp ? `<p style="margin:24px 0 0;font-size:11px;color:${BRAND.muted};text-align:right;border-top:1px solid ${BRAND.border};padding-top:12px;">&#128336; ${opts.timestamp}</p>` : ""}`;

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
    ? `<div style="text-align:center;margin:28px 0 8px;"><a href="${opts.cta.url}" style="display:inline-block;background:${BRAND.primary};color:#fff;font-size:14px;font-weight:600;padding:12px 32px;border-radius:8px;text-decoration:none;font-family:${FONT_STACK};">${opts.cta.label}</a></div>`
    : "";

  const content = `<h1 style="margin:0 0 12px;font-size:20px;font-weight:600;color:${BRAND.text};font-family:${FONT_STACK};">${opts.heading}</h1>
<div style="font-size:14px;color:${BRAND.text};line-height:1.7;">${opts.body}</div>
${ctaHtml}`;

  return baseLayout(content, opts.footer || "");
}
