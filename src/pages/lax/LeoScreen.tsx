/**
 * Leo is the page (Jared, 2026-10-11): a full-screen conversation with Leo on the trip pages.
 *
 * - Voice and typing in one place. "Call Leo" starts a voice session; typing works during a call too. "Message Leo"
 *   and "Open Leo" start nothing until the guest types or taps the mic, so an open screen costs nothing.
 * - Leo's car actions come back as cards with real buttons (climate presets, lock, Superchargers, charging) plus a
 *   short toast. The cards use trip-voice {op:"act"} with the trip token: exactly the trip page's own rules and
 *   command path, so Leo, the cards and the page buttons can never disagree.
 * - show_card (Leo's client tool) brings up the key, controls or charging inline, or steps aside to the page's own
 *   pickup / return sheets while the call keeps going (Leo shrinks to a pill at the top).
 * - page_action (Leo's client tool) controls the whole page: open the pickup / return sheets, show the QR, the car
 *   controls, Supercharging or Help, run the Next Step, and on the demo pages switch the stage or weather. It goes to
 *   the page over leoBridge.ts; the page answers with one line Leo can say.
 * - The page follows the car: every car tool result is re-sent as `leo:car` (demo pages apply it to their pretend car,
 *   real trips refetch), and a car button tapped on the page comes back as `leo:page-did` so Leo stays in step.
 * - Sessions come from trip-voice {op:"session"} (signed URL + opaque trip_key); the trip token never reaches the
 *   voice platform. Any failure on a real device is reported to trip-voice {op:"diag"} -> leo_client_diag.
 * - Design: Apple HIG pass then UI UX Pro Max (house rules: 12-hour times, US units, number+unit never split, no
 *   truncation, feathered glows, 44 px targets, Reduce Motion respected).
 */
import { leoChips } from "./leoChips";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle, ArrowUp, Armchair, BatteryMedium, Check, ChevronDown, Flame, KeyRound, ListChecks, Loader2, Lock, LockOpen,
  MapPin, Mic, MicOff, Navigation, PhoneOff, Power, QrCode, ShieldAlert, Snowflake, Thermometer, X, Zap,
  Volume2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { TripContext } from "./AskSheet";
import { LeoMiniPill, LeoOrb, THEME, loadLeoSdk, takeLeoMode, type LeoMini, type LeoTheme } from "./LeoWidget";
import { leoOpening } from "./leoOffer";
import { audioLocked, audioState, playStreamPlayers, resumeAllAudio } from "@/lib/audioRescue";
import { track } from "./track";
import { MINIMIZE, askPage, emitLeoCar, useLeoDid } from "./leoBridge";
import { lockScroll } from "./TripSheet";
import { useDemoOpen } from "./demoState";

type Any = Record<string, unknown>;
type Card = Any & { type: string };
type Item =
  | { id: number; kind: "leo" | "you"; text: string }
  | { id: number; kind: "card"; card: Card }
  | { id: number; kind: "note"; text: string; tone?: "error" };
type NewItem = Item extends infer T ? (T extends Item ? Omit<T, "id"> : never) : never;
type Conv = Awaited<ReturnType<Awaited<ReturnType<typeof loadLeoSdk>>["Conversation"]["startSession"]>>;
type Phase = "idle" | "connecting" | "live" | "ended";

const nw = (s: ReactNode) => <span className="whitespace-nowrap">{s}</span>;
const money = (n: unknown) => `$${Number(n ?? 0).toFixed(2)}`;
const mi = (n: unknown) => (n == null ? "" : Number(n) < 10 ? Number(n).toFixed(1) : String(Math.round(Number(n))));
let seq = 1;

/** One fetch to trip-voice; reads the body on refusals too (supabase-js puts it on error.context). */
async function tv(body: Any): Promise<Any | null> {
  const res = await supabase.functions.invoke("trip-voice", { body });
  let r = res.data as Any | null;
  if (res.error && !r) { try { r = await (res.error as { context?: Response }).context?.json(); } catch { /* keep null */ } }
  return r;
}

function diag(token: string, kind: string, detail: Record<string, string>) {
  void supabase.functions.invoke("trip-voice", { body: { op: "diag", token, kind, detail } }).catch(() => {});
}

