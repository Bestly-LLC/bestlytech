import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { SECRET_KEY, PUBLISHABLE_KEY, keyHeaders, isServiceRequest } from "../_shared/keys.ts";

/**
 * site-depth-check — Ares's depth check for bestly.tech (2026-10-17).
 *
 * WHY THIS EXISTS
 *
 * bestly.tech is a Vite SPA. Every URL on it, including the ones that are
 * completely broken, answers 200 with the same 13 KB of index.html. That is
 * exactly what the site was being monitored with: probe-external fetched five
 * homepages every five minutes and looked at the status code. So on 2026-10-17
 * the whole estate was green while:
 *
 *   - /status showed "couldn't load" on most visits, because get_public_status()
 *     ran for 2.9s against the anon role's 3s statement_timeout and was killed
 *     with 57014. It succeeded just often enough to look like a fluke.
 *   - /cookie-yeti/transparency had never once shown live numbers. Its RPC,
 *     get_cookie_yeti_public_stats(), is in the repo (two files!) but was never
 *     applied to the project, so PostgREST answered PGRST202 to every call and
 *     the page fell back to hardcoded last-known-good constants from May.
 *
 * Both of those are invisible to a status-code check and invisible to a
 * screenshot, because a fallback is not a blank page. A fallback is a page that
 * looks fine and is lying.
 *
 * WHAT IT CHECKS
 *
 *   1. Routes — the HTML a visitor actually gets: 200, the app shell, and a
 *      real script bundle referenced.
 *   2. Assets — every /assets/ and /models/ URL those routes reference still
 *      resolves, so a bad deploy that drops a chunk is caught in 15 minutes.
 *   3. Data paths — each public RPC the site reads with no sign-in is called
 *      with the publishable key, the way the browser calls it, and its shape is
 *      asserted. This is the layer that was missing.
 *   4. Sitemap — every <loc> in sitemap.xml answers 200.
 *
 * WHAT IT CANNOT CHECK, SO DON'T PRETEND IT DID
 *
 * A server-side fetch gets the shell, not the rendered page. It cannot see
 * console errors, a React error boundary, a chart that drew zeroes, or a
 * fallback that invented its numbers. Those need a real browser; see
 * docs/site-depth-check.md for the manual sweep and why it is not on a cron.
 *
 * Each finding lands in monitor_issues under the `site.` prefix, which
 * notification_owners routes to Ares, and climbs the normal Fix Ladder.
 *
 * v1 (2026-10-17) — first version, written after the /status and transparency
 * misses above.
 */

const SITE = "https://www.bestly.tech";
const TIMEOUT_MS = 12000;
const ASSET_CAP = 40;

type Sev = "info" | "warning" | "error";

interface RouteDef {
  path: string;
  /** Something that must appear in the served HTML for this to be the right page. */
  title?: string;
}

/**
 * The routes that carry revenue or a legal obligation. Not every route on the
 * site: the guest/token pages (/t/:token, /lax, /sign) are per-person links and
 * belong to their own watchdogs.
 */
const ROUTES: RouteDef[] = [
  { path: "/", title: "Bestly" },
  { path: "/agent", title: "Bestly Agent" },
  { path: "/products" },
  { path: "/in-house-cloud" },
  { path: "/studio" },
  { path: "/cookie-yeti" },
  { path: "/get-started" },
  { path: "/status" },
  { path: "/cookie-yeti/transparency" },
  { path: "/about" },
  { path: "/hire" },
  { path: "/contact" },
  { path: "/privacy-policy" },
  { path: "/terms-of-use" },
  { path: "/shield/report" },
  { path: "/support" },
];

interface RpcDef {
  name: string;
  /** Returns a complaint, or null when the answer looks healthy. */
  check: (body: unknown) => string | null;
}

const asArray = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);
const asObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));

