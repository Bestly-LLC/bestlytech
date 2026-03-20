import { Link } from "react-router-dom";
import { SEOHead } from "@/components/SEOHead";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { GlowCard } from "@/components/ui/GlowCard";
import { GradientText } from "@/components/ui/GradientText";
import {
  MapPin, Smartphone, CreditCard, Fingerprint, ShieldCheck,
  Mail, Repeat, ShoppingCart, BarChart3, Award, ArrowRight,
  Wine, UtensilsCrossed, Store, Scissors, Dumbbell, Ticket, Hotel,
  CheckCircle2, ChevronRight,
} from "lucide-react";

const coreComponents = [
  {
    icon: MapPin,
    title: "Apple Discovery Infrastructure",
    deliverables: [
      "Business Connect listing optimization",
      "Maps Place Card configuration",
      "Showcase campaign setup",
      "Multi-location consistency",
    ],
    outcome: "Increased high-intent local traffic via Apple Maps and Siri.",
  },
  {
    icon: Smartphone,
    title: "Instant Customer Experience (App Clips)",
    deliverables: [
      "Lightweight App Clip design",
      "QR / NFC / location invocation",
      "Menu, booking, or ordering flows",
      "Customer interaction analytics",
    ],
    outcome: "Immediate engagement without full app downloads.",
  },
  {
    icon: CreditCard,
    title: "Payments Modernization",
    deliverables: [
      "Tap to Pay on iPhone deployment",
      "Apple Pay readiness consulting",
      "Checkout workflow training",
      "Conversion tracking integration",
    ],
    outcome: "Reduced checkout friction and increased mobile payments.",
  },
  {
    icon: Fingerprint,
    title: "Digital ID Verification",
    deliverables: [
      "Digital ID acceptance assessment",
      "Mobile ID verification workflow",
      "Staff verification training",
      "Compliance SOP documentation",
    ],
    outcome: "Faster entry processing and reduced fraud exposure.",
  },
  {
    icon: ShieldCheck,
    title: "Brand Trust & Identity",
    deliverables: [
      "Branded email identity (BIMI)",
      "Domain authentication (SPF/DKIM/DMARC)",
      "Wallet pass deployment",
      "Apple ecosystem brand consistency",
    ],
    outcome: "Increased trust signals across Apple interfaces.",
  },
  {
    icon: Repeat,
    title: "Customer Experience Automation",
    deliverables: [
      "NFC-triggered return experiences",
      "Loyalty and promo automation",
      "Reservation / booking integration",
      "Membership enablement",
    ],
    outcome: "Higher repeat-customer conversion and retention.",
  },
  {
    icon: ShoppingCart,
    title: "Commerce & Ordering",
    deliverables: [
      "Apple Pay web checkout optimization",
      "App Clip ordering flows",
      "Mobile-first commerce deployment",
      "Subscription payment integration",
    ],
    outcome: "Direct revenue capture without third-party intermediaries.",
  },
  {
    icon: BarChart3,
    title: "Operational Analytics",
    deliverables: [
      "Apple Maps engagement dashboards",
      "Conversion funnel reporting",
      "Campaign performance tracking",
      "Quarterly optimization audits",
    ],
    outcome: "Data-driven decisions and measurable ROI tracking.",
  },
  {
    icon: Award,
    title: "Apple-Ready Certification",
    optional: true,
    deliverables: [
      "Maps listing optimized",
      "App Clip operational",
      "Tap-to-Pay enabled",
      "Wallet pass deployed",
    ],
    outcome: "Marketable differentiation badge for certified businesses.",
  },
];

const tiers = [
  {
    name: "Presence Setup",
    tier: "Tier 1",
    includes: [
      "Apple Business Connect listing optimization",
      "Maps Place Card configuration",
      "Initial Showcase campaign",
      "Basic analytics setup",
    ],
  },
  {
    name: "Conversion Stack",
    tier: "Tier 2",
    includes: [
      "Everything in Tier 1",
      "App Clip deployment",
      "NFC / QR invocation infrastructure",
      "Customer interaction flows",
      "Apple Pay readiness consulting",
    ],
  },
  {
    name: "Commerce & Identity Stack",
    tier: "Tier 3",
    includes: [
      "Everything in Tier 2",
      "Tap-to-Pay enablement",
      "Digital ID verification readiness",
      "Wallet pass deployment",
      "Customer lifecycle automation",
    ],
  },
  {
    name: "Enterprise Modernization",
    tier: "Tier 4",
    includes: [
      "Everything in Tier 3",
      "Analytics dashboards",
      "Multi-location rollout",
      "Quarterly optimization reporting",
      "Certification program eligibility",
    ],
  },
];

