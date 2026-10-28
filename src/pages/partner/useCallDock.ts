/**
 * The Bestly call window inside the partner portal (2026-10-27).
 *
 * BestlyDock is the same plain-JS call window Studio uses (public/partner/bestly-dock.js, copied verbatim from
 * Studio build 11bd2f83; re-copy that block to re-sync). It appends #bdock to <body>, so it sits beside React
 * and survives every tab change. This file is the host wiring Studio has (scPoll / scPaint / scJoin / init):
 *   - tickets, call state and Messages come from the partner-call edge function (the partner's own session; the
 *     room is the one in his partners.call_url, never taken from the page),
 *   - Eli joins with a one-minute ticket, Jared with his own Nextcloud session (no ticket),
 *   - Pop out opens /partner/callwin; the two windows talk over BroadcastChannel("bestly-call").
 * Failures go to Scout (reportToScout), never to the partner.
 */
import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { reportToScout } from "@/lib/reportToScout";

const V = "f1087b3f";
const NBS = " ";
type Dock = Record<string, any>;
const dock = (): Dock | undefined => (window as unknown as { BestlyDock?: Dock }).BestlyDock;
const asRoster = () => new URLSearchParams(window.location.search).get("as")?.toLowerCase() || undefined;

type Sc = { live: boolean; minutes: number | null; started_at: string | null; people: { name: string }[]; room: string; joined: boolean; connecting: boolean; failed: boolean; ready: boolean; gone: boolean; isJared: boolean; callUrl: string };
let SC: Sc = { live: false, minutes: null, started_at: null, people: [], room: "", joined: false, connecting: false, failed: false, ready: false, gone: false, isJared: false, callUrl: "" };
let snap = 0;
const subs = new Set<() => void>();
const emit = () => { snap++; subs.forEach((f) => f()); };
const set = (p: Partial<Sc>) => { SC = { ...SC, ...p }; emit(); };

export const roomOf = (url?: string | null) => /\/call\/([A-Za-z0-9]{4,32})/.exec(url ?? "")?.[1] ?? "";