const RPCS: RpcDef[] = [
  {
    name: "get_public_status",
    // /status renders one block per service plus a 90-day sparkline. An empty
    // array, or rows with no daily series, is the page with nothing on it.
    check: (body) => {
      const rows = asArray(body);
      if (!rows) return `expected an array of services, got ${typeof body}`;
      if (rows.length === 0) return "returned no services at all";
      const first = asObject(rows[0]);
      if (!first) return "a row was not an object";
      for (const field of ["service", "current_status", "last_checked", "daily_uptime"]) {
        if (!(field in first)) return `a row is missing ${field}`;
      }
      const days = asArray(first.daily_uptime);
      if (!days || days.length !== 90) return `daily_uptime has ${days?.length ?? 0} days, expected 90`;
      const bad = rows.find((r) => asArray(asObject(r)?.daily_uptime)?.length !== 90);
      if (bad) return "a service is missing part of its 90-day series";
      return null;
    },
  },
  {
    name: "get_cookie_yeti_public_stats",
    // /cookie-yeti/transparency falls back to hardcoded May numbers when this
    // call fails, so an outage here looks like a working page with stale data.
    // The counts below only exist if the RPC actually ran against the tables.
    check: (body) => {
      const o = asObject(body);
      if (!o) return `expected an object, got ${body === null ? "null" : typeof body}`;
      for (const field of [
        "sites_analyzed",
        "ai_generations",
        "banners_dismissed",
        "active_patterns",
        "offenders",
        "ai_status_breakdown",
      ]) {
        if (!(field in o)) return `missing ${field}`;
      }
      if (num(o.sites_analyzed) <= 0) return "sites_analyzed came back 0";
      if (num(o.active_patterns) <= 0) return "active_patterns came back 0";
      if (!asArray(o.offenders)?.length) return "offenders came back empty";
      return null;
    },
  },
];

function keyFor(kind: string, name: string): string {
  // e.g. site.route:/status, site.rpc:get_public_status, site.asset:/assets/main-abc.js
  return `site.${kind}:${name}`;
}

async function timedFetch(url: string, init: RequestInit = {}): Promise<{ res: Response | null; ms: number; err: string | null }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: ac.signal, redirect: "follow" });
    return { res, ms: Date.now() - start, err: null };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? `timeout after ${TIMEOUT_MS}ms` : e.message) : String(e);
    return { res: null, ms: Date.now() - start, err: msg };
  } finally {
    clearTimeout(t);
  }
}

/** One retry, because a single cold edge response is not a defect worth waking anyone for. */
async function fetchWithRetry(url: string, init: RequestInit = {}) {
  const first = await timedFetch(url, init);
  if (first.res && first.res.status < 400) return first;
  await new Promise((r) => setTimeout(r, 1500));
  const second = await timedFetch(url, init);
  return second.res && second.res.status < 400 ? second : (second.res ? second : first);
}

