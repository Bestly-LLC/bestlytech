import { Layout } from "@/components/layout/Layout";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { GlowCard } from "@/components/ui/GlowCard";
import { Link } from "react-router-dom";
import jaredHeadshot from "@/assets/jared-headshot.png";
import {
  Eye, ShieldCheck, Ban, BrainCircuit, Lock,
  Smartphone, Puzzle, Cpu, Box, Droplets, HardDrive,
  ArrowRight, Fingerprint, Server, UserX, Trash2,
} from "lucide-react";

const verticals = [
  { icon: Smartphone, label: "Mobile Apps", desc: "iOS and Android" },
  { icon: Puzzle, label: "Browser Extensions", desc: "Productivity & privacy" },
  { icon: Cpu, label: "AI Tools", desc: "Built with transparency" },
  { icon: Box, label: "Consumer Tech", desc: "Everyday products" },
  { icon: HardDrive, label: "Physical Products", desc: "Companion apps" },
  { icon: Droplets, label: "Wellness", desc: "Cosmetic-safe, non-medical" },
];

const principles = [
  { icon: Eye, title: "Transparency", desc: "We tell you what we collect, why, and how it's used." },
  { icon: ShieldCheck, title: "User Control", desc: "Access, modify, or delete your data anytime." },
  { icon: Ban, title: "No Dark Patterns", desc: "Honest interfaces. No tricks." },
  { icon: BrainCircuit, title: "AI Disclosure", desc: "When we use AI, we explain how." },
  { icon: Lock, title: "Security", desc: "Industry-standard protections, regularly audited." },
];

const privacyCommitments = [
  { icon: Fingerprint, title: "Data Minimization", desc: "Only what's strictly necessary." },
  { icon: Server, title: "On-Device Processing", desc: "Your data stays on your device whenever possible." },
  { icon: Ban, title: "No Data Sales", desc: "Never. Period." },
  { icon: UserX, title: "No Cross-App Tracking", desc: "We don't follow you around." },
  { icon: Trash2, title: "Right to Deletion", desc: "Your data, your call." },
];

export default function About() {
  return (
    <Layout>
      <SEOHead
        title="Our Story | Bestly LLC"
        description="We build things people actually want — without the trade-offs they shouldn't have to make."
      />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-mesh opacity-50" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="max-w-3xl">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              Our Story
            </h1>
            <p className="mt-6 text-xl text-muted-foreground leading-relaxed max-w-2xl">
              We build things people actually want — without the trade-offs they shouldn't have to make.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* Why We Exist */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
            <AnimatedSection>
              <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                Why We Exist
              </h2>
              <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
                Technology should make life better without making privacy worse. That's not a tagline — it's how we decide what to build and what to skip.
              </p>
            </AnimatedSection>
            <AnimatedSection delay={100}>
              <GlowCard className="p-8">
                <h3 className="text-xl font-semibold text-foreground mb-4">Lean by Design</h3>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  We're founder-led and intentionally lean. No outside investors pushing us to monetize your data. No board meetings debating whether to sell your information.
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  This structure lets us move fast and stay principled — from software to physical products, the same standards apply to everything we ship.
                </p>
              </GlowCard>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* What We Touch */}
      <section className="border-t border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="text-center mb-16">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              What We Touch
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

      {/* How We Build */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="text-center mb-16">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              How We Build
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Ethical technology isn't a talking point — it's the filter for every decision.
            </p>
          </AnimatedSection>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto">
            {principles.map((p, i) => (
              <AnimatedSection key={p.title} delay={i * 80}>
                <GlowCard className="h-full">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.1)] to-[hsl(var(--gradient-end)/0.1)]">
                    <p.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-foreground">{p.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{p.desc}</p>
                </GlowCard>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Privacy as a Feature */}
      <section className="border-t border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="text-center mb-16">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Privacy as a Feature
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Our approach goes beyond checking boxes.
            </p>
          </AnimatedSection>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto">
            {privacyCommitments.map((c, i) => (
              <AnimatedSection key={c.title} delay={i * 80}>
                <div className="flex gap-4 p-5 rounded-2xl border border-border bg-card transition-all hover:shadow-lg hover:border-border/60">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.1)] to-[hsl(var(--gradient-end)/0.1)]">
                    <c.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{c.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{c.desc}</p>
                  </div>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Platform Agnostic + Wellness */}
      <section className="border-t border-border">
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
      <section className="border-t border-border bg-secondary/20">
        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Curious?
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              See what we're building or say hello.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/products"
                className="group inline-flex items-center justify-center rounded-xl gradient-bg px-8 py-4 text-base font-medium text-white shadow-lg shadow-primary/20 btn-lift"
              >
                View Products
                <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                to="/contact"
                className="inline-flex items-center justify-center rounded-xl border border-border bg-background/80 backdrop-blur-sm px-8 py-4 text-base font-medium text-foreground shadow-sm transition-all hover:bg-accent hover:border-border/80"
              >
                Contact Us
              </Link>
            </div>
          </AnimatedSection>
        </div>
      </section>
    </Layout>
  );
}
