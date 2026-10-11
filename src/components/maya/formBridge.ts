/**
 * Bridge between the website's contact forms and Maya (same pattern as cloud/calcBridge.ts).
 *
 * Jared, 2026-10-11: the form the visitor sees is the record. Maya types their answers into it live, reads it back,
 * and presses Send only after a clear yes. A page registers its form while it is mounted; Maya's fill_contact_form
 * tool (presenter.ts) waits for it and drives it.
 *
 * Pieces shared by both forms (Contact, GetStarted):
 *  - registerForm / getForm:   the page's FormApi, available while the form is on screen.
 *  - createFillGuard():        remembers what Maya typed vs. what the visitor typed, so Maya never overwrites the
 *                              visitor's own edit with a value she already sent.
 *  - runSteps():               types each value into its field the way a hand would (about 25 ms a character, caret
 *                              visible, feathered glow, scrolls into view). Reduce Motion fills instantly.
 *  - noteManualEdit():         the visitor edited by hand: announce FORM_CHANGED (debounced) so Maya keeps up.
 */
import "./maya-form.css";

export type FormFieldKey = "name" | "email" | "phone" | "company" | "team_size" | "topic" | "details";
export type FormValues = Partial<Record<FormFieldKey, string | number>>;

export type FormApi = {
  id: "contact" | "cloud-lead";
  fill(v: FormValues): Promise<{ say: string; missing: string[] }>;
  submit(): Promise<{ ok: boolean; say: string }>;
  read(): { say: string; missing: string[] };
  /** The form card, for the spotlight. */
  element(): HTMLElement | null;
};

let current: FormApi | null = null;
let waiting: ((a: FormApi) => void)[] = [];

export function registerForm(api: FormApi): () => void {
  current = api;
  const ws = waiting;
  waiting = [];
  ws.forEach((w) => w(api));
  return () => {
    if (current === api) current = null;
  };
}

/** The form if it is on screen now, or once it mounts (up to `ms`). Pass `id` to wait for one specific form. */
export function getForm(ms = 4000, id?: FormApi["id"]): Promise<FormApi | null> {
  if (current && (!id || current.id === id)) return Promise.resolve(current);
  return new Promise((resolve) => {
    const done = (a: FormApi | null) => {
      clearTimeout(t);
      waiting = waiting.filter((w) => w !== ok);
      resolve(a);
    };
    const ok = (a: FormApi) => {
      if (id && a.id !== id) {
        waiting.push(ok); // a different form mounted first (mid-navigation): keep waiting for ours
        return;
      }
      done(a);
    };
    const t = setTimeout(() => done(null), ms);
    waiting.push(ok);
  });
}

/** Debounced 1.2 s, manual edits only. detail = a sentence describing the form now. */
export const FORM_CHANGED = "maya:form-changed";

// The live Maya conversation id (set by the Maya screen), so a lead can be traced back to the call.
let conversationId: string | null = null;
export function setMayaConversationId(id: string | null | undefined) {
  conversationId = id ? String(id).slice(0, 80) : null;
}
export function getMayaConversationId(): string | null {
  return conversationId;
}

// ---------- shared helpers ----------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const reduceMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** True while Maya is typing, so a page's onChange can tell her keystrokes from the visitor's. */
let typing = false;
export const isMayaTyping = () => typing;

export type FillGuard = {
  /** Fields the visitor changed by hand since Maya last set them. */
  edited: Set<string>;
  /** What Maya last put in each field. */
  mine: Map<string, string>;
  /** Fills run one at a time. */
  queue: Promise<unknown>;
  announce: ReturnType<typeof setTimeout> | undefined;
};

export function createFillGuard(): FillGuard {
  return { edited: new Set(), mine: new Map(), queue: Promise.resolve(), announce: undefined };
}

/** Call from the page's onChange / onValueChange. Ignores Maya's own typing. */
export function noteManualEdit(guard: FillGuard, id: string, say: () => string) {
  if (typing) return;
  guard.edited.add(id);
  clearTimeout(guard.announce);
  guard.announce = setTimeout(() => {
    try {
      window.dispatchEvent(new CustomEvent(FORM_CHANGED, { detail: say() }));
    } catch {
      /* never let an announcement break the form */
    }
  }, 1200);
}

export type FillStep = {
  /** Key in the guard (the page's own field name). */
  id: string;
  /** Plain word Maya uses for it: "name", "email", "details". */
  label: string;
  el: () => HTMLElement | null;
  get: () => string;
  next: string;
  /** Text field typed key by key; false = a select that is set in one go. */
  text: boolean;
  apply?: (v: string) => void;
};

export type FillOutcome = { filled: string[]; replaced: string[]; kept: string[] };

function setNative(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function inView(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight || 800;
  return r.top >= 80 && r.bottom <= vh - 24;
}

function reveal(el: HTMLElement) {
  if (!inView(el)) el.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "center" });
}

let announcer: HTMLElement | null = null;
function announceToScreenReader(text: string) {
  if (typeof document === "undefined") return;
  if (!announcer || !announcer.isConnected) {
    announcer = document.createElement("div");
    announcer.setAttribute("role", "status");
    announcer.setAttribute("aria-live", "polite");
    announcer.className = "sr-only";
    document.body.appendChild(announcer);
  }
  announcer.textContent = text;
}

