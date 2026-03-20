import { SEOHead } from "@/components/SEOHead";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { GlowCard } from "@/components/ui/GlowCard";
import { Link } from "react-router-dom";
import jaredHeadshot from "@/assets/jared-headshot.png";
import {
  Eye, ShieldCheck, Ban, BrainCircuit, Lock,
  Smartphone, Puzzle, Cpu, Box, Droplets, HardDrive,
  ArrowRight, Fingerprint, Server, UserX, Trash2,
  MapPin, Heart,
} from "lucide-react";

const verticals = [
  { icon: Smartphone, label: "Mobile Apps", desc: "iOS & Android" },
  { icon: Puzzle, label: "Browser Extensions", desc: "Productivity & privacy" },
  { icon: Cpu, label: "AI Tools", desc: "Built with transparency" },
  { icon: Box, label: "Consumer Tech", desc: "Everyday products" },
  { icon: HardDrive, label: "Physical Products", desc: "Companion apps" },
  { icon: Droplets, label: "Wellness", desc: "Cosmetic-safe, non-medical" },
];

const operatingPrinciples = [
  { icon: Eye, title: "Transparency", desc: "We tell you what we collect, why, and how it's used." },
  { icon: Fingerprint, title: "Data Minimization", desc: "We only collect what's strictly necessary. Nothing more." },
  { icon: ShieldCheck, title: "User Control", desc: "Access, modify, or delete your data — anytime, no hoops." },
  { icon: Ban, title: "No Dark Patterns", desc: "Honest interfaces, honest business. No tricks, no data sales." },
  { icon: Server, title: "On-Device First", desc: "Your data stays on your device whenever possible." },
  { icon: BrainCircuit, title: "AI Disclosure", desc: "When we use AI, we explain how — clearly and upfront." },
  { icon: Lock, title: "Security", desc: "Industry-standard protections, regularly audited." },
  { icon: UserX, title: "No Cross-App Tracking", desc: "We don't follow you around the internet. Period." },
  { icon: Trash2, title: "Right to Deletion", desc: "Your data, your call. One request and it's gone." },
];

