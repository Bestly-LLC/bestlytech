import { products } from "@/config/products";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { Link } from "react-router-dom";
import { Shield, Database, Lock, Globe, ArrowRight, CheckCircle2, MapPin, Cloud } from "lucide-react";
import { GradientText } from "@/components/ui/GradientText";
import { GlowCard } from "@/components/ui/GlowCard";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";

import glossyApps from "@/assets/glossy-apps.png";
import glossyAi from "@/assets/glossy-ai.png";
import glossyExtension from "@/assets/glossy-extension.png";
import glossyConsumer from "@/assets/glossy-consumer.png";
import glossyPhysical from "@/assets/glossy-physical.png";
import glossyEcosystem from "@/assets/glossy-ecosystem.png";

const focusAreas = [
  {
    name: "Apps & Platforms",
    description: "Mobile and web products designed to work for you, not against you.",
    image: glossyApps,
  },
  {
    name: "AI & Automation",
    description: "Smart tools that are transparent about how they think.",
    image: glossyAi,
  },
  {
    name: "Browser Extensions",
    description: "Productivity without the surveillance.",
    image: glossyExtension,
  },
  {
    name: "Consumer Tech",
    description: "Everyday tools, built to last.",
    image: glossyConsumer,
  },
  {
    name: "Physical Products",
    description: "Real things you can hold. No data strings attached.",
    image: glossyPhysical,
  },
  {
    name: "Connected Ecosystems",
    description: "Software and hardware that work as one.",
    image: glossyEcosystem,
  },
];

const trustPrinciples = [
  {
    name: "Privacy by Design",
    description: "Built in from day one. Not bolted on after.",
    icon: Shield,
  },
  {
    name: "Less Data, More Trust",
    description: "We collect only what's needed. Nothing more.",
    icon: Database,
  },
  {
    name: "Zero Data Sales",
    description: "Your information is never for sale. Period.",
    icon: Lock,
  },
  {
    name: "Global Standards",
    description: "GDPR, CCPA, and beyond. Your rights, worldwide.",
    icon: Globe,
  },
];

const metrics = [
  { value: products.length, label: "Products Built", suffix: "" },
  { value: 100, label: "Privacy First", suffix: "%" },
  { value: 0, label: "User Data Sold", suffix: "" },
];

