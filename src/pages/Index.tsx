import { Layout } from "@/components/layout/Layout";
import { Link } from "react-router-dom";
import { 
  Shield, 
  Database, 
  Lock, 
  Globe,
  Monitor,
  Cpu,
  Puzzle,
  Smartphone,
  Box,
  Workflow
} from "lucide-react";

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
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-7xl px-6 py-24 sm:py-32 lg:px-8 lg:py-40">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl text-balance">
              Building Privacy-First Digital & Physical Products
            </h1>
            <p className="mt-6 text-lg leading-8 text-muted-foreground text-balance">
              Bestly LLC is a multi-vertical product studio developing consumer software, AI tools, 
              hardware-adjacent devices, and physical products with a strict commitment to privacy, 
              transparency, and ethical design.
            </p>
            <div className="mt-10 flex items-center justify-center gap-x-4">
              <Link
                to="/products"
                className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                View Our Products
              </Link>
              <Link
                to="/about"
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-6 py-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Learn More
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Focus Areas Grid */}
      <section className="border-t border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Our Core Focus Areas
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              We build across multiple verticals, united by our commitment to quality and user privacy.
            </p>
          </div>
          <div className="mx-auto mt-16 grid max-w-5xl grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {focusAreas.map((area) => (
              <div
                key={area.name}
                className="relative rounded-xl border border-border bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <area.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-foreground">
                  {area.name}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {area.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust & Compliance Strip */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Trust & Compliance
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Our commitment to protecting your data and respecting your rights.
            </p>
          </div>
          <div className="mx-auto mt-16 grid max-w-4xl grid-cols-1 gap-8 sm:grid-cols-2">
            {trustPrinciples.map((principle) => (
              <div key={principle.name} className="flex gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-secondary">
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
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="border-t border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Questions or Inquiries?
            </h2>
            <p className="mt-4 text-muted-foreground">
              We're here to help with any questions about our products, partnerships, or compliance.
            </p>
            <div className="mt-8">
              <Link
                to="/contact"
                className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                Contact Us
              </Link>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
