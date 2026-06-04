import { useState } from "react";
import { Link } from "react-router-dom";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import cookieYetiIcon from "@/assets/cookieyeti-icon.png";
import settingsScreenshot from "@/assets/cookieyeti-settings-iphone.png";
import safariMenuShot from "@/assets/cy-safari-menu.png";
import safariBannerShot from "@/assets/cy-safari-banner.png";
import panelReportShot from "@/assets/cy-panel-report.png";
import {
  Puzzle,
  Cookie,
  CheckCircle2,
  Flag,
  ArrowLeft,
  Globe,
  Lock,
  RotateCcw,
  Sparkles,
} from "lucide-react";

// CY-GS-01: Post-download onboarding guide. Teaches three things:
// 1) Where the Cookie Yeti panel lives in Safari (the puzzle icon)
// 2) What a missed cookie banner looks like (interactive fake demo)
// 3) How to report it (practice run on the fake banner — purely client-side,
//    nothing is sent to the real missed-banner API)

type DemoStage = "banner" | "panel" | "reported";

const TEAL = "#2DB3A6";

function FakeBannerDemo({
  stage,
  onOpenPanel,
  onReport,
  onReset,
}: {
  stage: DemoStage;
  onOpenPanel: () => void;
  onReport: () => void;
  onReset: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Mock page chrome */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/60 border-b border-border text-xs text-muted-foreground">
        <Globe className="h-3.5 w-3.5" aria-hidden="true" />
        <span>demo-site.example</span>
        <span className="ml-auto rounded-full bg-[#2DB3A6]/10 text-[#2DB3A6] px-2 py-0.5 font-semibold uppercase tracking-wide text-[10px]">
          Demo
        </span>
      </div>

      {/* Mock page content */}
      <div className="relative px-4 sm:px-6 pt-5 pb-4 min-h-[290px]">
        <div className="space-y-2.5 opacity-50" aria-hidden="true">
          <div className="h-4 w-2/3 rounded bg-muted" />
          <div className="h-3 w-full rounded bg-muted" />
          <div className="h-3 w-11/12 rounded bg-muted" />
          <div className="h-3 w-4/5 rounded bg-muted" />
          <div className="h-24 w-full rounded-lg bg-muted mt-4" />
        </div>

        {/* Stage: the missed banner */}
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
                Open Cookie Yeti
              </Button>
            </div>
          </div>
        )}

        {/* Stage: the Cookie Yeti panel */}
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
              See a banner Cookie Yeti didn't handle? One tap teaches the yeti.
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

        {/* Stage: success */}
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
    q: "I don't see the puzzle icon — where is it?",
    a: "In Safari on iPhone, the puzzle-piece icon sits on the left side of the address bar at the bottom of your screen. If it's not there, make sure the extension is enabled: Settings → Apps → Safari → Extensions → Cookie Yeti → Allow Extension.",
  },
];

function StepBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2DB3A6] text-white text-sm font-bold">
      {n}
    </span>
  );
}