export default function Index() {
  return (
    <>
      <SEOHead
        title="Bestly — Privacy-first cloud & product studio"
        description="Bestly is a product studio that builds and operates its own private cloud. We replace Google Workspace, Zoom, Slack, and DocuSign with on-premise infrastructure that wears your brand. For teams of 5 to 200+."
        path="/"
      />

      {/* Hero Section */}
      <section className="relative overflow-hidden min-h-[90vh] flex items-center">
        <div className="absolute inset-0 bg-mesh" />
        <div className="absolute inset-0 bg-grid opacity-50" />
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-gradient-to-r from-[hsl(var(--gradient-start)/0.2)] to-[hsl(var(--gradient-end)/0.1)] rounded-full blur-3xl animate-float-slow" />
        <div className="absolute bottom-1/4 -right-32 w-80 h-80 bg-gradient-to-l from-[hsl(var(--gradient-end)/0.15)] to-[hsl(var(--gradient-start)/0.1)] rounded-full blur-3xl animate-float-slow" style={{ animationDelay: '-3s' }} />

        <div className="relative mx-auto max-w-7xl px-6 py-32 lg:px-8 lg:py-40">
          <AnimatedSection className="mx-auto max-w-4xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary mb-6">
              Privacy-first infrastructure · Los Angeles
            </p>

            <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:text-5xl lg:text-7xl leading-[1.05]">
              The cloud that{" "}
              <GradientText className="font-semibold inline-block">
                lives in your office.
              </GradientText>
            </h1>

            <p className="mt-8 text-lg sm:text-xl leading-relaxed text-muted-foreground text-balance max-w-2xl mx-auto">
              Bestly is a product studio that builds and operates its own private cloud.
              We&rsquo;ll build yours — on-premise, on-brand, and free of per-seat licensing for good.
            </p>

            <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to="/contact"
                className="group inline-flex items-center justify-center rounded-xl gradient-bg px-8 py-4 text-base font-medium text-white shadow-lg shadow-primary/20 transition-all hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Book a Discovery Call
                <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>
              <a
                href="mailto:jared@bestly.tech?subject=Bestly%20%E2%80%94%20Discovery%20Call"
                className="inline-flex items-center justify-center rounded-xl border border-border bg-background/80 backdrop-blur-sm px-8 py-4 text-base font-medium text-foreground shadow-sm transition-all hover:bg-accent hover:border-border/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Email jared@bestly.tech
              </a>
            </div>

            <div className="mt-16 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span>$0 per-seat fees</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span>On-prem &amp; on-brand</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span>5–200+ user teams</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span>GDPR &amp; CCPA aligned</span>
              </div>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* In-House Cloud Callout — flagship offer */}
      <section className="relative border-t border-border bg-secondary/20">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-24">
          <AnimatedSection animation="fade-in">
            <Link to="/cloud" className="block group">
              <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-[hsl(var(--gradient-start)/0.04)] to-[hsl(var(--gradient-end)/0.08)] p-8 sm:p-12 transition-all hover:shadow-premium hover:-translate-y-1">
                <div className="absolute top-6 right-6 sm:top-8 sm:right-8">
                  <ArrowRight className="h-6 w-6 text-primary transition-transform group-hover:translate-x-1" />
                </div>
                <div className="flex flex-col sm:flex-row items-start gap-6 sm:gap-8">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.15)] to-[hsl(var(--gradient-end)/0.15)]">
                    <Cloud className="h-8 w-8 text-primary" />
                  </div>
                  <div className="max-w-2xl">
                    <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-2">Flagship Program</p>
                    <h3 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
                      Bestly In-House Cloud
                    </h3>
                    <p className="mt-3 text-muted-foreground leading-relaxed">
                      Thirteen services — drive, mail, video, chat, docs, calendar, e-sign, passwords, projects, local AI — on a single server in your office. Branded to your company. No per-seat fees, ever.
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2">
                      {["On-prem", "Branded", "Local AI", "GDPR &amp; CCPA", "$200K–$1.6M+ saved"].map((tag) => (
                        <span key={tag} className="text-xs font-medium text-primary bg-primary/10 px-3 py-1 rounded-full" dangerouslySetInnerHTML={{ __html: tag }} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          </AnimatedSection>
        </div>
      </section>

      {/* Metrics Section */}
      <section className="relative border-t border-border bg-secondary/30">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {metrics.map((metric, index) => (
              <AnimatedSection key={metric.label} delay={index * 100} className="text-center">
                <div className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-foreground">
                  <AnimatedCounter end={metric.value} suffix={metric.suffix} />
                </div>
                <div className="mt-2 text-sm sm:text-base text-muted-foreground font-medium">
                  {metric.label}
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Focus Areas Grid */}
      <section className="relative border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="mx-auto max-w-2xl text-center mb-16">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
              What We Build
            </h2>
            <p className="mt-6 text-lg text-muted-foreground">
              From apps to physical goods — always privacy-first.
            </p>
          </AnimatedSection>
          
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {focusAreas.map((area, index) => (
              <AnimatedSection key={area.name} delay={index * 80}>
                <GlowCard className="h-full text-center">
                  <div className="flex justify-center mb-2">
                    <img
                      src={area.image}
                      alt={area.name}
                      loading="lazy"
                      width={120}
                      height={120}
                      className="w-24 h-24 sm:w-28 sm:h-28 object-contain drop-shadow-lg transition-transform duration-500 group-hover:scale-110 group-hover:drop-shadow-2xl"
                    />
                  </div>
                  <h3 className="mt-3 text-lg font-semibold text-foreground">
                    {area.name}
                  </h3>
                  <p className="mt-2 text-muted-foreground leading-relaxed">
                    {area.description}
                  </p>
                </GlowCard>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Apple Modernization Callout */}
      <section className="relative border-t border-border bg-secondary/20">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection animation="fade-in">
            <Link to="/apple-modernization" className="block group">
              <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-[hsl(var(--gradient-start)/0.04)] to-[hsl(var(--gradient-end)/0.08)] p-8 sm:p-12 transition-all hover:shadow-premium hover:-translate-y-1">
                <div className="absolute top-6 right-6 sm:top-8 sm:right-8">
                  <ArrowRight className="h-6 w-6 text-primary transition-transform group-hover:translate-x-1" />
                </div>
                <div className="flex flex-col sm:flex-row items-start gap-6 sm:gap-8">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.15)] to-[hsl(var(--gradient-end)/0.15)]">
                    <MapPin className="h-8 w-8 text-primary" />
                  </div>
                  <div className="max-w-2xl">
                    <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-2">Apple-Native Stack</p>
                    <h3 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
                      Apple-Native Business Modernization
                    </h3>
                    <p className="mt-3 text-muted-foreground leading-relaxed">
                      A turnkey infrastructure stack for local businesses — discovery, payments, identity verification, and automation, all built on Apple's ecosystem.
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2">
                      {["Apple Maps", "Tap to Pay", "App Clips", "Digital ID", "Wallet Passes"].map((tag) => (
                        <span key={tag} className="text-xs font-medium text-primary bg-primary/10 px-3 py-1 rounded-full">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          </AnimatedSection>
        </div>
      </section>

      {/* Trust & Compliance Strip */}
      <section className="relative border-t border-border bg-secondary/20">
        {/* Subtle gradient accent */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
        
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="mx-auto max-w-2xl text-center mb-16">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
              Our Principles
            </h2>
            <p className="mt-6 text-lg text-muted-foreground">
              Not policies. Promises.
            </p>
          </AnimatedSection>
          
          <div className="mx-auto grid max-w-4xl grid-cols-1 gap-8 sm:grid-cols-2">
            {trustPrinciples.map((principle, index) => (
              <AnimatedSection key={principle.name} delay={index * 100}>
                <div className="flex gap-5 p-6 rounded-2xl bg-card border border-border transition-all hover:shadow-lg hover:border-border/60">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.1)] to-[hsl(var(--gradient-end)/0.1)]">
                    <principle.icon className="h-7 w-7 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">
                      {principle.name}
                    </h3>
                    <p className="mt-2 text-muted-foreground leading-relaxed">
                      {principle.description}
                    </p>
                  </div>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="relative border-t border-border">
        <div className="absolute inset-0 bg-mesh opacity-50" />

        <div className="relative mx-auto max-w-3xl px-6 py-24 lg:px-8 lg:py-32 text-center">
          <AnimatedSection>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
              Stop renting.{" "}
              <GradientText className="font-semibold inline-block">
                Start owning.
              </GradientText>
            </h2>
            <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
              Thirty minutes on a call, a side-by-side cost comparison, and zero pressure. Find out what your stack looks like when you bring it home.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to="/contact"
                className="group inline-flex items-center justify-center rounded-xl gradient-bg px-8 py-4 text-base font-medium text-white shadow-lg shadow-primary/20 transition-all hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5"
              >
                Book a Discovery Call
                <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>
              <a
                href="mailto:jared@bestly.tech?subject=Bestly%20%E2%80%94%20Discovery%20Call"
                className="inline-flex items-center justify-center rounded-xl border border-border bg-background/80 backdrop-blur-sm px-8 py-4 text-base font-medium text-foreground shadow-sm transition-all hover:bg-accent"
              >
                Email jared@bestly.tech
              </a>
            </div>
          </AnimatedSection>
        </div>
      </section>
    </>
  );
}
