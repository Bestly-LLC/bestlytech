/**
 * Maya, Leo-style (Jared, 2026-10-11: "show an example of the Leo style screen but for Maya").
 *
 * Our own screen on the ElevenLabs SDK instead of their widget, built for presenting the site:
 * - A glass panel docked beside the page on desktop (the page slides over to make room, so nothing she shows hides
 *   under her) and a bottom sheet on phones. No scrim: the site stays live and scrollable, because the site is the
 *   presentation.
 * - Voice and typing in one place. Opening the panel starts nothing; a session begins on the first message or the mic.
 * - Her client tools come from presenter.ts (show_section, describe_screen, navigate_site_page, open_site_modal,
 *   cloud_calculator, fill_contact_form, agent_pricing, agent_checkout, agent_setup).
 *   When she shows something, a "Showing" strip names it with a Show again button; on phones the sheet tucks into a
 *   pill so the page is visible, and the pill brings her back.
 * - Sessions come from maya-session (signed URL; her agent is private). Worklets are self-hosted under /maya, so the
 *   page CSP needs no blob:. Failures on real devices go to maya-session {op:"diag"}.
 * - The default on bestly.tech since 2026-10-11 (Jared). ?maya=widget falls back to the old ElevenLabs embed for that tab.
 * - Design: Apple HIG pass then UI UX Pro Max (house rules: 12-hour times, US units, number+unit never split, no
 *   truncation, feathered glows, 44 px targets, Reduce Motion and Reduce Transparency respected).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowUp, ChevronDown, Loader2, Mic, MicOff, PhoneOff, Presentation, Sparkles, X } from "lucide-react";
import { mayaProductForPath, normalizePath } from "./siteTools";
import { findHeading, presenterTools, spotlight } from "./presenter";
import { getMayaSession, mayaDiag } from "./mayaSession";
import { CALC_CHANGED } from "@/components/cloud/calcBridge";
import { PLAN_CHANGED } from "@/components/agentDemo/planBridge";
import { FORM_CHANGED, setMayaConversationId } from "./formBridge";

type Any = Record<string, unknown>;
type Item = { id: number; kind: "maya" | "you"; text: string } | { id: number; kind: "note"; text: string };
type Phase = "idle" | "connecting" | "live" | "ended";
type Sdk = typeof import("@elevenlabs/client");
type Conv = Awaited<ReturnType<Sdk["Conversation"]["startSession"]>>;

const PHONE_DISPLAY = "(213) 641-0074";
const PHONE_TEL = "tel:+12136410074";
let seq = 1;
let sdk: Promise<Sdk> | null = null;
export const loadMayaSdk = () => (sdk ??= import("@elevenlabs/client").catch((e) => { sdk = null; throw e; }));

const nw = (s: ReactNode) => <span className="whitespace-nowrap">{s}</span>;

function greetingFor(product: string | null): string {
  const hi = "Hi, I'm Maya, Bestly's AI guide. I can answer questions and show you around the site while we talk.";
  if (!product || /home page|products|contact/i.test(product)) return `${hi} What brings you here?`;
  return `${hi} Want a quick tour of ${product}, or do you have a question?`;
}

function chipsFor(path: string): string[] {
  const p = normalizePath(path);
  if (p === "/cloud" || p === "/in-house-cloud" || p === "/get-started") return ["Show me the savings calculator", "How does the box work?", "What if the server breaks?"];
  if (p === "/about") return ["Who is Jared?", "What does Bestly make?", "How do you handle my data?"];
  if (p === "/hoku") return ["Show me the science", "When does HOKU launch?", "What makes it different?"];
  if (p === "/cookie-yeti") return ["How does Cookie Yeti work?", "Show me pricing", "Is it on Safari?"];
  if (p === "/agent") return ["What does it cost?", "Which plan is right for me?", "Show me a demo call"];
  if (p === "/agent/welcome") return ["Help me fill in the setup", "What happens after I send it?", "Which apps can you connect?"];
  return ["Give me a quick tour", "Who's behind Bestly?", "Show me the cloud savings calculator"];
}

function labelFor(tool: string): string {
  switch (tool) {
    case "show_section": return "Finding that on the site";
    case "navigate_site_page": case "open_site_modal": return "Opening the page";
    case "describe_screen": return "Looking at your screen";
    case "cloud_calculator": return "Running your numbers";
    case "fill_contact_form": case "agent_checkout": return "Filling in your details";
    case "agent_pricing": return "Running your numbers";
    case "agent_setup": return "Filling in your setup";
    case "file_ticket": return "Saving that for the team";
    case "verify_start": case "verify_check": return "Checking your account";
    default: return "Working on it";
  }
}

const isPhone = () => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;

export function MayaScreen({ onClose, startWith = "voice" }: { onClose: () => void; startWith?: "voice" | "text" }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [greeting] = useState(() => greetingFor(mayaProductForPath(window.location.pathname)));
  const [items, setItems] = useState<Item[]>([{ id: seq++, kind: "maya", text: greeting }]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [voice, setVoice] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [showing, setShowing] = useState<{ label: string; page: string } | null>(null);
  const [mini, setMini] = useState(false);
  const [text, setText] = useState("");
  const conv = useRef<Conv | null>(null);
  const starting = useRef<Promise<Conv | null> | null>(null);
  const lastSent = useRef("");
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const push = useCallback((it: Omit<Item, "id">) => setItems((xs) => [...xs, { ...it, id: seq++ } as Item]), []);

  // The presenter: same tools as the widget, plus the "Showing" strip and, on phones, tucking into the pill.
  const tools = useRef(presenterTools({
    navigate: () => navigateRef.current,
    path: () => pathRef.current,
    onShow: (label) => {
      setShowing({ label, page: mayaProductForPath(pathRef.current) ?? "this page" });
      if (isPhone()) setMini(true);
    },
  })).current;

  // ---- session ----
  const start = useCallback(async (withVoice: boolean): Promise<Conv | null> => {
    if (conv.current) return conv.current;
    if (starting.current) return starting.current;
    setPhase("connecting");
    starting.current = (async () => {
      try {
        const [{ Conversation }, s] = await Promise.all([loadMayaSdk(), getMayaSession(pathRef.current)]);
        if ("error" in s) throw new Error(s.error);
        const history = items.filter((x) => x.kind !== "note").slice(-6)
          .map((x) => `${x.kind === "you" ? "Visitor" : "Maya"}: ${x.text}`).join("\n");
        const here = mayaProductForPath(pathRef.current) ?? "Bestly home page";
        const c = await Conversation.startSession({
          signedUrl: s.signedUrl,
          textOnly: !withVoice,
          workletPaths: { rawAudioProcessor: "/maya/sdk/raw-audio-processor.js", audioConcatProcessor: "/maya/sdk/audio-concat-processor.js" },
          libsampleratePath: "/maya/libsamplerate.worklet.js",
          overrides: { agent: { firstMessage: items.length > 1 ? "I'm here. Go ahead." : greeting }, conversation: { textOnly: !withVoice } },
          dynamicVariables: { page_product: here, page_path: pathRef.current },
          clientTools: tools,
          onConnect: () => {
            setPhase("live");
            try { setMayaConversationId(c.getId()); } catch { /* id not ready: the lead is just not linked to the call */ }
            if (history && items.length > 1) try { c.sendContextualUpdate(`Earlier in this chat:\n${history}`); } catch { /* ignore */ }
          },
          onDisconnect: () => { conv.current = null; setMayaConversationId(null); setPhase("ended"); setVoice(false); setSpeaking(false); setWorking(null); },
          onModeChange: ({ mode }: { mode: string }) => setSpeaking(mode === "speaking"),
          onMessage: ({ message, role }: { message: string; role: string }) => {
            const t = String(message ?? "").replace(/\[[a-z ]+\]\s*/gi, "").trim();
            if (!t) return;
            if (role === "user") { if (t === lastSent.current) { lastSent.current = ""; return; } push({ kind: "you", text: t }); return; }
            setItems((xs) => (xs.length && xs[xs.length - 1].kind === "maya" && xs[xs.length - 1].text === t ? xs : [...xs, { id: seq++, kind: "maya", text: t }]));
          },
          onAgentToolRequest: (p: Any) => setWorking(labelFor(String((p as { tool_name?: string })?.tool_name ?? ""))),
          onAgentToolResponse: () => setWorking(null),
          onError: (msg: string) => mayaDiag("sdk", { msg: String(msg).slice(0, 300) }),
        } as never) as Conv;
        conv.current = c;
        setVoice(withVoice);
        return c;
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        mayaDiag("start", { msg: msg.slice(0, 300), voice: String(withVoice) });
        push({ kind: "note", text: /permission|denied|notallowed/i.test(msg)
          ? "Maya needs your microphone to talk. Allow it in your browser, or just type below."
          : msg.length < 160 ? msg : `Maya didn't load. Try again, or call ${PHONE_DISPLAY}.` });
        setPhase("idle");
        return null;
      } finally {
        starting.current = null;
      }
    })();
    return starting.current;
  }, [items, greeting, push, tools]);

  const endCall = useCallback(async () => {
    const c = conv.current;
    conv.current = null;
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
    try { c?.sendUserMessage(t); } catch { push({ kind: "note", text: "That didn't send. Try again." }); }
  }, [text, push, start]);

  const toggleMic = useCallback(async () => {
    if (voice) { const m = !muted; setMuted(m); try { conv.current?.setMicMuted(m); } catch { /* ignore */ } return; }
    if (conv.current) { const c = conv.current; conv.current = null; try { await c.endSession(); } catch { /* ignore */ } }
    await start(true);
  }, [voice, muted, start]);

  // She hears where the visitor is when they move around on their own.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (pathname === lastPath.current) return;
    lastPath.current = pathname;
    try { conv.current?.sendContextualUpdate(`The visitor is now on the ${mayaProductForPath(pathname) ?? "a page you don't cover"} page (${pathname}).`); } catch { /* not connected */ }
  }, [pathname]);

  // Desktop: the page makes room for the panel, so what she shows is never under her.
  useEffect(() => {
    const root = document.documentElement;
    if (!mini) root.classList.add("maya-docked");
    else root.classList.remove("maya-docked");
    return () => root.classList.remove("maya-docked");
  }, [mini]);

  // Opened from the intro: voice by default ("Start talking"), or ready to type ("Type instead").
  useEffect(() => {
    if (startWith === "voice") void start(true);
    else window.setTimeout(() => input.current?.focus(), 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The visitor moved the savings calculator by hand: Maya hears the new numbers, so she can talk about them.
  useEffect(() => {
    const f = (e: Event) => {
      const say = String((e as CustomEvent<string>).detail ?? "");
      try { if (say) conv.current?.sendContextualUpdate(`The visitor changed the savings calculator themselves. ${say}`); } catch { /* not connected */ }
    };
    window.addEventListener(CALC_CHANGED, f);
    return () => window.removeEventListener(CALC_CHANGED, f);
  }, []);

  // The visitor moved the pricing picker or chose a plan by hand: she hears the numbers the page shows.
  useEffect(() => {
    const f = (e: Event) => {
      const say = String((e as CustomEvent<string>).detail ?? "");
      try { if (say) conv.current?.sendContextualUpdate(`The visitor changed the pricing section themselves. ${say}`); } catch { /* not connected */ }
    };
    window.addEventListener(PLAN_CHANGED, f);
    return () => window.removeEventListener(PLAN_CHANGED, f);
  }, []);

  // The visitor edited the contact form by hand (after Maya typed, or before): she hears what is on it now.
  useEffect(() => {
    const f = (e: Event) => {
      const say = String((e as CustomEvent<string>).detail ?? "");
      try { if (say) conv.current?.sendContextualUpdate(`The visitor edited the form: ${say} Don't re-type what they changed.`); } catch { /* not connected */ }
    };
    window.addEventListener(FORM_CHANGED, f);
    return () => window.removeEventListener(FORM_CHANGED, f);
  }, []);

  useEffect(() => {
    loadMayaSdk().catch(() => {}); // iPhone plays audio only from a context unlocked in a tap; load before the tap.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMini(true); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); try { void conv.current?.endSession(); } catch { /* ignore */ } };
  }, []);
  useEffect(() => {
    const f = (e: SecurityPolicyViolationEvent) => mayaDiag("csp", { blocked: String(e.blockedURI), directive: e.effectiveDirective });
    document.addEventListener("securitypolicyviolation", f);
    return () => document.removeEventListener("securitypolicyviolation", f);
  }, []);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }); }, [items, working, showing]);

  const close = async () => { await endCall(); onClose(); };
  const showAgain = () => {
    if (!showing) return;
    const h = findHeading(showing.label);
    if (h) spotlight(h);
    if (isPhone()) setMini(true);
  };
  const status = phase === "connecting" ? "Connecting"
    : phase === "live" ? (voice ? (speaking ? "Maya is talking" : muted ? "Muted" : "Listening") : "Chatting")
    : "Bestly's AI guide";
  const chips = items.length === 1 ? chipsFor(pathname) : [];

  if (mini) {
    return createPortal(
      <button type="button" onClick={() => setMini(false)} aria-label="Open Maya"
        className="maya-pill fixed z-[60] flex items-center gap-2.5 rounded-full py-2 pl-2 pr-4 text-[15px] font-semibold text-white motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2">
        <MayaOrb size={30} live={voice && speaking} />
        <span className="whitespace-nowrap">Maya</span>
        <span className="whitespace-nowrap font-medium text-[#C7CBEA]">
          {phase === "live" && voice ? status : showing ? `On ${showing.page}` : "Tap to talk"}
        </span>
      </button>, document.body);
  }

  return createPortal(
    <aside aria-label="Maya, Bestly's AI guide"
      className="maya-panel fixed z-[60] flex flex-col overflow-hidden text-white motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-4 motion-safe:duration-300 max-lg:motion-safe:slide-in-from-bottom-4">
      {/* Glow behind the header, feathered so it never ends in an edge. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-60"
        style={{ background: "radial-gradient(80% 100% at 50% 0%, #8E9BFF38, #E59CFF14 45%, transparent 75%)" }} />

      <header className="relative flex items-center gap-3 px-4 pb-2 pt-4">
        <MayaOrb size={44} live={voice && speaking} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[19px] font-semibold leading-tight tracking-[-0.01em]">Maya</h2>
          <p className="text-[14px] leading-snug text-[#C7CBEA]" aria-live="polite">{status}</p>
        </div>
        <IconBtn label="Tuck Maya away" onClick={() => setMini(true)}><ChevronDown className="h-5 w-5" aria-hidden /></IconBtn>
        <IconBtn label="Close Maya" onClick={close}><X className="h-5 w-5" aria-hidden /></IconBtn>
      </header>

      {showing && (
        <div className="relative mx-4 mb-1 flex items-center gap-3 rounded-2xl bg-white/[0.07] py-2 pl-3 pr-2 ring-1 ring-white/10 motion-safe:animate-in motion-safe:fade-in">
          <Presentation className="h-4 w-4 shrink-0 text-[#8E9BFF]" aria-hidden />
          <p className="min-w-0 flex-1 text-[14px] leading-snug">
            <span className="text-[#C7CBEA]">Showing on {nw(showing.page)}: </span>{showing.label}
          </p>
          <button type="button" onClick={showAgain}
            className="min-h-[44px] shrink-0 rounded-full px-3 text-[14px] font-semibold text-[#8E9BFF] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
            {nw("Show again")}
          </button>
        </div>
      )}

      <div ref={list} className="maya-scroll relative flex-1 overflow-y-auto overscroll-contain">
        <div className="flex flex-col gap-3 px-4 pb-5 pt-4" aria-live="polite">
          {items.map((it) => it.kind === "note"
            ? <p key={it.id} role="alert" className="flex items-start gap-2 rounded-2xl bg-white/[0.06] px-4 py-3 text-[15px] leading-snug ring-1 ring-white/10">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#FF9DB3]" aria-hidden />{it.text}</p>
            : <Bubble key={it.id} you={it.kind === "you"}>{it.text}</Bubble>)}
          {working && (
            <p className="flex items-center gap-2 text-[15px] text-[#C7CBEA]">
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />{working}
            </p>
          )}
          {chips.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-2" aria-label="Suggestions">
              {chips.map((c) => (
                <button key={c} type="button" onClick={() => void send(c)}
                  className="min-h-[44px] rounded-full bg-white/[0.08] px-4 text-[15px] font-medium ring-1 ring-white/15 transition-transform duration-100 active:scale-95 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">{c}</button>
              ))}
            </div>
          )}
          {phase === "ended" && <p className="text-center text-[14px] text-[#C7CBEA]">Call ended. Type below or tap the mic to talk again.</p>}
        </div>
      </div>

      <footer className="relative px-4 pb-4 pt-2">
        {voice && phase === "live" && (
          <div className="mb-2 flex items-center gap-2 rounded-2xl bg-white/[0.06] p-2 pl-3 ring-1 ring-white/10">
            <span className="flex-1 text-[15px] font-medium">{speaking ? "Maya is talking" : muted ? "You're muted" : "Listening, go ahead"}</span>
            <IconBtn label={muted ? "Unmute" : "Mute"} pressed={muted} onClick={toggleMic}>
              {muted ? <MicOff className="h-5 w-5" aria-hidden /> : <Mic className="h-5 w-5" aria-hidden />}
            </IconBtn>
            <button type="button" onClick={endCall} aria-label="End call"
              className="flex h-11 items-center gap-1.5 rounded-full bg-[#E5484D] px-4 text-[15px] font-semibold active:scale-95">
              <PhoneOff className="h-4 w-4" aria-hidden />End
            </button>
          </div>
        )}
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          {!voice && (
            <button type="button" onClick={toggleMic} aria-label="Talk to Maya" disabled={phase === "connecting"}
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#8E9BFF] text-[#0E1030] ring-1 ring-white/20 transition-transform duration-100 active:scale-95 disabled:opacity-60 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
              {phase === "connecting" ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Mic className="h-5 w-5" aria-hidden />}
            </button>
          )}
          <label className="sr-only" htmlFor="maya-input">Message Maya</label>
          <textarea id="maya-input" ref={input} rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder="Message Maya"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            className="max-h-32 min-h-[48px] flex-1 resize-none rounded-3xl bg-white/[0.08] px-4 py-3 text-[16px] leading-snug text-white ring-1 ring-white/15 placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-[#8E9BFF]" />
          <button type="submit" aria-label="Send" disabled={!text.trim()}
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-black transition-transform duration-100 active:scale-95 disabled:opacity-40 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
            <ArrowUp className="h-5 w-5" aria-hidden />
          </button>
        </form>
        <p className="mt-2 text-center text-[12px] leading-snug text-[#C7CBEA]">
          Maya is Bestly's AI and can move around this site for you. Prefer a person?{" "}
          <a href={PHONE_TEL} className="whitespace-nowrap font-semibold text-white underline-offset-2 hover:underline">{PHONE_DISPLAY}</a>
        </p>
      </footer>
    </aside>, document.body);
}

/** The launcher while the screen is closed: Maya's orb and one clear action. */
export function MayaScreenLauncher({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} onPointerEnter={() => loadMayaSdk().catch(() => {})} onFocus={() => loadMayaSdk().catch(() => {})}
      aria-label="Talk to Maya, Bestly's AI guide"
      className="maya-pill fixed z-[60] flex items-center gap-2.5 rounded-full py-2 pl-2 pr-5 text-[16px] font-semibold text-white transition-transform duration-100 active:scale-[0.97] motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E9BFF]">
      <MayaOrb size={34} />
      <span className="whitespace-nowrap">Talk to Maya</span>
      <Sparkles className="h-4 w-4 text-[#C7CBEA]" aria-hidden />
    </button>
  );
}

function MayaOrb({ size = 40, live = false }: { size?: number; live?: boolean }) {
  return (
    <span aria-hidden className={`block shrink-0 rounded-full ${live ? "maya-orb-live" : ""}`}
      style={{ width: size, height: size,
        background: "radial-gradient(circle at 32% 28%, rgba(255,255,255,.85), rgba(255,255,255,0) 45%), conic-gradient(from 210deg, #8E9BFF, #E59CFF, #8E9BFF, #6CD3FF, #8E9BFF)",
        boxShadow: `0 0 ${Math.round(size * 0.5)}px -${Math.round(size * 0.05)}px #8E9BFFAA` }} />
  );
}

function IconBtn({ label, onClick, pressed, children }: { label: string; onClick: () => void; pressed?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={pressed}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/[0.08] ring-1 ring-white/15 transition-transform duration-100 active:scale-95 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
      {children}
    </button>
  );
}

function Bubble({ you, children }: { you: boolean; children: ReactNode }) {
  return (
    <p className={`max-w-[88%] whitespace-pre-wrap rounded-3xl px-4 py-2.5 text-[16px] leading-relaxed ${you ? "self-end rounded-br-md bg-[#8E9BFF] text-[#0E1030]" : "self-start rounded-bl-md bg-white/[0.08]"}`}>{children}</p>
  );
}
