#!/usr/bin/env node
/**
 * Maya's site index: what is on every public page of bestly.tech, section by section.
 *
 *   node tools/maya-site-index/build.mjs [baseUrl]      (default http://127.0.0.1:4173, i.e. `npx vite preview`)
 *
 * The site is a single-page app, so a plain crawler sees an empty shell. This renders each page in headless
 * Chromium and reads the real headings and text, then writes two files:
 *
 *   public/maya/site-index.json   served at bestly.tech/maya/site-index.json; Maya's show_section tool uses it to find
 *                                          "the cloud calculator" or "Jared" on any page and take the visitor there
 *   docs/maya-site-knowledge.md           the same content as plain text, for people to read. Maya's Line Check
 *                                          (maya-watch) rebuilds her "bestly.tech site map" knowledge from the live
 *                                          JSON whenever generated_at changes, so publishing the JSON is enough.
 *
 * Re-run after changing page copy (Maya's Line Check warns when it is more than 14 days old).
 * Routes come from PAGE_PRODUCT in src/components/maya/siteTools.ts, so a page Maya can open is a page she knows.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const base = (process.argv[2] ?? "http://127.0.0.1:4173").replace(/\/+$/, "");
const toolsSrc = readFileSync("src/components/maya/siteTools.ts", "utf8");
const block = toolsSrc.slice(toolsSrc.indexOf("export const PAGE_PRODUCT"), toolsSrc.indexOf("};", toolsSrc.indexOf("export const PAGE_PRODUCT")));
const pages = [...block.matchAll(/"(\/[^"]*)":\s*"([^"]+)"/g)].map((m) => ({ path: m[1], name: m[2] }));
// Same page under two paths: index it once, under the path Maya uses.
const SKIP = new Set(["/apps", "/in-house-cloud", "/agent/welcome"]); // welcome needs a token from the post-payment email

const exe = process.env.MAYA_CHROME || undefined;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const out = [];

for (const p of pages) {
  if (SKIP.has(p.path)) continue;
  await page.goto(base + p.path, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(600);
  const sections = await page.evaluate(() => {
    const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();
    const main = document.querySelector("main") ?? document.body;
    // Every h1-h3 inside the page content starts a section; its text runs until the next heading.
    const heads = [...main.querySelectorAll("h1, h2, h3")].filter((h) => !h.closest("[aria-hidden='true'], .maya, nav, footer, header"));
    const res = [];
    for (let i = 0; i < heads.length; i++) {
      const h = heads[i];
      const heading = clean(h.textContent);
      if (!heading || heading.length > 140) continue;
      // Text that belongs to this heading only: from the end of it to the start of the next heading.
      const r = document.createRange();
      r.setStartAfter(h);
      if (heads[i + 1]) r.setEndBefore(heads[i + 1]);
      else r.setEndAfter(main.lastChild ?? main);
      const text = clean(r.toString());
      // The small label above a heading ("THE MATH, ON YOUR BUSINESS") is often the words people use for it.
      const prev = h.previousElementSibling;
      const label = prev && clean(prev.textContent).length < 60 ? clean(prev.textContent) : "";
      res.push({ level: Number(h.tagName[1]), heading, label, text: text.slice(0, 700) });
    }
    return { title: clean(document.title), sections: res };
  });
  // Keep h1/h2 always; h3 only when its text adds something (cards, calculator steps).
  const sections2 = sections.sections.filter((s) => s.level < 3 || s.text.length > 40).slice(0, 40);
  out.push({ path: p.path, name: p.name, title: sections.title, sections: sections2 });
  console.log(`${p.path.padEnd(22)} ${String(sections2.length).padStart(3)} sections`);
}
await browser.close();

const index = {
  generated_at: new Date().toISOString(),
  source: base,
  pages: out.map((p) => ({ path: p.path, name: p.name, sections: p.sections.map((s) => ({ heading: s.heading, label: s.label || undefined, text: s.text.slice(0, 500) })) })),
};
writeFileSync("public/maya/site-index.json", JSON.stringify(index, null, 1) + "\n");

const md = [
  "# bestly.tech site map for Maya",
  "",
  "Every public page on bestly.tech and what each section says, read from the live pages. Use it to answer",
  "questions about what is on the site, and to pick what to show with show_section or navigate_site_page.",
  "If something is not in this map, it is not on the website: say so plainly instead of guessing.",
  "",
  ...out.flatMap((p) => [
    `## ${p.name} (${p.path === "/" ? "home page" : p.path})`,
    "",
    ...p.sections.flatMap((s) => [`### ${s.heading}${s.label ? ` (${s.label})` : ""}`, s.text ? s.text : "(heading only)", ""]),
  ]),
].join("\n");
writeFileSync("docs/maya-site-knowledge.md", md + "\n");
console.log(`wrote site-index.json (${out.length} pages) and docs/maya-site-knowledge.md (${md.length} chars)`);
