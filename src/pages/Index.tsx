import { SEOHead } from "@/components/SEOHead";
import { Link } from "react-router-dom";
import { ArrowRight, Shield, Database, Lock, Globe } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { InteractiveDotGrid } from "@/components/InteractiveDotGrid";
import { MagneticButton } from "@/components/wow/MagneticButton";
import { TiltCard } from "@/components/wow/TiltCard";
import { RevealText, RevealOnScroll } from "@/components/wow/RevealText";
import { Marquee } from "@/components/wow/Marquee";
import { BottomWordmark } from "@/components/wow/BottomWordmark";

import glossyApps from "@/assets/glossy-apps.png";
import glossyAi from "@/assets/glossy-ai.png";
import glossyExtension from "@/assets/glossy-extension.png";
import glossyConsumer from "@/assets/glossy-consumer.png";
import glossyPhysical from "@/assets/glossy-physical.png";
import glossyEcosystem from "@/assets/glossy-ecosystem.png";
import cookieYetiIcon from "@/assets/cookieyeti-icon.png";
import inventoryproofIcon from "@/assets/inventoryproof-icon.png";
import hokuBottle from "@/assets/hoku-bottle.png";

/* WOW v5 — interactivity-everywhere
 *  Reusable building blocks under /components/wow/:
 *  - CursorFollower (mounted in App.tsx)
 *  - MagneticButton — CTA pulls toward cursor
 *  - TiltCard — 3D rotateX/Y based on cursor position
 *  - RevealText / RevealOnScroll — section headings + lists animate in on scroll
 *  - Marquee — slow scrolling text band
 *  All respect prefers-reduced-motion + degrade on touch.
 */

const HOUSE_EASE = [0.32, 0.72, 0, 1] as const;

const heroLine1 = ["Stop", "renting", "your"];
const heroLine2 = ["business", "from"];
const accentWord = "big tech.";

const heroPills = [
  "Private cloud for your office",
  "Apps that don't sell your data",
  "Extensions that block surveillance",
  "Built in Los Angeles",
];

const focusAreas = [
  { name: "In-House Cloud", body: "One server in your office replaces Google Workspace, Slack, Zoom, Dropbox, DocuSign, 1Password, and your AI tool. Wears your logo. Stays in your building.", image: glossyEcosystem },
  { name: "Browser extensions", body: "Cookie Yeti dismisses cookie banners instantly and blocks 200,000+ malicious banner domains. More extensions on the way.", image: glossyExtension },
  { name: "Consumer apps", body: "InventoryProof builds an insurance-ready home inventory in minutes. NeckPilot fixes your posture using AirPods. Apps that solve real problems without harvesting your data.", image: glossyApps },
  { name: "AI tools", body: "AI that runs on your hardware. No prompts shipped to OpenAI. No training on your data. Same models, your machine.", image: glossyAi },
  { name: "Physical products", body: "HOKU skincare. Real things you can hold and own. No subscriptions, no telemetry phoning home.", image: glossyPhysical },
  { name: "Connected hardware", body: "Software and hardware designed to work together — at your office, in your home, on your wrist.", image: glossyConsumer },
];

const featuredProducts = [
  { name: "Cookie Yeti", pitch: "Browser extension that dismisses cookie banners instantly and blocks 200,000+ malicious banner domains. Browse cleaner, faster, more private.", href: "/cookie-yeti", image: cookieYetiIcon },
  { name: "InventoryProof", pitch: "Walk through your home with your phone. Get an insurance-ready PDF inventory in minutes. The thing you should do before something burns down.", href: "https://inventoryproof.com", image: inventoryproofIcon },
  { name: "HOKU", pitch: "Pharmaceutical-grade skincare, simplified. One daily facial mist. No subscriptions, no upsells.", href: "https://hoku-clean.com", image: hokuBottle },
];

const trustPrinciples = [
  { name: "Collect less", body: "We only ask for what's strictly needed to make the product work. Then we stop.", icon: Database },
  { name: "Ask first", body: "No silent data collection. No background telemetry. If we want it, we ask, and 'no' is a real answer.", icon: Shield },
  { name: "Never sell", body: "Your data is not a product. We don't sell it, broker it, or hand it to ad networks. Ever.", icon: Lock },
  { name: "Open about it", body: "GDPR and CCPA compliant. Source code available on request for the open parts. Plain-English policies, no dark patterns.", icon: Globe },
];

const marqueeWords = ["Private cloud", "AI", "Extensions", "Hardware", "Apps", "Privacy", "No data sales", "Built in LA"];

