import type { ReactNode } from "react";
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
  Puzzle,
  Cookie,
  CheckCircle2,
  Flag,
  ArrowLeft,
  Globe,
  Lock,
  RotateCcw,
  ImageIcon,
} from "lucide-react";

// CY-GS-02: Shared building blocks for the platform-specific Get Started
// tutorials (iOS / macOS / Chrome). The interactive "report a missed banner"
// demo is identical across platforms, so it lives here. Each platform page
// supplies its own hero copy, step instructions, and screenshots.

export const TEAL = "#2DB3A6";

export type DemoStage = "banner" | "panel" | "reported";

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

export function FakeBannerDemo({
  stage,
  onOpenPanel,
  onReport,
  onReset,
  openLabel = "Open Cookie Yeti",
}: {
  stage: DemoStage;
  onOpenPanel: () => void;
  onReport: () => void;
  onReset: () => void;
  openLabel?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/60 border-b border-border text-xs text-muted-foreground">
        <Globe className="h-3.5 w-3.5" aria-hidden="true" />
        <span>demo-site.example</span>
        <span className="ml-auto rounded-full bg-[#2DB3A6]/10 text-[#2DB3A6] px-2 py-0.5 font-semibold uppercase tracking-wide text-[10px]">
          Demo
        </span>
      </div>

      <div className="relative px-4 sm:px-6 pt-5 pb-4 min-h-[290px]">
        <div className="space-y-2.5 opacity-50" aria-hidden="true">
          <div className="h-4 w-2/3 rounded bg-muted" />
          <div className="h-3 w-full rounded bg-muted" />
          <div className="h-3 w-11/12 rounded bg-muted" />
          <div className="h-3 w-4/5 rounded bg-muted" />
          <div className="h-24 w-full rounded-lg bg-muted mt-4" />
        </div>

        {stage === "banner" && (
          <div
            className="absolute inset-x-3 bottom-3 rounded-xl border border-border bg-background shadow-lg p-4 motion-safe:animate-in motion-safe:slide-in-from-bottom-4 motion-safe:fade-in motion-safe:duration-300"
            role="group"
            aria-label="Example cookie consent banner that Cookie Yeti missed"
          >
            <div className="flex items-start gap-3">
              <Cookie className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">We value your privacy</p>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  This demo site uses cookies to personalize content and analyze traffic
                  — and Cookie Yeti didn't catch this one. That's your cue to report it.
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex h-9 items-center rounded-lg bg-muted px-3 text-xs font-medium text-muted-foreground select-none">
                Accept all
              </span>
              <span className="inline-flex h-9 items-center rounded-lg bg-muted px-3 text-xs font-medium text-muted-foreground select-none">
                Manage settings
              </span>
              <Button
                size="sm"
                onClick={onOpenPanel}
                className="ml-auto h-11 sm:h-9 bg-[#2DB3A6] hover:bg-[#249b90] text-white"
              >
                <Puzzle className="h-4 w-4 mr-1.5" aria-hidden="true" />
                {openLabel}
              </Button>
            </div>
          </div>
        )}

        {stage === "panel" && (
          <div
            className="absolute inset-x-3 bottom-3 rounded-xl border border-border bg-background shadow-lg p-4 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
            role="group"
            aria-label="Mock Cookie Yeti panel"
          >
            <div className="flex items-center gap-2.5 pb-3 border-b border-border">
              <img src={cookieYetiIcon} alt="" className="h-6 w-6 rounded" aria-hidden="true" />
              <span className="text-sm font-semibold text-foreground">Cookie Yeti</span>
              <span className="ml-auto text-xs text-muted-foreground">demo-site.example</span>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              See a banner Cookie Yeti didn't handle? One click teaches the yeti.
            </p>
            <Button
              onClick={onReport}
              className="mt-3 w-full h-11 bg-[#2DB3A6] hover:bg-[#249b90] text-white font-semibold"
            >
              <Flag className="h-4 w-4 mr-2" aria-hidden="true" />
              Report missed banner
            </Button>
          </div>
        )}

        {stage === "reported" && (
          <div
            className="absolute inset-x-3 bottom-3 rounded-xl border border-[#2DB3A6]/40 bg-[#2DB3A6]/5 shadow-lg p-5 text-center motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:fade-in motion-safe:duration-300"
            role="status"
          >
            <CheckCircle2 className="h-8 w-8 text-[#2DB3A6] mx-auto" aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold text-foreground">Report sent — your yeti is learning</p>
            <p className="mt-1 text-xs text-muted-foreground">
              In the real app, our system analyzes the banner so it's handled automatically next time — for you and everyone else.
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={onReset}
              className="mt-3 h-11 sm:h-9 text-[#2DB3A6] hover:text-[#249b90] hover:bg-[#2DB3A6]/10"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              Try the demo again
            </Button>
          </div>
        )}
      </div>
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
    <div className="mx-auto w-full max-w-[600px]">
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
    <figure className="mt-5">
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
      <figcaption className="mt-5 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#2DB3A6]">{eyebrow}</p>
        <p className="mt-1 text-base font-semibold text-foreground">{caption}</p>
      </figcaption>
    </figure>
  );
}