export function LeoScreen({ token, context, home, pageOpen = true, onEnd }: { token: string; context?: TripContext; home: boolean; pageOpen?: boolean; onEnd: () => void }) {
  const theme = THEME[home ? "home" : "lax"];
  const [mode] = useState(takeLeoMode);
  const opening = leoOpening({ ...context, tab: context?.stage ?? null });
  const greeting = opening.text;
  const [items, setItems] = useState<Item[]>([{ id: seq++, kind: "leo", text: greeting }]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [voice, setVoice] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [mini, setMini] = useState(false);
  // iPhone kept Leo's audio paused (no tap reached it): show a big "Tap to hear Leo" until it plays. See audioRescue.ts.
  const [locked, setLocked] = useState(false);
  const lockLogged = useRef(false);
  const [text, setText] = useState("");
  // Demo pages with "open demo" on: Leo may unlock the pretend car, so the controls card gets an Unlock button.
  const demoOpen = useDemoOpen().open;
  const unlockable = token.startsWith("demo-") && demoOpen;
  const conv = useRef<Conv | null>(null);
  const starting = useRef<Promise<Conv | null> | null>(null);
  const lastSent = useRef("");
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const toastTimer = useRef<number>();
  // The page's own sheet took over (pickup / return): step aside to the pill. Tapping the Leo bar again: back full.
  const firstOpen = useRef(true);
  useEffect(() => { if (firstOpen.current) { firstOpen.current = false; return; } setMini(!pageOpen); }, [pageOpen]);

  const push = useCallback((it: NewItem) => setItems((xs) => [...xs, { ...it, id: seq++ } as Item]), []);
  const flash = useCallback((t: string) => {
    setToast(t);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  // A tool result (from Leo or from a card button): card inline, toast on success.
  const showResult = useCallback((r: Any | null, replaceId?: number) => {
    if (!r) return;
    const card = r.card as Card | undefined;
    if (card) {
      if (replaceId) setItems((xs) => xs.map((x) => (x.id === replaceId ? { id: x.id, kind: "card", card } : x)));
      else push({ kind: "card", card });
    }
    if (r.toast && r.ok) flash(String(r.toast));
  }, [push, flash]);

  // ---- page hand-offs (show_card targets that live on the trip page itself) ----
  const toPage = useCallback((hash: "#pickup" | "#return") => {
    setMini(true);
    window.setTimeout(() => { window.location.hash = hash; }, 60);
  }, []);

  const act = useCallback(async (tool: string, args: Any = {}, replaceId?: number) => {
    const r = await tv({ op: "act", token, tool, args });
    if (!r) { flash("Couldn't reach the car. Try again."); return null; }
    if (r.ok === false && !r.card) flash(String(r.say ?? "That didn't work."));
    showResult(r, replaceId);
    if (tool.startsWith("car_")) emitLeoCar(r); // the trip page shows the same car state

    // Let Leo know what happened on screen, so the conversation stays in step.
    try { conv.current?.sendContextualUpdate(`The guest tapped a button on Leo's screen (${tool} ${JSON.stringify(args)}). Result: ${String(r.say ?? "")}`); } catch { /* not connected */ }
    return r;
  }, [token, flash, showResult]);

  const showCard = useCallback(async (card: string) => {
    switch (card) {
      case "controls": await act("car_status"); push({ kind: "card", card: { type: "controls" } }); return "Showing the climate and lock buttons on screen.";
      case "charging": await act("charging_summary"); return "Showing the Supercharging total on screen.";
      case "key": push({ kind: "card", card: { type: "key", state: context?.keyState ?? null, link: context?.keyLink ?? null } }); return "Showing their key on screen.";
      case "qr": {
        // The lobby door QR code, right in Leo's chat (Jared, 2026-10-11): the guest at the door shouldn't have to hunt for it.
        const q = context?.qr;
        if (!q) return "There's no lobby door QR code on this trip. Home pickups don't need one.";
        if (q.state === "done") return "The trip is over, so the lobby QR code isn't needed anymore.";
        if (q.state !== "ready" || !q.payload) return "The QR code isn't ready yet. It shows up here and on the trip page before pickup.";
        push({ kind: "card", card: { type: "qr", payload: q.payload, thru: q.thru ?? null } });
        return "Showing the lobby door QR code in the chat. Tell them to hold the phone up to the scanner by the lobby door, brightness up.";
      }
      case "guide": push({ kind: "card", card: { type: "page", which: "guide" } }); return "Showing a button for the pickup guide.";
      case "return": push({ kind: "card", card: { type: "page", which: "return" } }); return "Showing a button for the return checklist.";
      case "backup_unlock": push({ kind: "card", card: { type: "page", which: "unlock" } }); return "Showing a button for the trip page's backup unlock.";
    }
    return "That card isn't available.";
  }, [act, push, context?.keyState, context?.keyLink, context?.qr]);

  // page_action: Leo drives the trip page. The page does it (leoBridge) and says what happened; Leo steps aside to his pill
  // for anything that is on the page itself, and comes back for close_sheets.
  const pageAction = useCallback(async (p: Any) => {
    const action = String(p?.action ?? "").trim();
    const value = p?.value == null ? undefined : String(p.value).trim();
    if (!action) return "Which action? I need one, like open_pickup or show_qr.";
    if (action === "show_qr") return showCard("qr"); // the QR shows in the chat, not on the page
    const r = await askPage(action, value, action === "next_step" ? 20000 : 3000);
    if (!r.stay) {
      if (MINIMIZE.has(action)) {
        setMini(true);
        // Leo's full-screen dialog sits above the page's sheets: if it is still up a moment later, the guest can't see what the page did.
        await new Promise((res) => window.setTimeout(res, 250));
        if (document.querySelector('[role="dialog"][aria-label="Leo, your trip helper"]')) {
          setMini(true);
          if (!token.startsWith("demo-")) diag(token, "page_action", { msg: `${action}: Leo was still full screen over the page after stepping aside` });
        }
      } else if (action === "close_sheets") setMini(false);
    } else {
      // The page said it did not happen (or never answered): log it for the diagnostics table (real guests only, not the host's demo pages)
      // and, for the pickup / return sheets, leave a button on Leo's screen that does open them.
      if (!token.startsWith("demo-")) diag(token, "page_action", { msg: `${action}${value ? ` ${value}` : ""}: ${r.say}`.slice(0, 300) });
      if (r.card) push({ kind: "card", card: { type: "page", which: r.card } });
    }
    return r.say;
  }, [token, push, showCard]);

  // The guest tapped a car button on the trip page: tell Leo so he doesn't repeat or contradict it.
  useLeoDid(({ action, result }) => {
    try { conv.current?.sendContextualUpdate(`The guest tapped ${action} on the trip page. Result: ${result}`); } catch { /* not connected */ }
  });

  // ---- session ----
  const start = useCallback(async (withVoice: boolean): Promise<Conv | null> => {
    if (conv.current) return conv.current;
    if (starting.current) return starting.current;
    setPhase("connecting");
    starting.current = (async () => {
      try {
        const [{ Conversation }, s] = await Promise.all([loadLeoSdk(), tv({ op: "session", token })]);
        if (!s?.ok || !s.signed_url || !s.key) throw new Error(String(s?.error ?? "Leo didn't load. Try again in a minute, or message your host in the Turo app."));
        const history = items.filter((x) => x.kind === "leo" || x.kind === "you").slice(-6)
          .map((x) => `${x.kind === "you" ? "Guest" : "Leo"}: ${(x as { text: string }).text}`).join("\n");
        // If the phone holds the audio paused, setup waits here for a tap: offer one after a moment.
        const lockTimer = withVoice ? window.setTimeout(() => {
          if (!audioLocked()) return;
          setLocked(true);
          if (!lockLogged.current) { lockLogged.current = true; diag(token, "audio_locked", { msg: "voice setup waiting for a tap (iOS audio)" }); }
        }, 2500) : 0;
        const c = await Conversation.startSession({
          signedUrl: String(s.signed_url),
          textOnly: !withVoice,
          libsampleratePath: "/maya/libsamplerate.worklet.js",
          overrides: { agent: { firstMessage: items.length > 1 ? "I'm here. Go ahead." : greeting }, conversation: { textOnly: !withVoice } },
          dynamicVariables: { trip_key: String(s.key), call_mode: "page", caller_type: token.startsWith("demo-") ? "test_guest" : "guest",
            pickup_place: home ? "home" : "lax", trip_stage: context?.linkDown ? "link_down" : context?.stage ?? "unknown",
            guest_first_name: /^Hi (\S+), I'm Leo\./.exec(opening.text)?.[1] ?? "",
            minutes_to_pickup: opening.mtp ?? 9999, controls_state: context?.controlsState ?? "unknown", greeting_offer: opening.offer },
          clientTools: { show_card: async (p: Any) => showCard(String(p?.card ?? "")), page_action: async (p: Any) => pageAction(p) },
          onConnect: () => {
            setPhase("live");
            // Link-down page (2026-10-11): Leo can't see a trip here. Tell him why and what he may do.
            if (context?.linkDown) try { c.sendContextualUpdate(`This guest is on a trip link that no longer works (reason: ${context.linkDown}). You cannot see their trip, key or car from here. Help them: if they rebooked or changed the trip, they can sign in at bestly.tech/${home ? "turo-key" : "turo-lax"} with their phone number and last name to reach their current trip page. Otherwise take a message for the host with notify_host or file_ticket (ask for their name and best number).`); } catch { /* ignore */ }
            if (history && items.length > 1) try { c.sendContextualUpdate(`Earlier on this screen:\n${history}`); } catch { /* ignore */ }
          },
          onDisconnect: () => { conv.current = null; setPhase("ended"); setVoice(false); setSpeaking(false); setWorking(null); },
          onModeChange: ({ mode: m }: { mode: string }) => setSpeaking(m === "speaking"),
          onMessage: ({ message, role }: { message: string; role: string }) => {
            const t = String(message ?? "").replace(/\[[a-z ]+\]\s*/gi, "").trim();
            if (!t) return;
            if (role === "user") { if (t === lastSent.current) { lastSent.current = ""; return; } push({ kind: "you", text: t }); return; }
            setItems((xs) => (xs.length && xs[xs.length - 1].kind === "leo" && (xs[xs.length - 1] as { text: string }).text === t ? xs : [...xs, { id: seq++, kind: "leo", text: t }]));
          },
          onAgentToolRequest: (p: Any) => setWorking(labelFor(String((p as { tool_name?: string })?.tool_name ?? ""))),
          onAgentToolResponse: (p: Any) => {
            setWorking(null);
            const raw = (p as { full_tool_result?: string }).full_tool_result;
            if (!raw) return;
            try {
              const j = JSON.parse(raw);
              const res = ((j && typeof j === "object" && "card" in j) ? j : (j?.result ?? j)) as Any | null;
              showResult(res);
              // A car tool: the page behind Leo should show the same car (demo: pretend car, real: refetch).
              const ct = String(((res?.card ?? null) as Card | null)?.type ?? "");
              if (res && typeof res === "object" && (["climate", "lock", "unlock", "car"].includes(ct) || String((p as { tool_name?: string }).tool_name ?? "").startsWith("car_"))) emitLeoCar(res);
            } catch { /* not JSON */ }
          },
          onError: (msg: string) => { diag(token, "sdk", { msg: String(msg).slice(0, 300) }); },
        } as never) as Conv;
        window.clearTimeout(lockTimer);
        conv.current = c;
        setVoice(withVoice);
        if (withVoice) playStreamPlayers(); // mic is live now, so iOS lets Leo's player start (see audioRescue.ts)
        return c;
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        diag(token, "start", { msg: msg.slice(0, 300) });
        push({ kind: "note", tone: "error", text: /permission|denied|notallowed/i.test(msg)
          ? "Leo needs your microphone for a call. Allow it in your browser, or just type below."
          : msg.length < 160 ? msg : "Leo didn't load. Try again in a minute, or message your host in the Turo app." });
        setPhase("idle");
        return null;
      } finally { starting.current = null; }
    })();
    return starting.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, home, greeting, context?.stage, items, push, showCard, showResult, pageAction]);

  // During a voice call, keep checking that Leo can actually be heard. If the phone paused his audio, show the tap button.
  useEffect(() => {
    if (!voice || phase !== "live") return;
    let logged = false;
    const id = window.setInterval(() => {
      if (!audioLocked()) return;
      playStreamPlayers();
      setLocked(true);
      if (!logged && !lockLogged.current) { logged = true; lockLogged.current = true; const st = audioState(); diag(token, "audio_locked", { msg: `live call, Leo's audio paused (contexts ${st.contexts}; players ${st.players})` }); }
    }, 1000);
    return () => window.clearInterval(id);
  }, [voice, phase, token]);

  // Clear the tap prompt as soon as the audio is actually running (the page-wide tap listener resumes it).
  useEffect(() => {
    if (!locked) return;
    const id = window.setInterval(() => { if (!audioLocked()) setLocked(false); }, 400);
    return () => window.clearInterval(id);
  }, [locked]);

  const endCall = useCallback(async () => {
    const c = conv.current; conv.current = null;
    try { await c?.endSession(); } catch { /* already gone */ }
    setVoice(false); setSpeaking(false); setPhase("ended");
  }, []);

  const send = useCallback(async (raw?: string) => {
    const t = (raw ?? text).trim();
    if (!t) return;
    setText("");
    push({ kind: "you", text: t });
    lastSent.current = t;
    const c = conv.current ?? (await start(false));
    try { c?.sendUserMessage(t); } catch { push({ kind: "note", tone: "error", text: "That didn't send. Try again." }); }
  }, [text, push, start]);

  const toggleMic = useCallback(async () => {
    if (voice) { const m = !muted; setMuted(m); try { conv.current?.setMicMuted(m); } catch { /* ignore */ } return; }
    // Typing session running: restart as a voice call (the screen keeps the conversation; Leo gets a short recap).
    if (conv.current) { const c = conv.current; conv.current = null; try { await c.endSession(); } catch { /* ignore */ } }
    await start(true);
  }, [voice, muted, start]);

  // Open as asked: Call dials now; Message focuses the box; Open just shows Leo.
  useEffect(() => {
    track(token, "ask", { via: "leo-screen", mode });
    if (mode === "call") void start(true);
    if (mode === "chat") window.setTimeout(() => input.current?.focus(), 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Page chrome: the bar steps aside, the dock hides and the page stops scrolling while Leo is full screen.
  useEffect(() => {
    window.dispatchEvent(new Event("leo:ready"));
    return () => { window.dispatchEvent(new Event("leo:closed")); try { void conv.current?.endSession(); } catch { /* ignore */ } };
  }, []);
  useEffect(() => {
    if (mini) return;
    const unlock = lockScroll();
    document.body.classList.add("leo-open");
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMini(true); };
    window.addEventListener("keydown", onKey);
    return () => { unlock(); document.body.classList.remove("leo-open"); window.removeEventListener("keydown", onKey); };
  }, [mini]);
  // CSP blocks on a real device go to the diagnostics table.
  useEffect(() => {
    const f = (e: SecurityPolicyViolationEvent) => diag(token, "csp", { blocked: String(e.blockedURI), directive: e.effectiveDirective, source: `${e.sourceFile}:${e.lineNumber}` });
    document.addEventListener("securitypolicyviolation", f);
    return () => document.removeEventListener("securitypolicyviolation", f);
  }, [token]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }); }, [items, working]);

  const close = async () => { await endCall(); onEnd(); };
  const status = phase === "connecting" ? "Connecting" : phase === "live" ? (voice ? (speaking ? "Leo is talking" : muted ? "Muted" : "Listening") : "Chatting") : "24/7 trip helper";
  const chips = items.length === 1 ? leoChips(context, home) : [];

  // Minimized: Leo goes back to the dock where he lives (LeoBar shows the pill in its own spot) instead of a
  // pill at the top. LeoBar taps send leo:restore. Jared, 2026-10-11.
  const miniLabel = phase === "live" && voice ? status : "Tap to return";
  const miniLive = voice && speaking;
  useEffect(() => {
    window.dispatchEvent(new CustomEvent<LeoMini | null>("leo:mini", { detail: mini ? { label: miniLabel, live: miniLive } : null }));
  }, [mini, miniLabel, miniLive]);
  useEffect(() => {
    const restore = () => setMini(false);
    window.addEventListener("leo:restore", restore);
    return () => window.removeEventListener("leo:restore", restore);
  }, []);

  if (mini) {
    // The dock bar draws the pill; only pages without it get a floating one, still at the bottom.
    if (document.querySelector("[data-leo-bar]")) return null;
    return createPortal(<LeoMiniPill theme={theme} mini={{ label: miniLabel, live: miniLive }} floating />, document.body);
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Leo, your trip helper"
      className="fixed inset-0 z-[60] flex flex-col text-white motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-300"
      style={{ background: theme.base, height: "100dvh" }}>
      {/* soft glow behind the header, feathered so it never ends in an edge */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72"
        style={{ background: `radial-gradient(80% 100% at 50% 0%, ${theme.orb[0]}33, ${theme.orb[1]}14 45%, transparent 75%)` }} />

      <header className="relative mx-auto flex w-full max-w-md items-center gap-3 px-4 pb-2" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
        <LeoOrb theme={theme} size={44} live={voice && speaking} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[19px] font-semibold leading-tight tracking-[-0.01em]">Leo</h2>
          <p className="text-[14px] leading-snug" style={{ color: theme.subtle }} aria-live="polite">{status}</p>
        </div>
        <button type="button" onClick={() => setMini(true)} aria-label="Back to the trip page"
          className="grid h-11 w-11 place-items-center rounded-full bg-white/[0.08] ring-1 ring-white/15 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
          <ChevronDown className="h-5 w-5" aria-hidden />
        </button>
        <button type="button" onClick={close} aria-label="Close Leo"
          className="grid h-11 w-11 place-items-center rounded-full bg-white/[0.08] ring-1 ring-white/15 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
          <X className="h-5 w-5" aria-hidden />
        </button>
      </header>

      {toast && (
        <div role="status" aria-live="polite" className="pointer-events-none absolute inset-x-0 z-10 flex justify-center px-4"
          style={{ top: "calc(max(12px, env(safe-area-inset-top)) + 64px)" }}>
          <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[15px] font-semibold shadow-xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2"
            style={{ color: theme.onAccent }}>
            <Check className="h-4 w-4 shrink-0" style={{ color: "#1F9D55" }} aria-hidden />{toast}
          </span>
        </div>
      )}

      <div ref={list} className="relative flex-1 overflow-y-auto overscroll-contain"
        style={{ maskImage: "linear-gradient(to bottom, transparent 0, #000 20px, #000 calc(100% - 16px), transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 20px, #000 calc(100% - 16px), transparent 100%)" }}>
        <div className="mx-auto flex max-w-md flex-col gap-3 px-4 pb-5 pt-5" aria-live="polite">
          {items.map((it) => it.kind === "card"
            ? <CardView key={it.id} card={it.card} theme={theme} onAct={(tool, args) => act(tool, args, it.id)} onPage={toPage} unlockable={unlockable} />
            : it.kind === "note"
              ? <p key={it.id} role={it.tone === "error" ? "alert" : undefined} className="flex items-start gap-2 rounded-2xl bg-white/[0.06] px-4 py-3 text-[15px] leading-snug ring-1 ring-white/10">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: theme.error }} aria-hidden />{it.text}</p>
              : <Bubble key={it.id} you={it.kind === "you"} theme={theme}>{it.text}</Bubble>)}
          {working && (
            <p className="flex items-center gap-2 text-[15px]" style={{ color: theme.subtle }}>
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />{working}
            </p>
          )}
          {chips.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-2" aria-label="Suggestions">
              {chips.map((c) => (
                <button key={c} type="button" onClick={() => void send(c)}
                  className="min-h-[44px] rounded-full bg-white/[0.08] px-4 text-[15px] font-medium ring-1 ring-white/15 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">{c}</button>
              ))}
            </div>
          )}
          {phase === "ended" && (
            <p className="text-center text-[14px]" style={{ color: theme.subtle }}>Call ended. Type below or tap the mic to talk again.</p>
          )}
        </div>
      </div>

      <footer className="relative mx-auto w-full max-w-md px-4 pt-2" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
        {locked && (
          <button type="button" onClick={() => { resumeAllAudio(); window.setTimeout(() => { if (!audioLocked()) setLocked(false); }, 300); }}
            className="mb-2 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl text-[16px] font-bold shadow-lg shadow-black/25 active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            style={{ background: theme.accent, color: theme.onAccent }}>
            <Volume2 className="h-5 w-5" aria-hidden />Tap to hear Leo
          </button>
        )}
        {voice && phase === "live" && (
          <div className="mb-2 flex items-center gap-2 rounded-2xl bg-white/[0.06] p-2 pl-3 ring-1 ring-white/10">
            <span className="flex-1 text-[15px] font-medium">{speaking ? "Leo is talking" : muted ? "You're muted" : "Listening, go ahead"}</span>
            <button type="button" onClick={toggleMic} aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted}
              className="grid h-11 w-11 place-items-center rounded-full bg-white/[0.1] ring-1 ring-white/15 active:scale-95">
              {muted ? <MicOff className="h-5 w-5" aria-hidden /> : <Mic className="h-5 w-5" aria-hidden />}
            </button>
            <button type="button" onClick={endCall} aria-label="End call"
              className="flex h-11 items-center gap-1.5 rounded-full bg-[#E5484D] px-4 text-[15px] font-semibold active:scale-95">
              <PhoneOff className="h-4 w-4" aria-hidden />End
            </button>
          </div>
        )}
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          {!voice && (
            <button type="button" onClick={toggleMic} aria-label="Talk to Leo" disabled={phase === "connecting"}
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full ring-1 ring-white/20 active:scale-95 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
              style={{ background: theme.accent, color: theme.onAccent }}>
              {phase === "connecting" ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Mic className="h-5 w-5" aria-hidden />}
            </button>
          )}
          <label className="sr-only" htmlFor="leo-input">Message Leo</label>
          <textarea id="leo-input" ref={input} rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder="Message Leo"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            className="max-h-32 min-h-[48px] flex-1 resize-none rounded-3xl bg-white/[0.08] px-4 py-3 text-[16px] leading-snug text-white ring-1 ring-white/15 placeholder:text-white/50 focus:outline-none focus:ring-2"
            style={{ ["--tw-ring-color" as string]: theme.accent }} />
          <button type="submit" aria-label="Send" disabled={!text.trim()}
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-black active:scale-95 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
            <ArrowUp className="h-5 w-5" aria-hidden />
          </button>
        </form>
        <p className="mt-2 text-center text-[12px]" style={{ color: theme.subtle }}>Leo is an AI helper. For emergencies, call 911.</p>
      </footer>
    </div>, document.body);
}