function mark(el: HTMLElement, state: "typing" | "done") {
  el.setAttribute("data-maya-fill", state);
}
function settle(el: HTMLElement) {
  mark(el, "done");
  window.setTimeout(() => {
    if (el.getAttribute("data-maya-fill") === "done") el.removeAttribute("data-maya-fill");
  }, 1800);
}

async function typeInto(el: HTMLInputElement | HTMLTextAreaElement, from: string, to: string, instant: boolean) {
  typing = true;
  try {
    let text = to;
    let base = from;
    if (!(from && to.startsWith(from))) {
      if (from) setNative(el, "");
      base = "";
    } else {
      text = to.slice(from.length);
    }
    if (instant) {
      setNative(el, base + text);
      return;
    }
    // About 25 ms a character; a long note types a few characters a tick so it never takes more than about 3 s.
    const per = Math.max(1, Math.ceil(text.length / 120));
    let out = base;
    for (let i = 0; i < text.length; i += per) {
      out += text.slice(i, i + per);
      setNative(el, out);
      try {
        el.setSelectionRange(out.length, out.length);
      } catch {
        /* email inputs have no selection */
      }
      if (el instanceof HTMLTextAreaElement) el.scrollTop = el.scrollHeight;
      await sleep(22 + Math.random() * 8);
    }
  } finally {
    typing = false;
  }
}

/**
 * Put each step's value into its field. Fills are serialized. A field the visitor changed after Maya's last fill is
 * left alone when Maya re-sends her old value; a different value from Maya replaces it (and `replaced` says so).
 */
export function runSteps(guard: FillGuard, steps: FillStep[]): Promise<FillOutcome> {
  const job = guard.queue.then(async (): Promise<FillOutcome> => {
    const out: FillOutcome = { filled: [], replaced: [], kept: [] };
    const reduce = reduceMotion();
    const t0 = Date.now();
    for (const s of steps) {
      const cur = s.get();
      if (cur === s.next) {
        guard.mine.set(s.id, s.next);
        continue;
      }
      const edited = guard.edited.has(s.id);
      if (edited && guard.mine.get(s.id) === s.next) {
        out.kept.push(s.label);
        continue;
      }
      if (edited && cur) out.replaced.push(s.label);
      out.filled.push(s.label);
      const el = s.el();
      // Past about 8 s the rest goes in at once, so one answer never outlasts the tool's 15 s limit.
      const instant = reduce || Date.now() - t0 > 8000;
      if (el) {
        if (!reduce) reveal(el);
        mark(el, "typing");
      }
      if (s.text && el instanceof HTMLElement && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
        if (!instant) {
          try {
            el.focus({ preventScroll: true });
          } catch {
            /* ignore */
          }
        }
        await typeInto(el, cur, s.next, instant);
      } else {
        if (!instant) await sleep(320);
        typing = true;
        try {
          s.apply?.(s.next);
        } finally {
          typing = false;
        }
        if (!instant) await sleep(120);
      }
      if (el) settle(el);
      guard.mine.set(s.id, s.next);
      guard.edited.delete(s.id);
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
      active.blur();
    }
    if (out.filled.length) announceToScreenReader(`Maya filled in: ${out.filled.join(", ")}.`);
    return out;
  });
  guard.queue = job.catch(() => undefined);
  return job;
}

// ---------- plain words for Maya ----------

/** A value the way it is said aloud: emails and phone numbers spelled out. */
export function spoken(key: FormFieldKey | string, value: string): string {
  const v = value.trim();
  if (key === "email") return v.replace(/@/g, " at ").replace(/\./g, " dot ");
  if (key === "phone") {
    const d = v.replace(/\D/g, "");
    const g = (s: string) => s.split("").join(" ");
    if (d.length === 10) return [g(d.slice(0, 3)), g(d.slice(3, 6)), g(d.slice(6))].join(", ");
    if (d.length === 11 && d[0] === "1") return ["1", g(d.slice(1, 4)), g(d.slice(4, 7)), g(d.slice(7))].join(", ");
    return v;
  }
  const flat = v.replace(/\s*\n+\s*/g, ". ").replace(/\.\s*\./g, ".");
  if (flat.length <= 160) return flat;
  const cut = flat.slice(0, 160);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 80)).trimEnd()} and more`;
}

export function describeForm(items: { label: string; value: string }[], missing: string[], optional: string[] = []): string {
  const have = items.filter((i) => i.value.trim());
  const parts: string[] = [];
  parts.push(have.length ? `On the form now: ${have.map((i) => `${i.label} ${spoken(i.label, i.value).replace(/[.;,\s]+$/, "")}`).join("; ")}.` : "The form is empty.");
  parts.push(missing.length ? `Still needed: ${missing.join(", ")}.` : "Every required field is filled in.");
  const opt = optional.filter((o) => !have.some((i) => i.label === o));
  if (opt.length) parts.push(`Optional: ${opt.join(", ")}.`);
  return parts.join(" ");
}

/** Words that mean the visitor is a business asking about a Bestly product (so the form files a sales lead). */
export const SALES_WORDS = /\b(agent|cloud|demo|pricing|price|quote|sales|book|trial|plan)\b/i;
