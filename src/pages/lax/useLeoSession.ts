/**
 * Leo's ElevenLabs session as one hook, shared by every screen that talks to him (Jared, 2026-10-12):
 *  - LeoScreen.tsx: the full-screen conversation on the LAX and Home trip pages.
 *  - DeliveryGuest.tsx: the delivery trip page, where Leo's orb IS the page (tap to talk in place, no sheet).
 * One copy of the session code, so a fix to audio, reconnects or diagnostics reaches both.
 *
 * What it owns: the transcript (`items`: Leo's lines, the guest's lines, cards, notes), the phase (idle, connecting,
 * live, ended), voice / muted / speaking, the "Leo is doing X" label, iPhone's paused-audio rescue, the client-side
 * diagnostics (SDK errors, CSP blocks), and `levels()` (Leo's and the mic's current volume, for an orb that reacts).
 * What stays with the screen: how it looks, cards and toasts (via `onToolResponse`), and Leo's client tools
 * (`clientTools`, e.g. show_card and page_action), because those act on the page the screen sits on.
 *
 * Sessions come from trip-voice {op:"session"}: a signed URL + an opaque trip_key. The trip token never reaches the
 * voice platform. Any failure on a real device goes to trip-voice {op:"diag"} -> leo_client_diag.
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadLeoSdk } from "./LeoWidget";
import { audioLocked, audioState, playStreamPlayers, resumeAllAudio } from "@/lib/audioRescue";
import { useLeoDid } from "./leoBridge";

export type Any = Record<string, unknown>;
export type Card = Any & { type: string };
export type Item =
  | { id: number; kind: "leo" | "you"; text: string }
  | { id: number; kind: "card"; card: Card }
  | { id: number; kind: "note"; text: string; tone?: "error" };
export type NewItem = Item extends infer T ? (T extends Item ? Omit<T, "id"> : never) : never;
export type Conv = Awaited<ReturnType<Awaited<ReturnType<typeof loadLeoSdk>>["Conversation"]["startSession"]>>;
export type Phase = "idle" | "connecting" | "live" | "ended";

let seq = 1;

/** One fetch to trip-voice; reads the body on refusals too (supabase-js puts it on error.context). */
export async function tv(body: Any): Promise<Any | null> {
  const res = await supabase.functions.invoke("trip-voice", { body });
  let r = res.data as Any | null;
  if (res.error && !r) { try { r = await (res.error as { context?: Response }).context?.json(); } catch { /* keep null */ } }
  return r;
}

export function diag(token: string, kind: string, detail: Record<string, string>) {
  void supabase.functions.invoke("trip-voice", { body: { op: "diag", token, kind, detail } }).catch(() => {});
}

/** What the screen shows while Leo's tool runs. */
export function labelFor(tool: string): string {
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
    case "delivery_info": return "Passing that to Jared";
    default: return "Working on it";
  }
}

/** What a screen can do to the session from inside its own callbacks. */
export type LeoApi = {
  push: (it: NewItem) => void;
  conv: MutableRefObject<Conv | null>;
  /** The transcript as of right now (not as of the last render). */
  items: MutableRefObject<Item[]>;
};

export type LeoSessionOpts = {
  token: string;
  /** Leo's opening line, also the first item of the transcript. */
  greeting: string;
  /** Dynamic variables for the agent beyond trip_key / call_mode / caller_type. Read when the session connects. */
  variables: () => Record<string, string | number | boolean>;
  /** Leo's client tools (show_card, page_action ...): they act on the page, so the screen supplies them. Read when the session starts. */
  clientTools: (api: LeoApi) => Record<string, (p: Any) => Promise<string> | string>;
  /** A tool Leo ran finished. `res` is its parsed result (or null if it wasn't JSON). */
  onToolResponse?: (res: Any | null, tool: string, api: LeoApi) => void;
  /** The session connected. `c` is the live conversation. */
  onConnect?: (c: Conv, api: LeoApi) => void;
};

