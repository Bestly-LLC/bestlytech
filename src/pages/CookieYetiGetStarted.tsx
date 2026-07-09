import { SEOHead } from "@/components/SEOHead";
import cookieYetiIcon from "@/assets/cookieyeti-icon.png";
import settingsScreenshot from "@/assets/cookieyeti-settings-iphone.png";
import safariMenuShot from "@/assets/cy-safari-menu.png";
import safariBannerShot from "@/assets/cy-safari-banner.png";
import panelReportShot from "@/assets/cy-panel-report.png";
import { StepCarousel } from "@/components/cookieyeti/StepCarousel";
import { LiveReportDemo, QuestionsSheet } from "@/components/cookieyeti/getStartedShared";
import { Sparkles } from "lucide-react";

// CY-GS-01: Post-download onboarding guide (Safari on iPhone) — a MOBILE-ONLY
// page (only ever opened on a phone). It teaches three things:
// 1) Where the Cookie Yeti panel lives in Safari (the address-bar menu)
// 2) What a missed cookie banner looks like (a real screenshot)
// 3) How to report it — on the last step the user fires a REAL report through
//    their actually-installed Cookie Yeti (see LiveReportDemo).
//
// CY-GS-05 layout: the whole thing is exactly one viewport tall (100dvh minus
// the slim header) with overflow hidden, so it NEVER scrolls. The hero is
// collapsed to a minimal top strip and the StepCarousel pane sits dead-center,
// owning the screen. FAQ + end CTA live behind a "Questions?" control on the
// last step (QuestionsSheet) so nothing invites a scroll.

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

// Troubleshooting note shown inside the Questions modal (iOS-specific).
const Troubleshooting = (
  <div className="rounded-2xl border border-border bg-card p-4">
    <h3 className="text-base font-bold tracking-tight text-foreground">
      Don't see Cookie Yeti in the menu?
    </h3>
    <div className="mt-3 grid gap-4 sm:grid-cols-2 sm:items-center">
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
        className="mx-auto w-full max-w-[180px] rounded-[1.25rem] border-2 border-border shadow-sm"
        width={415}
        height={900}
        loading="lazy"
      />
    </div>
  </div>
);

function StepBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2DB3A6] text-white text-sm font-bold">
      {n}
    </span>
  );
}

export default function CookieYetiGetStarted() {
  return (
    <>
      <SEOHead
        title="Get Started with Cookie Yeti"
        description="Just downloaded Cookie Yeti? Learn where the panel lives in Safari, what a missed cookie banner looks like, and how to report one in a single tap."
        path="/cookie-yeti/get-started"
      />

      {/* CY-GS-05: single-viewport, no-scroll tour shell. Exactly 100dvh minus
          the slim header, overflow hidden — vertical scrolling is impossible. */}
      <div className="h-[calc(100dvh_-_var(--cy-hdr,52px))] overflow-hidden">
        <div className="mx-auto flex h-full max-w-xl flex-col px-4">
          {/* Minimal hero strip — small icon + one short line. Never pushes the
              pane down; it's a shrink-0 header the pane centers beneath. */}
          <div className="flex shrink-0 items-center justify-center gap-2.5 py-2.5">
            <img
              src={cookieYetiIcon}
              alt="Cookie Yeti app icon"
              className="h-8 w-8 rounded-xl shadow-sm"
              width={32}
              height={32}
            />
            <p className="text-sm font-semibold text-foreground">
              You're protected — here's your 30-second tour.
            </p>
          </div>

          {/* Pane, dead-center in the remaining space (flex center, both axes). */}
          <div className="flex min-h-0 flex-1 items-center justify-center pb-3">
            <StepCarousel
              className="h-full w-full"
              accent="#2DB3A6"
              steps={[
                <div key="s1" className="flex h-full flex-col">
                  <div className="flex items-center gap-3">
                    <StepBadge n={1} />
                    <h2 className="text-xl font-bold tracking-tight text-foreground">
                      Open your panel — right now
                    </h2>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                    You're already in Safari, so try it on this page: tap the menu button in
                    the address bar at the bottom of your screen, then tap{" "}
                    <strong className="text-foreground">Cookie Yeti</strong>. Your panel opens
                    with live stats and the report button.
                  </p>
                  <div className="mt-3 grid min-h-0 flex-1 grid-cols-2 gap-3">
                    <div className="flex min-h-0 flex-col">
                      <img
                        src={safariMenuShot}
                        alt="Real screenshot of Safari on iPhone with the page menu open, showing the Cookie Yeti entry alongside Manage Extensions."
                        className="mx-auto min-h-0 w-auto max-w-full flex-1 rounded-[1.25rem] border-2 border-border object-contain shadow-sm"
                        width={414}
                        height={900}
                        loading="lazy"
                      />
                      <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
                        1. Address bar menu → <span className="text-[#2DB3A6] font-semibold">Cookie Yeti</span>
                      </p>
                    </div>
                    <div className="flex min-h-0 flex-col">
                      <img
                        src={panelReportShot}
                        alt="Real screenshot of the Cookie Yeti panel open in Safari on iPhone, showing the Active status, live stats, and the Report a missed banner button."
                        className="mx-auto min-h-0 w-auto max-w-full flex-1 rounded-[1.25rem] border-2 border-border object-contain shadow-sm"
                        width={414}
                        height={900}
                        loading="lazy"
                      />
                      <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
                        2. Stats, mode &amp; <span className="text-[#2DB3A6] font-semibold">Report a missed banner</span>
                      </p>
                    </div>
                  </div>
                </div>,
                <div key="s2" className="flex h-full flex-col">
                  <div className="flex items-center gap-3">
                    <StepBadge n={2} />
                    <h2 className="text-xl font-bold tracking-tight text-foreground">
                      Meet a missed banner
                    </h2>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                    Cookie Yeti handles almost every consent pop-up before you notice it. Once
                    in a while a site uses a banner the yeti hasn't learned yet. Here's a real
                    one in the wild — next step, a real page you can report from.
                  </p>
                  <img
                    src={safariBannerShot}
                    alt="Real screenshot of Safari on iPhone showing a website with a cookie consent banner at the bottom of the page, above the address bar."
                    className="mx-auto mt-3 min-h-0 w-auto max-w-full flex-1 rounded-[1.25rem] border-2 border-border object-contain shadow-sm"
                    width={414}
                    height={900}
                    loading="lazy"
                  />
                  <p className="mt-1.5 shrink-0 text-center text-[11px] text-muted-foreground">
                    A real cookie banner, doing its best to interrupt you
                  </p>
                </div>,
                <div key="s3" className="flex h-full flex-col">
                  <div className="flex items-center gap-3">
                    <StepBadge n={3} />
                    <h2 className="text-xl font-bold tracking-tight text-foreground">
                      Report it — for real, right here
                    </h2>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                    One tap teaches the yeti. The demo below is a real page with a real banner —
                    open <strong className="text-foreground">Cookie Yeti</strong> from your
                    address-bar menu and tap{" "}
                    <strong className="text-foreground">Report a missed banner</strong>.
                  </p>
                  <div className="mt-3 min-h-0 flex-1 overflow-hidden">
                    <LiveReportDemo platform="ios" />
                  </div>
                  <div className="mt-2.5 flex shrink-0 items-center justify-between gap-3">
                    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Sparkles className="h-3.5 w-3.5 text-[#2DB3A6]" aria-hidden="true" />
                      Sends only the pattern &amp; domain.
                    </p>
                    <QuestionsSheet items={FAQ} extra={Troubleshooting} />
                  </div>
                </div>,
              ]}
            />
          </div>
        </div>
      </div>
    </>
  );
}
