import { useCallback, useEffect, useRef, useState, type ElementType } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Mic } from "lucide-react";
import "./maya-widget.css";
import { mayaProductForPath } from "./siteTools";
import { presenterTools } from "./presenter";
import { getMayaSession, mayaDiag, SESSION_FRESH_MS } from "./mayaSession";
import { MayaScreen, MayaScreenLauncher } from "./MayaScreen";
import { MayaIntro } from "./MayaIntro";

/** Review flag for the Leo-style Maya screen: ?maya=screen turns it on for this tab, ?maya=widget turns it off. */
const WIDGET_KEY = "maya:widget";
/**
 * Maya's own screen (MayaScreen, with the "Meet Maya" intro) is the default for everyone since 2026-10-11 (Jared).
 * `?maya=widget` falls back to the old ElevenLabs embed for this tab (a debugging escape hatch); `?maya=screen` undoes it.
 */
function useScreenFlag(): boolean {
  const { search } = useLocation();
  const [on, setOn] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("maya");
      if (q === "widget") return false;
      if (q === "screen") return true;
      return sessionStorage.getItem(WIDGET_KEY) !== "1";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    const q = new URLSearchParams(search).get("maya");
    try {
      if (q === "widget") sessionStorage.setItem(WIDGET_KEY, "1");
      if (q === "screen") sessionStorage.removeItem(WIDGET_KEY);
    } catch {
      /* storage off: the URL flag still works for this page */
    }
    if (q === "screen") setOn(true);
    if (q === "widget") setOn(false);
  }, [search]);
  return on;
}

/**
 * "Talk to Maya" - Bestly's voice + chat agent (ElevenLabs), on public marketing pages only.
 *
 * - Lazy: nothing from ElevenLabs or unpkg loads until the visitor taps the launcher (or hovers /
 *   focuses it, which only pre-fetches the script). No page-load cost, and no third-party request
 *   before the visitor shows intent.
 * - Official embed: <elevenlabs-convai> custom element + @elevenlabs/convai-widget-embed, pinned to
 *   an exact version with a Subresource Integrity hash. Bump both together (see MAYA_EMBED_*).
 * - The three audio worklets are self-hosted from /maya (public/maya) so the page CSP does not need
 *   blob: or a second script CDN. They match the pinned embed version.
 * - Passes the page the visitor is on as dynamic variables (page_product, page_path). It never
 *   sets call_mode: Maya defaults to inbound.
 * - Allowed routes are an explicit allowlist (siteTools.ts). Never add /admin, /partner, token pages (/brief,
 *   /intake, /shield/request) or anything authenticated.
 * - Maya's client tools (navigate_site_page, open_site_modal, show_section, describe_screen) come from presenter.ts
 *   and are registered on the embed's `elevenlabs-convai:call` event. In-app navigation, so the call keeps going.
 * - Private agent (2026-10-11): the widget never gets Maya's agent id. On tap it asks maya-session for a signed URL
 *   (origin + per-visitor limits checked there) and hands that to the embed. Signed URLs must start a call within
 *   about 15 minutes, so an idle open widget refreshes it every 12 minutes, but never during a call.
 */

const MAYA_PHONE_DISPLAY = "(213) 641-0074";
const MAYA_PHONE_TEL = "tel:+12136410074";

const MAYA_EMBED_VERSION = "0.18.3";
const MAYA_EMBED_SRC = `https://unpkg.com/@elevenlabs/convai-widget-embed@${MAYA_EMBED_VERSION}/dist/index.js`;
const MAYA_EMBED_SRI = "sha384-BpmvKCW/TFrpO8oObmUgZzUCIMHI00QbpGA4/jfXcfTosbgtuEUN1wYT7nNIsV3v";

/** Widget copy: short, never truncated, and Maya is clearly identified as AI. */
const TEXT_CONTENTS = JSON.stringify({
  main_label: "Talk to Maya",
  chatting_status: "Chatting with Maya, Bestly's AI",
  input_placeholder: "Send a message",
  input_placeholder_text_only: "Send a message",
  typing_indicator: "Maya is typing",
  agent_working: "Working",
});

