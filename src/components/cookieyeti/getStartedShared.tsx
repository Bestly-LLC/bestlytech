import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import cookieYetiIcon from "@/assets/cookieyeti-icon.png";
import {
  Cookie,
  ArrowLeft,
  Lock,
  ImageIcon,
  ShieldCheck,
  ShieldAlert,
  Flag,
  X,
} from "lucide-react";

// CY-GS-02: Shared building blocks for the platform-specific Get Started
// tutorials (iOS / macOS / Chrome). The last carousel step lets the user fire a
// REAL "report a missed banner" through their actually-installed Cookie Yeti
// extension — see LiveReportDemo below. Each platform page supplies its own hero
// copy, step instructions, and screenshots.

export const TEAL = "#2DB3A6";

export type DemoPlatform = "chrome" | "mac" | "ios";

export function StepBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2DB3A6] text-white text-sm font-bold">
      {n}
    </span>
  );
}

// CY-GS-02: Labeled placeholder shown until real platform screenshots are
// dropped into src/assets and wired in. Keeps the page rendering cleanly and
// tells whoever is adding the image exactly which shot goes here.
export function ScreenshotPlaceholder({
  label,
  hint,
  phone = false,
}: {
  label: string;
  hint?: string;
  phone?: boolean;
}) {
  return (
    <div
      className={`mx-auto w-full ${phone ? "max-w-[320px] rounded-[2rem]" : "max-w-[520px] rounded-xl"} border-2 border-dashed border-[#2DB3A6]/50 bg-[#2DB3A6]/5 flex flex-col items-center justify-center text-center p-6 aspect-[16/10]`}
      role="img"
      aria-label={`Placeholder for screenshot: ${label}`}
    >
      <ImageIcon className="h-8 w-8 text-[#2DB3A6]/70" aria-hidden="true" />
      <p className="mt-2 text-sm font-semibold text-[#2DB3A6]">{label}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground max-w-[36ch]">{hint}</p>}
    </div>
  );
}

