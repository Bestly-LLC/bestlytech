/**
 * Maya as a presenter: the browser side of her show_section and describe_screen tools.
 *
 * Shared by the Talk to Maya widget and the full Maya screen, so both present the site the same way:
 *  - goTo():          in-app navigation (the call keeps going), then optionally a section.
 *  - spotlight():     finds a heading on the page by its words (no ids needed), glides it into view and gives its
 *                     block a soft, feathered glow for a few seconds. Reduce Motion: jumps, no pulse.
 *  - describeScreen(): what the visitor is looking at right now (page + visible headings + their words), so Maya
 *                     can talk over the slide instead of reciting the knowledge base.
 *  - presenterTools(): the client tools (navigate_site_page, open_site_modal, show_section, describe_screen,
 *                     cloud_calculator, fill_contact_form),
 *                     each returning one plain sentence for Maya.
 */
import { getCalc, type CalcChange } from "@/components/cloud/calcBridge";
import { getForm, type FormValues } from "./formBridge";
import { mayaDiag } from "./mayaSession";
import {
  findSection, loadSiteIndex, mayaProductForPath, normalizePath, resolveSiteModal, resolveSitePage,
} from "./siteTools";

type Nav = (path: string) => void;
export type PresenterDeps = { navigate: () => Nav; path: () => string; onShow?: (label: string) => void };

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const reduceMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function headings(): HTMLElement[] {
  const main = document.querySelector("main") ?? document.body;
  return [...main.querySelectorAll<HTMLElement>("h1, h2, h3")].filter((h) => !h.closest(".maya, .maya-screen, nav, header, footer"));
}

const words = (s: string) => clean(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(" ").filter((w) => w.length > 2);

/** The heading on the current page that best matches `text` (exact first, then by shared words). */
export function findHeading(text: string): HTMLElement | null {
  const want = clean(text).toLowerCase();
  if (!want) return null;
  const hs = headings();
  const exact = hs.find((h) => clean(h.textContent).toLowerCase() === want)
    ?? hs.find((h) => clean(h.textContent).toLowerCase().startsWith(want.slice(0, 28)));
  if (exact) return exact;
  const ww = new Set(words(want));
  let best: { h: HTMLElement; n: number } | null = null;
  for (const h of hs) {
    const n = words(h.textContent ?? "").filter((w) => ww.has(w)).length;
    if (n > 0 && (!best || n > best.n)) best = { h, n };
  }
  return best && best.n >= Math.min(2, ww.size) ? best.h : null;
}

/** The block to light up for a heading: its card or section, but never something taller than the screen. */
function blockFor(h: HTMLElement): HTMLElement {
  const vh = window.innerHeight || 800;
  const cands = [h.parentElement, h.parentElement?.parentElement, h.closest("article, li, section")].filter(Boolean) as HTMLElement[];
  for (const c of cands) {
    const r = c.getBoundingClientRect();
    if (r.height > 0 && r.height < vh * 0.9) return c;
  }
  return h;
}

// The glow is its own element laid over the block, not a class on it: React re-renders and on-scroll animations on
// the page would wipe a class, and an overlay never touches the page's layout or clicks.
let glow: HTMLDivElement | null = null;
let glowTimer: ReturnType<typeof setTimeout> | undefined;
let glowFollow = 0;

function placeGlow(block: HTMLElement) {
  if (!glow) return;
  const r = block.getBoundingClientRect();
  const pad = 10;
  glow.style.top = `${r.top + window.scrollY - pad}px`;
  glow.style.left = `${r.left + window.scrollX - pad}px`;
  glow.style.width = `${r.width + pad * 2}px`;
  glow.style.height = `${r.height + pad * 2}px`;
}

export function spotlight(h: HTMLElement): void {
  spotlightBlock(blockFor(h));
}

/** Glide a block into view and give it the feathered glow. */
export function spotlightBlock(block: HTMLElement): void {
  block.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "center" });
  glow?.remove();
  clearTimeout(glowTimer);
  cancelAnimationFrame(glowFollow);
  glow = document.createElement("div");
  glow.className = "maya-spotlight";
  glow.setAttribute("aria-hidden", "true");
  document.body.appendChild(glow);
  placeGlow(block);
  // Follow the block while the page settles (images loading, the smooth scroll), then let the glow fade.
  const until = Date.now() + 4200;
  const follow = () => {
    placeGlow(block);
    if (Date.now() < until) glowFollow = requestAnimationFrame(follow);
  };
  glowFollow = requestAnimationFrame(follow);
  const mine = glow;
  glowTimer = setTimeout(() => mine.remove(), 4300);
}