let scriptPromise: Promise<void> | null = null;

// The page CSP is fixed when a document loads, and only the marketing routes (vercel.json) allow the embed's
// host. A visitor who landed on a stricter page (say a legal page) and then clicked through to a marketing
// page in-app is still on the strict CSP, so the embed is blocked. Detect that and reload once, so the
// marketing page's own headers apply, then reopen Maya automatically.
let cspBlockedEmbed = false;
if (typeof document !== "undefined") {
  document.addEventListener("securitypolicyviolation", (e) => {
    if (e.blockedURI.includes("unpkg.com")) cspBlockedEmbed = true;
  });
}
const RELOADED_KEY = "maya:reloaded";
const REOPEN_KEY = "maya:reopen";

function reloadUnderMarketingCsp(): boolean {
  try {
    if (!cspBlockedEmbed || sessionStorage.getItem(RELOADED_KEY)) return false;
    sessionStorage.setItem(RELOADED_KEY, "1");
    sessionStorage.setItem(REOPEN_KEY, "1");
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/** Shared with LeoWidget (trip pages): same pinned embed, same SRI. */
export function loadEmbed(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    if (customElements.get("elevenlabs-convai")) return resolve();
    const s = document.createElement("script");
    s.src = MAYA_EMBED_SRC;
    s.integrity = MAYA_EMBED_SRI;
    s.crossOrigin = "anonymous";
    s.async = true;
    s.onload = () => {
      customElements.whenDefined("elevenlabs-convai").then(() => resolve(), reject);
    };
    s.onerror = () => {
      s.remove();
      scriptPromise = null;
      reject(new Error("maya embed failed to load"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

// Custom element, typed loosely on purpose: a global JSX.IntrinsicElements entry would leak into every
// keyof JSX.IntrinsicElements use in the app.
const ConvaiElement = "elevenlabs-convai" as unknown as ElementType;

type Phase = "idle" | "loading" | "ready" | "error";

export function MayaWidget() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const product = mayaProductForPath(pathname);
  const [phase, setPhase] = useState<Phase>("idle");
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const screen = useScreenFlag();
  // closed -> intro (what she is) -> open with voice (default) or typing
  const [screenStage, setScreenStage] = useState<"closed" | "intro" | "voice" | "text">("closed");
  const mounted = useRef(true);
  const widgetEl = useRef<HTMLElement | null>(null);
  const callStartedAt = useRef(0);
  const urlAt = useRef(0);
  // Tools run long after render; read the latest route and navigate through refs, never a stale closure.
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Register Maya's client tools on the embed. The event fires each time a conversation starts.
  useEffect(() => {
    const el = widgetEl.current;
    if (phase !== "ready" || !el) return;
    const tools = presenterTools({ navigate: () => navigateRef.current, path: () => pathRef.current });
    const onCall = (event: Event) => {
      callStartedAt.current = Date.now();
      window.dispatchEvent(new Event("maya:call-start")); // pages that play their own audio (the /agent demo) pause
      const detail = (event as CustomEvent<{ config?: Record<string, unknown> }>).detail;
      if (!detail?.config) return;
      const existing = (detail.config.clientTools as Record<string, unknown> | undefined) ?? {};
      detail.config.clientTools = { ...existing, ...tools };
    };
    el.addEventListener("elevenlabs-convai:call", onCall);
    return () => el.removeEventListener("elevenlabs-convai:call", onCall);
  }, [phase]);

  // Keep the signed URL fresh while the widget sits open, but never swap it during a call (calls run 10 minutes max).
  useEffect(() => {
    if (phase !== "ready") return;
    const t = setInterval(async () => {
      if (document.hidden) return;
      if (Date.now() - urlAt.current < SESSION_FRESH_MS) return;
      if (Date.now() - callStartedAt.current < 11 * 60_000) return;
      const s = await getMayaSession(pathRef.current);
      if ("signedUrl" in s && mounted.current) {
        urlAt.current = s.at;
        setSignedUrl(s.signedUrl);
      }
    }, 60_000);
    return () => clearInterval(t);
  }, [phase]);

  const prefetch = useCallback(() => {
    loadEmbed().catch(() => {});
  }, []);

  const open = useCallback(async () => {
    setPhase("loading");
    setNote(null);
    const [session] = await Promise.all([
      getMayaSession(window.location.pathname),
      loadEmbed().catch((e: unknown) => e),
    ]);
    if (!mounted.current) return;
    if (!customElements.get("elevenlabs-convai")) {
      if (reloadUnderMarketingCsp()) return;
      mayaDiag("embed_load_failed");
      setPhase("error");
      return;
    }
    if ("error" in session) {
      setNote(session.error);
      setPhase("error");
      return;
    }
    urlAt.current = session.at;
    setSignedUrl(session.signedUrl);
    setPhase("ready");
  }, []);

  // After the one-time CSP reload above, pick up where the visitor left off.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(REOPEN_KEY)) {
        sessionStorage.removeItem(REOPEN_KEY);
        if (mayaProductForPath(window.location.pathname)) void open();
      }
    } catch {
      /* storage off: they can tap again */
    }
  }, [open]);

  // Other parts of the site (the /agent page buttons) open Maya with: window.dispatchEvent(new Event("maya:open")).
  // It does exactly what tapping her launcher does: the intro in screen mode, the widget otherwise.
  const openFromSite = useRef<() => void>(() => {});
  openFromSite.current = () => {
    if (!product) return;
    if (screen) {
      setScreenStage((s) => (s === "closed" ? "intro" : s));
    } else if (phase === "idle" || phase === "error") {
      void open();
    }
  };
  useEffect(() => {
    const on = () => openFromSite.current();
    window.addEventListener("maya:open", on);
    return () => window.removeEventListener("maya:open", on);
  }, []);

  if (!product) return null;

  if (screen) {
    if (screenStage === "voice" || screenStage === "text") {
      return <MayaScreen startWith={screenStage} onClose={() => setScreenStage("closed")} />;
    }
    return (
      <>
        <MayaScreenLauncher onOpen={() => setScreenStage("intro")} />
        {screenStage === "intro" && (
          <MayaIntro onTalk={() => setScreenStage("voice")} onType={() => setScreenStage("text")} onClose={() => setScreenStage("closed")} />
        )}
      </>
    );
  }

  const dynamicVariables = JSON.stringify({ page_product: product, page_path: pathname });

  return (
    <div className="maya">
      {phase === "ready" && signedUrl ? (
        <ConvaiElement
          ref={widgetEl}
          signed-url={signedUrl}
          dynamic-variables={dynamicVariables}
          text-contents={TEXT_CONTENTS}
          variant="full"
          placement="bottom-right"
          default-expanded="true"
          text-input="true"
          transcript="true"
          worklet-path-raw-audio-processor="/maya/raw-audio-processor.js"
          worklet-path-audio-concat-processor="/maya/audio-concat-processor.js"
          worklet-path-libsamplerate="/maya/libsamplerate.worklet.js"
        />
      ) : (
        <div className="maya-launcher-wrap">
          {phase === "error" && (
            <p role="alert" className="maya-note">
              {note ?? "Maya didn\u2019t load. Try again, or call us."}
            </p>
          )}
          <button
            type="button"
            className="maya-launcher"
            onClick={() => void open()}
            onPointerEnter={prefetch}
            onFocus={prefetch}
            onTouchStart={prefetch}
            disabled={phase === "loading"}
            aria-label="Talk to Maya, Bestly's AI assistant"
          >
            <Mic aria-hidden="true" className="maya-launcher-icon" />
            <span>{phase === "loading" ? "Starting Maya" : "Talk to Maya"}</span>
          </button>
        </div>
      )}
      <a className="maya-call" href={MAYA_PHONE_TEL}>
        Prefer to call? <span className="maya-num">{MAYA_PHONE_DISPLAY}</span>
      </a>
    </div>
  );
}
