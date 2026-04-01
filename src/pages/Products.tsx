import { useState } from "react";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { GlowCard } from "@/components/ui/GlowCard";
import { GradientText } from "@/components/ui/GradientText";
import { ExternalLink, ArrowRight, Box } from "lucide-react";
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
        title="What We're Building | Bestly LLC"
        description="Explore our portfolio of privacy-first products including Cookie Yeti, InventoryProof, SchoolPilot, HOA Cure, and Confesh."
      />

      <div className="relative">
        <div className="absolute inset-0 bg-mesh opacity-30 pointer-events-none" />

        <div className="relative mx-auto max-w-7xl px-6 py-16 lg:px-8 lg:py-24">
          {/* Header */}
          <AnimatedSection className="mb-12 max-w-3xl">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              What We're <GradientText>Building</GradientText>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
              Every product starts with the same question: how do we make this great without compromising anyone's privacy?
            </p>
          </AnimatedSection>

          {/* Filter Tabs */}
          <AnimatedSection delay={60} className="mb-10">
            <div className="flex flex-wrap gap-2">
              {(["All", ...categories] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 border ${
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
                    <div className="flex items-start justify-between mb-5">
                      {product.image ? (
                        <div className="h-14 w-14 rounded-xl overflow-hidden bg-secondary/30 flex items-center justify-center">
                          <img
                            src={product.image}
                            alt={product.name}
                            className="h-12 w-12 object-contain"
                            loading="lazy"
                            width={48}
                            height={48}
                          />
                        </div>
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.1)] to-[hsl(var(--gradient-end)/0.1)]">
                          <Box className="h-7 w-7 text-primary" />
                        </div>
                      )}
                      <Badge variant="outline" className={statusColors[product.status]}>
                        {product.status}
                      </Badge>
                    </div>

                    <h3 className="text-xl font-semibold text-foreground mb-3">{product.name}</h3>

                    <p className="text-muted-foreground mb-6 leading-relaxed flex-grow">
                      {product.description}
                    </p>

                    <div className="flex items-center justify-between pt-5 border-t border-border">
                      <Badge variant="outline" className="text-xs border-border">
                        {product.category}
                      </Badge>

                      <div className="flex items-center gap-3">
                        {product.appStoreUrl && (
                          <a
                            href={product.appStoreUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                          >
                            App Store
                            <ExternalLink className="ml-1 h-3.5 w-3.5" />
                          </a>
                        )}
                        {product.webUrl && (
                          <a
                            href={product.webUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Website
                            <ExternalLink className="ml-1 h-3.5 w-3.5" />
                          </a>
                        )}
                        {hasDetailPage && (
                          product.href.startsWith("https://") ? (
                            <a
                              href={product.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors group"
                            >
                              Details
                              <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                            </a>
                          ) : (
                            <Link
                              to={product.href}
                              className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors group"
                            >
                              Details
                              <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                            </Link>
                          )
                        )}
                      </div>
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