interface Finding {
  key: string;
  ok: boolean;
  severity: Sev;
  title: string;
  body: string;
  needs: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Same gate as probe-external: the maintenance secret, a service key, or the
  // bare POST pg_cron sends.
  const secret = req.headers.get("x-maintenance-secret");
  const isCronCall = !req.headers.get("Authorization") && !secret && req.method === "POST";
  const authed =
    (secret && secret === Deno.env.get("MAINTENANCE_SECRET")) ||
    (await isServiceRequest(req)) ||
    ((req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "") === Deno.env.get("MAINTENANCE_SECRET"));
  if (!authed && !isCronCall) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SECRET_KEY);
  const findings: Finding[] = [];
  const assets = new Set<string>();

  // ---- 1. Routes ---------------------------------------------------------
  const html = new Map<string, string>();
  await Promise.all(
    ROUTES.map(async (route) => {
      const { res, err } = await fetchWithRetry(`${SITE}${route.path}`);
      const key = keyFor("route", route.path);
      if (!res) {
        findings.push({
          key, ok: false, severity: "error",
          title: `bestly.tech${route.path} did not answer`,
          body: `${err ?? "no response"}. The page is unreachable from the outside.`,
          needs: `Check the Vercel deployment for bestly.tech — the last build may have failed or been rolled back.`,
        });
        return;
      }
      if (res.status !== 200) {
        findings.push({
          key, ok: false, severity: "error",
          title: `bestly.tech${route.path} returned ${res.status}`,
          body: `HTTP ${res.status} from the origin.`,
          needs: `Check the Vercel deployment for bestly.tech.`,
        });
        return;
      }
      const body = await res.text();
      html.set(route.path, body);
      const problems: string[] = [];
      if (!/text\/html/i.test(res.headers.get("content-type") ?? "")) problems.push("content-type is not HTML");
      if (!body.includes('id="root"')) problems.push("the React root element is missing");
      if (!/\/assets\/[A-Za-z0-9_.-]+\.js/.test(body)) problems.push("no built script bundle is referenced");
      if (route.title && !body.includes(route.title)) problems.push(`the page's own title marker (${route.title}) is missing`);
      if (problems.length) {
        findings.push({
          key, ok: false, severity: "error",
          title: `bestly.tech${route.path} served the wrong thing`,
          body: problems.join("; ") + ".",
          needs: "The SPA shell is broken or the deploy is incomplete. Check the last Vercel build.",
        });
      } else {
        findings.push({ key, ok: true, severity: "info", title: `bestly.tech${route.path} is serving`, body: "", needs: null });
      }
      for (const m of body.matchAll(/(?:href|src)="(\/(?:assets|models)\/[^"]+)"/g)) assets.add(m[1]);
    }),
  );

  // ---- 2. Assets ---------------------------------------------------------
  const assetList = [...assets].slice(0, ASSET_CAP);
  await Promise.all(
    assetList.map(async (asset) => {
      const { res, err } = await fetchWithRetry(`${SITE}${asset}`, { method: "HEAD" });
      const key = keyFor("asset", asset);
      if (res && res.status < 400) {
        findings.push({ key, ok: true, severity: "info", title: `${asset} resolves`, body: "", needs: null });
        return;
      }
      findings.push({
        key, ok: false, severity: "error",
        title: `A file bestly.tech's pages load is missing: ${asset}`,
        body: `${err ?? `HTTP ${res?.status}`}. Every visitor's browser asks for this and gets nothing, so the page renders without it.`,
        needs: "A deploy shipped HTML that points at a file it did not upload. Rebuild and redeploy.",
      });
    }),
  );

  // ---- 3. Data paths -----------------------------------------------------
  const anonHeaders = { ...keyHeaders(PUBLISHABLE_KEY), "Content-Type": "application/json" };
  await Promise.all(
    RPCS.map(async (rpc) => {
      const key = keyFor("rpc", rpc.name);
      const { res, err } = await fetchWithRetry(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/${rpc.name}`, {
        method: "POST",
        headers: anonHeaders,
        body: "{}",
      });
      if (!res) {
        findings.push({
          key, ok: false, severity: "error",
          title: `${rpc.name}() is unreachable`,
          body: `${err ?? "no response"}.`,
          needs: "Check the Supabase project is up.",
        });
        return;
      }
      const text = await res.text();
      if (res.status !== 200) {
        findings.push({
          key, ok: false, severity: "error",
          title: `A public page's data call fails: ${rpc.name}()`,
          body: `The site calls this with the publishable key and no sign-in and got HTTP ${res.status}: ${text.slice(0, 300)}. ` +
            `PGRST202 means the function does not exist in the project even though the migration is in the repo.`,
          needs: `Apply the migration that defines (or last redefined) ${rpc.name}(). If it is meant to be public, it also needs a row in security_public_rpcs or Ares's Auto-Fixer will lock it again.`,
        });
        return;
      }
      let parsed: unknown = null;
      try { parsed = JSON.parse(text); } catch { /* shape check reports it */ }
      const complaint = rpc.check(parsed);
      if (complaint) {
        findings.push({
          key, ok: false, severity: "warning",
          title: `${rpc.name}() answered with the wrong shape`,
          body: `${complaint}. The page will render empties or fall back to its hardcoded numbers and look fine.`,
          needs: `Read the function body and the page that consumes it. A fallback that hides a failure is the bug, not the fix.`,
        });
      } else {
        findings.push({ key, ok: true, severity: "info", title: `${rpc.name}() answers with live data`, body: "", needs: null });
      }
    }),
  );

  // ---- 4. Sitemap --------------------------------------------------------
  const sitemapKey = keyFor("sitemap", "sitemap.xml");
  const { res: mapRes, err: mapErr } = await fetchWithRetry(`${SITE}/sitemap.xml`);
  if (!mapRes || mapRes.status !== 200) {
    findings.push({
      key: sitemapKey, ok: false, severity: "warning",
      title: "bestly.tech/sitemap.xml is not being served",
      body: `${mapErr ?? `HTTP ${mapRes?.status}`}. Search engines have nothing to crawl from.`,
      needs: "Check public/sitemap.xml is in the build output.",
    });
  } else {
    const xml = await mapRes.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
    if (locs.length < 10) {
      findings.push({
        key: sitemapKey, ok: false, severity: "warning",
        title: `bestly.tech/sitemap.xml lists only ${locs.length} URL(s)`,
        body: "The sitemap is served but nearly empty, so new pages are not being announced to search engines.",
        needs: "Check the sitemap generator in the build.",
      });
    } else {
      const dead: string[] = [];
      await Promise.all(
        locs.slice(0, ASSET_CAP).map(async (loc) => {
          const { res } = await fetchWithRetry(loc, { method: "GET" });
          if (!res || res.status >= 400) dead.push(`${loc} (${res?.status ?? "no response"})`);
        }),
      );
      if (dead.length) {
        findings.push({
          key: sitemapKey, ok: false, severity: "warning",
          title: `${dead.length} URL(s) in the sitemap do not resolve`,
          body: dead.slice(0, 8).join(", ") + ". Search engines are being pointed at pages that are not there.",
          needs: "Remove the dead entries from the sitemap or ship the pages.",
        });
      } else {
        findings.push({ key: sitemapKey, ok: true, severity: "info", title: "sitemap.xml is complete", body: "", needs: null });
      }
    }
  }

  // ---- Report ------------------------------------------------------------
  let raised = 0, cleared = 0, failed = 0;
  for (const f of findings) {
    const { error } = await supabase.rpc("bestly_raise", {
      p_key: f.key,
      p_kind: f.ok ? "resolved" : "problem",
      p_severity: f.severity,
      p_title: f.title,
      p_body: f.body,
      p_area: "site",
      p_needs_jared: f.needs,
      p_healed: false,
    });
    if (error) failed++;
    else if (f.ok) cleared++;
    else raised++;
  }

  // A checker that dies quietly is worse than no checker, which is the whole
  // story of this file. site_depth_watch() (cron, every 30 minutes) raises
  // site.depth-check.stale if this beat stops landing, and clears it when it
  // comes back.
  const { error: beatError } = await supabase
    .from("site_depth_beat")
    .upsert(
      { id: 1, at: new Date().toISOString(), ok: failed === 0, raised, cleared, checks: findings.length },
      { onConflict: "id" },
    );

  return new Response(
    JSON.stringify({
      ok: true,
      routes: ROUTES.length,
      assets: assetList.length,
      rpcs: RPCS.length,
      raised,
      cleared,
      report_errors: failed,
      beat: beatError ? `beat write failed: ${beatError.message}` : "recorded",
      findings: findings.filter((f) => !f.ok).map((f) => ({ key: f.key, title: f.title, body: f.body })),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
