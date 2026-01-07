import { useEffect } from "react";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Download,
  Mail,
  Building2,
  FileText,
  Image,
  Newspaper,
  ExternalLink,
} from "lucide-react";
import { Link } from "react-router-dom";
import bestlyLogo from "@/assets/bestly-logo.png";

const PressKit = () => {
  useEffect(() => {
    document.title = "Press Kit - Media Resources | Bestly LLC";
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute(
        "content",
        "Official press kit for Bestly LLC. Download brand assets, logos, and access media resources for press coverage."
      );
    }
  }, []);

  const products = [
    {
      name: "Cookie Yeti",
      tagline: "Dismiss cookie banners with one click.",
      description:
        "A privacy-focused browser extension that automatically detects and dismisses cookie consent banners without compromising user privacy or accepting tracking cookies.",
      category: "Browser Extension",
      status: "Active",
    },
    {
      name: "InventoryProof",
      tagline: "Your possessions, verified and protected.",
      description:
        "A mobile-first platform that uses AI-powered video analysis to help homeowners and renters create insurance-ready documentation of their belongings in minutes.",
      category: "Mobile Platform",
      status: "In Development",
    },
    {
      name: "HOKU",
      tagline: "Premium Hypochlorous Acid Skincare.",
      description:
        "A premium skincare brand delivering pharmaceutical-grade hypochlorous acid formulations using advanced electrolysis manufacturing and vacuum-sealed packaging.",
      category: "Physical Product",
      status: "In Development",
    },
  ];

  const companyFacts = [
    { label: "Founded", value: "2024" },
    { label: "Headquarters", value: "United States" },
    { label: "Focus Areas", value: "Privacy, AI, Consumer Products" },
    { label: "Company Type", value: "Multi-Vertical Product Studio" },
  ];

  return (
    <Layout>
      <div className="bg-background">
        {/* Hero Section */}
        <section className="py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <div className="mb-6 flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                  <Newspaper className="h-8 w-8 text-primary" />
                </div>
              </div>
              <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
                Press Kit
              </h1>
              <p className="mt-6 text-lg leading-8 text-muted-foreground">
                Official media resources for Bestly LLC. Find brand assets,
                product information, and company details for press coverage.
              </p>
            </div>
          </div>
        </section>

        {/* Company Overview */}
        <section className="py-16 bg-muted/30">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="mx-auto max-w-3xl">
              <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Company Overview
              </h2>
              <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
                Bestly LLC is a multi-vertical product studio building
                privacy-first digital and physical products. We create tools and
                products that respect user privacy, leverage thoughtful
                technology, and deliver genuine value across diverse categories
                including software, consumer electronics, and personal care.
              </p>
              <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
                Our philosophy centers on data minimization, transparency, and
                building products that don't exploit user attention or personal
                information. We believe great products can be both profitable
                and ethical.
              </p>

              <div className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-4">
                {companyFacts.map((fact, index) => (
                  <div key={index}>
                    <p className="text-sm font-medium text-muted-foreground">
                      {fact.label}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-foreground">
                      {fact.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Brand Assets */}
        <section className="py-16">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="mx-auto max-w-3xl">
              <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Brand Assets
              </h2>
              <p className="mt-4 text-muted-foreground">
                Download official Bestly LLC logos and brand materials for media
                use.
              </p>

              <Card className="mt-8 border-border">
                <CardContent className="pt-6">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
                    <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-muted p-4">
                      <img
                        src={bestlyLogo}
                        alt="Bestly LLC Logo"
                        className="h-16 w-auto rotate-[20deg]"
                      />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-foreground">
                        Primary Logo
                      </h3>
                      <p className="mt-1 text-muted-foreground">
                        The official Bestly LLC logo. Use on light or dark
                        backgrounds with adequate contrast.
                      </p>
                      <div className="mt-4 flex flex-wrap gap-3">
                        <Button variant="outline" size="sm" asChild>
                          <a href={bestlyLogo} download="bestly-logo.png">
                            <Download className="mr-2 h-4 w-4" />
                            PNG
                          </a>
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="mt-8 rounded-lg bg-muted/50 p-6">
                <h3 className="font-semibold text-foreground">
                  Brand Guidelines
                </h3>
                <ul className="mt-4 space-y-2 text-muted-foreground">
                  <li>• Maintain clear space around the logo equal to the height of the icon</li>
                  <li>• Do not distort, rotate beyond brand specifications, or add effects to the logo</li>
                  <li>• Primary colors: Neutral tones with high contrast for accessibility</li>
                  <li>• Typography: Clean, modern sans-serif fonts</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Product Descriptions */}
        <section className="py-16 bg-muted/30">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="mx-auto max-w-3xl">
              <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Product Descriptions
              </h2>
              <p className="mt-4 text-muted-foreground">
                Official descriptions for media use. Please use these
                descriptions when covering our products.
              </p>

              <div className="mt-8 space-y-6">
                {products.map((product, index) => (
                  <Card key={index} className="border-border">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-xl">
                            {product.name}
                          </CardTitle>
                          <p className="mt-1 text-primary font-medium">
                            {product.tagline}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded">
                            {product.category}
                          </span>
                          <span
                            className={`text-xs font-medium px-2 py-1 rounded ${
                              product.status === "Active"
                                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                                : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                            }`}
                          >
                            {product.status}
                          </span>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-muted-foreground">
                        {product.description}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Media Contact */}
        <section className="py-16">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="mx-auto max-w-3xl">
              <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Media Contact
              </h2>
              <p className="mt-4 text-muted-foreground">
                For press inquiries, interview requests, or additional
                information, please contact our media relations team.
              </p>

              <Card className="mt-8 border-border">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                      <Mail className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">
                        Press Inquiries
                      </p>
                      <a
                        href="mailto:press@bestly.tech"
                        className="text-primary hover:underline"
                      >
                        press@bestly.tech
                      </a>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="mt-8 rounded-lg bg-muted/50 p-6">
                <h3 className="font-semibold text-foreground">
                  Response Time
                </h3>
                <p className="mt-2 text-muted-foreground">
                  We aim to respond to all media inquiries within 24-48 business
                  hours. For urgent requests, please indicate "URGENT" in your
                  subject line.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Additional Resources */}
        <section className="py-16 bg-muted/30">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="mx-auto max-w-3xl">
              <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Additional Resources
              </h2>

              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <Card className="border-border">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                        <Building2 className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">
                          About Bestly
                        </p>
                        <Link
                          to="/about"
                          className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                        >
                          Learn more <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                        <FileText className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">
                          Legal Documents
                        </p>
                        <Link
                          to="/terms"
                          className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                        >
                          View policies <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                        <Image className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">
                          All Products
                        </p>
                        <Link
                          to="/products"
                          className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                        >
                          View portfolio <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                        <Mail className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">
                          General Contact
                        </p>
                        <Link
                          to="/contact"
                          className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                        >
                          Get in touch <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </section>

        {/* Usage Terms */}
        <section className="py-12 border-t border-border">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm text-muted-foreground">
                All brand assets are provided for editorial and media use only.
                Commercial use requires written permission from Bestly LLC.
                Assets subject to our{" "}
                <Link to="/terms" className="underline hover:text-foreground">
                  Terms of Service
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

export default PressKit;