// CY-GS-04: Detect whether the REAL Cookie Yeti extension is installed and
// running on this page. The extension's content script (isolated world) sets
// `data-cookie-yeti="<version>"` on <html> right after it initializes; page JS
// can read that attribute even though it can't see the isolated-world globals.
// Returns null while still checking, then true / false.
function useCookieYetiPresence(): boolean | null {
  const [present, setPresent] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const read = () => document.documentElement.getAttribute("data-cookie-yeti");

    if (read()) {
      setPresent(true);
      return;
    }

    // The content script injects at document_idle, which can land after this
    // component mounts — watch for the attribute appearing, with a timed
    // fallback so we don't wait forever.
    const observer = new MutationObserver(() => {
      if (read()) {
        setPresent(true);
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-cookie-yeti"],
    });

    const timer = window.setTimeout(() => {
      setPresent((prev) => (prev === null ? Boolean(read()) : prev));
      observer.disconnect();
    }, 1600);

    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  return present;
}

// CY-GS-04: The last-step demo. A believable, self-contained scripted article
// (pure HTML/CSS, no external requests) with a REAL cookie-consent banner. The
// report itself is NOT faked: if the real Cookie Yeti extension is detected we
// tell the user to open their real panel and tap "Report a missed banner" — the
// extension scans THIS page and sends a real report through its own outbox. If
// the extension isn't detected we fall back to a clear install/enable message
// while still showing the scripted article so the page isn't broken.
const PANEL_HINT: Record<DemoPlatform, ReactNode> = {
  chrome: (
    <>
      Open <strong className="text-foreground">Cookie Yeti</strong> from your toolbar (the
      pinned Yeti, top-right) and tap{" "}
      <strong className="text-foreground">Report a missed banner</strong>.
    </>
  ),
  mac: (
    <>
      Click the <strong className="text-foreground">Yeti icon</strong> in your Safari toolbar
      and tap <strong className="text-foreground">Report a missed banner</strong>.
    </>
  ),
  ios: (
    <>
      Tap the <strong className="text-foreground">menu</strong> in your address bar →{" "}
      <strong className="text-foreground">Cookie Yeti</strong>, then tap{" "}
      <strong className="text-foreground">Report a missed banner</strong>.
    </>
  ),
};

export function LiveReportDemo({ platform }: { platform: DemoPlatform }) {
  const present = useCookieYetiPresence();
  const [bannerOpen, setBannerOpen] = useState(true);

  return (
    <div>
      {/* Scripted "real" webpage */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/60 border-b border-border">
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </span>
          <span className="ml-1 flex min-w-0 flex-1 items-center gap-1 truncate rounded-md bg-background px-2 py-0.5 text-[11px] text-muted-foreground shadow-sm">
            <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">thedailybyte.example/privacy/take-back-your-data</span>
          </span>
          <span className="shrink-0 rounded-full bg-[#2DB3A6]/10 text-[#2DB3A6] px-2 py-0.5 font-semibold uppercase tracking-wide text-[10px]">
            Demo
          </span>
        </div>

        {/* Article */}
        <div className="relative min-h-[150px] bg-white dark:bg-neutral-950 sm:min-h-[290px]">
          {/* Masthead */}
          <div className="flex items-center gap-2 border-b border-black/5 px-3 py-1 dark:border-white/10">
            <span className="font-serif text-[12px] font-bold tracking-tight text-foreground">
              The Daily Byte
            </span>
            <nav className="ml-auto hidden gap-3 text-[11px] font-medium text-muted-foreground sm:flex">
              <span>Tech</span>
              <span className="text-[#2DB3A6]">Privacy</span>
              <span>Reviews</span>
            </nav>
          </div>

          {/* Body */}
          <div className="px-3 py-1 sm:px-5 sm:py-4">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[#2DB3A6]">
              Privacy
            </span>
            <h3 className="mt-0.5 font-serif text-[14px] font-bold leading-tight text-foreground sm:text-xl">
              The Privacy Tools Worth Using in 2026
            </h3>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground sm:mt-1">
              <span
                className="h-4 w-4 rounded-full bg-gradient-to-br from-[#2DB3A6] to-[#1f7f77]"
                aria-hidden="true"
              />
              <span>By Jordan Vale</span>
              <span aria-hidden="true">·</span>
              <span>6 min read</span>
            </div>
            {/* Image block (pure CSS, no request) */}
            <div
              className="mt-1.5 flex h-8 items-end overflow-hidden rounded-lg bg-gradient-to-br from-slate-700 via-slate-800 to-[#123c39] sm:mt-2 sm:h-24"
              aria-hidden="true"
            >
              <div className="h-4 w-full bg-gradient-to-t from-black/40 to-transparent sm:h-6" />
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground sm:mt-2 sm:text-sm sm:leading-relaxed">
              Every site wants to drop cookies before you've read a word — hand that busywork
              to a tool that clears it for you.
            </p>
            <p className="mt-1.5 hidden text-sm leading-relaxed text-muted-foreground sm:block">
              We tested the ones that actually respect your time. Here's where to start.
            </p>
          </div>

          {/* REAL cookie-consent banner the extension can detect + report */}
          {bannerOpen && (
            <div
              id="cy-demo-consent"
              role="dialog"
              aria-label="Cookie consent"
              className="cookie-consent-banner absolute inset-x-2 bottom-2 rounded-xl border border-border bg-background p-3 shadow-lg motion-safe:animate-in motion-safe:slide-in-from-bottom-4 motion-safe:fade-in motion-safe:duration-300"
            >
              <button
                type="button"
                onClick={() => setBannerOpen(false)}
                aria-label="Close cookie banner"
                className="absolute right-2 top-2 text-muted-foreground/70 hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <div className="flex items-start gap-2.5 pr-5">
                <Cookie className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-foreground">We value your privacy</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    We use cookies to personalize content and analyze traffic. This one's a
                    tricky pattern — a perfect test for your Cookie Yeti.
                  </p>
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setBannerOpen(false)}
                  className="inline-flex h-8 items-center rounded-lg bg-[#2DB3A6] px-3 text-xs font-semibold text-white hover:bg-[#249b90]"
                >
                  Accept all
                </button>
                <button
                  type="button"
                  onClick={() => setBannerOpen(false)}
                  className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-muted"
                >
                  Reject all
                </button>
                <button
                  type="button"
                  onClick={() => setBannerOpen(false)}
                  className="inline-flex h-8 items-center rounded-lg px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Manage preferences
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Detection-aware status strip — reflects the REAL outcome, never a fake one */}
      <LiveReportStatus platform={platform} present={present} bannerOpen={bannerOpen} />
    </div>
  );
}

function LiveReportStatus({
  platform,
  present,
  bannerOpen,
}: {
  platform: DemoPlatform;
  present: boolean | null;
  bannerOpen: boolean;
}) {
  if (present === null) {
    return (
      <p className="mt-2 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <span
          className="h-2 w-2 animate-pulse rounded-full bg-[#2DB3A6]"
          aria-hidden="true"
        />
        Checking for your Cookie Yeti…
      </p>
    );
  }

  if (present) {
    return (
      <div className="mt-2 rounded-lg border border-[#2DB3A6]/40 bg-[#2DB3A6]/5 px-3 py-1.5">
        <p className="flex items-center gap-2 text-xs font-semibold text-foreground">
          <ShieldCheck className="h-4 w-4 shrink-0 text-[#2DB3A6]" aria-hidden="true" />
          Cookie Yeti is active here — reporting is real.
        </p>
        <p className="mt-1 hidden items-start gap-2 text-xs leading-relaxed text-muted-foreground sm:flex">
          <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#2DB3A6]" aria-hidden="true" />
          <span>
            {PANEL_HINT[platform]} It scans this page and sends a{" "}
            <strong className="text-foreground">real report</strong> — that's how it learns.
            {!bannerOpen && " Closing the banner is fine; the report still goes through."}
          </span>
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-amber-400/40 bg-amber-400/5 px-3 py-1.5">
      <p className="flex items-center gap-2 text-xs font-semibold text-foreground">
        <ShieldAlert className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
        <span className="min-w-0">
          Not detected —{" "}
          <Link to="/cookie-yeti" className="text-[#2DB3A6] hover:underline">
            get Cookie Yeti
          </Link>
          .
        </span>
      </p>
      <p className="mt-1 hidden text-xs leading-relaxed text-muted-foreground sm:block">
        The article above is a live preview. Install or enable Cookie Yeti and reload this page
        to send a <strong className="text-foreground">real report</strong>.
      </p>
    </div>
  );
}

export function GetStartedFAQ({ items }: { items: { q: string; a: string }[] }) {
  return (
    <Accordion type="single" collapsible className="mt-4">
      {items.map((item, i) => (
        <AccordionItem key={i} value={`faq-${i}`}>
          <AccordionTrigger className="text-left text-foreground">{item.q}</AccordionTrigger>
          <AccordionContent className="text-muted-foreground leading-relaxed">
            {item.a}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

export function GetStartedFooterCTA() {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 text-center shadow-sm">
      <Lock className="h-6 w-6 text-[#2DB3A6] mx-auto" aria-hidden="true" />
      <h2 className="mt-3 text-xl font-bold tracking-tight text-foreground">
        That's the whole tour
      </h2>
      <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
        Browse like normal — Cookie Yeti works quietly in the background. If
        anything ever feels off, we're one click away.
      </p>
      <div className="mt-5 flex flex-col sm:flex-row gap-3 justify-center">
        <Button asChild className="h-11 bg-[#2DB3A6] hover:bg-[#249b90] text-white font-semibold">
          <Link to="/cookie-yeti">
            <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" />
            Back to Cookie Yeti
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-11">
          <Link to="/support">Get help</Link>
        </Button>
      </div>
    </div>
  );
}

// CY-GS-03: MacBook device mockup. Wraps a screenshot (or a labeled
// placeholder) in a CSS-drawn laptop so the tutorials look like polished,
// app-themed marketing rather than bare screen grabs. An optional browser
// chrome bar (traffic lights + URL pill) sits inside the screen.
export function MacBookFrame({
  children,
  url,
}: {
  children: React.ReactNode;
  url?: string;
}) {
  return (
    <div className="mx-auto w-full max-w-[300px] sm:max-w-[600px]">
      {/* Lid + bezel */}
      <div className="relative rounded-t-[16px] rounded-b-[6px] bg-gradient-to-b from-neutral-800 to-neutral-900 p-[12px] shadow-2xl ring-1 ring-black/10">
        {/* Camera */}
        <div className="absolute left-1/2 top-[5px] h-[5px] w-[5px] -translate-x-1/2 rounded-full bg-neutral-600" aria-hidden="true" />
        {/* Screen */}
        <div className="overflow-hidden rounded-[6px] bg-white dark:bg-neutral-950">
          {url && (
            <div className="flex items-center gap-2 border-b border-black/5 bg-neutral-100 px-3 py-2 dark:bg-neutral-900">
              <span className="flex gap-1.5" aria-hidden="true">
                <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
              </span>
              <span className="ml-2 flex-1 truncate rounded-md bg-white px-2.5 py-1 text-[11px] text-neutral-500 shadow-sm dark:bg-neutral-800 dark:text-neutral-400">
                {url}
              </span>
            </div>
          )}
          <div className="relative aspect-[16/10] w-full bg-[#F7F9FB] dark:bg-neutral-950">
            {children}
          </div>
        </div>
      </div>
      {/* Base / deck */}
      <div className="relative mx-auto h-[14px] w-[112%] -translate-x-[5.3%] rounded-b-[14px] bg-gradient-to-b from-neutral-300 to-neutral-400 shadow-md dark:from-neutral-700 dark:to-neutral-800">
        <div className="absolute left-1/2 top-0 h-[6px] w-[16%] -translate-x-1/2 rounded-b-[8px] bg-neutral-400/90 dark:bg-neutral-900/80" />
      </div>
    </div>
  );
}

// CY-GS-03: A MacBook showcase with an app-themed marketing caption. Pass an
// imported screenshot via `image`; until one exists it renders a labeled
// placeholder inside the screen so it's obvious which shot belongs here.
export function DeviceShowcase({
  eyebrow,
  caption,
  url,
  image,
  imageAlt,
  placeholderLabel,
  placeholderHint,
}: {
  eyebrow: string;
  caption: string;
  url?: string;
  image?: string;
  imageAlt?: string;
  placeholderLabel?: string;
  placeholderHint?: string;
}) {
  return (
    <figure className="mt-2 sm:mt-5">
      <MacBookFrame url={url}>
        {image ? (
          <img
            src={image}
            alt={imageAlt || caption}
            className="h-full w-full object-cover object-top"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center bg-[#2DB3A6]/5 p-6 text-center">
            <ImageIcon className="h-7 w-7 text-[#2DB3A6]/70" aria-hidden="true" />
            {placeholderLabel && (
              <p className="mt-2 text-sm font-semibold text-[#2DB3A6]">{placeholderLabel}</p>
            )}
            {placeholderHint && (
              <p className="mt-1 max-w-[40ch] text-xs text-muted-foreground">{placeholderHint}</p>
            )}
          </div>
        )}
      </MacBookFrame>
      <figcaption className="mt-2 sm:mt-5 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#2DB3A6]">{eyebrow}</p>
        <p className="mt-1 text-sm sm:text-base font-semibold text-foreground">{caption}</p>
      </figcaption>
    </figure>
  );
}
