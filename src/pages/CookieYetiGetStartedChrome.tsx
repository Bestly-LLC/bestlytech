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
import { Sparkles } from "lucide-react";
import { StepCarousel } from "@/components/cookieyeti/StepCarousel";
import cyPanelInsights from "@/assets/cy-panel-insights.png";
import cyPanelControl from "@/assets/cy-panel-control.png";
import cyPinPuzzle from "@/assets/cy-pin-puzzle.png";

// CY-GS-02 (Chrome): plain-English onboarding. Pin from the puzzle menu, open
// the panel, pick a mode, report a miss. Mobile = swipeable carousel; desktop =
// stacked. A hovering arrow points up at the real Chrome puzzle icon.

const FAQ = [
  {
    q: "What gets sent when I report a pop-up?",
    a: "Only the pop-up's layout and the site's name — never your browsing history or anything you typed. Reports just teach Cookie Yeti new pop-ups to close.",
  },
  {
    q: "Do I have to report every pop-up?",
    a: "No. Cookie Yeti closes almost all of them by itself. Reporting is only for the rare one it misses — and once you report a site, it's handled for everyone.",
  },
  {
    q: "I can't find the Cookie Yeti icon — where is it?",
    a: "Click the puzzle piece at the top-right of Chrome, find Cookie Yeti, and click the little pin next to it. Now the Yeti stays in your toolbar, one click away.",
  },
  {
    q: "Does it clean cookies too?",
    a: "Yes. On top of closing pop-ups, Cookie Yeti clears tracking cookies as you browse — but never the ones that keep you logged in. Your panel shows the count.",
  },
];

// Hovering arrow that points up toward the real Chrome puzzle/extensions icon.
// Lives inside the relatively-positioned hero section so it scrolls away with
// the page instead of staying pinned to the viewport.
function PuzzleArrow() {
  return (
    <div className="pointer-events-none absolute top-2 right-3 z-20 hidden md:flex flex-col items-center animate-bounce">
      <svg width="30" height="34" viewBox="0 0 30 34" fill="none" aria-hidden="true">
        <path d="M15 2v26M15 2 7 11M15 2l8 9" stroke="#2DB3A6" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="mt-1 rounded-full bg-[#2DB3A6] px-3 py-1 text-xs font-bold text-white shadow-lg whitespace-nowrap">
        Your extensions live up here
      </span>
    </div>
  );
}

type Step = { n: number; title: string; body: ReactNode; showcase: ReactNode };

export default function CookieYetiGetStartedChrome() {
  const [stage, setStage] = useState<DemoStage>("banner");
  // CY-GS: reveal FAQ + end CTA only once the tour reaches its final step, so
  // the core tour stays within one mobile viewport with no scroll.
  const [atLast, setAtLast] = useState(false);

  const steps: Step[] = [
    {
      n: 1,
      title: "Pin the Yeti so you can find it",
      body: (
        <>
          Click the <strong className="text-foreground">puzzle piece</strong> at the very top-right of
          Chrome (see the arrow). Find <strong className="text-foreground">Cookie Yeti</strong> and click
          the <strong className="text-foreground">pin</strong> — now the Yeti sits in your toolbar, one click away.
        </>
      ),
      showcase: (
        <DeviceShowcase
          eyebrow="Pin it"
          caption="Keep Cookie Yeti one click away in your toolbar."
          image={cyPinPuzzle}
          imageAlt="Chrome Extensions puzzle menu with Cookie Yeti pinned to the toolbar."
        />
      ),
    },
    {
      n: 2,
      title: "Click the Yeti to open your panel",
      body: (
        <>
          Tap the <strong className="text-foreground">Yeti icon</strong> in your toolbar. You'll see how many
          pop-ups it's closed for you — plus a big button to{" "}
          <strong className="text-foreground">report one it missed</strong>.
        </>
      ),
      showcase: (
        <DeviceShowcase
          url="bestly.tech"
          eyebrow="Your panel"
          caption="Live stats and one-tap reporting, right in your toolbar."
          image={cyPanelInsights}
          imageAlt="Cookie Yeti panel — Insights tab: Active status, live stats, and the amber Report a missed banner button."
        />
      ),
    },
    {
      n: 3,
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
      n: 4,
      title: "See one it missed? Tap Report — try it here",
      body: (
        <>
          Cookie Yeti closes almost every pop-up before you notice. If one slips through, open the panel and
          tap <strong className="text-foreground">Report a missed banner</strong> — one tap teaches it. Try the
          whole thing safely below. Nothing is actually sent.
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
          <p className="mt-2 hidden text-center text-xs text-muted-foreground sm:block">Practice here — it's just a demo</p>
        </div>
      ),
    },
  ];

  return (
    <>
      <SEOHead
        title="Get Started with Cookie Yeti for Chrome"
        description="Just added Cookie Yeti to Chrome? Pin it to your toolbar, open the panel, pick a mode, and learn to report a missed cookie pop-up in one tap."
        path="/cookie-yeti/get-started/chrome"
      />

      {/* CY-GS: single-viewport tour shell. On mobile the compact hero + step
          carousel fill exactly one screen (100dvh minus the 52px compact
          header) with no scroll. Desktop keeps the fuller stacked layout. */}
      <div className="mx-auto flex min-h-[calc(100dvh_-_var(--cy-hdr,52px))] max-w-3xl flex-col justify-center px-4 pb-4 sm:px-6 md:min-h-0 md:justify-start md:pb-20">
        {/* Hero (compact on mobile, fuller on sm+) */}
        <section className="relative pt-3 pb-3 text-center sm:pt-8 sm:pb-6">
          <PuzzleArrow />
          <AnimatedSection>
            <img
              src={cookieYetiIcon}
              alt="Cookie Yeti app icon"
              className="mx-auto h-12 w-12 rounded-2xl shadow-md sm:h-20 sm:w-20"
              width={80}
              height={80}
            />
            <span className="mt-2 hidden rounded-full bg-[#2DB3A6]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#2DB3A6] sm:mt-5 sm:inline-block">
              Chrome
            </span>
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-foreground sm:mt-4 sm:text-5xl">
              You're all set.
            </h1>
            <p className="mx-auto mt-3 hidden max-w-xl text-lg text-muted-foreground sm:block">
              Cookie Yeti is already closing those "Accept Cookies?" pop-ups for you in Chrome. Pin it so it's
              one click away — here's the 30-second tour.
            </p>
          </AnimatedSection>
        </section>

        {/* Steps — swipeable carousel on mobile, stacked on desktop */}
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
              {s.n === 4 && (
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