export default function Index() {
  const reduce = useReducedMotion();

  return (
    <>
      <SEOHead
        title="Bestly — Stop renting your business from big tech"
        description="Bestly builds private cloud servers for businesses, plus privacy-first apps, browser extensions, and consumer hardware. One server in your office replaces Google Workspace, Slack, Zoom, Dropbox, DocuSign, 1Password, and your AI tool. Built in Los Angeles."
        path="/"
      />

      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden min-h-[92vh] flex items-center wow-bg-ink wow-text-paper">
        <InteractiveDotGrid />

        <div className="relative mx-auto max-w-7xl w-full px-6 py-32 lg:px-8 lg:py-40">
          <div className="mx-auto max-w-5xl">
            <motion.p
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: HOUSE_EASE }}
              className="text-xs font-medium uppercase tracking-[0.2em] wow-text-muted mb-10"
            >
              Bestly · Privacy-first tech, built in Los Angeles
            </motion.p>

            <h1 className="font-display font-normal tracking-[-0.04em] leading-[0.95] text-[clamp(2.5rem,7vw,6rem)]">
              <span className="block">
                {heroLine1.map((word, i) => (
                  <motion.span
                    key={`${word}-${i}`}
                    className="inline-block mr-[0.22em]"
                    initial={reduce ? false : { opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.55, delay: reduce ? 0 : 0.08 * i, ease: HOUSE_EASE }}
                  >
                    {word}
                  </motion.span>
                ))}
              </span>
              <span className="block">
                {heroLine2.map((word, i) => (
                  <motion.span
                    key={`${word}-${i + heroLine1.length}`}
                    className="inline-block mr-[0.22em]"
                    initial={reduce ? false : { opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.55, delay: reduce ? 0 : 0.08 * (i + heroLine1.length), ease: HOUSE_EASE }}
                  >
                    {word}
                  </motion.span>
                ))}
                <motion.span
                  className="inline-block wow-underline-accent wow-text-paper"
                  initial={reduce ? false : { opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.55, delay: reduce ? 0 : 0.08 * (heroLine1.length + heroLine2.length), ease: HOUSE_EASE }}
                >
                  {accentWord}
                </motion.span>
              </span>
            </h1>

            <motion.p
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.9, ease: HOUSE_EASE }}
              className="mt-10 max-w-2xl text-lg sm:text-xl leading-relaxed wow-text-muted"
            >
              Google, Microsoft, Adobe, Zoom, Slack &mdash; they charge per seat, harvest your
              data, and raise prices every year. Bestly builds the alternatives: a private
              cloud for your office, browser extensions that block surveillance, and apps
              that don&rsquo;t sell your data. One company, one promise: collect less, ask first,
              never sell.
            </motion.p>

            <motion.div
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1.05, ease: HOUSE_EASE }}
              className="mt-12 flex flex-col sm:flex-row gap-4"
            >
              <MagneticButton>
                <Link
                  to="/products"
                  className="group inline-flex items-center justify-center rounded-md wow-bg-indigo px-8 py-4 text-base font-medium wow-text-paper transition-transform duration-200 wow-ease hover:-translate-y-[1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--wow-indigo-light))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--wow-ink))]"
                >
                  See the products
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 wow-ease group-hover:translate-x-0.5" />
                </Link>
              </MagneticButton>
              <MagneticButton>
                <Link
                  to="/services"
                  className="inline-flex items-center justify-center rounded-md border wow-border bg-transparent px-8 py-4 text-base font-medium wow-text-paper transition-colors duration-200 wow-ease hover:wow-bg-elev focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--wow-indigo-light))]"
                >
                  Talk to Jared
                </Link>
              </MagneticButton>
            </motion.div>

            <motion.div
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.7, delay: 1.25, ease: HOUSE_EASE }}
              className="mt-14 flex flex-wrap gap-x-7 gap-y-3 text-sm wow-text-muted"
            >
              {heroPills.map((pill, i) => (
                <span key={pill} className="inline-flex items-center gap-2">
                  {i > 0 && <span aria-hidden="true" className="opacity-40">·</span>}
                  {pill}
                </span>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* ---------- Marquee separator ---------- */}
      <div className="wow-bg-ink wow-text-paper wow-hairline">
        <Marquee speed={50} className="py-8">
          {marqueeWords.flatMap((w, i) => [
            <span
              key={`${w}-${i}`}
              className="font-display tracking-[-0.02em] text-3xl sm:text-4xl wow-text-paper"
            >
              {w}
            </span>,
            <span key={`dot-${i}`} aria-hidden="true" className="text-2xl wow-text-indigo">
              ◆
            </span>,
          ])}
        </Marquee>
      </div>

      {/* ---------- What we build ---------- */}
      <section className="wow-bg-ink wow-text-paper wow-hairline">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <RevealOnScroll className="max-w-2xl mb-20">
            <p className="text-xs font-medium uppercase tracking-[0.2em] wow-text-indigo mb-5">
              What we build
            </p>
            <RevealText
              as="h2"
              className="font-display font-normal tracking-[-0.03em] leading-[1.05] text-[clamp(2rem,4.5vw,3.75rem)] block"
            >
              Six product lines. None of them sell your data.
            </RevealText>
          </RevealOnScroll>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-14">
            {focusAreas.map((area, i) => (
              <RevealOnScroll key={area.name} delay={i * 0.06}>
                <TiltCard className="border-t wow-border pt-8" max={4}>
                  <div className="h-24 mb-5 flex items-center" style={{ transform: "translateZ(40px)" }}>
                    <img
                      src={area.image}
                      alt=""
                      loading="lazy"
                      width={96}
                      height={96}
                      className="w-20 h-20 object-contain drop-shadow-2xl"
                    />
                  </div>
                  <h3 className="font-display text-xl sm:text-2xl tracking-[-0.02em] wow-text-paper">
                    {area.name}
                  </h3>
                  <p className="mt-4 text-base leading-relaxed wow-text-muted">{area.body}</p>
                </TiltCard>
              </RevealOnScroll>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Featured products ---------- */}
      <section className="wow-bg-elev wow-text-paper">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <RevealOnScroll className="max-w-2xl mb-16">
            <p className="text-xs font-medium uppercase tracking-[0.2em] wow-text-indigo mb-5">
              In the wild
            </p>
            <RevealText
              as="h2"
              className="font-display font-normal tracking-[-0.03em] leading-[1.05] text-[clamp(2rem,4.5vw,3.75rem)] block"
            >
              Three live right now. Pick one.
            </RevealText>
          </RevealOnScroll>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-14">
            {featuredProducts.map((p, i) => (
              <RevealOnScroll key={p.name} delay={i * 0.08}>
                <TiltCard max={5}>
                  <Link
                    to={p.href}
                    className="block group border-t wow-border pt-8 transition-transform duration-200 wow-ease"
                    {...(p.href.startsWith("http") ? { target: "_blank", rel: "noopener" } : {})}
                  >
                    <div className="h-20 mb-5 flex items-center" style={{ transform: "translateZ(50px)" }}>
                      <img
                        src={p.image}
                        alt={p.name}
                        loading="lazy"
                        width={64}
                        height={64}
                        className="h-16 w-auto object-contain drop-shadow-xl"
                      />
                    </div>
                    <h3 className="font-display text-2xl sm:text-3xl tracking-[-0.02em] wow-text-paper">
                      {p.name}
                    </h3>
                    <p className="mt-5 text-base leading-relaxed wow-text-muted">{p.pitch}</p>
                    <div className="mt-7 inline-flex items-center gap-2 text-sm uppercase tracking-[0.18em] wow-text-paper">
                      Read more
                      <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 wow-ease group-hover:translate-x-1" />
                    </div>
                  </Link>
                </TiltCard>
              </RevealOnScroll>
            ))}
          </div>

          <RevealOnScroll className="mt-16">
            <MagneticButton>
              <Link
                to="/products"
                className="inline-flex items-center gap-3 text-base wow-text-paper group"
              >
                <span className="border-b border-current pb-1">All products</span>
                <ArrowRight className="h-4 w-4 transition-transform duration-200 wow-ease group-hover:translate-x-1" />
              </Link>
            </MagneticButton>
          </RevealOnScroll>
        </div>
      </section>

      {/* ---------- Trust principles ---------- */}
      <section className="wow-bg-ink wow-text-paper wow-hairline">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <RevealOnScroll className="max-w-2xl mb-16">
            <p className="text-xs font-medium uppercase tracking-[0.2em] wow-text-indigo mb-5">
              How we operate
            </p>
            <RevealText
              as="h2"
              className="font-display font-normal tracking-[-0.03em] leading-[1.05] text-[clamp(2rem,4.5vw,3.75rem)] block"
            >
              Not policies. Promises.
            </RevealText>
          </RevealOnScroll>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-12 max-w-5xl">
            {trustPrinciples.map((p, i) => (
              <RevealOnScroll key={p.name} delay={i * 0.07}>
                <TiltCard className="flex gap-6 group" max={3}>
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border wow-border transition-colors duration-300 wow-ease group-hover:bg-[hsl(var(--wow-indigo)/0.15)]">
                    <p.icon className="h-5 w-5 wow-text-indigo transition-transform duration-300 wow-ease group-hover:rotate-[12deg]" />
                  </div>
                  <div>
                    <h3 className="font-display text-xl sm:text-2xl tracking-[-0.02em] wow-text-paper">
                      {p.name}
                    </h3>
                    <p className="mt-3 text-base leading-relaxed wow-text-muted">{p.body}</p>
                  </div>
                </TiltCard>
              </RevealOnScroll>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Services callout ---------- */}
      <section className="wow-bg-ink wow-text-paper wow-hairline">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <RevealOnScroll>
            <Link to="/services" className="block group">
              <div className="border-t wow-border pt-12 lg:pt-16">
                <p className="text-xs font-medium uppercase tracking-[0.2em] wow-text-indigo mb-6">
                  Services
                </p>
                <RevealText
                  as="h2"
                  className="font-display font-normal tracking-[-0.03em] leading-[1.02] text-[clamp(2.25rem,5.5vw,4.5rem)] max-w-4xl block"
                >
                  Need software built? We do that, too.
                </RevealText>
                <p className="mt-8 max-w-2xl text-lg leading-relaxed wow-text-muted">
                  Custom app development, AI integration, compliance engineering, old Mac apps
                  modernized for Apple Silicon, App Store and marketplace launches, and our
                  flagship In-House Cloud installed in your office. Thirteen services, fixed-fee
                  pricing, no per-hour billing games.
                </p>
                <div className="mt-10 inline-flex items-center gap-3 text-base wow-text-paper">
                  <span className="border-b border-current pb-1">See all services</span>
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 wow-ease group-hover:translate-x-1" />
                </div>
              </div>
            </Link>
          </RevealOnScroll>
        </div>
      </section>

      {/* ---------- Founder note + final CTA ---------- */}
      <section className="wow-bg-cream text-[hsl(0_0%_8%)]">
        <div className="mx-auto max-w-3xl px-6 py-28 lg:px-8 lg:py-36">
          <RevealOnScroll>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-[hsl(0_0%_30%)] mb-8">
              From the founder
            </p>
            <div className="font-display text-2xl sm:text-3xl leading-[1.35] tracking-[-0.01em]">
              <p>
                I started Bestly because I wanted to make tools that don&rsquo;t treat the people
                using them as a product to be optimized. Every Bestly thing &mdash; software,
                hardware, the boring infrastructure underneath &mdash; ships with the same
                default: collect less, ask first, never sell.
              </p>
              <p className="mt-6">
                If that&rsquo;s the kind of work you want done for you, or you want me on your
                team for a stretch, talk to me directly.
              </p>
            </div>
            <div className="mt-10 flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-[hsl(0_0%_15%)] grid place-items-center text-[hsl(var(--wow-paper))] font-display text-base">
                J
              </div>
              <div>
                <div className="font-medium">Jared Best</div>
                <div className="text-sm text-[hsl(0_0%_40%)]">Founder, Bestly</div>
              </div>
            </div>
            <div className="mt-14 flex flex-col sm:flex-row gap-4">
              <MagneticButton>
                <Link
                  to="/contact"
                  className="group inline-flex items-center justify-center rounded-md bg-[hsl(var(--wow-indigo-deep))] px-8 py-4 text-base font-medium text-[hsl(var(--wow-paper))] transition-transform duration-200 wow-ease hover:-translate-y-[1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--wow-indigo-deep))] focus-visible:ring-offset-2"
                >
                  Get in touch
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 wow-ease group-hover:translate-x-0.5" />
                </Link>
              </MagneticButton>
              <MagneticButton>
                <a
                  href="mailto:jared@bestly.tech?subject=Bestly%20%E2%80%94%20Hello"
                  className="inline-flex items-center justify-center rounded-md border border-[hsl(0_0%_15%)] bg-transparent px-8 py-4 text-base font-medium text-[hsl(0_0%_8%)] transition-colors duration-200 wow-ease hover:bg-[hsl(0_0%_8%/0.05)]"
                >
                  jared@bestly.tech
                </a>
              </MagneticButton>
            </div>
          </RevealOnScroll>
        </div>
      </section>

      {/* ---------- Bottom Wordmark ---------- */}
      <BottomWordmark />
    </>
  );
}