function labelFor(tool: string): string {
  switch (tool) {
    case "car_climate": return "Sending that to the car";
    case "car_lock": return "Locking the car";
    case "car_status": return "Checking the car";
    case "find_superchargers": return "Finding Superchargers";
    case "send_to_car_nav": return "Sending it to the car";
    case "charging_summary": return "Adding up your charging";
    case "trip_status": return "Checking your trip";
    case "key_fix": case "job_status": return "Working on your key";
    case "page_action": return "Updating the page";
    default: return "Working on it";
  }
}

function Bubble({ you, theme, children }: { you: boolean; theme: LeoTheme; children: ReactNode }) {
  return (
    <p className={`max-w-[85%] whitespace-pre-wrap rounded-3xl px-4 py-2.5 text-[16px] leading-relaxed ${you ? "self-end rounded-br-md" : "self-start rounded-bl-md bg-white/[0.08]"}`}
      style={you ? { background: theme.accent, color: theme.onAccent } : undefined}>{children}</p>
  );
}

function Shell({ icon, title, demo, theme, children }: { icon: ReactNode; title: string; demo?: boolean; theme: LeoTheme; children: ReactNode }) {
  return (
    <section className="rounded-3xl bg-white/[0.06] p-4 ring-1 ring-white/[0.12] motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-200">
      <header className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-full" style={{ background: `${theme.accent}26`, color: theme.accent }}>{icon}</span>
        <h3 className="flex-1 text-[16px] font-semibold">{title}</h3>
        {demo && <span className="rounded-full bg-white/10 px-2.5 py-1 text-[12px] font-semibold" style={{ color: theme.subtle }}>Demo car</span>}
      </header>
      {children}
    </section>
  );
}

