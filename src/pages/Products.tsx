import { useState } from "react";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { GlowCard } from "@/components/ui/GlowCard";
import { GradientText } from "@/components/ui/GradientText";
import { ExternalLink, ArrowRight, Box, Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { products, categories, type ProductCategory, type ProductStatus } from "@/config/products";

const statusColors: Record<ProductStatus, string> = {
  Live: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  "In Development": "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  "Coming Soon": "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
};

export default function Products() {
  const [activeCategory, setActiveCategory] = useState<"All" | ProductCategory>("All");

  const filtered =
    activeCategory === "All"
      ? products
      : products.filter((p) => p.category === activeCategory);

  return (
    <>
      <SEOHead
        title="The Bestly Suite — Apps That Simplify Your Life"
        description="Explore the full Bestly LLC product suite: Cookie Yeti, InventoryProof, SchoolPilot, HOA Cure, Confesh, and more. Download on the App Store or try on the web."
      />

      <div className="relative">
        <div className="absolute inset-0 bg-mesh opacity-30 pointer-events-none" />

        <div className="relative mx-auto max-w-7xl px-6 py-16 lg:px-8 lg:py-24">
          {/* Hero */}
          <AnimatedSection className="mb-16 max-w-3xl text-center mx-auto">
            <Badge variant="outline" className="mb-4 border-primary/30 text-primary">
              Our Apps
            </Badge>
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              The Bestly <GradientText>Suite</GradientText>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              Apps that simplify your life — built with privacy at the core, designed with care, and crafted to just work.
            </p>
          </AnimatedSection>

          {/* Filter Tabs */}
          <AnimatedSection delay={60} className="mb-10">
            <div className="flex flex-wrap gap-2 justify-center">
              {(["All", ...categories] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-all duration-200 border ${
                    activeCategory === cat
                      ? "bg-primary text-primary-foreground border-primary shadow-md"
                      : "bg-card text-muted-foreground border-border hover:text-foreground hover:border-foreground/20"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </AnimatedSection>

          {/* Products Grid */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((product, index) => {
              const hasDetailPage = ["/cookie-yeti", "/inventory-proof", "/hoku", "/neckpilot"].includes(product.href) || product.href.startsWith("https://");
              return (
                <AnimatedSection key={product.id} delay={index * 80}>
                  <GlowCard className="h-full flex flex-col">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-4">
                      {product.image ? (
                        <div className="h-16 w-16 rounded-2xl overflow-hidden bg-secondary/30 flex items-center justify-center shadow-sm">
                          <img
                            src={product.image}
                            alt={product.name}
                            className="h-14 w-14 object-contain"
                            loading="lazy"
                            width={56}
                            height={56}
                          />
                        </div>
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.1)] to-[hsl(var(--gradient-end)/0.1)]">
                          <Box className="h-8 w-8 text-primary" />
                        </div>
                      )}
                      <Badge variant="outline" className={statusColors[product.status]}>
                        {product.status}
                      </Badge>
                    </div>

                    <h3 className="text-xl font-semibold text-foreground mb-2">{product.name}</h3>
                    <p className="text-muted-foreground mb-4 leading-relaxed text-sm">
                      {product.description}
                    </p>

                    {/* Features */}
                    {product.features && product.features.length > 0 && (
                      <ul className="space-y-1.5 mb-5 flex-grow">
                        {product.features.map((feature) => (
                          <li key={feature} className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                            {feature}
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-4 border-t border-border mt-auto">
                      {product.appStoreUrl && (
                        <Button asChild size="sm" variant="outline" className="gap-1.5">
                          <a href={product.appStoreUrl} target="_blank" rel="noopener noreferrer">
                            <Download className="h-3.5 w-3.5" />
                            App Store
                          </a>
                        </Button>
                      )}
                      {product.webUrl && (
                        <Button asChild size="sm" variant="outline" className="gap-1.5">
                          <a href={product.webUrl} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-3.5 w-3.5" />
                            Dashboard
                          </a>
                        </Button>
                      )}
                      {hasDetailPage && (
                        product.href.startsWith("https://") ? (
                          <Button asChild size="sm" variant="ghost" className="gap-1 ml-auto">
                            <a href={product.href} target="_blank" rel="noopener noreferrer">
                              Learn More
                              <ArrowRight className="h-3.5 w-3.5" />
                            </a>
                          </Button>
                        ) : (
                          <Button asChild size="sm" variant="ghost" className="gap-1 ml-auto">
                            <Link to={product.href}>
                              Learn More
                              <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        )
                      )}
                    </div>
                  </GlowCard>
                </AnimatedSection>
              );
            })}

            {/* Placeholder */}
            <AnimatedSection delay={filtered.length * 80}>
              <div className="relative h-full min-h-[300px] rounded-2xl border border-dashed border-border bg-gradient-to-br from-secondary/30 to-secondary/10 p-6 flex flex-col items-center justify-center text-center">
                <div className="w-14 h-14 rounded-xl bg-secondary/50 flex items-center justify-center mb-4">
                  <Box className="h-7 w-7 text-muted-foreground" />
                </div>
                <p className="text-foreground font-medium mb-2">More Coming Soon</p>
                <p className="text-sm text-muted-foreground max-w-[200px]">
                  Something new is always in the works.
                </p>
              </div>
            </AnimatedSection>
          </div>

          {/* Legal Notice */}
          <AnimatedSection delay={100}>
            <section className="mt-16 p-8 rounded-2xl bg-gradient-to-br from-secondary/40 to-secondary/20 border border-border">
              <h3 className="font-semibold text-foreground mb-3">Product Legal Information</h3>
              <p className="text-muted-foreground leading-relaxed">
                Each product has its own specific privacy policy and terms of service that supplement
                our{" "}
                <Link to="/privacy-policy" className="text-foreground underline underline-offset-4 hover:text-primary transition-colors">
                  Master Privacy Policy
                </Link>{" "}
                and{" "}
                <Link to="/terms-of-service" className="text-foreground underline underline-offset-4 hover:text-primary transition-colors">
                  Master Terms of Service
                </Link>
                .
              </p>
            </section>
          </AnimatedSection>
        </div>
      </div>
    </>
  );
}