export default function About() {
  return (
    <>
      <SEOHead
        title="About Jared Best | Founder of Bestly LLC"
        description="Founder-led technology studio based in Los Angeles. We build privacy-first software, consumer products, and business tools — without the trade-offs."
        path="/about"
      />

      {/* Hero — Founder Introduction */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-mesh opacity-50" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-36">
          <div className="grid gap-12 lg:grid-cols-[auto_1fr] lg:items-center lg:gap-20">
            <AnimatedSection animation="fade-in">
              <div className="flex justify-center lg:justify-start">
                <div className="relative">
                  <div className="absolute -inset-1 rounded-3xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.3)] to-[hsl(var(--gradient-end)/0.3)] blur-xl" />
                  <img
                    src={jaredHeadshot}
                    alt="Jared Best, founder of Bestly LLC"
                    className="relative w-72 h-72 sm:w-80 sm:h-80 rounded-3xl object-cover shadow-2xl border-2 border-border"
                  />
                </div>
              </div>
            </AnimatedSection>
            <AnimatedSection animation="fade-in" delay={100}>
              <div className="text-center lg:text-left">
                <p className="text-sm font-semibold uppercase tracking-widest text-primary mb-4">
                  Founder & Builder
                </p>
                <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                  Hey, I'm Jared.
                </h1>
                <p className="mt-6 text-xl text-muted-foreground leading-relaxed max-w-2xl">
                  I run Bestly — a technology studio based in Los Angeles. We build software, consumer products, and business tools that respect the people who use them.
                </p>
                <div className="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4 text-primary" />
                  Los Angeles, California
                </div>
              </div>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* The Story */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <div className="grid gap-16 lg:grid-cols-2 lg:items-start">
            <AnimatedSection>
              <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                Why I Started This
              </h2>
              <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
                I got tired of building things that worked <em>against</em> the people using them — products designed to extract data, exploit attention, and maximize engagement at all costs.
              </p>
              <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
                So I started building the opposite. Technology that makes life better without making privacy worse. That's not a tagline — it's how I decide what to build and what to skip.
              </p>
            </AnimatedSection>
            <AnimatedSection delay={100}>
              <GlowCard className="p-8">
                <h3 className="text-xl font-semibold text-foreground mb-4">Lean by Design</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  Bestly is founder-led and intentionally lean. No outside investors pushing us to monetize your data. No board meetings debating whether to sell your information.
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  This structure lets us move fast and stay principled — from software to physical products, the same standards apply to everything we ship.
                </p>
              </GlowCard>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* What We Build */}
      <section className="border-t border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="text-center mb-16">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              What We Build
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Different industries, same conviction.
            </p>
          </AnimatedSection>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {verticals.map((v, i) => (
              <AnimatedSection key={v.label} delay={i * 60}>
                <div className="text-center p-5 rounded-2xl border border-border bg-card transition-all hover:shadow-premium hover:-translate-y-1">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.1)] to-[hsl(var(--gradient-end)/0.1)] mb-3">
                    <v.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="text-sm font-semibold text-foreground">{v.label}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{v.desc}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* How We Operate — Consolidated principles + privacy */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="text-center mb-16">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              How We Operate
            </h2>
            <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              Privacy isn't a feature we bolt on — it's the foundation everything else is built on.
            </p>
          </AnimatedSection>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto">
            {operatingPrinciples.map((p, i) => (
              <AnimatedSection key={p.title} delay={i * 60}>
                <div className="flex gap-4 p-5 rounded-2xl border border-border bg-card transition-all hover:shadow-lg hover:border-border/60 h-full">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.1)] to-[hsl(var(--gradient-end)/0.1)]">
                    <p.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{p.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{p.desc}</p>
                  </div>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Platform + Wellness */}
      <section className="border-t border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <div className="grid gap-8 lg:grid-cols-2">
            <AnimatedSection>
              <GlowCard className="h-full p-8">
                <h3 className="text-xl font-semibold text-foreground mb-4">Built for Every Platform</h3>
                <p className="text-muted-foreground leading-relaxed">
                  We build for people, not platforms. iOS, Android, web — our products deliver consistent experiences with the same privacy protections, regardless of where you use them.
                </p>
              </GlowCard>
            </AnimatedSection>
            <AnimatedSection delay={100}>
              <GlowCard className="h-full p-8">
                <h3 className="text-xl font-semibold text-foreground mb-4">Wellness Product Safety</h3>
                <p className="text-muted-foreground leading-relaxed mb-3">
                  Some of our products fall into the wellness-adjacent category. We make no medical claims, comply with FDA cosmetics guidelines, and clearly disclose all ingredients and usage instructions.
                </p>
                <p className="text-sm text-muted-foreground">
                  Users are encouraged to consult healthcare professionals for medical concerns.
                </p>
              </GlowCard>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border">
        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <div className="absolute inset-0 bg-mesh opacity-30" />
          <AnimatedSection className="relative text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.1)] to-[hsl(var(--gradient-end)/0.1)] mb-6">
              <Heart className="h-7 w-7 text-primary" />
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Let's Build Something Together
            </h2>
            <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              Whether you need a product built, a business scaled, or a partnership that goes deeper — I'd love to hear from you.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/hire"
                className="group inline-flex items-center justify-center rounded-xl gradient-bg px-8 py-4 text-base font-medium text-white shadow-lg shadow-primary/20 btn-lift"
              >
                Work With Me
                <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                to="/products"
                className="inline-flex items-center justify-center rounded-xl border border-border bg-background/80 backdrop-blur-sm px-8 py-4 text-base font-medium text-foreground shadow-sm transition-all hover:bg-accent hover:border-border/80"
              >
                View Products
              </Link>
            </div>
          </AnimatedSection>
        </div>
      </section>
    </Layout>
  );
}