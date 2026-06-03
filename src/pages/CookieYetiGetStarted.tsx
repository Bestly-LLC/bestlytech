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
import {
  Puzzle,
  Cookie,
  CheckCircle2,
  Flag,
  ArrowRight,
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

function SafariToolbarMock() {
  return (
    <div
      className="mx-auto max-w-[320px] rounded-[2rem] border-2 border-border bg-card shadow-sm overflow-hidden"
      role="img"
      aria-label="Illustration of Safari on iPhone. The extensions puzzle icon sits on the left side of the address bar at the bottom of the screen. Tapping it reveals Cookie Yeti."
    >
      {/* Mock page content (phone screen) */}
      <div className="px-5 pt-6 pb-3 space-y-2.5 opacity-50" aria-hidden="true">
        <div className="h-3.5 w-2/3 rounded bg-muted" />
        <div className="h-2.5 w-full rounded bg-muted" />
        <div className="h-2.5 w-11/12 rounded bg-muted" />
        <div className="h-16 w-full rounded-lg bg-muted mt-3" />
      </div>

      {/* Extension sheet (appears above the address bar) */}
      <div className="px-4 pb-2">
        <div className="rounded-xl border border-border bg-background shadow-md p-2 motion-safe:animate-in motion-safe:slide-in-from-bottom-2 motion-safe:fade-in">
          <div className="flex items-center gap-3 rounded-lg bg-[#2DB3A6]/10 px-3 py-2.5">
            <img src={cookieYetiIcon} alt="" className="h-6 w-6 rounded" aria-hidden="true" />
            <span className="text-sm font-semibold text-foreground">Cookie Yeti</span>
            <ArrowRight className="h-4 w-4 ml-auto text-[#2DB3A6]" aria-hidden="true" />
          </div>
          <p className="px-3 pt-2 pb-1 text-[11px] text-muted-foreground">
            Tap the puzzle icon below, then Cookie Yeti, to open your panel on any site.
          </p>
        </div>
      </div>

      {/* iOS Safari bottom address bar — the star of the show */}
      <div className="flex items-center gap-2.5 px-3 pb-4 pt-2 bg-muted/60 border-t border-border">
        <div className="relative shrink-0">
          <span
            className="absolute inset-0 rounded-lg motion-safe:animate-ping bg-[#2DB3A6]/30"
            aria-hidden="true"
          />
          <span className="relative flex h-10 w-10 items-center justify-center rounded-lg border-2 border-[#2DB3A6] bg-[#2DB3A6]/10">
            <Puzzle className="h-5 w-5 text-[#2DB3A6]" aria-hidden="true" />
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-background border border-border px-3 py-2.5 text-sm text-muted-foreground min-w-0">
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">demo-site.example</span>
        </div>
        <RotateCcw className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </div>
      {/* Home indicator */}
      <div className="pb-2 bg-muted/60">
        <div className="mx-auto h-1 w-24 rounded-full bg-foreground/20" aria-hidden="true" />
      </div>
    </div>
  );
}

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
              Here's the 60-second tour — where Cookie Yeti lives in Safari, and the
              one tap that makes it smarter.
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
              Find your panel — the puzzle icon
            </h2>
          </div>
          <p className="mt-3 text-muted-foreground leading-relaxed">
            On your iPhone, Cookie Yeti lives behind the puzzle-piece extensions icon in
            Safari's address bar — at the bottom of your screen. Tap it on any site, then
            tap <strong className="text-foreground">Cookie Yeti</strong> to open your panel —
            your privacy mode, stats, and the report button are all in there.
          </p>
          <div className="mt-5 grid gap-6 sm:grid-cols-2 sm:items-start">
            <div>
              <SafariToolbarMock />
              <p className="mt-2 text-center text-xs text-muted-foreground">
                In Safari: the puzzle icon, bottom address bar
              </p>
            </div>
            <div>
              <img
                src={settingsScreenshot}
                alt="Real screenshot of the Cookie Yeti app's Settings tab on iPhone, showing Extension Status as Active in Safari and the three privacy modes."
                className="mx-auto max-w-[320px] w-full rounded-[2rem] border-2 border-border shadow-sm"
                width={415}
                height={900}
                loading="lazy"
              />
              <p className="mt-2 text-center text-xs text-muted-foreground">
                In the app: confirm you're <span className="text-[#2DB3A6] font-semibold">Active in Safari</span>
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
            once in a while a site uses a banner the yeti hasn't learned yet. Below is a
            safe, fake example — this is what slipping through looks like.
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
            One tap teaches the yeti. Practice the real flow on this demo: open the
            Cookie Yeti panel, then hit <strong className="text-foreground">Report missed banner</strong>.
            Nothing is actually sent — it's just for practice.
          </p>
          <div className="mt-5">
            <FakeBannerDemo
              stage={stage}
              onOpenPanel={() => setStage("panel")}
              onReport={() => setStage("reported")}
              onReset={() => setStage("banner")}
            />
          </div>
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-[#2DB3A6]" aria-hidden="true" />
            Real reports send only the banner's pattern and the site's domain — never your personal data.
          </p>
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
