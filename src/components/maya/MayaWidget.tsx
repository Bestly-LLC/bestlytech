import { useCallback, useEffect, useRef, useState, type ElementType } from "react";
import { useLocation } from "react-router-dom";
import { Mic } from "lucide-react";
import "./maya-widget.css";

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
 * - Allowed routes are an explicit allowlist. Never add /admin, /partner, token pages (/brief,
 *   /intake, /shield/request) or anything authenticated.
 */

const MAYA_AGENT_ID = "agent_3701m4jbjnyef6ga4ys73xtbz37s";
const MAYA_PHONE_DISPLAY = "(213) 641-0074";
const MAYA_PHONE_TEL = "tel:+12136410074";

const MAYA_EMBED_VERSION = "0.18.3";
const MAYA_EMBED_SRC = `https://unpkg.com/@elevenlabs/convai-widget-embed@${MAYA_EMBED_VERSION}/dist/index.js`;
const MAYA_EMBED_SRI = "sha384-BpmvKCW/TFrpO8oObmUgZzUCIMHI00QbpGA4/jfXcfTosbgtuEUN1wYT7nNIsV3v";

/** Public pages that get the widget, and what Maya is told the visitor is looking at. */
const PAGE_PRODUCT: Record<string, string> = {
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

function mayaProductForPath(pathname: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (NEVER_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  return PAGE_PRODUCT[path] ?? null;
}

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

function loadEmbed(): Promise<void> {
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
  const product = mayaProductForPath(pathname);
  const [phase, setPhase] = useState<Phase>("idle");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const prefetch = useCallback(() => {
    loadEmbed().catch(() => {});
  }, []);

  const open = useCallback(() => {
    setPhase("loading");
    loadEmbed().then(
      () => mounted.current && setPhase("ready"),
      () => {
        if (reloadUnderMarketingCsp()) return;
        if (mounted.current) setPhase("error");
      },
    );
  }, []);

  // After the one-time CSP reload above, pick up where the visitor left off.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(REOPEN_KEY)) {
        sessionStorage.removeItem(REOPEN_KEY);
        if (mayaProductForPath(window.location.pathname)) open();
      }
    } catch {
      /* storage off: they can tap again */
    }
  }, [open]);

  if (!product) return null;

  const dynamicVariables = JSON.stringify({ page_product: product, page_path: pathname });

  return (
    <div className="maya">
      {phase === "ready" ? (
        <ConvaiElement
          agent-id={MAYA_AGENT_ID}
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
              Maya didn&rsquo;t load. Try again, or call us.
            </p>
          )}
          <button
            type="button"
            className="maya-launcher"
            onClick={open}
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
