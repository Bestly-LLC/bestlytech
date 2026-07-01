import { useState, type ReactNode } from "react";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import cookieYetiIcon from "@/assets/cookieyeti-icon.png";
import {
  StepBadge,
  DeviceShowcase,
  FakeBannerDemo,
  GetStartedFAQ,
  GetStartedFooterCTA,
  type DemoStage,
} from "@/components/cookieyeti/getStartedShared";
import { StepCarousel } from "@/components/cookieyeti/StepCarousel";
import cyPanelInsights from "@/assets/cy-panel-insights.png";
import cyPanelControl from "@/assets/cy-panel-control.png";
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

// Hovering arrow pointing up to the Safari toolbar (top-right) where the Yeti lives.
function ToolbarArrow() {
  return (
    <div className="pointer-events-none fixed top-2 right-4 z-50 hidden md:flex flex-col items-center animate-bounce">
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
  const [stage, setStage] = useState<DemoStage>("banner");

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
          placeholderLabel="Safari ▸ Settings ▸ Extensions"
          placeholderHint="The Extensions pane with Cookie Yeti ticked."
        />
      ),
    },
    {
      n: 2,
      title: "Let it work on every site",
      body: (
        <>
          Click the <strong className="text-foreground">Yeti icon</strong> in your Safari toolbar (top-right — see
          the arrow). The first time, Safari asks for permission — choose{" "}
          <strong className="text-foreground">Always Allow on Every Website</strong> so it can close banners
          everywhere. It only looks for cookie banners, nothing else.
        </>
      ),
      showcase: (
        <DeviceShowcase
          eyebrow="Allow everywhere"
          caption="Allow once, and the Yeti works on every site."
          placeholderLabel="Toolbar icon + “Always Allow on Every Website”"
          placeholderHint="The Yeti in the toolbar and Safari's permission prompt."
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
          Cookie Yeti closes almost every pop-up before you notice. If one slips through, open the panel and tap{" "}
          <strong className="text-foreground">Report a missed banner</strong> — one tap teaches it. Try the whole
          thing safely below. Nothing is actually sent.
        </>
      ),
      showcase: (
        <div className="mt-5 max-w-xl mx-auto">
          <FakeBannerDemo
            stage={stage}
            onOpenPanel={() => setStage("panel")}
            onReport={() => setStage("reported")}
            onReset={() => setStage("banner")}
          />
          <p className="mt-2 text-center text-xs text-muted-foreground">Practice here — it's just a demo</p>
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

      <ToolbarArrow />

      {/* Hero */}
      <section className="bg-[#F7F9FB] dark:bg-background">
        <div className="mx-auto max-w-3xl px-6 pt-16 pb-12 text-center">
          <AnimatedSection>
            <img
              src={cookieYetiIcon}
              alt="Cookie Yeti app icon"
              className="h-20 w-20 rounded-2xl mx-auto shadow-md"
              width={80}
              height={80}
            />
            <span className="mt-5 inline-block rounded-full bg-[#2DB3A6]/10 text-[#2DB3A6] px-3 py-1 text-xs font-semibold uppercase tracking-wide">
              Safari on Mac
            </span>
            <h1 className="mt-4 text-4xl sm:text-5xl font-extrabold tracking-tight text-foreground">
              You're almost set.
            </h1>
            <p className="mt-3 text-lg text-muted-foreground max-w-xl mx-auto">
              Two quick clicks to switch Cookie Yeti on in Safari, then it closes those "Accept Cookies?" pop-ups
              for you while you browse. Here's the 30-second tour.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* Steps carousel */}
      <section className="mx-auto max-w-3xl px-6 pb-20">
        <StepCarousel
          accent="#2DB3A6"
          steps={steps.map((s) => (
            <div key={s.n}>
              <div className="flex items-center gap-3">
                <StepBadge n={s.n} />
                <h2 className="text-2xl font-bold tracking-tight text-foreground">{s.title}</h2>
              </div>
              <p className="mt-3 text-muted-foreground leading-relaxed">{s.body}</p>
              {s.showcase}
              {s.n === 5 && (
                <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-[#2DB3A6]" aria-hidden="true" />
                  Real reports send only the pop-up's pattern and the site's name — never your personal data.
                </p>
              )}
            </div>
          ))}
        />

        {/* FAQ */}
        <AnimatedSection delay={200}>
          <h2 className="mt-16 text-2xl font-bold tracking-tight text-foreground">Quick questions</h2>
          <GetStartedFAQ items={FAQ} />
        </AnimatedSection>

        {/* Footer CTA */}
        <AnimatedSection delay={250}>
          <GetStartedFooterCTA />
        </AnimatedSection>
      </section>
    </>
  );
}
