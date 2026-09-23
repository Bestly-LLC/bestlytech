/**
 * Content-Security-Policy violations, reported to Scout.
 *
 * Why: on 2026-09-22 a security pass added a CSP to vercel.json without media-src/frame-src, and
 * with no Google Fonts or bigdatacloud. The browser silently refused every clip's audio ("Error" on
 * the player, not one request reached storage), PDF previews and the partner weather's place name.
 * Nothing noticed, because a blocked load never reaches a server.
 *
 * Now the page tells Scout: each distinct directive + host opens a monitor incident (admin_report on
 * /admin, partner_report_error on /partner) with what was blocked and the line to add to vercel.json.
 */
import { supabase } from "@/integrations/supabase/client";
import { reportToScout } from "@/lib/reportToScout";

const seen = new Set<string>();

function host(uri: string) {
  if (!uri || uri === "inline" || uri === "eval" || uri === "blob" || uri === "data") return uri || "inline";
  try { return new URL(uri).origin; } catch { return uri.slice(0, 80); }
}

export function installCspWatch() {
  if (typeof document === "undefined") return;
  document.addEventListener("securitypolicyviolation", (e) => {
    const path = window.location.pathname;
    const area = path.startsWith("/admin") ? "admin" : path.startsWith("/partner") ? "partner" : null;
    if (!area) return;
    const directive = (e.effectiveDirective || e.violatedDirective || "unknown").split(" ")[0];
    const from = host(e.blockedURI);
    const sig = `${directive} ${from}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    const detail = `The browser blocked a ${directive} load from ${from} (Content-Security-Policy in vercel.json).\n`
      + `Page: ${path}\nFix: add ${from === "inline" ? "'unsafe-inline'" : from} to ${directive} in the CSP header in vercel.json, `
      + `unless that load is unwanted.\nBrowser: ${navigator.userAgent}`;
    const where = `csp.${directive}`;
    if (area === "admin") {
      void (supabase.rpc as any)("admin_report", { p_where: where, p_detail: detail, p_ok: false }).then(() => {}, () => {});
    } else {
      reportToScout(where, detail);
    }
  });
}
