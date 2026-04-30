import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

/* WOW v3 — original Bestly homepage build per /docs/homepage-wow-plan-v3.md
 * - Editorial type pair (Newsreader display × Inter body)
 * - Kinetic word-by-word hero reveal w/ accent underline draw-on
 * - 7 compressed sections, single conversion goal
 * - House easing cubic-bezier(0.32, 0.72, 0, 1), 400ms cap
 * - prefers-reduced-motion respected throughout
 */

const HOUSE_EASE = [0.32, 0.72, 0, 1] as const;

const heroHeadline = ["The", "cloud", "that", "lives", "in", "your"];
const accentWord = "office.";

const heroPills = [
  "$0 per-seat fees",
  "On-prem & on-brand",
  "5–200+ user teams",
  "GDPR & CCPA aligned",
];

const trustNumbers = [
  { value: "99.9%", label: "uptime target" },
  { value: "$0", label: "per-seat fees" },
  { value: "weeks", label: "to deploy" },
];

const pillars = [
  {
    eyebrow: "01",
    title: "On-prem",
    body: "A real server in your office. Hardware you own, software you control. No vendor can pull the rug.",
  },
  {
    eyebrow: "02",
    title: "Owned",
    body: "Your data lives on your hardware, your storage, your network. We never see it. No third party reads it.",
  },
  {
    eyebrow: "03",
    title: "Branded",
    body: "Your domain, your logo, your colors across thirteen services. It looks like your company built it.",
  },
];

const processSteps = [
  { n: "01", label: "Discovery" },
  { n: "02", label: "Architecture" },
  { n: "03", label: "Build" },
  { n: "04", label: "Onboard" },
];

const proofProducts = [
  {
    name: "Cookie Yeti",
    pitch: "Privacy-first browser extension blocking 200K+ malicious banner domains.",
    href: "/cookie-yeti",
  },
  {
    name: "InventoryProof",
    pitch: "Self-custody photo evidence with cryptographic timestamps for IRS-grade records.",
    href: "/inventoryproof",
  },
  {
    name: "Bestly In-House Cloud",
    pitch: "Thirteen services on one server. We dogfood our own product first.",
    href: "/cloud",
  },
];

