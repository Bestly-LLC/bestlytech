import { useEffect } from "react";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
} from "lucide-react";
import { Link } from "react-router-dom";

const InventoryProof = () => {
  useEffect(() => {
    document.title = "InventoryProof - AI-Powered Home Inventory | Bestly LLC";
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute(
        "content",
        "Create insurance-ready documentation of your belongings in minutes with AI-powered video analysis. Trusted by 12,000+ homeowners."
      );
    }
  }, []);

  const features = [
    {
      icon: Brain,
      title: "AI-Powered Detection",
      description:
        "Automatically recognizes objects, brands, and models from video walkthrough footage.",
    },
    {
      icon: FileText,
      title: "Instant Valuations",
      description:
        "Get retail and resale value estimates for everything you own in real-time.",
    },
    {
      icon: Users,
      title: "Human Verification",
      description:
        "Optional expert review ensures accuracy for high-value items like jewelry and art.",
    },
    {
      icon: CheckCircle,
      title: "Insurance-Ready Reports",
      description:
        "Generate timestamped PDF and CSV reports accepted by all major insurers.",
    },
    {
      icon: Lock,
      title: "Data Vault",
      description:
        "Securely store receipts, warranties, and appraisals linked to each item.",
    },
    {
      icon: ScrollText,
      title: "Estate Planning",
      description:
        "Create wills and living trusts with direct item assignment to beneficiaries.",
    },
  ];

  const steps = [
    {
      icon: Video,
      title: "Record a Walkthrough",
      description:
        "Simply walk through your home recording a video of each room and your belongings.",
    },
    {
      icon: Brain,
      title: "AI Analysis",
      description:
        "Our AI automatically identifies, classifies, and estimates the value of every item it sees.",
    },
    {
      icon: FileText,
      title: "Get Your Report",
      description:
        "Receive a comprehensive, insurance-ready inventory report within minutes.",
    },
  ];

  return (
    <Layout>
      <div className="bg-background">
        {/* Hero Section */}
        <section className="relative overflow-hidden py-20 sm:py-32">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <div className="mb-8 flex justify-center">
                <div className="relative rounded-full px-4 py-1.5 text-sm leading-6 text-muted-foreground ring-1 ring-border">
                  <span className="inline-flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75"></span>
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-primary"></span>
                    </span>
                    Coming Soon
                  </span>
                </div>
              </div>
              <div className="mb-6 flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                  <Smartphone className="h-8 w-8 text-primary" />
                </div>
              </div>
              <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
                InventoryProof
              </h1>
              <p className="mt-4 text-xl text-primary font-medium">
                Your possessions, verified and protected.
              </p>
              <p className="mt-6 text-lg leading-8 text-muted-foreground">
                A mobile-first platform that helps homeowners and renters create
                insurance-ready documentation of their belongings in minutes—not
                hours.
              </p>
              <div className="mt-10 flex items-center justify-center gap-x-6">
                <Button size="lg" disabled>
                  Get Notified at Launch
                </Button>
                <Button variant="outline" size="lg" asChild>
                  <a href="#how-it-works">Learn More</a>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="py-20 bg-muted/30">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                How It Works
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Document your entire home inventory in three simple steps.
              </p>
            </div>
            <div className="mx-auto mt-16 max-w-5xl">
              <div className="grid gap-8 md:grid-cols-3">
                {steps.map((step, index) => (
                  <Card key={index} className="relative border-border">
                    <CardContent className="pt-6">
                      <div className="absolute -top-4 left-6 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-sm">
                        {index + 1}
                      </div>
                      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                        <step.icon className="h-6 w-6 text-primary" />
                      </div>
                      <h3 className="text-lg font-semibold text-foreground">
                        {step.title}
                      </h3>
                      <p className="mt-2 text-muted-foreground">
                        {step.description}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="py-20">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Key Features
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Everything you need to protect your assets and plan for the
                future.
              </p>
            </div>
            <div className="mx-auto mt-16 max-w-5xl">
              <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
                {features.map((feature, index) => (
                  <Card key={index} className="border-border">
                    <CardContent className="pt-6">
                      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                        <feature.icon className="h-6 w-6 text-primary" />
                      </div>
                      <h3 className="text-lg font-semibold text-foreground">
                        {feature.title}
                      </h3>
                      <p className="mt-2 text-muted-foreground">
                        {feature.description}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Why It Matters */}
        <section className="py-20 bg-muted/30">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Why It Matters
              </h2>
              <div className="mt-8 rounded-2xl bg-background p-8 ring-1 ring-border">
                <p className="text-5xl font-bold text-primary">40%</p>
                <p className="mt-4 text-xl text-foreground font-medium">
                  of insurance claim value is lost by the average homeowner
                </p>
                <p className="mt-4 text-muted-foreground">
                  Due to incomplete documentation. InventoryProof ensures you
                  can prove exactly what you owned—before you need to.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Trust Indicators */}
        <section className="py-20">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="mx-auto max-w-4xl">
              <div className="grid gap-8 sm:grid-cols-3 text-center">
                <div>
                  <div className="flex justify-center mb-4">
                    <Home className="h-8 w-8 text-primary" />
                  </div>
                  <p className="text-3xl font-bold text-foreground">12,000+</p>
                  <p className="mt-1 text-muted-foreground">Homeowners trust us</p>
                </div>
                <div>
                  <div className="flex justify-center mb-4">
                    <Shield className="h-8 w-8 text-primary" />
                  </div>
                  <p className="text-3xl font-bold text-foreground">AES-256</p>
                  <p className="mt-1 text-muted-foreground">Encrypted storage</p>
                </div>
                <div>
                  <div className="flex justify-center mb-4">
                    <Briefcase className="h-8 w-8 text-primary" />
                  </div>
                  <p className="text-3xl font-bold text-foreground">All Major</p>
                  <p className="mt-1 text-muted-foreground">Insurers accepted</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 bg-muted/30">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Coming Soon
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                InventoryProof is currently in development. Be the first to know
                when we launch.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" disabled>
                  Get Notified at Launch
                </Button>
                <Button variant="outline" size="lg" asChild>
                  <Link to="/products">View All Products</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Legal Notice */}
        <section className="py-12 border-t border-border">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm text-muted-foreground">
                InventoryProof is a product of Bestly LLC. All features are
                subject to our{" "}
                <Link to="/terms" className="underline hover:text-foreground">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link to="/privacy" className="underline hover:text-foreground">
                  Privacy Policy
                </Link>
                .
              </p>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
};

export default InventoryProof;