function Btn({ onClick, children, primary, theme, active, label }: { onClick: () => Promise<unknown> | void; children: ReactNode; primary?: boolean; theme: LeoTheme; active?: boolean; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" aria-label={label} aria-pressed={active ?? undefined} disabled={busy}
      onClick={async () => { setBusy(true); try { await onClick(); } finally { setBusy(false); } }}
      className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl px-3 text-[15px] font-semibold ring-1 transition-transform duration-100 active:scale-[0.97] disabled:opacity-70 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      style={primary || active ? { background: theme.accent, color: theme.onAccent, borderColor: "transparent", ["--tw-ring-color" as string]: "transparent" }
        : { background: "rgba(255,255,255,0.06)", color: "#fff", ["--tw-ring-color" as string]: "rgba(255,255,255,0.15)" }}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : children}
    </button>
  );
}

const PRESETS = [
  { id: "cool", label: "Cool", sub: "68°F", Icon: Snowflake },
  { id: "warm", label: "Warm", sub: "74°F", Icon: Flame },
  { id: "seat", label: "Seat heat", sub: "", Icon: Armchair },
  { id: "off", label: "Off", sub: "", Icon: Power },
] as const;

function ClimateButtons({ theme, current, onAct }: { theme: LeoTheme; current?: string | null; onAct: (tool: string, args?: Any) => Promise<unknown> }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {PRESETS.map(({ id, label, sub, Icon }) => (
        <Btn key={id} theme={theme} active={current === id} onClick={() => onAct("car_climate", { action: id })} label={`${label}${sub ? ` ${sub}` : ""}`}>
          <Icon className="h-4 w-4 shrink-0" aria-hidden />{nw(label)}{sub && <span className="whitespace-nowrap font-medium opacity-80">{sub}</span>}
        </Btn>
      ))}
    </div>
  );
}