export default function Index() {
  const reduce = useReducedMotion();

  return (
    <>
      <SEOHead
        title="Bestly — Privacy-first cloud & product studio"
        description="Bestly is a product studio that builds and operates its own private cloud. We replace Google Workspace, Zoom, Slack, and DocuSign with on-premise infrastructure that wears your brand. For teams of 5 to 200+."
        path="/"
      />

      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden min-h-[92vh] flex items-center wow-bg-ink wow-text-paper">
        {/* Restrained vignette — no mesh, no gradient blobs. Just paper-on-ink. */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,hsl(var(--wow-indigo)/0.10),transparent_60%)]" />

        <div className="relative mx-auto max-w-7xl w-full px-6 py-32 lg:px-8 lg:py-40">
          <div className="mx-auto max-w-5xl">
            {/* Eyebrow */}
            <motion.p
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: HOUSE_EASE }}
              className="text-xs font-medium uppercase tracking-[0.2em] wow-text-muted mb-10"
            >
              Bestly · Los Angeles
            </motion.p>

            {/* Headline — kinetic word-by-word with accent underline on the noun */}
            <h1 className="font-display font-normal tracking-[-0.04em] leading-[0.95] text-[clamp(2.5rem,7vw,6rem)]">
              <span className="block">
                {heroHeadline.map((word, i) => (
                  <motion.span
                    key={`${word}-${i}`}
                    className="inline-block mr-[0.22em]"
                    initial={reduce ? false : { opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.55,
                      delay: reduce ? 0 : 0.08 * i,
                      ease: HOUSE_EASE,
                    }}
                  >
                    {word}
                  </motion.span>
                ))}
                <motion.span
                  className="inline-block wow-underline-accent wow-text-paper"
                  initial={reduce ? false : { opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.55,
                    delay: reduce ? 0 : 0.08 * heroHeadline.length,
                    ease: HOUSE_EASE,
                  }}
                >
                  {accentWord}
                </motion.span>
              </span>
            </h1>

            {/* Subhead */}
            <motion.p
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.9, ease: HOUSE_EASE }}
              className="mt-10 max-w-2xl text-lg sm:text-xl leading-relaxed wow-text-muted"
            >
              Bestly is a product studio that builds and operates its own private cloud.
              We&rsquo;ll build yours — on-premise, on-brand, and free of per-seat licensing for good.
            </motion.p>

            {/* CTAs */}
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1.05, ease: HOUSE_EASE }}
              className="mt-12 flex flex-col sm:flex-row gap-4"
            >
              <Link
                to="/contact"
                className="group inline-flex items-center justify-center rounded-md wow-bg-indigo px-8 py-4 text-base font-medium wow-text-paper transition-transform duration-200 wow-ease hover:-translate-y-[1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--wow-indigo-light))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--wow-ink))]"
              >
                Book a discovery call
                <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 wow-ease group-hover:translate-x-0.5" />
              </Link>
              <a
                href="mailto:jared@bestly.tech?subject=Bestly%20%E2%80%94%20Discovery%20Call"
                className="inline-flex items-center justify-center rounded-md border wow-border bg-transparent px-8 py-4 text-base font-medium wow-text-paper transition-colors duration-200 wow-ease hover:wow-bg-elev focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--wow-indigo-light))]"
              >
                jared@bestly.tech
              </a>
            </motion.div>

            {/* Trust pills */}
            <motion.div
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.7, delay: 1.25, ease: HOUSE_EASE }}
              className="mt-14 flex flex-wrap gap-x-7 gap-y-3 text-sm wow-text-muted"
            >
              {heroPills.map((pill) => (
                <span key={pill} className="inline-flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 wow-text-indigo" />
                  {pill}
                </span>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* ---------- Trust strip (numbers + compliance) ---------- */}
      <section className="wow-bg-ink wow-text-paper wow-hairline">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8 lg:py-20">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-6">
            {trustNumbers.map((n, i) => (
              <AnimatedSection key={n.label} delay={i * 80}>
                <div className="flex flex-col">
                  <div className="font-display text-5xl sm:text-6xl tracking-[-0.04em] wow-text-paper">
                    {n.value}
                  </div>
                  <div className="mt-2 text-sm uppercase tracking-[0.18em] wow-text-muted">
                    {n.label}
                  </div>
                </div>
              </AnimatedSection>
            ))}
          </div>
          <div className="mt-12 flex flex-wrap gap-x-8 gap-y-3 text-xs uppercase tracking-[0.18em] wow-text-muted">
            <span>GDPR</span>
            <span aria-hidden="true">·</span>
            <span>CCPA</span>
            <span aria-hidden="true">·</span>
            <span>HIPAA-aligned</span>
            <span aria-hidden="true">·</span>
            <span>SOC 2 in progress</span>
          </div>
        </div>
      </section>

      {/* ---------- Three pillars ---------- */}
      <section className="wow-bg-ink wow-text-paper wow-hairline">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="max-w-2xl mb-20">
            <p className="text-xs font-medium uppercase tracking-[0.2em] wow-text-indigo mb-5">
              The thesis
            </p>
            <h2 className="font-display font-normal tracking-[-0.03em] leading-[1.05] text-[clamp(2rem,4.5vw,3.75rem)] wow-text-paper">
              <em className="not-italic">On-prem.</em> <em className="not-italic">Owned.</em>{" "}
              <em className="not-italic">Branded.</em>
            </h2>
            <p className="mt-6 text-lg wow-text-muted max-w-xl">
              Three things rented infrastructure can&rsquo;t give you. Three things we ship as defaults.
            </p>
          </AnimatedSection>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-14">
            {pillars.map((p, i) => (
              <AnimatedSection key={p.title} delay={i * 100}>
                <div className="border-t wow-border pt-8">
                  <p className="font-display text-sm wow-text-muted mb-4">{p.eyebrow}</p>
                  <h3 className="font-display text-2xl sm:text-3xl tracking-[-0.02em] wow-text-paper">
                    {p.title}
                  </h3>
                  <p className="mt-5 text-base leading-relaxed wow-text-muted">{p.body}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Flagship: In-House Cloud ---------- */}
      <section className="wow-bg-elev wow-text-paper">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection>
            <Link to="/cloud" className="block group">
              <div className="border-t wow-border pt-12 lg:pt-16">
                <p className="text-xs font-medium uppercase tracking-[0.2em] wow-text-indigo mb-6">
                  Flagship · In-House Cloud
                </p>
                <h2 className="font-display font-normal tracking-[-0.03em] leading-[1.02] text-[clamp(2.25rem,5.5vw,4.5rem)] wow-text-paper max-w-4xl">
                  Thirteen services on one server.{" "}
                  <span className="wow-text-muted">Wearing your brand.</span>
                </h2>
                <p className="mt-8 max-w-2xl text-lg leading-relaxed wow-text-muted">
                  Drive, mail, video, chat, docs, calendar, e-sign, passwords, projects, local AI &mdash;
                  on a single server in your office. Replaces Google Workspace, Zoom, Slack, DocuSign.
                  No per-seat fees, ever.
                </p>
                <div className="mt-10 inline-flex items-center gap-3 text-base wow-text-paper">
                  <span className="border-b border-current pb-1">See the math</span>
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 wow-ease group-hover:translate-x-1" />
                </div>
              </div>
            </Link>
          </AnimatedSection>
        </div>
      </section>

      {/* ---------- Process strip ---------- */}
      <section className="wow-bg-ink wow-text-paper wow-hairline">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-24">
          <AnimatedSection className="mb-12">
            <p className="text-xs font-medium uppercase tracking-[0.2em] wow-text-muted">
              How it ships
            </p>
          </AnimatedSection>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-4">
            {processSteps.map((s, i) => (
              <AnimatedSection key={s.label} delay={i * 80}>
                <div className="border-t wow-border pt-6">
                  <div className="font-display text-sm wow-text-muted">{s.n}</div>
                  <div className="mt-3 font-display text-xl sm:text-2xl tracking-[-0.02em] wow-text-paper">
                    {s.label}
                  </div>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Proof products ---------- */}
      <section className="wow-bg-ink wow-text-paper wow-hairline">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="max-w-2xl mb-16">
            <p className="text-xs font-medium uppercase tracking-[0.2em] wow-text-indigo mb-5">
              We ship
            </p>
            <h2 className="font-display font-normal tracking-[-0.03em] leading-[1.05] text-[clamp(2rem,4.5vw,3.75rem)] wow-text-paper">
              We dogfood. <span className="wow-text-muted">These are ours.</span>
            </h2>
          </AnimatedSection>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-14">
            {proofProducts.map((p, i) => (
              <AnimatedSection key={p.name} delay={i * 100}>
                <Link
                  to={p.href}
                  className="block group border-t wow-border pt-8 transition-transform duration-200 wow-ease hover:-translate-y-1"
                >
                  <h3 className="font-display text-2xl sm:text-3xl tracking-[-0.02em] wow-text-paper">
                    {p.name}
                  </h3>
                  <p className="mt-5 text-base leading-relaxed wow-text-muted">{p.pitch}</p>
                  <div className="mt-7 inline-flex items-center gap-2 text-sm uppercase tracking-[0.18em] wow-text-paper">
                    Read more
                    <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 wow-ease group-hover:translate-x-0.5" />
                  </div>
                </Link>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Founder note + final CTA ---------- */}
      {/* Note: founder copy is a v3 placeholder. Replace with Jared's longhand 2 paragraphs per Phase 0.4. */}
      <section className="wow-bg-cream text-[hsl(0_0%_8%)]">
        <div className="mx-auto max-w-3xl px-6 py-28 lg:px-8 lg:py-36">
          <AnimatedSection>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-[hsl(0_0%_30%)] mb-8">
              From the founder
            </p>
            <div className="font-display text-2xl sm:text-3xl leading-[1.35] tracking-[-0.01em]">
              <p>
                I built Bestly because I got tired of paying rent on my own work. Per-seat
                licenses, surveillance-default tools, and platforms that change the deal every
                two quarters &mdash; that&rsquo;s what we&rsquo;ve all been calling &ldquo;modern&rdquo; software.
              </p>
              <p className="mt-6">
                Our private cloud lives in your office, on hardware you own, wearing your
                brand. We build the boring, durable infrastructure other companies rent. If
                that&rsquo;s the kind of stack you want, talk to me directly.
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
              <Link
                to="/contact"
                className="group inline-flex items-center justify-center rounded-md bg-[hsl(var(--wow-indigo-deep))] px-8 py-4 text-base font-medium text-[hsl(var(--wow-paper))] transition-transform duration-200 wow-ease hover:-translate-y-[1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--wow-indigo-deep))] focus-visible:ring-offset-2"
              >
                Book a discovery call
                <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 wow-ease group-hover:translate-x-0.5" />
              </Link>
              <a
                href="mailto:jared@bestly.tech?subject=Bestly%20%E2%80%94%20Discovery%20Call"
                className="inline-flex items-center justify-center rounded-md border border-[hsl(0_0%_15%)] bg-transparent px-8 py-4 text-base font-medium text-[hsl(0_0%_8%)] transition-colors duration-200 wow-ease hover:bg-[hsl(0_0%_8%/0.05)]"
              >
                jared@bestly.tech
              </a>
            </div>
          </AnimatedSection>
        </div>
      </section>
    </>
  );
}
