import { SEOHead } from "@/components/SEOHead";
import { Link } from "react-router-dom";
import { ArrowRight, Shield, Database, Lock, Globe } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { InteractiveDotGrid } from "@/components/InteractiveDotGrid";
import { MagneticButton } from "@/components/wow/MagneticButton";
import { TiltCard } from "@/components/wow/TiltCard";
import { RevealText, RevealOnScroll } from "@/components/wow/RevealText";
import { Marquee } from "@/components/wow/Marquee";

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

const heroLine1 = ["We", "build", "products"];
const heroLine2 = ["that", "respect"];
const accentWord = "you.";

const heroPills = [
  "Privacy-first",
  "Software · Hardware · Cloud",
  "On-prem & on-brand",
  "Los Angeles",
];

const focusAreas = [
  { name: "Apps & Platforms", body: "Mobile and web products designed to work for you, not against you.", image: glossyApps },
  { name: "AI & Automation", body: "Smart tools that are transparent about how they think.", image: glossyAi },
  { name: "Browser Extensions", body: "Productivity without the surveillance.", image: glossyExtension },
  { name: "Consumer Tech", body: "Everyday tools, built to last.", image: glossyConsumer },
  { name: "Physical Products", body: "Real things you can hold. No data strings attached.", image: glossyPhysical },
  { name: "Connected Ecosystems", body: "Software and hardware that work as one.", image: glossyEcosystem },
];

const featuredProducts = [
  { name: "Cookie Yeti", pitch: "Privacy-first browser extension. Dismisses cookie banners instantly, blocks 200K+ malicious banner domains.", href: "/cookie-yeti", image: cookieYetiIcon },
  { name: "InventoryProof", pitch: "AI-powered home inventory walkthrough that produces an insurance-ready PDF report in minutes.", href: "https://inventoryproof.com", image: inventoryproofIcon },
  { name: "HOKU", pitch: "Pharmaceutical-grade skincare, simplified. A daily facial mist backed by science.", href: "https://hoku-clean.com", image: hokuBottle },
];

const trustPrinciples = [
  { name: "Privacy by Design", body: "Built in from day one. Not bolted on after.", icon: Shield },
  { name: "Less Data, More Trust", body: "We collect only what's needed. Nothing more.", icon: Database },
  { name: "Zero Data Sales", body: "Your information is never for sale. Period.", icon: Lock },
  { name: "Global Standards", body: "GDPR, CCPA, and beyond. Your rights, worldwide.", icon: Globe },
];

const marqueeWords = ["Apps", "AI", "Extensions", "Hardware", "Cloud", "Privacy", "On-prem", "Built in LA"];

export default function Index() {
  const reduce = useReducedMotion();

  return (
    <>
      <SEOHead
        title="Bestly — Privacy-first product studio"
        description="Bestly is a Los Angeles product studio shipping privacy-first software, hardware, and the cloud underneath. We build apps, AI tools, browser extensions, consumer tech, and physical products — and we run private cloud infrastructure for teams that need it."
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
              Bestly · Privacy-first product studio · Los Angeles
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
              Bestly is a Los Angeles product studio shipping privacy-first software, hardware,
              and the cloud underneath. Apps, AI tools, browser extensions, consumer tech,
              physical goods &mdash; and the on-prem infrastructure for teams that want their
              data home.
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
                  See what we&rsquo;ve built
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 wow-ease group-hover:translate-x-0.5" />
                </Link>
              </MagneticButton>
              <MagneticButton>
                <Link
                  to="/services"
                  className="inline-flex items-center justify-center rounded-md border wow-border bg-transparent px-8 py-4 text-base font-medium wow-text-paper transition-colors duration-200 wow-ease hover:wow-bg-elev focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--wow-indigo-light))]"
                >
                  Work with us
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
              Six surfaces. One thesis: privacy-first by default.
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
              Three you can use today.
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
                  We also build for other companies. Including the cloud underneath.
                </RevealText>
                <p className="mt-8 max-w-2xl text-lg leading-relaxed wow-text-muted">
                  Web &amp; app development, AI integration, compliance engineering, marketplace
                  onboarding, Apple-native modernization, and our flagship In-House Cloud &mdash;
                  thirteen services on one server in your office, wearing your brand.
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
    </>
  );
}
