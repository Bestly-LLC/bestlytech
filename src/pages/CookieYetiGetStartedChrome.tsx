import { useState } from "react";
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

// CY-GS-02 (Chrome): Desktop Chrome onboarding. Teaches the Chrome flow:
// 1) Pin Cookie Yeti from the puzzle (Extensions) menu, 2) click the toolbar
// icon to open the popup panel, 3) report a missed banner (interactive demo,
// nothing is sent).

const FAQ = [
  {
    q: "What gets sent when I report a banner?",
    a: "Only the banner's structure (its HTML pattern) and the site's domain — never your browsing history, personal data, or anything you typed. Reports exist purely to teach Cookie Yeti new banner patterns.",
  },
  {
    q: "Do I need to report every banner I see?",
    a: "No — Cookie Yeti handles the vast majority automatically. Reporting is just for the rare stragglers. One report per site is plenty; our system takes it from there.",
  },
  {
    q: "I don't see the Cookie Yeti icon — where is it?",
    a: "Click the puzzle-piece (Extensions) icon at the top-right of Chrome, find Cookie Yeti in the list, and click the pin icon next to it so it stays in your toolbar. Then you can click the Yeti icon directly any time.",
  },
  {
    q: "Does Cookie Yeti clean cookies in Chrome too?",
    a: "Yes. Beyond dismissing consent banners, Cookie Yeti clears known tracking cookies as you browse. Your panel shows how many it has cleaned. It never touches the cookies that keep you logged in to sites you use.",
  },
];

export default function CookieYetiGetStartedChrome() {
  const [stage, setStage] = useState<DemoStage>("banner");

  return (
    <>
      <SEOHead
        title="Get Started with Cookie Yeti for Chrome"
        description="Just added Cookie Yeti to Chrome? Pin it to your toolbar, open the panel, and learn how to report a missed cookie banner in one click."
        path="/cookie-yeti/get-started/chrome"
      />

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
              You're protected.
            </h1>
            <p className="mt-3 text-lg text-muted-foreground max-w-xl mx-auto">
              Cookie Yeti is already added to Chrome and clearing cookie banners in
              the background. Pin it to your toolbar and you're all set — here's the tour.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* Steps */}
      <section className="mx-auto max-w-3xl px-6 pb-20 space-y-16">
        {/* Step 1 — pin it */}
        <AnimatedSection>
          <div className="flex items-center gap-3">
            <StepBadge n={1} />
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              Pin Cookie Yeti to your toolbar
            </h2>
          </div>
          <p className="mt-3 text-muted-foreground leading-relaxed">
            Click the <strong className="text-foreground">puzzle-piece icon</strong> at the
            top-right of Chrome to open the Extensions menu, find{" "}
            <strong className="text-foreground">Cookie Yeti</strong>, and click the{" "}
            <strong className="text-foreground">pin</strong> next to it. The Yeti icon now lives
            in your toolbar, one click away.
          </p>
          <DeviceShowcase
            eyebrow="Pin it"
            caption="Keep Cookie Yeti one click away in your Chrome toolbar."
            placeholderLabel="C1 — Puzzle (Extensions) menu, pin Cookie Yeti"
            placeholderHint="Extensions dropdown with the pin icon next to Cookie Yeti."
          />
        </AnimatedSection>

        {/* Step 2 — open the panel */}
        <AnimatedSection delay={80}>
          <div className="flex items-center gap-3">
            <StepBadge n={2} />
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              Open your panel — right now
            </h2>
          </div>
          <p className="mt-3 text-muted-foreground leading-relaxed">
            Click the <strong className="text-foreground">Cookie Yeti icon</strong> in your toolbar
            to open the panel. You'll see live stats — banners handled, time saved, tracking
            cookies cleaned — plus your privacy mode and the{" "}
            <strong className="text-foreground">Report a missed banner</strong> button.
          </p>
          <DeviceShowcase
            url="bestly.tech"
            eyebrow="Your panel"
            caption="Live stats and one-click reporting, right in your toolbar."
            placeholderLabel="C2 — Cookie Yeti popup open from the toolbar"
            placeholderHint="Insights tab: Active status, stats, and Report a missed banner."
          />
        </AnimatedSection>

        {/* Step 3 — pick your privacy mode (Control tab) */}
        <AnimatedSection delay={110}>
          <div className="flex items-center gap-3">
            <StepBadge n={3} />
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              Pick your privacy mode
            </h2>
          </div>
          <p className="mt-3 text-muted-foreground leading-relaxed">
            In the popup, switch to the <strong className="text-foreground">Control</strong> tab to
            choose how Cookie Yeti answers consent banners — <strong className="text-foreground">Strict</strong>{" "}
            (essential cookies only), <strong className="text-foreground">Balanced</strong> (recommended),
            or <strong className="text-foreground">Permissive</strong>. Set it once and it applies
            everywhere; you can change it any time.
          </p>
          <DeviceShowcase
            url="bestly.tech"
            eyebrow="Your call"
            caption="Strict, Balanced, or Permissive — set your privacy in one click."
            placeholderLabel="C3 — Control tab with the privacy modes"
            placeholderHint="The popup's Control tab showing Strict / Balanced / Permissive."
          />
        </AnimatedSection>

        {/* Step 4 + interactive demo */}
        <AnimatedSection delay={120}>
          <div className="flex items-center gap-3">
            <StepBadge n={4} />
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              Report a missed banner — try it here
            </h2>
          </div>
          <p className="mt-3 text-muted-foreground leading-relaxed">
            Cookie Yeti handles almost every consent pop-up before you notice. Once in a while a
            site uses a banner the yeti hasn't learned yet — when that happens, open your panel and
            click <strong className="text-foreground">Report a missed banner</strong>. One click
            teaches the yeti. Practice the whole flow safely below — nothing is actually sent.
          </p>
          <div className="mt-5 max-w-xl mx-auto">
            <FakeBannerDemo
              stage={stage}
              onOpenPanel={() => setStage("panel")}
              onReport={() => setStage("reported")}
              onReset={() => setStage("banner")}
            />
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Practice here — it's just a demo
            </p>
          </div>
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-[#2DB3A6]" aria-hidden="true" />
            Real reports send only the banner's pattern and the site's domain — never your personal data.
          </p>
        </AnimatedSection>

        {/* FAQ */}
        <AnimatedSection delay={200}>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Quick questions</h2>
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
