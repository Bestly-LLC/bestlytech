#!/usr/bin/env node
/**
 * site-audit — the half of the site check that needs a real browser.
 *
 *   node scripts/site-audit/crawl.mjs                 # all public routes, desktop
 *   node scripts/site-audit/crawl.mjs --mobile        # 390x844, catches overflow
 *   node scripts/site-audit/crawl.mjs --route /status # one route
 *
 * Exits 1 if anything failed, so it is safe to run from a shell or a workflow.
 *
 * WHY THIS EXISTS BESIDE site-depth-check
 *
 * The edge function (supabase/functions/site-depth-check) runs every 15 minutes
 * from cron and covers what a server-side fetch can see: the HTML, the files it
 * references, and the public RPCs the page calls. It cannot see the rendered
 * page. Nothing server-side can. A React error boundary, a chart that drew
 * zeroes, a query that stopped returning rows — all of those arrive as a 200 and
 * a healthy-looking HTML shell.
 *
 * So this runs a real Chromium against the same routes, with the console and the
 * network attached, and reports what the page actually did:
 *
 *   - console errors and uncaught exceptions
 *   - failed requests and any response >= 400 (this is what caught
 *     get_public_status 500-ing on most loads and the transparency RPC 404-ing)
 *   - images with no alt text, and images that failed to load
 *   - pages that fell back to the homepage's <title> because they forgot a head
 *   - /nonexistent-style 404s reached from a real link on a real page
 *   - horizontal overflow at phone width (--mobile)
 *
 * Run it after any change to the marketing site, and as part of the manual sweep
 * in docs/site-depth-check.md. It needs Chrome installed and the repo's
 * node_modules (playwright-core).
 */

import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = value("--base", "https://www.bestly.tech");
const MOBILE = flag("--mobile");
const ONLY = value("--route", null);

/** Routes anyone can reach without a token. Admin, token pages and guest links
 *  have their own watchdogs and their own auth. */
const ROUTES = [
  "/", "/agent", "/about", "/products", "/services", "/hire", "/contact", "/press",
  "/cookie-yeti", "/cookie-yeti/privacy", "/cookie-yeti/terms", "/cookie-yeti/success",
  "/cookie-yeti/cancel", "/cookie-yeti/transparency",
  "/in-house-cloud", "/studio", "/neckpilot", "/inventory-proof", "/hoku",
  "/get-started", "/shield/report", "/support", "/status", "/links", "/unsubscribe",
  "/apple-modernization", "/marketplace-setup", "/developer-compliance", "/report-site",
  "/confesh/privacy", "/confesh/support", "/privacy-policy", "/terms",
];

const routes = ONLY ? [ONLY] : ROUTES;
const viewport = MOBILE ? { width: 390, height: 844 } : { width: 1366, height: 900 };

/** Console noise and aborted beacons that are not ours and not actionable. */
const IGNORE = [
  /preloaded using link preload but not used/i,
  /Download the React DevTools/i,
  /\[fast refresh\]/i,
  /cdn-cgi\/rum/i, // Cloudflare's own RUM beacon, aborted on unload on every page
];

/** The <title> in index.html. Any page still showing it never set its own. */
const DEFAULT_TITLE = "Bestly — AI Agents That Answer Your Phone and Do the Work";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport, isMobile: MOBILE, hasTouch: MOBILE });
const page = await ctx.newPage();

const problems = [];
const report = [];
let linkedRoutes = new Set();

