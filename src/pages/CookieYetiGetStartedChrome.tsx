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
function PuzzleArrow() {
  return (
    <div className="pointer-events-none fixed top-2 right-3 z-50 hidden md:flex flex-col items-center animate-bounce">
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
          placeholderLabel="Puzzle (Extensions) menu — pin Cookie Yeti"
          placeholderHint="The Extensions dropdown with the pin next to Cookie Yeti."
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
          placeholderLabel="Cookie Yeti panel open from the toolbar"
          placeholderHint="Insights tab: status, stats, and the Report button."
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
          placeholderLabel="Control tab with the privacy modes"
          placeholderHint="The panel's Control tab: Strict / Balanced / Permissive."
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
          <p className="mt-2 text-center text-xs text-muted-foreground">Practice here — it's just a demo</p>
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

      <PuzzleArrow />

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
              Chrome
            </span>
            <h1 className="mt-4 text-4xl sm:text-5xl font-extrabold tracking-tight text-foreground">
              You're all set.
            </h1>
            <p className="mt-3 text-lg text-muted-foreground max-w-xl mx-auto">
              Cookie Yeti is already closing those "Accept Cookies?" pop-ups for you in Chrome. Pin it so it's
              one click away — here's the 30-second tour.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* Steps — swipeable carousel on mobile, stacked on desktop */}
      <section className="mx-auto max-w-3xl px-6 pb-20">
        <div
          className="
            flex gap-5 overflow-x-auto snap-x snap-mandatory -mx-6 px-6 pb-4
            md:block md:gap-0 md:space-y-16 md:overflow-visible md:mx-0 md:px-0 md:pb-0
            [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden
          "
        >
          {steps.map((s, i) => (
            <AnimatedSection key={s.n} delay={i * 60}>
              <div className="snap-center shrink-0 w-[86%] sm:w-[70%] md:w-auto md:shrink">
                <div className="flex items-center gap-3">
                  <StepBadge n={s.n} />
                  <h2 className="text-2xl font-bold tracking-tight text-foreground">{s.title}</h2>
                </div>
                <p className="mt-3 text-muted-foreground leading-relaxed">{s.body}</p>
                {s.showcase}
                {s.n === 4 && (
                  <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5 text-[#2DB3A6]" aria-hidden="true" />
                    Real reports send only the pop-up's pattern and the site's name — never your personal data.
                  </p>
                )}
              </div>
            </AnimatedSection>
          ))}
        </div>

        <p className="mt-3 text-center text-xs text-muted-foreground md:hidden">Swipe to see all 4 steps →</p>

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
