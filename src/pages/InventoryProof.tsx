import { SEOHead } from "@/components/SEOHead";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";

import { GlowCard } from "@/components/ui/GlowCard";
import { Button } from "@/components/ui/button";
import {
  Smartphone,
  Video,
  Brain,
  FileText,
  Shield,
  Users,
  Lock,
  CheckCircle,
  Home,
  Briefcase,
  ScrollText,
  ExternalLink,
  ArrowRight,
  
} from "lucide-react";
import inventoryProofIcon from "@/assets/inventoryproof-icon.png";
import { Link } from "react-router-dom";

const InventoryProof = () => {
  const features = [
    {
      icon: Brain,
      title: "AI-Powered Detection",
      description: "Automatically recognizes objects, brands, and models from video walkthrough footage.",
    },
    {
      icon: FileText,
      title: "Instant Valuations",
      description: "Get retail and resale value estimates for everything you own in real-time.",
    },
    {
      icon: Users,
      title: "Human Verification",
      description: "Optional expert review ensures accuracy for high-value items like jewelry and art.",
    },
    {
      icon: CheckCircle,
      title: "Insurance-Ready Reports",
      description: "Generate timestamped PDF and CSV reports accepted by all major insurers.",
    },
    {
      icon: Lock,
      title: "Data Vault",
      description: "Securely store receipts, warranties, and appraisals linked to each item.",
    },
    {
      icon: ScrollText,
      title: "Estate Planning",
      description: "Create wills and living trusts with direct item assignment to beneficiaries.",
    },
  ];

  const steps = [
    {
      icon: Video,
      title: "Record a Walkthrough",
      description: "Simply walk through your home recording a video of each room and your belongings.",
    },
    {
      icon: Brain,
      title: "AI Analysis",
      description: "Our AI automatically identifies, classifies, and estimates the value of every item it sees.",
    },
    {
      icon: FileText,
      title: "Get Your Report",
      description: "Receive a comprehensive, insurance-ready inventory report within minutes.",
    },
  ];

  return (
    <>
      <SEOHead
        title="InventoryProof - AI-Powered Home Inventory | Bestly LLC"
        description="Create insurance-ready documentation of your belongings in minutes with AI-powered video analysis."
      />

      {/* Hero — deep blue tech aesthetic */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-mesh" />
        <div className="absolute inset-0 bg-grid opacity-40" />
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-gradient-to-r from-[hsl(var(--gradient-start)/0.15)] to-[hsl(var(--gradient-end)/0.08)] rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 -right-32 w-80 h-80 bg-gradient-to-l from-[hsl(var(--gradient-end)/0.12)] to-[hsl(var(--gradient-start)/0.06)] rounded-full blur-3xl" />

        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-36">
          <AnimatedSection animation="fade-in-up" className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-background/60 backdrop-blur-sm px-4 py-2 text-sm font-medium text-primary">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
              </span>
              Available on the App Store
            </div>

            <div className="mb-6 flex justify-center">
              <img src={inventoryProofIcon} alt="InventoryProof" className="h-20 w-20 rounded-2xl" />
            </div>

            <h1 className="text-5xl font-semibold tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              InventoryProof
            </h1>
            <p className="mt-4 text-xl text-primary font-medium">
              Your possessions, verified and protected.
            </p>
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground max-w-2xl mx-auto">
              A mobile-first platform that helps homeowners and renters create
              insurance-ready documentation of their belongings in minutes — not hours.
            </p>

            <div className="mt-10 flex justify-center">
              <a href="https://apps.apple.com/us/app/inventoryproof/id6758317473" target="_blank" rel="noopener noreferrer">
                <img
                  src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg"
                  alt="Download on the App Store"
                  style={{ width: 180 }}
                />
              </a>
            </div>

            <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
              <Button variant="outline" size="lg" asChild>
                <a href="https://inventoryproof.com" target="_blank" rel="noopener noreferrer">
                  Visit inventoryproof.com
                  <ExternalLink className="ml-2 h-4 w-4" />
                </a>
              </Button>
              <Button variant="outline" size="lg" asChild>
                <a href="#how-it-works">How It Works</a>
              </Button>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* Why It Matters — stat callout */}
      <section className="border-t border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <AnimatedSection className="mx-auto max-w-3xl text-center">
            <div className="rounded-2xl border border-border bg-card p-10 glow-sm">
              <p className="text-6xl font-semibold text-primary">40%</p>
              <p className="mt-4 text-xl text-foreground font-medium">
                of insurance claim value is lost by the average homeowner
              </p>
              <p className="mt-4 text-muted-foreground max-w-lg mx-auto">
                Due to incomplete documentation. InventoryProof ensures you
                can prove exactly what you owned — before you need to.
              </p>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="text-center mb-16">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              How It Works
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Document your entire home inventory in three simple steps.
            </p>
          </AnimatedSection>

          <div className="grid gap-8 md:grid-cols-3 max-w-5xl mx-auto">
            {steps.map((step, index) => (
              <AnimatedSection key={step.title} delay={index * 100}>
                <div className="relative text-center">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-full gradient-bg text-white text-sm font-semibold mb-6">
                    {index + 1}
                  </div>
                  <div className="flex justify-center mb-5">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.1)] to-[hsl(var(--gradient-end)/0.1)]">
                      <step.icon className="h-7 w-7 text-primary" />
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{step.description}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="text-center mb-16">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Key Features
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Everything you need to protect your assets and plan for the future.
            </p>
          </AnimatedSection>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 max-w-6xl mx-auto">
            {features.map((feature, index) => (
              <AnimatedSection key={feature.title} delay={index * 60}>
                <GlowCard className="h-full">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.1)] to-[hsl(var(--gradient-end)/0.1)]">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-foreground">{feature.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                </GlowCard>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Trust Indicators */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <div className="grid gap-8 sm:grid-cols-3 max-w-4xl mx-auto">
            {[
              { icon: Home, value: "12,000+", label: "Homeowners trust us" },
              { icon: Shield, value: "AES-256", label: "Encrypted storage" },
              { icon: Briefcase, value: "All Major", label: "Insurers accepted" },
            ].map((stat, i) => (
              <AnimatedSection key={stat.label} delay={i * 100}>
                <div className="text-center p-6 rounded-2xl border border-border bg-card">
                  <div className="flex justify-center mb-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.1)] to-[hsl(var(--gradient-end)/0.1)]">
                      <stat.icon className="h-6 w-6 text-primary" />
                    </div>
                  </div>
                  <p className="text-2xl font-semibold text-foreground">{stat.value}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{stat.label}</p>
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
          <AnimatedSection className="relative mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Available Now
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              InventoryProof is live on the App Store. Download it today and protect what matters.
            </p>
            <div className="mt-8 flex justify-center">
              <a href="https://apps.apple.com/us/app/inventoryproof/id6758317473" target="_blank" rel="noopener noreferrer">
                <img
                  src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg"
                  alt="Download on the App Store"
                  style={{ width: 180 }}
                />
              </a>
            </div>
            <div className="mt-6">
              <Button variant="outline" size="lg" asChild>
                <Link to="/products">View All Products</Link>
              </Button>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* Legal Notice */}
      <section className="py-12 border-t border-border">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm text-muted-foreground">
              InventoryProof is a product of Bestly LLC. All features are
              subject to our{" "}
              <Link to="/terms-of-service" className="underline hover:text-foreground">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link to="/privacy-policy" className="underline hover:text-foreground">
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </Layout>
  );
};

export default InventoryProof;
