import { type ReactNode } from "react";
import { SEOHead } from "@/components/SEOHead";
import cookieYetiIcon from "@/assets/cookieyeti-icon.png";
import {
  StepBadge,
  DeviceShowcase,
  PanelShowcase,
  LiveReportDemo,
  QuestionsSheet,
  ReportSubSteps,
  PrivateBrowsingCallout,
} from "@/components/cookieyeti/getStartedShared";
import { StepCarousel } from "@/components/cookieyeti/StepCarousel";
import cyPanelInsights from "@/assets/cy-panel-insights-real.png";
import cySafariExtensions from "@/assets/cy-safari-extensions.png";
import { Sparkles } from "lucide-react";

// CY-GS-02 (macOS): plain-English Safari-on-Mac onboarding as an animated step
// carousel. Turn it on in Safari Settings, allow on every site, open the panel,
// pick a mode, report a miss.
//
// CY-GS-05 layout (viewed on a desktop browser window): the page is exactly one
// viewport tall (100dvh minus the slim header) with overflow hidden, so it
// NEVER scrolls. On desktop it's a two-column split — a demoted hero on the
// LEFT (icon, "You're almost set.", one short line) and the StepCarousel pane
// centered on the RIGHT, both vertically centered and adapting to the window
// height. FAQ + end CTA live behind a "Questions?" control on the final step.

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

// Hovering arrow pointing up to the Safari toolbar (top-left, where Safari puts
// extension icons). Desktop-only — hidden on mobile per spec.
function ToolbarArrow() {
  return (
    <div className="pointer-events-none absolute top-2 left-8 z-20 hidden md:flex flex-col items-center motion-safe:animate-arrow-nudge">
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
  const steps: Step[] = [
    {
      n: 1,
      title: "Turn it on in Safari",
      body: (
        <>
          Open <strong className="text-foreground">Safari ▸ Settings ▸ Extensions</strong> and tick{" "}
          <strong className="text-foreground">Cookie Yeti</strong>. Then click the{" "}
          <strong className="text-foreground">Yeti</strong> in your toolbar (top-left, see the arrow)
          and choose <strong className="text-foreground">Always Allow on Every Website</strong>.
        </>
      ),
      showcase: (
        <>
          <DeviceShowcase
            eyebrow="Switch it on"
            caption="Tick Cookie Yeti in Safari Settings, then allow it everywhere."
            image={cySafariExtensions}
            imageAlt="Safari Settings ▸ Extensions with Cookie Yeti ticked on."
          />
          <PrivateBrowsingCallout title="Use Private Browsing?">
            Open <strong className="text-foreground">Safari ▸ Settings ▸ Extensions ▸ Cookie Yeti</strong>{" "}
            and turn on <strong className="text-foreground">Allow in Private Browsing</strong>.
          </PrivateBrowsingCallout>
        </>
      ),
    },
    {
      n: 2,
      title: "That's it — it runs on its own",
      body: (
        <>
          Nothing else to do. Click the <strong className="text-foreground">Yeti</strong> any time to see
          pop-ups closed and cookies cleaned. Want it stricter or lighter? Pick a mode in{" "}
          <strong className="text-foreground">Control</strong> — Balanced suits most.
        </>
      ),
      showcase: (
        <PanelShowcase
          eyebrow="Your panel"
          caption="Live stats and one-click reporting, right in your toolbar."
          image={cyPanelInsights}
          imageAlt="The real Cookie Yeti panel — Insights tab: Active status, 1,284 handled, time saved and cookies cleaned, plus the Report a missed banner button and recent sites."
        />
      ),
    },
    {
      n: 3,
      title: "See one it missed? Report it",
      body: "Cookie Yeti catches almost every pop-up. If one slips through, three taps fix it — try it on the real banner below:",
      showcase: (
        <>
          <ReportSubSteps openLabel="Click the Yeti in your toolbar" />
          <div className="mt-3 min-h-0 flex-1 overflow-hidden">
            <LiveReportDemo platform="mac" />
          </div>
        </>
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

      {/* CY-GS-05: single-viewport, no-scroll tour shell. Desktop = two columns
          (demoted hero left, centered pane right); mobile = a minimal top strip
          with the pane dead-center. Overflow hidden makes scrolling impossible. */}
      <div className="relative h-[calc(100dvh_-_var(--cy-hdr,52px))] overflow-hidden">
        <ToolbarArrow />
        <div className="mx-auto flex h-full max-w-6xl flex-col px-4 md:flex-row md:items-center md:justify-center md:gap-10 md:px-10">
          {/* Demoted hero — top strip on mobile, left column (vertically
              centered) on desktop. Never pushes the pane down. */}
          <div className="flex shrink-0 items-center justify-center gap-2.5 py-2.5 text-center md:w-[38%] md:flex-col md:items-start md:justify-center md:py-0 md:text-left">
            <img
              src={cookieYetiIcon}
              alt="Cookie Yeti app icon"
              className="h-8 w-8 rounded-xl shadow-sm md:h-16 md:w-16 md:rounded-2xl md:shadow-md"
              width={64}
              height={64}
            />
            <div>
              <span className="mb-3 hidden rounded-full bg-[#2DB3A6]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#2DB3A6] md:inline-block">
                Safari on Mac
              </span>
              <h1 className="text-base font-extrabold tracking-tight text-foreground md:text-4xl">
                You're almost set.
              </h1>
              <p className="mt-3 hidden max-w-sm text-base text-muted-foreground md:block">
                Two quick clicks switch Cookie Yeti on in Safari — then it quietly closes those
                “Accept Cookies?” pop-ups while you browse.
              </p>
            </div>
          </div>

          {/* Pane, centered in the remaining space (both axes). */}
          <div className="flex min-h-0 flex-1 items-center justify-center pb-3 md:h-full md:pb-0">
            <StepCarousel
              className="h-full w-full md:max-w-xl"
              accent="#2DB3A6"
              steps={steps.map((s) => (
                <div key={s.n} className="flex h-full flex-col">
                  <div className="flex items-center gap-3">
                    <StepBadge n={s.n} />
                    <h2 className="text-lg font-bold tracking-tight text-foreground md:text-2xl">{s.title}</h2>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed md:text-base">{s.body}</p>
                  {s.showcase}
                  {s.n === 3 && (
                    <div className="mt-2.5 flex shrink-0 items-center justify-between gap-3">
                      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Sparkles className="h-3.5 w-3.5 text-[#2DB3A6]" aria-hidden="true" />
                        Sends only the pattern &amp; site name.
                      </p>
                      <QuestionsSheet items={FAQ} />
                    </div>
                  )}
                </div>
              ))}
            />
          </div>
        </div>
      </div>
    </>
  );
}
