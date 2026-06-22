import CookieYetiGetStarted from "./CookieYetiGetStarted";
import CookieYetiGetStartedMac from "./CookieYetiGetStartedMac";
import CookieYetiGetStartedChrome from "./CookieYetiGetStartedChrome";

// CY-GS-02: /cookie-yeti/get-started is the URL baked into already-shipped
// iOS and macOS builds (and the iOS onboarding hand-off). Rather than force an
// app update, we detect the platform here and render the matching tutorial so
// existing installs immediately get correct instructions. Explicit
// /get-started/ios|mac|chrome routes exist for direct links and new builds.

type Platform = "ios" | "mac" | "chrome";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "ios";
  const ua = navigator.userAgent || "";
  const isTouchMac = /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;

  // iOS / iPadOS first (iPadOS 13+ reports as "Macintosh" but has touch points).
  if (/iPhone|iPad|iPod/.test(ua) || isTouchMac) return "ios";

  // Desktop Chromium (Chrome, Brave, etc.) — exclude Edge/Opera which aren't
  // where our Chrome Web Store extension runs, but they still match best here.
  const isChromium = /Chrome|Chromium|CriOS|Edg|OPR/.test(ua);
  if (isChromium) return "chrome";

  // Desktop Safari on macOS.
  if (/Safari/.test(ua) && /Macintosh/.test(ua)) return "mac";

  // Fallback: preserve historical behavior (iOS page).
  return "ios";
}

export default function CookieYetiGetStartedRouter() {
  const platform = detectPlatform();
  if (platform === "mac") return <CookieYetiGetStartedMac />;
  if (platform === "chrome") return <CookieYetiGetStartedChrome />;
  return <CookieYetiGetStarted />;
}