function CardView({ card, theme, onAct, onPage, unlockable = false }: { card: Card; theme: LeoTheme; onAct: (tool: string, args?: Any) => Promise<unknown>; onPage: (h: "#pickup" | "#return") => void; unlockable?: boolean }) {
  const demo = !!card.demo;
  switch (card.type) {
    case "climate": {
      const on = !!card.on && card.mode !== "off";
      const mode = String(card.mode ?? "off");
      const head = !on ? "Climate is off" : mode === "cool" ? "A/C on, cooling to 68°F" : mode === "warm" ? "Heat on, warming to 74°F" : "Driver seat heater on";
      return (
        <Shell icon={<Thermometer className="h-4 w-4" aria-hidden />} title="Climate" demo={demo} theme={theme}>
          <p className="text-[20px] font-semibold leading-tight">{head}</p>
          <p className="mb-3 mt-1 text-[14px]" style={{ color: theme.subtle }}>
            {card.pending ? "Sent. The car can take up to a minute." : on && card.until ? <>Turns off by itself at {nw(String(card.until))}</> : on ? "Turns off by itself after 20 minutes" : "Pick a setting to start it"}
          </p>
          <ClimateButtons theme={theme} current={on ? mode : "off"} onAct={onAct} />
        </Shell>
      );
    }
    case "controls":
      return (
        <Shell icon={<Thermometer className="h-4 w-4" aria-hidden />} title="Car controls" theme={theme}>
          <ClimateButtons theme={theme} onAct={onAct} />
          <div className={`mt-2 grid gap-2 ${unlockable ? "grid-cols-2" : ""}`}>
            <Btn theme={theme} onClick={() => onAct("car_lock", { action: "lock" })}><Lock className="h-4 w-4" aria-hidden />{nw("Lock the car")}</Btn>
            {unlockable && <Btn theme={theme} onClick={() => onAct("car_lock", { action: "unlock" })}><LockOpen className="h-4 w-4" aria-hidden />{nw("Unlock")}</Btn>}
          </div>
        </Shell>
      );
    case "car": {
      const locked = card.locked as boolean | null;
      return (
        <Shell icon={<BatteryMedium className="h-4 w-4" aria-hidden />} title="Your car" demo={demo} theme={theme}>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat theme={theme} big={card.battery != null ? `${card.battery}%` : "--"} small={card.range_mi != null ? `${mi(card.range_mi)} mi` : ""} />
            <Stat theme={theme} big={card.inside_f != null ? `${card.inside_f}°F` : "--"} small="inside" />
            <Stat theme={theme} big={locked == null ? "--" : locked ? "Locked" : "Open"} small={card.outside_f != null ? `${card.outside_f}°F out` : ""} />
          </div>
          {locked === false && <div className="mt-3 grid"><Btn theme={theme} primary onClick={() => onAct("car_lock", { action: "lock" })}><Lock className="h-4 w-4" aria-hidden />Lock the car</Btn></div>}
          {locked === true && unlockable && <div className="mt-3 grid"><Btn theme={theme} onClick={() => onAct("car_lock", { action: "unlock" })}><LockOpen className="h-4 w-4" aria-hidden />Unlock the car</Btn></div>}
          {card.as_of && <p className="mt-3 text-[13px]" style={{ color: theme.subtle }}>As of {nw(String(card.as_of))}</p>}
        </Shell>
      );
    }
    case "lock":
    case "unlock": {
      const locked = card.type === "lock" && !!card.locked; // an "unlock" card is always unlocked
      return (
        <Shell icon={locked ? <Lock className="h-4 w-4" aria-hidden /> : <LockOpen className="h-4 w-4" aria-hidden />} title="Locks" demo={demo} theme={theme}>
          <p className="text-[20px] font-semibold">{card.pending ? (card.type === "unlock" ? "Unlocking now" : "Locking now") : locked ? "The car is locked" : "The car is unlocked"}</p>
          {unlockable && <div className="mt-3 grid"><Btn theme={theme} onClick={() => onAct("car_lock", { action: locked ? "unlock" : "lock" })}>{locked ? <LockOpen className="h-4 w-4" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}{locked ? "Unlock the car" : "Lock the car"}</Btn></div>}
        </Shell>
      );
    }
    case "superchargers": {
      const sites = (card.sites ?? []) as Any[];
      return (
        <Shell icon={<Zap className="h-4 w-4" aria-hidden />} title="Nearby Superchargers" demo={demo} theme={theme}>
          <ul className="flex flex-col gap-2">
            {sites.map((s) => (
              <li key={String(s.name)} className="flex items-center gap-3 rounded-2xl bg-white/[0.05] p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] font-semibold leading-snug">{String(s.name)}</p>
                  <p className="text-[14px]" style={{ color: theme.subtle }}>
                    {nw(`${mi(s.miles)} mi`)}{s.open != null && s.total != null && <> · {nw(`${s.open} of ${s.total} open`)}</>}
                  </p>
                </div>
                <Btn theme={theme} onClick={() => onAct("send_to_car_nav", { destination: `${s.name} Supercharger` })} label={`Send ${s.name} to the car`}>
                  <Navigation className="h-4 w-4" aria-hidden />{nw("Send")}
                </Btn>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px]" style={{ color: theme.subtle }}>Live prices show on the car's screen.</p>
        </Shell>
      );
    }
    case "nav":
      return (
        <Shell icon={<Navigation className="h-4 w-4" aria-hidden />} title="Navigation" demo={demo} theme={theme}>
          <p className="text-[18px] font-semibold leading-snug">{String(card.destination)}</p>
          <p className="mt-1 text-[14px]" style={{ color: theme.subtle }}>{card.pending ? "Sent. It shows on the car's screen in a moment." : "It's on the car's screen."}</p>
        </Shell>
      );
    case "charging": {
      const sessions = (card.sessions ?? []) as Any[];
      return (
        <Shell icon={<Zap className="h-4 w-4" aria-hidden />} title="Supercharging this trip" demo={demo} theme={theme}>
          <p className="text-[28px] font-semibold leading-none tracking-[-0.02em]">{money(card.total)}</p>
          <p className="mt-1.5 text-[14px]" style={{ color: theme.subtle }}>
            {nw(`${card.count ?? 0} ${Number(card.count) === 1 ? "stop" : "stops"}`)}{card.kwh ? <> · {nw(`${Number(card.kwh).toFixed(1)} kWh`)}</> : null}{card.final === false && Number(card.count) > 0 ? " · may still update" : ""}
          </p>
          {sessions.length > 0 && (
            <ul className="mt-3 divide-y divide-white/10">
              {sessions.map((x, i) => (
                <li key={i} className="flex items-baseline gap-3 py-2 text-[15px]">
                  <span className="min-w-0 flex-1">{String(x.site ?? "")}<span className="block text-[13px]" style={{ color: theme.subtle }}>{String(x.when ?? "")}</span></span>
                  <span className="whitespace-nowrap font-semibold">{x.cost != null ? money(x.cost) : ""}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[13px]" style={{ color: theme.subtle }}>Billed through Turo after your trip.</p>
        </Shell>
      );
    }
    case "key": {
      const st = String(card.state ?? "");
      const line = st === "ready" ? "Your key is ready. Tap below while signed in to the Tesla account you'll drive with."
        : st === "added" ? "Your key is in your Tesla app."
        : st === "problem" ? "Your key hit a snag. Ask Leo to send a fresh one."
        : "Your key shows up here once Jared has checked your license and readied the car.";
      return (
        <Shell icon={<KeyRound className="h-4 w-4" aria-hidden />} title="Your Tesla key" theme={theme}>
          <p className="mb-3 text-[16px] leading-snug">{line}</p>
          {st === "ready" && card.link
            ? <a href={String(card.link)} className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold" style={{ background: theme.accent, color: theme.onAccent }}>
                <KeyRound className="h-4 w-4" aria-hidden />Add the car to my Tesla app</a>
            : <div className="grid"><Btn theme={theme} onClick={() => onPage("#pickup")}><ListChecks className="h-4 w-4" aria-hidden />Open pickup steps</Btn></div>}
        </Shell>
      );
    }
    case "page": {
      const w = String(card.which);
      const meta = w === "return" ? { t: "Return checklist", d: "Everything to do before you drop it off.", icon: <ListChecks className="h-4 w-4" aria-hidden />, h: "#return" as const }
        : w === "unlock" ? { t: "Backup unlock", d: "Only if your phone key won't work at the car. It's on your pickup steps.", icon: <ShieldAlert className="h-4 w-4" aria-hidden />, h: "#pickup" as const }
        : { t: "Pickup guide", d: "The garage, the elevator, and where the car is.", icon: <MapPin className="h-4 w-4" aria-hidden />, h: "#pickup" as const };
      return (
        <Shell icon={meta.icon} title={meta.t} theme={theme}>
          <p className="mb-3 text-[15px] leading-snug" style={{ color: theme.subtle }}>{meta.d}</p>
          <div className="grid"><Btn theme={theme} primary onClick={() => onPage(meta.h)}>Show me</Btn></div>
          <p className="mt-2 text-[13px]" style={{ color: theme.subtle }}>Leo stays with you at the top of the screen.</p>
        </Shell>
      );
    }
    case "qr":
      return (
        <Shell icon={<QrCode className="h-4 w-4" aria-hidden />} title="Lobby door QR code" theme={theme}>
          <div className="rounded-3xl bg-white p-5 text-center text-[#1A1140]">
            <QRCodeSVG value={String(card.payload)} size={240} level="M" className="mx-auto h-auto w-full max-w-[240px]" />
            {card.thru ? <p className="mt-3 text-[13px] font-medium text-[#1A1140]/70">{nw(`Good through ${String(card.thru)}`)}</p> : null}
          </div>
          <p className="mt-3 text-[15px] leading-snug">Hold it up to the scanner by the lobby door. Turn your screen brightness up if it doesn't read.</p>
        </Shell>
      );
    case "notice":
      return (
        <Shell icon={<AlertCircle className="h-4 w-4" aria-hidden />} title="Good to know" theme={theme}>
          <p className="text-[16px] leading-snug">{String(card.text ?? "")}</p>
        </Shell>
      );
  }
  return null;
}

function Stat({ big, small, theme }: { big: string; small: string; theme: LeoTheme }) {
  return (
    <div className="rounded-2xl bg-white/[0.05] px-2 py-3">
      <p className="whitespace-nowrap text-[20px] font-semibold leading-none tracking-[-0.01em]">{big}</p>
      {small && <p className="mt-1.5 whitespace-nowrap text-[13px]" style={{ color: theme.subtle }}>{small}</p>}
    </div>
  );
}
