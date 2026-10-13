/**
 * Maya's two "hands" on bestly.tech (ElevenLabs client tools, run in the visitor's browser).
 *
 * - navigate_site_page({ page_path }): moves the visitor to another page with in-app (SPA) navigation, so the
 *   voice session keeps going. Only pages that carry the Maya widget are allowed; a page without the widget would
 *   unmount it and end the call. Anything else (other sites, admin, token pages, unknown paths) is refused.
 * - open_site_modal({ modal_type }): the site has no modals for these yet, so each type maps to the real page that
 *   does the job. Unknown types are refused.
 *
 * Every call returns a short sentence for Maya to act on (the tools have expects_response on), so she never claims
 * something happened that didn't. Pure functions: no React here, so they are easy to test.
 */

/** Pages that get the widget, and the plain name Maya is given for each. Also the navigation allowlist. */
export const PAGE_PRODUCT: Record<string, string> = {
  "/": "Bestly home page",
  "/about": "About Bestly",
  "/products": "Bestly products",
  "/apps": "Bestly products",
  "/cookie-yeti": "Cookie Yeti",
  "/inventory-proof": "InventoryProof",
  "/hoku": "HOKU",
  "/cloud": "Bestly Cloud",
  "/in-house-cloud": "Bestly Cloud",
  "/get-started": "Bestly Cloud",
  "/studio": "Bestly Studio",
  "/agent": "Bestly Agent",
  // Where a buyer lands after paying (token in the query, never in the path). Maya is there to help with the setup form,
  // but she can't navigate to it: see resolveSitePage.
  "/agent/welcome": "Bestly Agent setup",
  "/neckpilot": "NeckPilot",
  "/services": "Bestly services",
  "/apple-modernization": "Apple modernization service",
  "/marketplace-setup": "Marketplace setup service",
  "/contact": "Contact page",
  "/support": "Cookie Yeti support",
};

const NEVER_PREFIXES = ["/admin", "/partner"];

/** Names Maya might use that are not the real path. */
const NAV_ALIASES: Record<string, string> = {
  "/home": "/",
  "/index": "/",
  "/inventoryproof": "/inventory-proof",
  "/cookieyeti": "/cookie-yeti",
  "/cookie": "/cookie-yeti",
  "/bestly-cloud": "/cloud",
  "/private-cloud": "/in-house-cloud",
  "/house-cloud": "/in-house-cloud",
  "/pricing": "/products",
  "/product": "/products",
  "/contact-us": "/contact",
  "/bestly-agent": "/agent",
  "/demo": "/agent",
};

/** Products Maya supports that have no page on bestly.tech yet. Key: normalized path. */
const NO_PAGE_YET: Record<string, string> = {
  "/schoolpilot": "SchoolPilot",
  "/school-pilot": "SchoolPilot",
  "/parentiq": "ParentIQ",
  "/parent-iq": "ParentIQ",
  "/eldora": "El D'Ora",
  "/el-dora": "El D'Ora",
};