export function useLeoSession(opts: LeoSessionOpts) {
  const o = useRef(opts); o.current = opts;
  const { token } = opts;
  const [items, setItemsState] = useState<Item[]>(() => [{ id: seq++, kind: "leo", text: opts.greeting }]);
  const itemsRef = useRef<Item[]>(items); itemsRef.current = items;
  const [phase, setPhase] = useState<Phase>("idle");
  const [voice, setVoice] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  // iPhone kept Leo's audio paused (no tap reached it): show a big "Tap to hear Leo" until it plays. See audioRescue.ts.
  const [locked, setLocked] = useState(false);
  const lockLogged = useRef(false);
  const conv = useRef<Conv | null>(null);
  const starting = useRef<Promise<Conv | null> | null>(null);
  const lastSent = useRef("");

  const setItems = useCallback((f: (xs: Item[]) => Item[]) => setItemsState((xs) => { const n = f(xs); itemsRef.current = n; return n; }), []);
  const push = useCallback((it: NewItem) => setItems((xs) => [...xs, { ...it, id: seq++ } as Item]), [setItems]);
  const api = useRef<LeoApi>({ push, conv, items: itemsRef }).current;

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
        const startItems = itemsRef.current;
        const history = startItems.filter((x) => x.kind === "leo" || x.kind === "you").slice(-6)
          .map((x) => `${x.kind === "you" ? "Guest" : "Leo"}: ${(x as { text: string }).text}`).join("\n");
        // If the phone holds the audio paused, setup waits here for a tap: offer one after a moment.
        const lockTimer = withVoice ? window.setTimeout(() => {
          if (!audioLocked()) return;
          setLocked(true);
          if (!lockLogged.current) { lockLogged.current = true; diag(token, "audio_locked", { msg: "voice setup waiting for a tap (iOS audio)" }); }
        }, 2500) : 0;
        const greeting = o.current.greeting;
        // The SDK calls onConnect BEFORE startSession() resolves, so the conversation doesn't exist yet at that moment.
        // Referencing `c` there is a TDZ error ("Cannot access 'H' before initialization" once minified), which made every
        // Leo session fail on the production build. onConnect waits for this promise instead.
        let gotConv: (c: Conv) => void = () => {};
        const convReady = new Promise<Conv>((res) => { gotConv = res; });
        const c = await Conversation.startSession({
          signedUrl: String(s.signed_url),
          textOnly: !withVoice,
          libsampleratePath: "/maya/libsamplerate.worklet.js",
          overrides: { agent: { firstMessage: startItems.length > 1 ? "I'm here. Calls are recorded. Go ahead." : greeting }, conversation: { textOnly: !withVoice } },
          dynamicVariables: { trip_key: String(s.key), call_mode: "page", caller_type: token.startsWith("demo-") ? "test_guest" : "guest", ...o.current.variables() },
          clientTools: o.current.clientTools(api),
          onConnect: () => {
            setPhase("live");
            void convReady.then((live) => {
              try { o.current.onConnect?.(live, api); } catch { /* a screen's hook must never break the session */ }
              if (history && startItems.length > 1) try { live.sendContextualUpdate(`Earlier on this screen:\n${history}`); } catch { /* ignore */ }
            });
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
              o.current.onToolResponse?.(res, String((p as { tool_name?: string }).tool_name ?? ""), api);
            } catch { /* not JSON */ }
          },
          onError: (msg: string) => { diag(token, "sdk", { msg: String(msg).slice(0, 300) }); },
        } as never) as Conv;
        window.clearTimeout(lockTimer);
        conv.current = c;
        gotConv(c);
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
  }, [token, push, setItems, api]);

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

  /** The "Tap to hear Leo" button: resume the phone's audio and drop the prompt once it plays. */
  const unlockAudio = useCallback(() => {
    resumeAllAudio();
    window.setTimeout(() => { if (!audioLocked()) setLocked(false); }, 300);
  }, []);

  const endCall = useCallback(async () => {
    const c = conv.current; conv.current = null;
    try { await c?.endSession(); } catch { /* already gone */ }
    setVoice(false); setSpeaking(false); setPhase("ended");
  }, []);

  /** Add the guest's line, then send it. Starts a typing session if none is running. */
  const send = useCallback(async (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    push({ kind: "you", text: t });
    lastSent.current = t;
    const c = conv.current ?? (await start(false));
    try { c?.sendUserMessage(t); } catch { push({ kind: "note", tone: "error", text: "That didn't send. Try again." }); }
  }, [push, start]);

  const toggleMic = useCallback(async () => {
    if (voice) { const m = !muted; setMuted(m); try { conv.current?.setMicMuted(m); } catch { /* ignore */ } return; }
    // Typing session running: restart as a voice call (the screen keeps the conversation; Leo gets a short recap).
    if (conv.current) { const c = conv.current; conv.current = null; try { await c.endSession(); } catch { /* ignore */ } }
    await start(true);
  }, [voice, muted, start]);

  // CSP blocks on a real device go to the diagnostics table.
  useEffect(() => {
    const f = (e: SecurityPolicyViolationEvent) => diag(token, "csp", { blocked: String(e.blockedURI), directive: e.effectiveDirective, source: `${e.sourceFile}:${e.lineNumber}` });
    document.addEventListener("securitypolicyviolation", f);
    return () => document.removeEventListener("securitypolicyviolation", f);
  }, [token]);

  // Leaving the screen hangs up.
  useEffect(() => () => { try { void conv.current?.endSession(); } catch { /* ignore */ } }, []);

  /** Leo's voice and the guest's mic, 0 to 1, right now. Cheap: call it from an animation frame. */
  const levels = useCallback((): { out: number; in: number } => {
    const c = conv.current;
    if (!c) return { out: 0, in: 0 };
    try { return { out: c.getOutputVolume?.() ?? 0, in: c.getInputVolume?.() ?? 0 }; } catch { return { out: 0, in: 0 }; }
  }, []);

  return { items, setItems, push, phase, voice, speaking, muted, working, locked, unlockAudio, conv, start, send, endCall, toggleMic, levels };
}