/** After an in-app page change the site scrolls to the top on its own; make sure the shown block stays in view. */
async function keepInView(h: HTMLElement) {
  for (const wait of [350, 700]) {
    await sleep(wait);
    const r = h.getBoundingClientRect();
    if (r.top < 0 || r.bottom > (window.innerHeight || 800)) spotlight(h);
  }
}

async function waitForHeading(text: string, ms = 2500): Promise<HTMLElement | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const h = findHeading(text);
    if (h) return h;
    await sleep(120);
  }
  return null;
}

export function goTo(deps: PresenterDeps, path: string): boolean {
  const here = normalizePath(deps.path());
  if (path === here) return false;
  deps.navigate()(path);
  window.scrollTo({ top: 0, behavior: "auto" });
  return true;
}

/** What is on screen now: page name plus the visible headings and their words, capped for a spoken summary. */
export function describeScreen(path: string): string {
  const name = mayaProductForPath(path) ?? "a page Maya does not cover";
  const vh = window.innerHeight || 800;
  const hs = headings();
  const visible = hs.filter((h) => {
    const r = h.getBoundingClientRect();
    return r.bottom > 0 && r.top < vh;
  });
  const pick = (visible.length ? visible : hs.slice(0, 1)).slice(0, 4);
  const parts = pick.map((h) => {
    const i = hs.indexOf(h);
    const r = document.createRange();
    r.setStartAfter(h);
    if (hs[i + 1]) r.setEndBefore(hs[i + 1]);
    else r.setEndAfter(h.closest("section") ?? h.parentElement ?? h);
    return `${clean(h.textContent)}: ${clean(r.toString()).slice(0, 220)}`;
  });
  return `They are on the ${name} page. On screen now: ${parts.join(" | ") || "the top of the page"}`.slice(0, 1100);
}

type P = Record<string, unknown> | undefined;

// The form card last given the spotlight, so a second fill_contact_form call does not glow it again.
let spottedForm: HTMLElement | null = null;
const PHONE_LINE = "(213) 641-0074";

