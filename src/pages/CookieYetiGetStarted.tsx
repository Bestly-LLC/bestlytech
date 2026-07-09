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
import { StepCarousel } from "@/components/cookieyeti/StepCarousel";
import { LiveReportDemo } from "@/components/cookieyeti/getStartedShared";
import { ArrowLeft, Lock, Sparkles } from "lucide-react";

// CY-GS-01: Post-download onboarding guide (Safari on iPhone). Teaches three
// things:
// 1) Where the Cookie Yeti panel lives in Safari (the address-bar menu)
// 2) What a missed cookie banner looks like (a real screenshot)
// 3) How to report it — on the last step the user fires a REAL report through
//    their actually-installed Cookie Yeti (see LiveReportDemo).

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
  // CY-GS: reveal troubleshooting + FAQ + end CTA only once the tour reaches
  // its final step, so the core tour stays within one mobile viewport (no scroll).
  const [atLast, setAtLast] = useState(false);

  return (
    <>
      <SEOHead
        title="Get Started with Cookie Yeti"
        description="Just downloaded Cookie Yeti? Learn where the panel lives in Safari, what a missed cookie banner looks like, and how to report one in a single tap."
        path="/cookie-yeti/get-started"
      />

      {/* CY-GS: single-viewport tour shell — compact hero + carousel fill one
          mobile screen (100dvh minus the 52px compact header), no scroll.
          Desktop keeps the fuller stacked layout. */}
      <div className="mx-auto flex min-h-[calc(100dvh_-_var(--cy-hdr,52px))] max-w-3xl flex-col justify-center px-4 pb-4 sm:px-6 md:min-h-0 md:justify-start md:pb-20">
        {/* Hero (compact on mobile, fuller on sm+) */}
        <section className="pt-3 pb-3 text-center sm:pt-8 sm:pb-6">
          <AnimatedSection>
            <img
              src={cookieYetiIcon}
              alt="Cookie Yeti app icon"
              className="mx-auto h-12 w-12 rounded-2xl shadow-md sm:h-20 sm:w-20"
              width={80}
              height={80}
            />
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-foreground sm:mt-6 sm:text-5xl">
              You're protected.
            </h1>
            <p className="mx-auto mt-3 hidden max-w-xl text-lg text-muted-foreground sm:block">
              Setup's done — this page is your practice run. In fact, Cookie Yeti
              probably just handled this site's cookie banner before you noticed.
            </p>
          </AnimatedSection>
        </section>

        {/* Steps */}
        <StepCarousel
          accent="#2DB3A6"
          onIndexChange={(idx, total) => setAtLast(idx === total - 1)}
          steps={[
            <div key="s1">
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
          <div className="mt-4 grid grid-cols-2 gap-3 sm:mt-5 sm:gap-6 sm:items-start">
            <div>
              <img
                src={safariMenuShot}
                alt="Real screenshot of Safari on iPhone with the page menu open, showing the Cookie Yeti entry alongside Manage Extensions."
                className="mx-auto max-h-[26dvh] w-auto max-w-[320px] rounded-[1.25rem] border-2 border-border object-contain shadow-sm sm:max-h-none sm:w-full sm:rounded-[2rem]"
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
                className="mx-auto max-h-[26dvh] w-auto max-w-[320px] rounded-[1.25rem] border-2 border-border object-contain shadow-sm sm:max-h-none sm:w-full sm:rounded-[2rem]"
                width={414}
                height={900}
                loading="lazy"
              />
              <p className="mt-2 text-center text-xs text-muted-foreground">
                2. Your panel: stats, mode, and <span className="text-[#2DB3A6] font-semibold">Report a missed banner</span>
              </p>
            </div>
          </div>
            </div>,
            <div key="s2">
          <div className="flex items-center gap-3">
            <StepBadge n={2} />
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              Meet a missed banner
            </h2>
          </div>
          <p className="mt-3 text-muted-foreground leading-relaxed">
            Cookie Yeti handles almost every consent pop-up before you notice it. But
            once in a while a site uses a banner the yeti hasn't learned yet. Here's a
            real one in the wild — and on the next step, a real page you can report from.
          </p>
          <img
            src={safariBannerShot}
            alt="Real screenshot of Safari on iPhone showing a website with a cookie consent banner at the bottom of the page, above the address bar."
            className="mx-auto mt-3 max-h-[32dvh] w-auto max-w-[320px] rounded-[1.25rem] border-2 border-border object-contain shadow-sm sm:mt-5 sm:max-h-none sm:w-full sm:rounded-[2rem]"
            width={414}
            height={900}
            loading="lazy"
          />
          <p className="mt-2 text-center text-xs text-muted-foreground">
            A real cookie banner, doing its best to interrupt you
          </p>
            </div>,
            <div key="s3">
          <div className="flex items-center gap-3">
            <StepBadge n={3} />
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              Report it — for real, right here
            </h2>
          </div>
          <p className="mt-3 text-muted-foreground leading-relaxed">
            One tap teaches the yeti. The demo below is a real page with a real cookie banner —
            open <strong className="text-foreground">Cookie Yeti</strong> from your address-bar
            menu and tap <strong className="text-foreground">Report a missed banner</strong> to
            send a real report.
          </p>
          <div className="mt-5 max-w-xl mx-auto">
            <LiveReportDemo platform="ios" />
          </div>
          <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground sm:mt-3">
            <Sparkles className="h-3.5 w-3.5 text-[#2DB3A6]" aria-hidden="true" />
            Real reports send only the banner's pattern and the site's domain — never your personal data.
          </p>
            </div>,
          ]}
        />

        {/* Secondary content — hidden on mobile until the tour's last step
            (display:none contributes no height, so the tour never scrolls),
            always shown on desktop. */}
        <div className={`mt-12 space-y-16 sm:mt-16 ${atLast ? "block" : "hidden md:block"}`}>
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
        </div>
      </div>
    </>
  );
}
