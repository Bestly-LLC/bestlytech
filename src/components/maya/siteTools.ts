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
};

/** Products Maya supports that have no page on bestly.tech yet. Key: normalized path. */
const NO_PAGE_YET: Record<string, string> = {
  "/agent": "the Bestly Agent",
  "/bestly-agent": "the Bestly Agent",
  "/demo": "Bestly Agent demos",
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

const pageList = () => Object.keys(PAGE_PRODUCT).filter((p) => p !== "/apps" && p !== "/in-house-cloud").join(", ");

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