/** One call to partner-call. Never throws; a refusal comes back as { ok: false, error }. */
async function pc(action: string, extra: Record<string, unknown> = {}): Promise<any> {
  try {
    const { data, error } = await supabase.functions.invoke("partner-call", { body: { action, as: asRoster(), ...extra } });
    if (error) {
      try { const j = await (error as unknown as { context?: Response }).context?.json?.(); if (j) return j; } catch { /* no body */ }
      return { ok: false, error: error.message };
    }
    return data;
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

let loading: Promise<boolean> | null = null;
function loadDock(): Promise<boolean> {
  if (dock()) return Promise.resolve(true);
  if (loading) return loading;
  loading = new Promise<boolean>((resolve) => {
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = `/partner/bestly-dock.css?v=${V}`;
    const l2 = document.createElement("link");
    l2.rel = "stylesheet"; l2.href = `/partner/bestly-dock.portal.css?v=${V}`;
    document.head.append(l, l2);
    const s = document.createElement("script");
    s.src = `/partner/bestly-dock.js?v=${V}`; s.async = true;
    s.onload = () => resolve(!!dock());
    s.onerror = () => { loading = null; reportToScout("call.dock_load", "bestly-dock.js did not load"); resolve(false); };
    document.head.append(s);
  });
  return loading;
}

const scNames = () => SC.people.map((p) => String(p.name || "").trim().split(/\s+/)[0]).filter((n) => n && n.toLowerCase() !== (SC.isJared ? "jared" : "eli")).join(" and ");
const other = () => (SC.isJared ? "Eli" : "Jared");

let initDone = false;
function initDock() {
  const D = dock();
  if (initDone || !D) return;
  initDone = true;
  D.init({
    title: SC.isJared ? "Call with Eli" : "Call with Jared", defaultSpot: "tr", canStart: true,
    /* Jared uses his own Nextcloud session in the frame; if there is none, he can sign in once */
    cloudLogin: () => (SC.isJared ? "https://cloud.bestly.tech/login" : ""),
    ticket: async () => {
      if (SC.isJared) {
        const room = roomOf(SC.callUrl) || SC.room;
        if (!room) throw new Error("no_room");
        return { url: `https://cloud.bestly.tech/call/${encodeURIComponent(room)}?embed=1` };
      }
      const j = await pc("call_ticket");
      if (!j || !j.ok || !j.url) throw new Error((j && j.error) || "no_ticket");
      return j;
    },
    chat: {
      list: (after?: number, wait?: boolean) => pc("chat_list", { ...(after ? { after_id: after } : {}), ...(wait ? { wait: true } : {}) }),
      send: (text: string) => pc("chat_send", { text }),
      seen: (id: number) => pc("chat_seen", { last_id: id }),
    },
    names: scNames,
    me: () => ({ key: null, name: SC.isJared ? "Jared" : "Eli" }),
    face: () => null,
    getCall: () => SC,
    /* the dock now leaves a trace of every Pop out (which build ran, where it got stuck); only real failures go to Scout */
    fault: (code: string, detail: string) => { if (/^(win_boot|win_phase|win_tonc|pop_open|pop_msg)$/.test(String(code))) return; reportToScout(`call.${String(code).slice(0, 40)}`, String(detail || "dock")); },
    winFail: { title: "This window isn't connecting.", body: "Opening your call in Nextcloud instead.", back: "Back to the portal", nc: "Open in Nextcloud now" },
    toast: (msg: string) => { toast(msg); },
    backWord: "Back to the portal",
    winKind: "partner",
    winUrl: () => `${location.origin}/partner/callwin${location.search}`,
    waitFor: other,
    prewarm: () => true,
    topInset: () => 0,
    bottomInset: () => {
      const n = document.querySelector<HTMLElement>('nav[aria-label="Portal"]');
      return n && getComputedStyle(n).position === "fixed" && n.offsetHeight ? n.offsetHeight : 0;
    },
    onConnect: (c: boolean) => set({ connecting: !!c }),
    onFail: (f: boolean) => set({ failed: !!f }),
    onChange: (joined: boolean) => {
      set({ joined: !!joined, ...(joined ? {} : { connecting: false, live: SC.live && SC.people.length > 0 }) });
      void poll(); if (joined) { setTimeout(poll, 5000); setTimeout(poll, 15000); }
    },
  });
  // the dock names the pop-out card and its dialog "Strategy call" (Studio's word): this portal's call has its own name
  try {
    const t = SC.isJared ? "Call with Eli" : "Call with Jared", r = document.getElementById("bdock");
    r?.setAttribute("aria-label", t);
    const b = r?.querySelector(".bd-pbt b"); if (b) b.textContent = t;
  } catch { /* cosmetic */ }
  set({ ready: true });
}

async function poll() {
  if (document.hidden || SC.gone || !dock()) return;
  const j = await pc("call_state");
  if (!j) return;
  if (j.ok === false) {
    if (/^(forbidden|no_room|no_seat|unauthorized)$/i.test(String(j.error))) set({ gone: true });
    return;
  }
  const D = dock();
  set({ live: !!j.live, minutes: j.minutes ?? null, started_at: j.started_at ?? null, room: j.room || SC.room, people: (j.people || []).filter((p: { name: string }) => !(D && D.isScout && D.isScout(p))) });
}

let timers = false;
function startTimers() {
  if (timers) return;
  timers = true;
  setInterval(poll, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void poll(); });
}

export type CallUi = {
  /** the call window can be used on this page */
  enabled: boolean;
  /** "idle" nobody in, "live" someone is in, "joining" the lobby, "on" you are in */
  state: "idle" | "live" | "joining" | "on";
  /** button wording, number and unit never split (non-breaking space) */
  text: string | null;
  aria: string;
  open: () => void;
};

function view(): CallUi {
  const D = dock();
  const joined = SC.joined && !SC.failed;
  const idle = !SC.live && !joined;
  let mins = SC.minutes;
  if (SC.started_at) { const m = Math.floor((Date.now() - new Date(SC.started_at).getTime()) / 60000); if (isFinite(m) && m >= 0) mins = m; }
  const mw = mins != null && D?.minShort ? ` · ${D.minShort(Math.max(0, mins))}` : "";
  const conn = joined && SC.connecting;
  const state: CallUi["state"] = conn ? "joining" : joined ? "on" : idle ? "idle" : "live";
  const text = conn ? "In the lobby" : joined ? `On the call${mw}` : idle ? null : `Join the call${mw}`;
  const who = scNames();
  const aria = conn ? "In the lobby. Show the call window." : joined ? "You are on the call. Show the call window." : idle ? "Start the call. Nobody is in it yet." : `Join the call${who ? " with " + who : ""}`;
  return { enabled: SC.ready && !SC.gone, state, text: text ? text.replace(/ (\d+) (min)/g, `${NBS}$1${NBS}$2`) : null, aria, open };
}

function open() {
  const D = dock();
  if (!D) { toast("The call window is not ready yet. Please try again in a moment."); return; }
  if (SC.joined) { D.show(); return; }
  D.open();
}

let cached: { n: number; v: CallUi } | null = null;
const getSnap = () => { if (!cached || cached.n !== snap) cached = { n: snap, v: view() }; return cached.v; };
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** Starts the call window for this page and tells the buttons what to say. */
export function useCallDock(o: { on: boolean; isJared: boolean; callUrl: string | null | undefined }): CallUi {
  const { on, isJared, callUrl } = o;
  useEffect(() => {
    if (!on) return;
    set({ isJared, callUrl: callUrl ?? "", room: roomOf(callUrl) || SC.room });
    let alive = true;
    void loadDock().then((ok) => { if (!alive || !ok) return; initDock(); startTimers(); void poll(); });
    return () => { alive = false; };
  }, [on, isJared, callUrl]);
  return useSyncExternalStore(sub, getSnap, getSnap);
}

/** The minutes label keeps counting while the page is open. */
setInterval(() => { if (SC.started_at && !document.hidden) emit(); }, 30000);

/** /partner/callwin: only the call, filling this window, joined at once with the mic and camera the other window had. */
export function openCallWindow(o: { isJared: boolean; callUrl: string | null | undefined }, q: URLSearchParams) {
  set({ isJared: o.isJared, callUrl: o.callUrl ?? "", room: roomOf(o.callUrl) });
  return loadDock().then((ok) => {
    if (!ok) return false;
    initDock();
    const t0 = Date.now();
    const t = setInterval(() => {
      const D = dock();
      if (Date.now() - t0 > 600000) { clearInterval(t); return; }
      if (D && D.ready) {
        clearInterval(t);
        D.openWin({ mic: q.get("m") !== "0", cam: q.get("c") !== "0" });
        try { document.title = o.isJared ? "Call with Eli" : "Call with Jared"; } catch { /* none */ }
      }
    }, 300);
    return true;
  });
}