export default function CookieYetiGetStarted() {
  const [stage, setStage] = useState<DemoStage>("banner");

  return (
    <>
      <SEOHead
        title="Get Started with Cookie Yeti"
        description="Just downloaded Cookie Yeti? Learn where the panel lives in Safari, what a missed cookie banner looks like, and how to report one in a single tap."
        path="/cookie-yeti/get-started"
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
            <h1 className="mt-6 text-4xl sm:text-5xl font-extrabold tracking-tight text-foreground">
              You're protected.
            </h1>
            <p className="mt-3 text-lg text-muted-foreground max-w-xl mx-auto">
              Setup's done — this page is your practice run. In fact, Cookie Yeti
              probably just handled this site's cookie banner before you noticed.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* Steps */}
      <section className="mx-auto max-w-3xl px-6 pb-20 space-y-16">
        {/* Step 1 */}
        <AnimatedSection>
          <div className="flex items-center gap-3">
            <StepBadge n={1} />
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              Open your panel — right now
            </h2>
          </div>
          <p className="mt-3 text-muted-foreground leading-relaxed">
            You're already in Safari, so try it on this very page: tap the menu button in
            the address bar at the bottom of your screen, then tap{" "}
            <strong className="text-foreground">Cookie Yeti</strong>. Your panel opens with
            live stats — banners handled, your privacy mode, and the report button.
          </p>
          <div className="mt-5 grid gap-6 sm:grid-cols-2 sm:items-start">
            <div>
              <img
                src={safariMenuShot}
                alt="Real screenshot of Safari on iPhone with the page menu open, showing the Cookie Yeti entry alongside Manage Extensions."
                className="mx-auto max-w-[320px] w-full rounded-[2rem] border-2 border-border shadow-sm"
                width={414}
                height={900}
                loading="lazy"
              />
              <p className="mt-2 text-center text-xs text-muted-foreground">
                1. Address bar menu → <span className="text-[#2DB3A6] font-semibold">Cookie Yeti</span>
              </p>
            </div>
            <div>
              <img
                src={panelReportShot}
                alt="Real screenshot of the Cookie Yeti panel open in Safari on iPhone, showing the Active status, live stats, and the Report a missed banner button."
                className="mx-auto max-w-[320px] w-full rounded-[2rem] border-2 border-border shadow-sm"
                width={414}
                height={900}
                loading="lazy"
              />
              <p className="mt-2 text-center text-xs text-muted-foreground">
                2. Your panel: stats, mode, and <span className="text-[#2DB3A6] font-semibold">Report a missed banner</span>
              </p>
            </div>
          </div>
        </AnimatedSection>

        {/* Step 2 */}
        <AnimatedSection delay={100}>
          <div className="flex items-center gap-3">
            <StepBadge n={2} />
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              Meet a missed banner
            </h2>
          </div>
          <p className="mt-3 text-muted-foreground leading-relaxed">
            Cookie Yeti handles almost every consent pop-up before you notice it. But
            once in a while a site uses a banner the yeti hasn't learned yet. Here's a
            real one in the wild — and below, a safe fake example you can practice on.
          </p>
          <img
            src={safariBannerShot}
            alt="Real screenshot of Safari on iPhone showing a website with a cookie consent banner at the bottom of the page, above the address bar."
            className="mt-5 mx-auto max-w-[320px] w-full rounded-[2rem] border-2 border-border shadow-sm"
            width={414}
            height={900}
            loading="lazy"
          />
          <p className="mt-2 text-center text-xs text-muted-foreground">
            A real cookie banner, doing its best to interrupt you
          </p>
        </AnimatedSection>

        {/* Step 3 + interactive demo */}
        <AnimatedSection delay={150}>
          <div className="flex items-center gap-3">
            <StepBadge n={3} />
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              Report it — try it right here
            </h2>
          </div>
          <p className="mt-3 text-muted-foreground leading-relaxed">
            One tap teaches the yeti. You saw the{" "}
            <strong className="text-foreground">Report a missed banner</strong> button in
            your panel in step 1 — practice the whole flow safely on the demo below.
            Nothing is actually sent.
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

        {/* Troubleshooting */}
        <AnimatedSection delay={180}>
          <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              Don't see Cookie Yeti in the menu?
            </h2>
            <div className="mt-4 grid gap-6 sm:grid-cols-2 sm:items-center">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Open the Cookie Yeti app and check the Settings tab — Extension Status
                should read <strong className="text-foreground">Active in Safari</strong>.
                If it doesn't, tap{" "}
                <strong className="text-foreground">Open Safari Extension Settings</strong>{" "}
                and flip the toggle on, then come back to this page and try again.
              </p>
              <img
                src={settingsScreenshot}
                alt="Real screenshot of the Cookie Yeti app's Settings tab on iPhone, showing Extension Status as Active in Safari and the three privacy modes."
                className="mx-auto max-w-[240px] w-full rounded-[1.5rem] border-2 border-border shadow-sm"
                width={415}
                height={900}
                loading="lazy"
              />
            </div>
          </div>
        </AnimatedSection>

        {/* FAQ */}
        <AnimatedSection delay={200}>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Quick questions</h2>
          <Accordion type="single" collapsible className="mt-4">
            {FAQ.map((item, i) => (
              <AccordionItem key={i} value={`faq-${i}`}>
                <AccordionTrigger className="text-left text-foreground">{item.q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground leading-relaxed">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </AnimatedSection>

        {/* Footer CTA */}
        <AnimatedSection delay={250}>
          <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 text-center shadow-sm">
            <Lock className="h-6 w-6 text-[#2DB3A6] mx-auto" aria-hidden="true" />
            <h2 className="mt-3 text-xl font-bold tracking-tight text-foreground">
              That's the whole tour
            </h2>
            <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
              Browse like normal — Cookie Yeti works quietly in the background. If
              anything ever feels off, we're one tap away.
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
        </AnimatedSection>
      </section>
    </>
  );
}
