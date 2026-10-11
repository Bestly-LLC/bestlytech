/**
 * The bridge between Leo (LeoScreen) and the trip page he sits on. Plain window events, so neither side imports the other.
 *
 *   leo:page      Leo -> page   { action, value?, reply }  Leo's `page_action` tool. The page does it and calls reply().
 *   leo:car       Leo -> page   the result of a car tool (card climate / lock / unlock / car). Demo: apply it to the pretend
 *                               car. Real trip: refetch lax_guest_public so the car card updates right away.
 *   leo:page-did  page -> Leo   { action, result } the guest tapped a car button on the page; Leo is told so he stays in step.
 *
 * Pages use useLeoPage(handler) / useLeoCar(handler); LeoScreen uses askPage() / tellLeo-style listeners.
 */
import { useEffect, useRef } from "react";

export type PageAction =
  | "open_pickup" | "open_return" | "show_qr" | "show_car_controls" | "show_charging" | "show_help"
  | "next_step" | "close_sheets" | "demo_stage" | "demo_weather";
export const PAGE_ACTIONS: PageAction[] = ["open_pickup", "open_return", "show_qr", "show_car_controls", "show_charging", "show_help", "next_step", "close_sheets", "demo_stage", "demo_weather"];
/** Actions that leave the page in view: Leo steps aside to his pill (unless the page said it didn't happen). */
export const MINIMIZE: ReadonlySet<string> = new Set(["open_pickup", "open_return", "show_qr", "show_car_controls", "show_charging", "show_help", "next_step"]);

/** What the page says back: one plain sentence for Leo to say, and stay:true when nothing on the page moved. */
export type PageResult = { say: string; stay?: boolean };
export type PageReply = string | PageResult;
export type PageHandler = (action: string, value?: string) => PageReply | Promise<PageReply> | void;
export type LeoPageDetail = { action: string; value?: string; reply: (r: PageReply) => void };

const norm = (r: PageReply): PageResult => (typeof r === "string" ? { say: r } : r);

/** Leo asks the page to do something. Resolves with what the page said; "Done." if nobody answers within the timeout. */
export function askPage(action: string, value?: string, timeoutMs = 3000): Promise<PageResult> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: PageResult) => { if (done) return; done = true; window.clearTimeout(t); resolve(r); };
    const t = window.setTimeout(() => finish({ say: "Done." }), timeoutMs);
    window.dispatchEvent(new CustomEvent<LeoPageDetail>("leo:page", { detail: { action, value, reply: (r) => finish(norm(r)) } }));
  });
}

/** Page side: register once; the handler may be an inline function (the latest one is always used). Return nothing to ignore an action. */
export function useLeoPage(handler: PageHandler) {
  const ref = useRef(handler); ref.current = handler;
  useEffect(() => {
    const f = (e: Event) => {
      const d = (e as CustomEvent<LeoPageDetail>).detail;
      if (!d?.reply) return;
      let r: ReturnType<PageHandler>;
      try { r = ref.current(d.action, d.value); } catch (err) { d.reply({ say: `That didn't work: ${(err as Error)?.message ?? "error"}`, stay: true }); return; }
      if (r === undefined) return;
      void Promise.resolve(r).then((x) => { if (x !== undefined && x !== null) d.reply(x as PageReply); }, () => d.reply({ say: "That didn't work.", stay: true }));
    };
    window.addEventListener("leo:page", f);
    return () => window.removeEventListener("leo:page", f);
  }, []);
}

type Any = Record<string, unknown>;
/** Leo ran a car tool: its result object ({ ok, demo, card, ... }). */
export function emitLeoCar(result: Any) { window.dispatchEvent(new CustomEvent("leo:car", { detail: result })); }
export function useLeoCar(handler: (result: Any) => void) {
  const ref = useRef(handler); ref.current = handler;
  useEffect(() => {
    const f = (e: Event) => { const d = (e as CustomEvent<Any>).detail; if (d && typeof d === "object") ref.current(d); };
    window.addEventListener("leo:car", f);
    return () => window.removeEventListener("leo:car", f);
  }, []);
}

