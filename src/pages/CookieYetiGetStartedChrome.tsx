import { type ReactNode } from "react";
import { SEOHead } from "@/components/SEOHead";
import cookieYetiIcon from "@/assets/cookieyeti-icon.png";
import {
  StepBadge,
  DeviceShowcase,
  LiveReportDemo,
  QuestionsSheet,
} from "@/components/cookieyeti/getStartedShared";
import { Sparkles } from "lucide-react";
import { StepCarousel } from "@/components/cookieyeti/StepCarousel";
import cyPanelInsights from "@/assets/cy-panel-insights.png";
import cyPanelControl from "@/assets/cy-panel-control.png";
import cyPinPuzzle from "@/assets/cy-pin-puzzle.png";

// CY-GS-02 (Chrome): plain-English onboarding. Pin from the puzzle menu, open
// the panel, pick a mode, report a miss.
//
// CY-GS-05 layout (viewed on a desktop browser window): the page is exactly one
// viewport tall (100dvh minus the slim header) with overflow hidden, so it
// NEVER scrolls. On desktop it's a two-column split — a demoted hero on the
// LEFT (icon, "You're all set.", one short line) and the StepCarousel pane
// centered on the RIGHT, both vertically centered and adapting to window
// height. FAQ + end CTA live behind a "Questions?" control on the final step.

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

// Hovering arrow that points up toward the real Chrome puzzle/extensions icon
// (top-right). Desktop-only — hidden on mobile per spec.
function PuzzleArrow() {
  return (
    <div className="pointer-events-none absolute top-2 right-4 z-20 hidden md:flex flex-col items-center motion-safe:animate-arrow-nudge">
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
          Cookie Yeti closes almost every pop-up before you notice. If one slips through, open your panel and
          tap <strong className="text-foreground">Report a missed banner</strong>. The demo below is a real
          page with a real banner — reporting it sends a real report through your Cookie Yeti.
        </>
      ),
      showcase: (
        <div className="mt-3 min-h-0 flex-1 overflow-hidden">
          <LiveReportDemo platform="chrome" />
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

      {/* CY-GS-05: single-viewport, no-scroll tour shell. Desktop = two columns
          (demoted hero left, centered pane right); mobile = a minimal top strip
          with the pane dead-center. Overflow hidden makes scrolling impossible. */}
      <div className="relative h-[calc(100dvh_-_var(--cy-hdr,52px))] overflow-hidden">
        <PuzzleArrow />
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
                Chrome
              </span>
              <h1 className="text-base font-extrabold tracking-tight text-foreground md:text-4xl">
                You're all set.
              </h1>
              <p className="mt-3 hidden max-w-sm text-base text-muted-foreground md:block">
                Cookie Yeti is already closing those “Accept Cookies?” pop-ups in Chrome. Pin it so
                it's always one click away.
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
                  {s.n === 4 && (
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
