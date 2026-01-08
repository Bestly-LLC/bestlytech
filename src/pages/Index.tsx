import { Layout } from "@/components/layout/Layout";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { Link } from "react-router-dom";
import { Shield, Database, Lock, Globe, Monitor, Cpu, Puzzle, Smartphone, Box, Workflow, ArrowRight } from "lucide-react";

const focusAreas = [
  {
    name: "Software Platforms",
    description: "Web and mobile applications built with user privacy at the core.",
    icon: Monitor,
  },
  {
    name: "AI & Automation Tools",
    description: "Intelligent systems designed with transparency and ethical principles.",
    icon: Cpu,
  },
  {
    name: "Browser Extensions",
    description: "Productivity tools that respect your browsing privacy.",
    icon: Puzzle,
  },
  {
    name: "Consumer Technology",
    description: "User-centric digital products for everyday life.",
    icon: Smartphone,
  },
  {
    name: "Physical Products & Devices",
    description: "Hardware-adjacent products with privacy-first companion apps.",
    icon: Box,
  },
  {
    name: "Digital-to-Physical Systems",
    description: "Seamless ecosystems connecting software with tangible products.",
    icon: Workflow,
  },
];

const trustPrinciples = [
  {
    name: "Privacy-First Architecture",
    description: "Every product is designed with privacy as a foundational requirement.",
    icon: Shield,
  },
  {
    name: "Minimal Data Collection",
    description: "We only collect data that is essential for product functionality.",
    icon: Database,
  },
  {
    name: "No Data Resale",
    description: "Your personal information is never sold to third parties.",
    icon: Lock,
  },
  {
    name: "Global Consumer Rights",
    description: "We support GDPR, CCPA, and international data protection standards.",
    icon: Globe,
  },
];

export default function Index() {
  return (
    <Layout>
      <SEOHead
        title="Bestly LLC – Privacy-First Digital & Physical Products"
        description="Bestly LLC is a multi-vertical product studio developing consumer software, AI tools, hardware-adjacent devices, and physical products with a commitment to privacy and ethical design."
        path="/"
      />

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Subtle background pattern */}
        <div className="absolute inset-0 bg-gradient-to-b from-secondary/30 to-transparent pointer-events-none" />
        
        <div className="relative mx-auto max-w-7xl px-6 py-24 sm:py-32 lg:px-8 lg:py-40">
          <AnimatedSection className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl text-balance">
              Building Thoughtful Digital & Physical Products
            </h1>
            <p className="mt-6 text-lg leading-8 text-muted-foreground text-balance">
              Bestly LLC is a multi-vertical product studio developing consumer software, AI tools,
              hardware-adjacent devices, and physical products with a strict commitment to privacy,
              transparency, and ethical design.
            </p>
            <div className="mt-10 flex items-center justify-center gap-x-4">
              <Link
                to="/products"
                className="group inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                View Our Products
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                to="/about"
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-6 py-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Learn More
              </Link>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* Focus Areas Grid */}
      <section className="border-t border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8">
          <AnimatedSection className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Our Core Focus Areas
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              We build across multiple verticals, united by our commitment to quality and user privacy.
            </p>
          </AnimatedSection>
          
          <div className="mx-auto mt-16 grid max-w-5xl grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {focusAreas.map((area, index) => (
              <AnimatedSection key={area.name} delay={index * 100}>
                <div className="group relative rounded-xl border border-border bg-card p-6 shadow-sm transition-all duration-300 hover:shadow-lg hover:border-primary/20 hover:-translate-y-1">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 transition-colors group-hover:bg-primary/20">
                    <area.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-foreground">
                    {area.name}
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                    {area.description}
                  </p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Trust & Compliance Strip */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8">
          <AnimatedSection className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Trust & Compliance
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Our commitment to protecting your data and respecting your rights.
            </p>
          </AnimatedSection>
          
          <div className="mx-auto mt-16 grid max-w-4xl grid-cols-1 gap-8 sm:grid-cols-2">
            {trustPrinciples.map((principle, index) => (
              <AnimatedSection key={principle.name} delay={index * 100}>
                <div className="flex gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-secondary transition-colors hover:bg-secondary/80">
                    <principle.icon className="h-6 w-6 text-foreground" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-foreground">
                      {principle.name}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
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
      <section className="border-t border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
          <AnimatedSection className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Questions or Inquiries?
            </h2>
            <p className="mt-4 text-muted-foreground">
              We're here to help with any questions about our products, partnerships, or compliance.
            </p>
            <div className="mt-8">
              <Link
                to="/contact"
                className="group inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md"
              >
                Contact Us
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </div>
          </AnimatedSection>
        </div>
      </section>
    </Layout>
  );
}