const SITE_HOSTS = new Set(["bestly.tech", "www.bestly.tech"]);
const SECTION_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function normalizePath(pathname: string): string {
  const p = pathname.toLowerCase().replace(/\/{2,}/g, "/");
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

/** The product name for a page that carries the widget, or null if this page must not show Maya. */
export function mayaProductForPath(pathname: string): string | null {
  const path = normalizePath(pathname);
  if (NEVER_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  return PAGE_PRODUCT[path] ?? null;
}

const pageList = () => Object.keys(PAGE_PRODUCT).filter((p) => p !== "/apps" && p !== "/in-house-cloud" && p !== "/agent/welcome").join(", ");

export type NavResult = { ok: true; path: string; hash: string; name: string } | { ok: false; say: string };

/** Turn whatever Maya passed into an allowed page, or a refusal sentence for her. Never throws. */
export function resolveSitePage(raw: unknown, currentHost?: string): NavResult {
  let s = String(raw ?? "").trim();
  if (!s) return { ok: false, say: `No page was given. Pages I can open: ${pageList()}.` };
  if (s.length > 200) return { ok: false, say: "That page path is too long. Ask which page they want." };

  // Full URLs are only allowed for this site; everything else is refused, never opened.
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith("//")) {
    let u: URL;
    try {
      u = new URL(s.startsWith("//") ? `https:${s}` : s);
    } catch {
      return { ok: false, say: "That is not a page on bestly.tech, so I did not open it." };
    }
    const host = u.hostname.toLowerCase();
    if (!/^https?:$/.test(u.protocol) || !(SITE_HOSTS.has(host) || host === currentHost?.toLowerCase())) {
      return { ok: false, say: "I can only open pages on bestly.tech, so I did not open that link." };
    }
    s = u.pathname + u.hash;
  }

  // "Cookie Yeti", "pricing" -> "/cookie-yeti", "/pricing"
  if (!s.startsWith("/")) s = `/${s.toLowerCase().replace(/[\s_]+/g, "-")}`;

  const hashAt = s.indexOf("#");
  const rawHash = hashAt >= 0 ? s.slice(hashAt + 1).toLowerCase() : "";
  let path = normalizePath((hashAt >= 0 ? s.slice(0, hashAt) : s).split("?")[0]);
  path = NAV_ALIASES[path] ?? path;

  if (NO_PAGE_YET[path]) {
    return {
      ok: false,
      say: `${NO_PAGE_YET[path]} has no page on bestly.tech yet, so I stayed on this page. Answer from what you know, or offer a ticket.`,
    };
  }
  if (path === "/agent/welcome") {
    return { ok: false, say: "The setup page is only for someone who just paid; they reach it from the link in their email or after paying. You can't open it for them." };
  }
  const name = mayaProductForPath(path) ? PAGE_PRODUCT[path] : null;
  if (!name) return { ok: false, say: `There is no page for that on bestly.tech. Pages I can open: ${pageList()}.` };
  return { ok: true, path, hash: SECTION_ID.test(rawHash) ? rawHash : "", name };
}

/** What each open_site_modal type does today (there are no modals yet; each opens the page that does the job). */
export const MODAL_TYPES = ["contact_form", "book_demo", "pricing_table", "product_tour"] as const;
type ModalType = (typeof MODAL_TYPES)[number];

export type ModalResult = { ok: true; path: string; say: string } | { ok: false; say: string };

export function resolveSiteModal(raw: unknown, currentPath: string): ModalResult {
  const t = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_") as ModalType;
  const here = mayaProductForPath(currentPath);
  switch (t) {
    case "contact_form":
      return { ok: true, path: "/contact", say: "Opened the contact page with the message form." };
    case "book_demo":
      if (here === "Bestly Cloud") {
        return { ok: true, path: "/get-started", say: "Opened the Bestly Cloud get-started form, where they can book a call." };
      }
      return {
        ok: true,
        path: "/contact",
        say: "There is no demo booking page yet, so I opened the contact page. Offer to take their details and file a sales_lead ticket.",
      };
    case "pricing_table":
      return { ok: true, path: "/products", say: "Opened the products page. Each product's own page shows its pricing." };
    case "product_tour":
      return { ok: true, path: "/products", say: "Opened the products page, which shows every Bestly product." };
    default:
      return { ok: false, say: `That is not something the site can open. Options: ${MODAL_TYPES.join(", ")}.` };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Presenting: find a section anywhere on the site by what the visitor called it.
// The index (public/maya/site-index.json) is built by tools/maya-site-index/build.mjs from the rendered pages, so it
// follows the real headings. It is fetched only when Maya first needs it, never on page load. Maya's Line Check also
// reads it to keep her "bestly.tech site map" knowledge in step with the site.
// ---------------------------------------------------------------------------------------------------------------

export type SiteIndex = {
  generated_at: string;
  pages: { path: string; name: string; sections: { heading: string; label?: string; text: string }[] }[];
};

let indexPromise: Promise<SiteIndex> | null = null;
export function loadSiteIndex(): Promise<SiteIndex> {
  indexPromise ??= fetch("/maya/site-index.json", { cache: "no-cache" })
    .then((r) => (r.ok ? (r.json() as Promise<SiteIndex>) : Promise.reject(new Error(`site index ${r.status}`))))
    .catch((e) => {
      indexPromise = null; // try again next time
      throw e;
    });
  return indexPromise;
}

/** Words visitors use that are not on the page. Each points at a page and the start of a real heading there. */
const SECTION_ALIASES: { words: string[]; path: string; heading: string; need?: string }[] = [
  { words: ["calculator", "savings", "you'd save", "estimate"], path: "/cloud", heading: "Add up what you rent today" },
  { words: ["cost", "quote", "how much", "price", "pricing"], need: "cloud", path: "/cloud", heading: "Add up what you rent today" },
  { words: ["jared", "founder", "owner", "who runs", "who made", "who built", "behind bestly"], path: "/about", heading: "Hey, I'm Jared" },
  { words: ["book", "call", "discovery", "schedule", "get started"], path: "/cloud", heading: "Four steps" },
  { words: ["faq", "questions", "concerns", "breaks", "maintains"], path: "/cloud", heading: "The four questions everybody asks" },
  { words: ["demo", "example call", "sample call", "watch a call", "listen to a call"], path: "/agent", heading: "Watch Maya take a call" },
  { words: ["how it works", "how does it work", "how agent works"], need: "agent", path: "/agent", heading: "We set it all up for you." },
  { words: ["cost", "price", "pricing", "how much", "plans", "plan", "monthly", "subscription"], need: "agent", path: "/agent", heading: "Simple monthly plans" },
  { words: ["which plan", "right plan", "plan picker", "minutes a month", "how many minutes"], path: "/agent", heading: "Not sure which plan" },
];

const STOP = new Set(["the", "a", "an", "me", "show", "see", "of", "for", "to", "on", "in", "and", "your", "you", "our",
  "page", "section", "part", "please", "can", "with", "about", "more", "tell", "what", "is", "it", "that", "this", "bestly"]);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));

export type SectionHit = { path: string; name: string; heading: string; text: string };

/**
 * Best section for "the cloud calculator", "Jared", "how the box works". Prefers the page the visitor is on when the
 * match is close, and returns null rather than a weak guess.
 */
export function findSection(query: string, index: SiteIndex, currentPath: string): SectionHit | null {
  const q = String(query ?? "").toLowerCase().trim();
  if (!q) return null;
  const qw = words(q);
  const here = normalizePath(currentPath);
  let best: { score: number; hit: SectionHit } | null = null;

  const consider = (path: string, name: string, s: { heading: string; label?: string; text: string }, bonus: number) => {
    const hw = words(s.heading);
    const lw = words(s.label ?? "");
    const tw = new Set(words(s.text));
    let score = bonus;
    for (const w of qw) {
      if (hw.includes(w)) score += 3;
      else if (hw.some((h) => h.startsWith(w) || w.startsWith(h))) score += 1.5;
      if (lw.includes(w)) score += 2;
      if (tw.has(w)) score += 0.6;
      if (words(name).includes(w)) score += 1.2;
    }
    if (path === here) score += 0.8;
    if (!best || score > best.score) best = { score, hit: { path, name, heading: s.heading, text: s.text } };
  };

  for (const a of SECTION_ALIASES) {
    if (!a.words.some((w) => q.includes(w)) || (a.need && !q.includes(a.need))) continue;
    const page = index.pages.find((p) => p.path === a.path);
    const s = page?.sections.find((x) => x.heading.toLowerCase().startsWith(a.heading.toLowerCase()));
    if (page && s) consider(page.path, page.name, s, 12); // curated: wins unless the visitor named something else outright
  }
  for (const p of index.pages) for (const s of p.sections) consider(p.path, p.name, s, 0);

  const b = best as { score: number; hit: SectionHit } | null;
  return b && b.score >= 3 ? b.hit : null;
}