/** The guest tapped a car button on the page; one line so Leo can stay in step. */
export function tellLeo(action: string, result: string) { window.dispatchEvent(new CustomEvent("leo:page-did", { detail: { action, result } })); }
export function useLeoDid(handler: (d: { action: string; result: string }) => void) {
  const ref = useRef(handler); ref.current = handler;
  useEffect(() => {
    const f = (e: Event) => { const d = (e as CustomEvent<{ action: string; result: string }>).detail; if (d) ref.current(d); };
    window.addEventListener("leo:page-did", f);
    return () => window.removeEventListener("leo:page-did", f);
  }, []);
}

/** Bring a section on screen: opens a folded card, brings a carousel card forward, then scrolls. */
export function showSection(id: string, delay = 160): boolean {
  const exists = !!document.getElementById(id);
  window.dispatchEvent(new CustomEvent("open-section", { detail: id }));
  window.setTimeout(() => {
    const el = document.getElementById(id);
    const box = (el?.closest("[aria-roledescription=carousel]") as HTMLElement | null) ?? el;
    box?.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }, delay);
  return exists;
}

export type SharedCtx = {
  /** The page's own sheet setter ("ask" = Leo's sheet, which brings Leo back full screen). */
  openSheet: (t: "pickup" | "return" | "ask" | null) => void;
  /** LAX only: the lobby QR's state. Omit on the home page (no QR there). */
  qr?: "ready" | "soon" | "done";
  /** The page's Next Step card (null = none right now) and the page's own handler for its button. */
  next: { title: string; label?: string; action?: string } | null;
  doNext: (action: string) => void | Promise<void>;
  /** Is the climate / charging section on this page right now? */
  hasClimate: () => boolean;
  /** The "send" next step (nearest Supercharger to the car): runs it and says what happened; omit when the car buttons aren't live. */
  send?: () => Promise<string>;
};

const clean = (s: string) => s.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();

/** The page actions both trip pages do the same way. Returns undefined for actions it doesn't own (demo_*). */
export function sharedPageAction(action: string, c: SharedCtx): PageResult | Promise<PageResult> | undefined {
  switch (action) {
    case "open_pickup": c.openSheet("pickup"); return { say: "Opened the pickup steps on the page." };
    case "open_return": c.openSheet("return"); return { say: "Opened the return steps on the page." };
    case "close_sheets": c.openSheet("ask"); return { say: "Closed the sheet. Leo is back full screen." };
    case "show_qr": {
      if (!c.qr) return { say: "There's no QR code on this trip.", stay: true };
      if (c.qr === "done") return { say: "The QR code isn't needed anymore. The trip is over.", stay: true };
      c.openSheet(null);
      showSection("qr");
      return { say: c.qr === "ready" ? "Showing the QR code for the lobby door on the page." : "Showing where the QR code will appear. It isn't ready yet." };
    }
    case "show_car_controls": {
      if (!c.hasClimate()) return { say: "The car controls aren't on the page right now. Once the phone key is connected they use the Tesla app.", stay: true };
      c.openSheet(null);
      showSection("climate");
      return { say: "Showing the car card with the A/C buttons on the page." };
    }
    case "show_charging": {
      if (!document.getElementById("charging")) return { say: "There's no Supercharging on this trip yet.", stay: true };
      c.openSheet(null);
      showSection("charging");
      return { say: "Showing the Supercharging card on the page." };
    }
    case "show_help": {
      c.openSheet(null);
      showSection("help");
      return { say: "Showing Help and guides on the page." };
    }
    case "next_step": {
      if (!c.next) return { say: "There's no next step right now.", stay: true };
      const t = clean(c.next.title);
      const a = c.next.action;
      if (a === "pickup" || a === "return" || a === "climate" || a === "qr") {
        if (a === "pickup" || a === "return") c.openSheet(a); else c.openSheet(null);
        void c.doNext(a);
        return { say: `Next step is "${t}". I ${a === "pickup" ? "opened the pickup steps" : a === "return" ? "opened the return steps" : a === "qr" ? "brought up the QR code" : "scrolled to the car controls"}.` };
      }
      c.openSheet(null);
      if (a === "send" && c.send) {
        const run = c.send;
        return run().then((did) => ({ say: `Next step is "${t}". I ${did}` }), (e: Error) => ({ say: `Next step is "${t}". It didn't go through: ${e?.message || "the car didn't answer"}.`, stay: true }));
      }
      showSection("next-step");
      return { say: `Next step is "${t}". It's on the page${c.next.label ? ` as the "${clean(c.next.label)}" button` : ""}.` };
    }
  }
  return undefined;
}
