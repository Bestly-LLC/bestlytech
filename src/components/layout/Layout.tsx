import { Outlet, useLocation } from "react-router-dom";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { CookieConsent } from "@/components/CookieConsent";
import { PageTransition } from "@/components/PageTransition";

export function Layout() {
  const { pathname } = useLocation();
  // CY-GS: the Cookie Yeti get-started tours are a single-viewport, no-scroll
  // onboarding experience on mobile. We render a slim compact header, drop the
  // tall global footer (the tour supplies its own end-of-tour CTA), and expose
  // the header height as --cy-hdr so each page can size its tour to 100dvh.
  const isCyGetStarted = pathname.startsWith("/cookie-yeti/get-started");

  return (
    <div
      className="min-h-screen flex flex-col"
      style={isCyGetStarted ? ({ ["--cy-hdr" as string]: "52px" }) : undefined}
    >
      <Header compact={isCyGetStarted} />
      <main className="flex-1">
        <PageTransition>
          <Outlet />
        </PageTransition>
      </main>
      {!isCyGetStarted && <Footer />}
      {/* CY-GS-05: the get-started tours are a single-viewport, no-scroll pane
          experience. The global cookie-consent bar is fixed to the bottom and
          would cover the carousel's Back/Next controls, so we suppress it on
          these routes (as we do the footer). Consent is still gathered on every
          other page of the site. */}
      {!isCyGetStarted && <CookieConsent />}
    </div>
  );
}
