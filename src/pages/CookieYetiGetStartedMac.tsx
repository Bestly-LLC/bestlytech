import { useState, type ReactNode } from "react";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import cookieYetiIcon from "@/assets/cookieyeti-icon.png";
import {
  StepBadge,
  DeviceShowcase,
  LiveReportDemo,
  GetStartedFAQ,
  GetStartedFooterCTA,
} from "@/components/cookieyeti/getStartedShared";
import { StepCarousel } from "@/components/cookieyeti/StepCarousel";
import cyPanelInsights from "@/assets/cy-panel-insights.png";
import cyPanelControl from "@/assets/cy-panel-control.png";
import cySafariExtensions from "@/assets/cy-safari-extensions.png";
import cySafariAllow from "@/assets/cy-safari-allow.png";
import { Sparkles } from "lucide-react";

// CY-GS-02 (macOS): plain-English Safari-on-Mac onboarding as an animated step
// carousel. Turn it on in Safari Settings, allow on every site, open the panel,
// pick a mode, report a miss. Arrow points up to the Safari toolbar.

const FAQ = [
  {
    q: "What gets sent when I report a pop-up?",
    a: "Only the pop-up's layout and the site's name — never your browsing history or anything you typed. Reports just teach Cookie Yeti new pop-ups to close.",
  },
  {
    q: "Do I have to report every pop-up?",
    a: "No. Cookie Yeti closes almost all of them by itself. Reporting is only for the rare one it misses — one report per site is plenty.",
  },
  {
    q: "I don't see the Yeti icon in my toolbar — where is it?",
    a: "Open Safari ▸ Settings ▸ Extensions and make sure Cookie Yeti is ticked. If the icon still isn't in the toolbar, right-click the toolbar ▸ Customize Toolbar and drag the Yeti in. You may also need to click it once and choose “Always Allow on Every Website.”",
  },
  {
    q: "Why does Safari ask permission on every site?",
    a: "Safari makes every extension ask before it can see a page. Choosing “Always Allow on Every Website” lets Cookie Yeti close banners everywhere. It only ever looks for cookie banners — never your browsing.",
  },
];

// Hovering arrow pointing up to the Safari toolbar (top-left, left of the address
// bar) where Safari puts extension icons. Lives inside the relatively-positioned
// hero section so it scrolls away with the page instead of staying pinned to
// the viewport.
function ToolbarArrow() {
  return (
    <div className="pointer-events-none absolute top-2 left-1/4 z-20 hidden md:flex flex-col items-center animate-bounce">
      <svg width="30" height="34" viewBox="0 0 30 34" fill="none" aria-hidden="true">
        <path d="M15 2v26M15 2 7 11M15 2l8 9" stroke="#2DB3A6" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="mt-1 rounded-full bg-[#2DB3A6] px-3 py-1 text-xs font-bold text-white shadow-lg whitespace-nowrap">
        The Yeti lives in your toolbar
      </span>
    </div>
  );
}

type Step = { n: number; title: string; body: ReactNode; showcase: ReactNode };