const verticals = [
  { icon: Wine, name: "Bars & Nightlife" },
  { icon: UtensilsCrossed, name: "Restaurants & Cafés" },
  { icon: Store, name: "Retail Boutiques" },
  { icon: Scissors, name: "Salons & Spas" },
  { icon: Dumbbell, name: "Fitness Studios" },
  { icon: Ticket, name: "Event Venues" },
  { icon: Hotel, name: "Hospitality" },
];

export default function AppleModernization() {
  return (
    <Layout>
      <SEOHead
        title="Apple Business Modernization | Bestly"
        description="Apple-native infrastructure for local businesses. Discovery, payments, identity verification, and automation — all built on Apple's ecosystem."
        path="/apple-modernization"
      />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-mesh opacity-50" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection animation="fade-in" className="text-center max-w-4xl mx-auto">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary mb-4">
              Flagship Program
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              <GradientText as="span">Apple-Native Infrastructure</GradientText>{" "}
              for Local Businesses
            </h1>
            <p className="mt-6 text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              A turnkey modernization stack that enables discovery, payments, identity verification, 
              customer engagement, and analytics — all built on Apple's ecosystem.
            </p>
            <div className="mt-10">
              <Link
                to="/hire"
                className="group inline-flex items-center justify-center rounded-xl gradient-bg px-8 py-4 text-base font-medium text-white shadow-lg shadow-primary/20 btn-lift"
              >
                Get Started
                <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* Program Overview */}
      <section className="border-t border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection animation="fade-in" className="max-w-3xl mx-auto text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Program Overview
            </h2>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
              This program creates a comprehensive Apple-native operational stack that integrates 
              discovery, payments, identity verification, engagement, and analytics into a single 
              modernization offering. We position your business as a technology infrastructure partner — 
              not a marketing vendor.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* Core Components */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection animation="fade-in" className="text-center mb-16">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Core Components
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Nine integrated service modules covering the full Apple ecosystem.
            </p>
          </AnimatedSection>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {coreComponents.map((comp, index) => (
              <AnimatedSection key={comp.title} animation="fade-in" delay={index * 60}>
                <GlowCard className="h-full">
                  <div className="flex items-start justify-between">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.1)] to-[hsl(var(--gradient-end)/0.1)]">
                      <comp.icon className="h-6 w-6 text-primary" />
                    </div>
                    {comp.optional && (
                      <span className="text-xs font-medium text-muted-foreground bg-secondary px-2 py-1 rounded-full">
                        Optional
                      </span>
                    )}
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-foreground">{comp.title}</h3>
                  <ul className="mt-3 space-y-1.5">
                    {comp.deliverables.map((d) => (
                      <li key={d} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                        {d}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 text-sm font-medium text-foreground/80 border-t border-border pt-3">
                    {comp.outcome}
                  </p>
                </GlowCard>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Service Tiers */}
      <section className="border-t border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection animation="fade-in" className="text-center mb-16">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Service Tiers
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Each tier builds on the previous, scaling with your business needs.
            </p>
          </AnimatedSection>

          <div className="grid gap-6 md:grid-cols-2 max-w-5xl mx-auto">
            {tiers.map((tier, index) => (
              <AnimatedSection key={tier.name} animation="fade-in" delay={index * 80}>
                <GlowCard className="h-full">
                  <span className="text-xs font-semibold uppercase tracking-widest text-primary">
                    {tier.tier}
                  </span>
                  <h3 className="mt-2 text-xl font-semibold text-foreground">{tier.name}</h3>
                  <ul className="mt-4 space-y-2">
                    {tier.includes.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <ChevronRight className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </GlowCard>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Target Verticals */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection animation="fade-in" className="text-center mb-16">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Ideal For
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Highest-ROI verticals that benefit most from Apple-native infrastructure.
            </p>
          </AnimatedSection>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4 max-w-5xl mx-auto">
            {verticals.map((v, index) => (
              <AnimatedSection key={v.name} animation="fade-in" delay={index * 50}>
                <div className="text-center p-4 rounded-2xl border border-border bg-card transition-all hover:shadow-premium hover:-translate-y-1">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.1)] to-[hsl(var(--gradient-end)/0.1)] mb-3">
                    <v.icon className="h-5 w-5 text-primary" />
                  </div>
                  <p className="text-xs font-medium text-foreground">{v.name}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border bg-secondary/20">
        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <div className="absolute inset-0 bg-mesh opacity-30" />
          <AnimatedSection animation="fade-in" className="relative text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Ready to Modernize?
            </h2>
            <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              Let's discuss how Apple-native infrastructure can transform your business operations.
            </p>
            <div className="mt-10">
              <Link
                to="/hire"
                className="group inline-flex items-center justify-center rounded-xl gradient-bg px-8 py-4 text-base font-medium text-white shadow-lg shadow-primary/20 btn-lift"
              >
                Start the Conversation
                <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>
            </div>
          </AnimatedSection>
        </div>
      </section>
    </Layout>
  );
}