for (const route of routes) {
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const badResponses = [];

  const onConsole = (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
  };
  const onPageError = (e) => pageErrors.push(String(e).slice(0, 300));
  const onRequestFailed = (r) =>
    failedRequests.push(`${r.method()} ${r.url().slice(0, 140)} :: ${r.failure()?.errorText ?? "failed"}`);
  const onResponse = (r) => {
    if (r.status() >= 400) badResponses.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 140)}`);
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("requestfailed", onRequestFailed);
  page.on("response", onResponse);

  let status = null;
  let title = "";
  let h1 = "";
  let textLen = 0;
  let overflow = null;
  let missingAlt = [];
  let brokenImages = [];
  let links = [];

  try {
    const resp = await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 45000 });
    status = resp?.status() ?? null;
    await page.waitForTimeout(1200);
    title = await page.title();
    h1 = ((await page.locator("h1").first().textContent().catch(() => "")) || "").trim();
    textLen = ((await page.locator("body").innerText().catch(() => "")) || "").length;

    const dom = await page.evaluate(() => {
      const wide = document.documentElement.scrollWidth > window.innerWidth + 2;
      const imgs = [...document.querySelectorAll("img")];
      return {
        wide,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        // alt="" is the correct markup for a decorative image, so only a
        // genuinely absent attribute counts as missing.
        missingAlt: imgs
          .filter((i) => i.getAttribute("alt") === null && !i.closest("[aria-hidden=true]"))
          .map((i) => (i.currentSrc || i.src || "").slice(-80)),
        brokenImages: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => (i.currentSrc || i.src || "").slice(-80)),
        links: [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")),
      };
    });
    if (dom.wide) overflow = { scrollWidth: dom.scrollWidth, innerWidth: dom.innerWidth };
    missingAlt = dom.missingAlt;
    brokenImages = dom.brokenImages;
    links = dom.links.filter((h) => h && h.startsWith("/") && !h.startsWith("//")).map((h) => h.split("#")[0]);
  } catch (e) {
    pageErrors.push(`NAVIGATION: ${String(e).slice(0, 200)}`);
  }

  page.off("console", onConsole);
  page.off("pageerror", onPageError);
  page.off("requestfailed", onRequestFailed);
  page.off("response", onResponse);

  for (const l of links) linkedRoutes.add(l);

  const clean = (list) => [...new Set(list.filter((t) => !IGNORE.some((re) => re.test(t))))];

  const row = {
    route,
    status,
    title,
    h1,
    textLen,
    consoleErrors: clean(consoleErrors),
    pageErrors: clean(pageErrors),
    failedRequests: clean(failedRequests),
    badResponses: clean(badResponses),
    missingAlt,
    brokenImages,
    overflow,
  };
  report.push(row);

  // A page other than the homepage wearing the homepage's title has forgotten
  // its own <head> — which is how four real pages were shipping the wrong
  // title, canonical and og:image until 2026-10-17.
  const borrowedTitle = route !== "/" && title === DEFAULT_TITLE;
  row.borrowedTitle = borrowedTitle;

  const bad =
    status !== 200 ||
    row.consoleErrors.length ||
    row.pageErrors.length ||
    row.badResponses.length ||
    row.brokenImages.length ||
    row.overflow ||
    borrowedTitle;
  if (bad) problems.push(row);
}

/** Soft 404s: the SPA answers 200 for anything, so a dead link only shows up as
 *  a page whose H1 says 404. */
const deadLinks = [];
for (const link of [...linkedRoutes]) {
  if (/\.(png|jpg|jpeg|webp|svg|pdf|ico|xml|txt|glb|css|js)$/i.test(link)) continue;
  if (routes.includes(link)) continue;
  await page.goto(BASE + link, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
  const { h1, len } = await page.evaluate(() => ({
    h1: (document.querySelector("h1")?.textContent || "").trim(),
    len: (document.body.innerText || "").length,
  }));
  if (h1 === "404" || len < 120) deadLinks.push({ link, h1, len });
}

await browser.close();

const line = (s) => console.log(s);
line(`\nsite-audit — ${BASE}${MOBILE ? " (mobile 390x844)" : " (desktop 1366x900)"}, ${routes.length} routes\n`);

for (const r of report) {
  const bad = problems.includes(r);
  line(`${bad ? "FAIL" : " ok "}  ${r.route.padEnd(28)} ${String(r.status).padEnd(4)} "${r.title}"`);
  for (const e of r.consoleErrors) line(`        console: ${e}`);
  for (const e of r.pageErrors) line(`        page:    ${e}`);
  for (const e of r.badResponses) line(`        http:    ${e}`);
  for (const e of r.failedRequests) line(`        request: ${e}`);
  for (const e of r.brokenImages) line(`        image:   ${e}`);
  for (const e of r.missingAlt) line(`        no alt:  ${e}`);
  if (r.overflow) line(`        overflow: ${r.overflow.scrollWidth}px in a ${r.overflow.innerWidth}px viewport`);
  if (r.borrowedTitle) line(`        title:   still the homepage's. This page sets no <head>.`);
}

if (deadLinks.length) {
  line(`\nDead links (the SPA answers 200 and renders 404):`);
  for (const d of deadLinks) line(`  ${d.link}  h1="${d.h1}" body=${d.len} chars`);
}

const notes = report.reduce((n, r) => n + r.missingAlt.length, 0);
line(
  `\n${problems.length} of ${routes.length} routes have problems` +
    `${deadLinks.length ? `, plus ${deadLinks.length} dead link(s)` : ""}` +
    `${notes ? `, plus ${notes} image(s) with no alt text` : ""}.\n`,
);
process.exit(problems.length || deadLinks.length ? 1 : 0);
