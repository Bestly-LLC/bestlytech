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

// CY-GS-02 (macOS): Desktop Safari onboarding. Teaches the Mac flow:
// 1) Turn the extension on in Safari ▸ Settings ▸ Extensions and allow it on
//    every website, 2) find the Yeti icon in the Safari toolbar and open the
//    panel, 3) report a missed banner (interactive demo, nothing is sent).

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
    q: "I don't see the Yeti icon in my toolbar — where is it?",
    a: "Open Safari ▸ Settings ▸ Extensions and make sure Cookie Yeti is checked. If the icon still isn't in the toolbar, go to View ▸ Customize Toolbar (or right-click the toolbar) and drag the Cookie Yeti icon into place. You may also need to click the icon once and choose “Always Allow on Every Website.”",
  },
  {
    q: "Why does Safari ask for permission on every site?",
    a: "Safari requires extensions to request access to page content. Choosing “Always Allow on Every Website” lets Cookie Yeti handle consent banners everywhere automatically. Cookie Yeti never reads or stores your browsing — it only looks for cookie banners to dismiss.",
  },
];

export default function CookieYetiGetStartedMac() {
  const [stage, setStage] = useState<DemoStage>("banner");

  return (
    <>
      <SEOHead
        title="Get Started with Cookie Yeti for Mac"
        description="Just installed Cookie Yeti on your Mac? Turn it on in Safari, find the panel in your toolbar, and learn how to report a missed cookie banner in one click."
        path="/cookie-yeti/get-started/mac"
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
              Safari on Mac
            </span>
            <h1 className="mt-4 text-4xl sm:text-5xl font-extrabold tracking-tight text-foreground">
              You're almost protected.
            </h1>
            <p className="mt-3 text-lg text-muted-foreground max-w-xl mx-auto">
              Two quick clicks to switch Cookie Yeti on in Safari, then it handles
              cookie banners quietly while you browse. Here's the whole tour.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* Steps */}
      <section className="mx-auto max-w-3xl px-6 pb-20 space-y-16">
        {/* Step 1 — enable in Safari */}
        <AnimatedSection>
          <div className="flex items-center gap-3">
            <StepBadge n={1} />
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              Turn Cookie Yeti on in Safari
            </h2>
          </div>
          <p className="mt-3 text-muted-foreground leading-relaxed">
            Open <strong className="text-foreground">Safari ▸ Settings</strong> (or press{" "}
            <kbd className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">⌘ ,</kbd>), click the{" "}
            <strong className="text-foreground">Extensions</strong> tab, and tick the box next
            to <strong className="text-foreground">Cookie Yeti</strong>. That's it — the yeti is
            now watching for cookie banners.
          </p>
          <DeviceShowcase
            eyebrow="Switch it on"
            caption="Cookie Yeti turns on with a single checkbox in Safari."
            placeholderLabel="M1 — Safari ▸ Settings ▸ Extensions"
            placeholderHint="Extensions pane with the Cookie Yeti checkbox ticked."
          />
        </AnimatedSection>

        {/* Step 2 — allow on every website */}
        <AnimatedSection delay={80}>
          <div className="flex items-center gap-3">
            <StepBadge n={2} />
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              Allow it on every website
            </h2>
          </div>
          <p className="mt-3 text-muted-foreground leading-relaxed">
            Click the <strong className="text-foreground">Cookie Yeti icon</strong> in the Safari
            toolbar (top-right). The first time, Safari asks for permission — choose{" "}
            <strong className="text-foreground">Always Allow on Every Website</strong> so the yeti
            can clear banners everywhere automatically. Cookie Yeti only looks for cookie banners;
            it never reads or stores your browsing.
          </p>
          <DeviceShowcase
            eyebrow="Allow everywhere"
            caption="Grant access once and the yeti clears banners on every site."
            placeholderLabel="M2 — Toolbar icon + “Always Allow on Every Website”"
            placeholderHint="The Yeti icon in the toolbar and the Safari permission prompt."
          />
        </AnimatedSection>

        {/* Step 3 — open the panel */}
        <AnimatedSection delay={120}>
          <div className="flex items-center gap-3">
            <StepBadge n={3} />
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              Open your panel — right now
            </h2>
          </div>
          <p className="mt-3 text-muted-foreground leading-relaxed">
            Click the <strong className="text-foreground">Cookie Yeti icon</strong> in the toolbar
            any time to open your panel. You'll see live stats — banners handled, time saved,
            tracking cookies cleaned — plus your privacy mode and the{" "}
            <strong className="text-foreground">Report a missed banner</strong> button.
          </p>
          <DeviceShowcase
            url="bestly.tech"
            eyebrow="Your panel"
            caption="Live stats and one-click reporting, right in your toolbar."
            placeholderLabel="M3 — Cookie Yeti panel open from the toolbar"
            placeholderHint="Insights tab: Active status, stats, and Report a missed banner."
          />
        </AnimatedSection>

        {/* Step 4 — pick your privacy mode (Control tab) */}
        <AnimatedSection delay={140}>
          <div className="flex items-center gap-3">
            <StepBadge n={4} />
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              Pick your privacy mode
            </h2>
          </div>
          <p className="mt-3 text-muted-foreground leading-relaxed">
            In the panel, switch to the <strong className="text-foreground">Control</strong> tab to
            choose how Cookie Yeti answers consent banners — <strong className="text-foreground">Strict</strong>{" "}
            (essential cookies only), <strong className="text-foreground">Balanced</strong> (recommended),
            or <strong className="text-foreground">Permissive</strong>. Set it once and it applies
            everywhere; you can change it any time.
          </p>
          <DeviceShowcase
            url="bestly.tech"
            eyebrow="Your call"
            caption="Strict, Balanced, or Permissive — set your privacy in one tap."
            placeholderLabel="M4 — Control tab with the privacy modes"
            placeholderHint="The panel's Control tab showing Strict / Balanced / Permissive."
          />
        </AnimatedSection>

        {/* Step 5 + interactive demo */}
        <AnimatedSection delay={150}>
          <div className="flex items-center gap-3">
            <StepBadge n={5} />
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
