import { type ReactNode } from "react";
import { SEOHead } from "@/components/SEOHead";
import cookieYetiIcon from "@/assets/cookieyeti-icon.png";
import {
  StepBadge,
  DeviceShowcase,
  LiveReportDemo,
  QuestionsSheet,
} from "@/components/cookieyeti/getStartedShared";
import { StepCarousel } from "@/components/cookieyeti/StepCarousel";
import cyPanelInsights from "@/assets/cy-panel-insights.png";
import cyPanelControl from "@/assets/cy-panel-control.png";
import cySafariExtensions from "@/assets/cy-safari-extensions.png";
import cySafariAllow from "@/assets/cy-safari-allow.png";
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
          image={cySafariExtensions}
          imageAlt="Safari Settings ▸ Extensions with Cookie Yeti ticked on."
        />
      ),
    },
    {
      n: 2,
      title: "Let it work on every site",
      body: (
        <>
          Click the <strong className="text-foreground">Yeti icon</strong> in your Safari toolbar (top-left, just left of the address bar — see
          the arrow). The first time, Safari asks for permission — choose{" "}
          <strong className="text-foreground">Always Allow on Every Website</strong> so it can close banners
          everywhere. It only looks for cookie banners, nothing else.
        </>
      ),
      showcase: (
        <DeviceShowcase
          eyebrow="Allow everywhere"
          caption="Allow once, and the Yeti works on every site."
          image={cySafariAllow}
          imageAlt="Safari toolbar with Cookie Yeti and the ‘Always Allow on Every Website’ prompt."
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
          Cookie Yeti closes almost every pop-up before you notice. If one slips through, open your panel and tap{" "}
          <strong className="text-foreground">Report a missed banner</strong>. The demo below is a real page
          with a real banner — reporting it sends a real report through your Cookie Yeti.
        </>
      ),
      showcase: (
        <div className="mt-3 min-h-0 flex-1 overflow-hidden">
          <LiveReportDemo platform="mac" />
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
                  {s.n === 5 && (
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