export default function CookieYetiGetStartedMac() {
  // CY-GS: reveal FAQ + end CTA only once the tour reaches its final step, so
  // the core tour stays within one mobile viewport with no scroll.
  const [atLast, setAtLast] = useState(false);

  const steps: Step[] = [
    {
      n: 1,
      title: "Switch it on in Safari",
      body: (
        <>
          Open <strong className="text-foreground">Safari ▸ Settings</strong> (or press{" "}
          <kbd className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">⌘ ,</kbd>), click{" "}
          <strong className="text-foreground">Extensions</strong>, and tick the box next to{" "}
          <strong className="text-foreground">Cookie Yeti</strong>. That's it — the Yeti is now on.
        </>
      ),
      showcase: (
        <DeviceShowcase
          eyebrow="Switch it on"
          caption="One checkbox in Safari Settings turns Cookie Yeti on."
          image={cySafariExtensions}
          imageAlt="Safari Settings ▸ Extensions with Cookie Yeti ticked on."
        />
      ),
    },
    {
      n: 2,
      title: "Let it work on every site",
      body: (
        <>
          Click the <strong className="text-foreground">Yeti icon</strong> in your Safari toolbar (top-left, just left of the address bar — see
          the arrow). The first time, Safari asks for permission — choose{" "}
          <strong className="text-foreground">Always Allow on Every Website</strong> so it can close banners
          everywhere. It only looks for cookie banners, nothing else.
        </>
      ),
      showcase: (
        <DeviceShowcase
          eyebrow="Allow everywhere"
          caption="Allow once, and the Yeti works on every site."
          image={cySafariAllow}
          imageAlt="Safari toolbar with Cookie Yeti and the ‘Always Allow on Every Website’ prompt."
        />
      ),
    },
    {
      n: 3,
      title: "Click the Yeti to open your panel",
      body: (
        <>
          Click the <strong className="text-foreground">Yeti icon</strong> any time to open your panel — how many
          pop-ups it's closed, cookies cleaned, and a big{" "}
          <strong className="text-foreground">Report a missed banner</strong> button.
        </>
      ),
      showcase: (
        <DeviceShowcase
          url="bestly.tech"
          eyebrow="Your panel"
          caption="Live stats and one-click reporting, right in your toolbar."
          image={cyPanelInsights}
          imageAlt="Cookie Yeti panel — Insights tab: Active status, live stats, and the amber Report a missed banner button."
        />
      ),
    },
    {
      n: 4,
      title: "Choose how strict to be",
      body: (
        <>
          Open the <strong className="text-foreground">Control</strong> tab and pick{" "}
          <strong className="text-foreground">Strict</strong>,{" "}
          <strong className="text-foreground">Balanced</strong> (best for most), or{" "}
          <strong className="text-foreground">Permissive</strong>. Set it once — it works on every site.
        </>
      ),
      showcase: (
        <DeviceShowcase
          url="bestly.tech"
          eyebrow="Your call"
          caption="Strict, Balanced, or Permissive — set it once."
          image={cyPanelControl}
          imageAlt="Cookie Yeti panel — Control tab: Strict, Balanced, and Permissive privacy modes."
        />
      ),
    },
    {
      n: 5,
      title: "See one it missed? Tap Report — try it here",
      body: (
        <>
          Cookie Yeti closes almost every pop-up before you notice. If one slips through, open your panel and tap{" "}
          <strong className="text-foreground">Report a missed banner</strong>. The demo below is a real page
          with a real banner — reporting it sends a real report through your Cookie Yeti.
        </>
      ),
      showcase: (
        <div className="mt-5 max-w-xl mx-auto">
          <LiveReportDemo platform="mac" />
        </div>
      ),
    },
  ];

  return (
    <>
      <SEOHead
        title="Get Started with Cookie Yeti for Mac"
        description="Just installed Cookie Yeti on your Mac? Turn it on in Safari, allow it on every site, open the panel, and learn to report a missed cookie pop-up in one tap."
        path="/cookie-yeti/get-started/mac"
      />

      {/* CY-GS: single-viewport tour shell. On mobile the compact hero + step
          carousel fill exactly one screen (100dvh minus the 52px compact
          header) with no scroll. Desktop keeps the fuller stacked layout. */}
      <div className="mx-auto flex min-h-[calc(100dvh_-_var(--cy-hdr,52px))] max-w-3xl flex-col justify-center px-4 pb-4 sm:px-6 md:min-h-0 md:justify-start md:pb-20">
        {/* Hero (compact on mobile, fuller on sm+) */}
        <section className="relative pt-3 pb-3 text-center sm:pt-8 sm:pb-6">
          <ToolbarArrow />
          <AnimatedSection>
            <img
              src={cookieYetiIcon}
              alt="Cookie Yeti app icon"
              className="mx-auto h-12 w-12 rounded-2xl shadow-md sm:h-20 sm:w-20"
              width={80}
              height={80}
            />
            <span className="mt-2 hidden rounded-full bg-[#2DB3A6]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#2DB3A6] sm:mt-5 sm:inline-block">
              Safari on Mac
            </span>
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-foreground sm:mt-4 sm:text-5xl">
              You're almost set.
            </h1>
            <p className="mx-auto mt-3 hidden max-w-xl text-lg text-muted-foreground sm:block">
              Two quick clicks to switch Cookie Yeti on in Safari, then it closes those "Accept Cookies?" pop-ups
              for you while you browse. Here's the 30-second tour.
            </p>
          </AnimatedSection>
        </section>

        {/* Steps carousel */}
        <StepCarousel
          accent="#2DB3A6"
          onIndexChange={(idx, total) => setAtLast(idx === total - 1)}
          steps={steps.map((s) => (
            <div key={s.n}>
              <div className="flex items-center gap-3">
                <StepBadge n={s.n} />
                <h2 className="text-2xl font-bold tracking-tight text-foreground">{s.title}</h2>
              </div>
              <p className="mt-3 text-muted-foreground leading-relaxed">{s.body}</p>
              {s.showcase}
              {s.n === 5 && (
                <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground sm:mt-3">
                  <Sparkles className="h-3.5 w-3.5 text-[#2DB3A6]" aria-hidden="true" />
                  Real reports send only the pop-up's pattern and the site's name — never your personal data.
                </p>
              )}
            </div>
          ))}
        />

        {/* Secondary content — hidden on mobile until the tour's last step
            (display:none contributes no height, so the tour never scrolls),
            always shown on desktop. */}
        <div className={atLast ? "block" : "hidden md:block"}>
          {/* FAQ */}
          <AnimatedSection delay={200}>
            <h2 className="mt-12 text-2xl font-bold tracking-tight text-foreground sm:mt-16">Quick questions</h2>
            <GetStartedFAQ items={FAQ} />
          </AnimatedSection>

          {/* Footer CTA */}
          <AnimatedSection delay={250}>
            <div className="mt-12 sm:mt-16">
              <GetStartedFooterCTA />
            </div>
          </AnimatedSection>
        </div>
      </div>
    </>
  );
}
