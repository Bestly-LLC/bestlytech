import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedSection } from "@/components/AnimatedSection";
import { Lines } from "@/components/Lines";
import { STUDIO_USE_CASES } from "@/config/studioUseCases";

export const BOOKING = "https://cloud.bestly.tech/apps/calendar/appointment/BtktQYtGFocY";
export const EMAIL = "studio@bestly.tech";
/** Self-serve sign-up (questions, connect an account, then 7 days free with the card). Static page, see vercel.json. */
export const START = "/studio/start";
/** Where an existing Studio client signs in. */
export const SIGNIN = "/studio/start?signin=1";

export const chipClass =
  "inline-flex min-h-[44px] items-center rounded-full border border-border bg-card px-5 text-sm font-semibold text-foreground " +
  "transition-[transform,box-shadow,border-color] duration-200 hover:border-primary hover:shadow-md active:scale-[0.97] motion-reduce:transition-none";

export function StudioCtas({ center = false }: { center?: boolean }) {
  return (
    <div className={`flex flex-col gap-3 ${center ? "items-center" : "items-start"}`}>
      <div className={`flex flex-wrap items-center gap-3 ${center ? "justify-center" : ""}`}>
        <Button asChild size="lg" className="min-h-[44px] active:scale-[0.97]">
          <a href={START}>
            Start free for 7&nbsp;days <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </a>
        </Button>
        <Button asChild size="lg" variant="outline" className="min-h-[44px] active:scale-[0.97]">
          <a href={BOOKING} target="_blank" rel="noopener noreferrer">Book a free call</a>
        </Button>
      </div>
      <p className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground ${center ? "justify-center" : ""}`}>
        <span className="whitespace-nowrap">No card until your first account is connected.</span>
        <a href={SIGNIN} className="inline-flex min-h-[44px] items-center whitespace-nowrap font-semibold text-foreground underline underline-offset-4 hover:text-primary">
          Already a client? Sign in
        </a>
      </p>
    </div>
  );
}

export function StudioChips({ exclude }: { exclude?: string }) {
  return (
    <ul className="flex flex-wrap gap-3">
      {STUDIO_USE_CASES.filter((u) => u.slug !== exclude).map((u) => (
        <li key={u.slug}>
          <Link to={`/studio/for/${u.slug}`} className={chipClass}>{u.chip}</Link>
        </li>
      ))}
      <li>
        <a href={BOOKING} target="_blank" rel="noopener noreferrer" className={chipClass}>Something else</a>
      </li>
    </ul>
  );
}

export function StudioFooterCta({ otherUses = false, exclude }: { otherUses?: boolean; exclude?: string }) {
  return (
    <>
      <section className="border-b border-border bg-background">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center lg:py-24">
          <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Talk to us first. It is free.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            <Lines>Tell us about your business. We will tell you what we would post and how it would work.</Lines>
          </p>
          <div className="mt-8"><StudioCtas center /></div>
          {otherUses && (
            <div className="mt-12 text-left">
              <p className="mb-4 text-center text-sm font-semibold uppercase tracking-widest text-primary">Other uses</p>
              <div className="flex justify-center"><StudioChips exclude={exclude} /></div>
            </div>
          )}
        </div>
      </section>
      <section className="bg-secondary/20">
        <div className="mx-auto max-w-7xl px-6 py-14 lg:px-8">
          <AnimatedSection animation="fade-in">
            <p className="mb-4 text-sm font-semibold uppercase tracking-widest text-primary">More from Bestly</p>
            <ul className="grid gap-4 sm:grid-cols-3">
              {[
                { to: "/agent", name: "Bestly Agent", line: "An AI receptionist that answers your business phone.", ext: false },
                { to: "/in-house-cloud", name: "Bestly Cloud", line: "A private cloud for your office, set up by Bestly.", ext: false },
                { to: "https://inventoryproof.com", name: "InventoryProof", line: "A home inventory app for insurance, in the App Store.", ext: true },
              ].map((p) => (
                <li key={p.name}>
                  {p.ext ? (
                    <a href={p.to} target="_blank" rel="noopener noreferrer" className="block min-h-[44px] h-full rounded-2xl border border-border bg-card p-5 transition-shadow hover:shadow-md">
                      <span className="font-modern font-semibold text-foreground">{p.name}</span>
                      <span className="mt-1 block text-sm text-muted-foreground">{p.line}</span>
                    </a>
                  ) : (
                    <Link to={p.to} className="block min-h-[44px] h-full rounded-2xl border border-border bg-card p-5 transition-shadow hover:shadow-md">
                      <span className="font-modern font-semibold text-foreground">{p.name}</span>
                      <span className="mt-1 block text-sm text-muted-foreground">{p.line}</span>
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </AnimatedSection>
          <p className="mt-10 text-sm text-muted-foreground">
            Bestly Studio is made by Bestly LLC, Los Angeles.{" "}
            <Link to="/studio/terms" className="inline-flex min-h-[44px] items-center underline underline-offset-4 hover:text-foreground">Terms</Link>
            {" · "}
            <Link to="/studio/privacy" className="inline-flex min-h-[44px] items-center underline underline-offset-4 hover:text-foreground">Privacy</Link>
          </p>
        </div>
      </section>
    </>
  );
}
