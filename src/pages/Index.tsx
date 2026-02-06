import { Layout } from "@/components/layout/Layout";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { Link } from "react-router-dom";
import { Shield, Database, Lock, Globe, Monitor, Cpu, Puzzle, Smartphone, Box, Workflow, ArrowRight, CheckCircle2 } from "lucide-react";
import { GradientText } from "@/components/ui/GradientText";
import { GlowCard } from "@/components/ui/GlowCard";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";

const focusAreas = [
  {
    name: "Apps & Platforms",
    description: "Mobile and web products designed to work for you, not against you.",
    icon: Monitor,
  },
  {
    name: "AI & Automation",
    description: "Smart tools that are transparent about how they think.",
    icon: Cpu,
  },
  {
    name: "Browser Extensions",
    description: "Productivity without the surveillance.",
    icon: Puzzle,
  },
  {
    name: "Consumer Tech",
    description: "Everyday tools, built to last.",
    icon: Smartphone,
  },
  {
    name: "Physical Products",
    description: "Real things you can hold. No data strings attached.",
    icon: Box,
  },
  {
    name: "Connected Ecosystems",
    description: "Software and hardware that work as one.",
    icon: Workflow,
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
  { value: 3, label: "Products Shipped", suffix: "" },
  { value: 100, label: "Privacy Score", suffix: "%" },
  { value: 0, label: "User Data Sold", suffix: "" },
];

export default function Index() {
  return (
    <Layout>
      <SEOHead
        title="Bestly – Products That Respect People"
        description="Bestly is a product studio building software, hardware, and AI tools with privacy at the core."
        path="/"
      />

      {/* Hero Section */}
      <section className="relative overflow-hidden min-h-[90vh] flex items-center">
        {/* Gradient mesh background */}
        <div className="absolute inset-0 bg-mesh" />
        
        {/* Subtle grid overlay */}
        <div className="absolute inset-0 bg-grid opacity-50" />
        
        {/* Animated gradient orbs */}
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-gradient-to-r from-[hsl(var(--gradient-start)/0.2)] to-[hsl(var(--gradient-end)/0.1)] rounded-full blur-3xl animate-float-slow" />
        <div className="absolute bottom-1/4 -right-32 w-80 h-80 bg-gradient-to-l from-[hsl(var(--gradient-end)/0.15)] to-[hsl(var(--gradient-start)/0.1)] rounded-full blur-3xl animate-float-slow" style={{ animationDelay: '-3s' }} />
        
        <div className="relative mx-auto max-w-7xl px-6 py-32 lg:px-8 lg:py-40">
          <AnimatedSection className="mx-auto max-w-4xl text-center">
            {/* Premium badge */}
            <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-border bg-background/60 backdrop-blur-sm px-4 py-2 text-sm font-medium text-muted-foreground">
              <Shield className="h-4 w-4 text-primary" />
              A Bestly Studio
            </div>
            
            {/* Main headline with gradient */}
            <h1 className="text-5xl font-semibold tracking-tight text-foreground sm:text-6xl lg:text-7xl text-balance leading-[1.1]">
              Products That{" "}
              <GradientText className="font-semibold">
                Respect People
              </GradientText>
            </h1>
            
            <p className="mt-8 text-lg sm:text-xl leading-relaxed text-muted-foreground text-balance max-w-2xl mx-auto">
              We design software, hardware, and everything in between — all built on the principle that your data is yours.
            </p>
            
            {/* CTAs */}
            <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to="/products"
                className="group inline-flex items-center justify-center rounded-xl gradient-bg px-8 py-4 text-base font-medium text-white shadow-lg shadow-primary/20 transition-all hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                See What We're Building
                <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                to="/about"
                className="inline-flex items-center justify-center rounded-xl border border-border bg-background/80 backdrop-blur-sm px-8 py-4 text-base font-medium text-foreground shadow-sm transition-all hover:bg-accent hover:border-border/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Our Story
              </Link>
            </div>
            
            {/* Trust badges */}
            <div className="mt-16 flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span>GDPR Compliant</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span>CCPA Ready</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span>Zero Data Resale</span>
              </div>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* Metrics Section */}
      <section className="relative border-t border-border bg-secondary/30">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
          <div className="grid grid-cols-3 gap-8">
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
                <GlowCard className="h-full">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.1)] to-[hsl(var(--gradient-end)/0.1)] transition-all group-hover:from-[hsl(var(--gradient-start)/0.2)] group-hover:to-[hsl(var(--gradient-end)/0.2)]">
                    <area.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-foreground">
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

      {/* CTA Section */}
      <section className="relative border-t border-border">
        {/* Gradient background */}
        <div className="absolute inset-0 bg-mesh opacity-50" />
        
        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Let's Talk
            </h2>
            <p className="mt-6 text-lg text-muted-foreground">
              Whether it's a question, a partnership, or just curiosity — we're here.
            </p>
            <div className="mt-10">
              <Link
                to="/contact"
                className="group inline-flex items-center justify-center rounded-xl gradient-bg px-8 py-4 text-base font-medium text-white shadow-lg shadow-primary/20 transition-all hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5"
              >
                Contact Us
                <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>
            </div>
          </AnimatedSection>
        </div>
      </section>
    </Layout>
  );
}