/** The client tools both Maya surfaces register. Every one returns one sentence Maya can act on. */
export function presenterTools(deps: PresenterDeps) {
  return {
    navigate_site_page: async (params: P) => {
      const r = resolveSitePage(params?.page_path, window.location.hostname);
      if ("say" in r) return r.say;
      const moved = goTo(deps, r.path);
      if (r.hash) {
        if (moved) await sleep(450);
        const h = await waitForHeading(r.hash.replace(/-/g, " "), 1500);
        if (h) {
          spotlight(h);
          if (moved) void keepInView(h);
        }
      }
      deps.onShow?.(r.name);
      return moved || r.hash ? `Opened the ${r.name} page.` : `They are already on the ${r.name} page.`;
    },

    open_site_modal: async (params: P) => {
      const r = resolveSiteModal(params?.modal_type, deps.path());
      if (!r.ok) return r.say;
      goTo(deps, r.path);
      deps.onShow?.(mayaProductForPath(r.path) ?? r.path);
      return r.say;
    },

    show_section: async (params: P) => {
      const what = clean(String(params?.what ?? params?.query ?? "")).slice(0, 120);
      if (!what) return "Say what to show, for example the Bestly Cloud calculator or the HOKU science section.";
      // Something on this very page first: cheapest, and it covers sections newer than the site index.
      const local = findHeading(what);
      let hit: { path: string; name: string; heading: string; text: string } | null = null;
      try {
        hit = findSection(what, await loadSiteIndex(), deps.path());
      } catch {
        /* index unreachable: fall back to this page only */
      }
      if (!hit && local) {
        spotlight(local);
        deps.onShow?.(clean(local.textContent));
        return `Showing "${clean(local.textContent)}" on this page. ${describeScreen(deps.path())}`;
      }
      if (!hit) {
        return `Nothing on bestly.tech matches "${what}". Say plainly that it is not on the website, then offer what is, or a ticket for the team.`;
      }
      const moved = goTo(deps, hit.path);
      if (moved) await sleep(450); // let the page transition finish before looking
      const h = await waitForHeading(hit.heading);
      if (h) {
        spotlight(h);
        if (moved) void keepInView(h);
      }
      deps.onShow?.(hit.heading);
      return `Showing "${hit.heading}" on the ${hit.name} page. It says: ${hit.text.slice(0, 260)} Walk them through it in a sentence or two, then ask one question.`;
    },

    describe_screen: async () => describeScreen(deps.path()),

    // Drive the Bestly Cloud savings calculator like a person would, and read back exactly what it shows.
    cloud_calculator: async (params: P) => {
      const list = (v: unknown) => String(v ?? "").split(/,|;|\band\b/i).map((x) => x.trim()).filter(Boolean).slice(0, 20);
      const num = Number(String(params?.team_size ?? "").replace(/[^0-9.]/g, ""));
      const billing = String(params?.billing ?? "").toLowerCase();
      const plan = String(params?.plan ?? "").toLowerCase();
      const change: CalcChange = {
        teamSize: num > 0 ? num : undefined,
        only: params?.apps_paying_for ? list(params.apps_paying_for) : undefined,
        add: params?.add_apps ? list(params.add_apps) : undefined,
        remove: params?.remove_apps ? list(params.remove_apps) : undefined,
        billing: billing.startsWith("month") ? "monthly" : billing.startsWith("annual") || billing.startsWith("year") ? "annual" : undefined,
        plan: plan.startsWith("self") ? "selfhosted" : plan.startsWith("manag") ? "managed" : undefined,
      };
      const moved = goTo(deps, "/cloud");
      if (moved) await sleep(450);
      const calc = await getCalc(5000);
      if (!calc) return "The savings calculator didn't load. Describe the savings in general terms and offer a call instead.";
      const el = calc.element();
      if (el) spotlightBlock(el);
      const nothing = Object.values(change).every((v) => v == null);
      const r = nothing ? calc.read() : await calc.apply(change);
      if (el) spotlightBlock(el);
      deps.onShow?.("Bestly Cloud savings calculator");
      return `${r.say} Lead with the savings number in plain words, then ask the next thing you don't know yet (team size, the apps they pay for, or monthly vs annual billing). Never quote a number that is not in this result.`;
    },

    // Fill the contact form the visitor is looking at (Contact, or the Bestly Cloud get-started form), typing their
    // answers in live, and press Send only when asked to (after a clear yes).
    fill_contact_form: async (params: P) => {
      try {
        const str = (k: string) => {
          const v = params?.[k];
          return v == null ? undefined : clean(String(v));
        };
        const wantsSubmit = params?.submit === true || String(params?.submit ?? "").toLowerCase() === "true";
        const values: FormValues = {};
        for (const k of ["name", "email", "phone", "company", "team_size", "topic"] as const) {
          const v = str(k);
          if (v) values[k] = v;
        }
        // details keeps its line breaks and punctuation; only the ends are trimmed.
        if (params?.details != null && String(params.details).trim()) values.details = String(params.details).trim();

        // Which form: stay on the one they are already looking at; otherwise Bestly Cloud questions go to the
        // get-started form and everything else to the contact page.
        const here = normalizePath(deps.path());
        const target = here === "/contact" || here === "/get-started" ? here
          : mayaProductForPath(here) === "Bestly Cloud" || /cloud/i.test(String(values.topic ?? "")) ? "/get-started" : "/contact";
        const moved = goTo(deps, target);
        if (moved) await sleep(450);
        const api = await getForm(5000, target === "/get-started" ? "cloud-lead" : "contact");
        if (!api) {
          mayaDiag("form-fill", { msg: "form did not load", target });
          return `The form didn't load. Offer to try again, or to take it by phone at ${PHONE_LINE}.`;
        }
        const el = api.element();
        if (el && el !== spottedForm) {
          spottedForm = el;
          spotlightBlock(el);
        }
        deps.onShow?.("Filling in your details");

        let lead = "";
        let missing: string[] = [];
        if (Object.keys(values).length) {
          const r = await api.fill(values);
          lead = r.say;
          missing = r.missing;
        } else {
          const r = api.read();
          lead = r.say;
          missing = r.missing;
        }

        if (wantsSubmit) {
          const s = await api.submit();
          if (!s.ok && !/^Not sent yet/.test(s.say)) mayaDiag("form-fill", { msg: s.say.slice(0, 200), target });
          return s.ok
            ? `${s.say} Tell them what happens next, then ask if there is anything else.`
            : `${s.say} Say it plainly. If a field is missing, ask for it; if the site failed, offer to try again or ${PHONE_LINE}.`;
        }
        return missing.length
          ? `${lead} Ask for the missing ones one at a time. Never say it was sent: only a submit result that says Sent means that.`
          : `${lead} Read it back in plain words and only call again with submit true after a clear yes. Never say it was sent until a submit result says Sent.`;
      } catch (e) {
        mayaDiag("form-fill", { msg: String((e as Error)?.message ?? e).slice(0, 200) });
        return `The form didn't respond. Offer to try again, or to take it by phone at ${PHONE_LINE}.`;
      }
    },
  };
}
