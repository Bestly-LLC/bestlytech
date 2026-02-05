import { Layout } from "@/components/layout/Layout";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { GlowCard } from "@/components/ui/GlowCard";
import { GradientText } from "@/components/ui/GradientText";
import { 
  Smartphone, 
  Puzzle, 
  Cpu, 
  Box,
  ExternalLink,
  Droplets,
  ArrowRight,
} from "lucide-react";

type ProductCategory = "App" | "Extension" | "AI Tool" | "Physical Product" | "Device" | "Platform";
type ProductStatus = "Live" | "Active" | "In Development" | "Coming Soon";

interface Product {
  id: string;
  name: string;
  description: string;
  category: ProductCategory;
  status: ProductStatus;
  icon: typeof Smartphone;
}

const products: Product[] = [
  {
    id: "cookie-yeti",
    name: "Cookie Yeti",
    description: "A privacy-focused browser extension that automatically detects and dismisses cookie consent banners without compromising your privacy.",
    category: "Extension",
    status: "Coming Soon",
    icon: Puzzle,
  },
  {
    id: "inventory-proof",
    name: "InventoryProof",
    description: "AI-powered home inventory documentation for insurance claims and estate planning. Create insurance-ready reports from video walkthroughs in minutes.",
    category: "Platform",
    status: "In Development",
    icon: Smartphone,
  },
  {
    id: "hoku",
    name: "HOKU",
    description: "Premium hypochlorous acid skincare. Pharmaceutical-grade HOCl facial mist using advanced electrolysis manufacturing and vacuum-sealed packaging.",
    category: "Physical Product",
    status: "In Development",
    icon: Droplets,
  },
];

const categoryIcons: Record<ProductCategory, typeof Smartphone> = {
  "App": Smartphone,
  "Extension": Puzzle,
  "AI Tool": Cpu,
  "Physical Product": Box,
  "Device": Box,
  "Platform": Smartphone,
};

const statusColors: Record<ProductStatus, string> = {
  "Live": "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  "Active": "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  "In Development": "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  "Coming Soon": "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
};

export default function Products() {
  return (
    <Layout>
      <SEOHead
        title="Products & Platforms | Bestly LLC"
        description="Explore our portfolio of privacy-first products including Cookie Yeti, InventoryProof, and HOKU. Software, AI tools, and physical products built with ethical design."
      />
      
      <div className="relative">
        {/* Background decoration */}
        <div className="absolute inset-0 bg-mesh opacity-30 pointer-events-none" />
        
        <div className="relative mx-auto max-w-7xl px-6 py-16 lg:px-8 lg:py-24">
          {/* Page Header */}
          <AnimatedSection className="mb-20 max-w-3xl">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              Products & <GradientText>Platforms</GradientText>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
              Our portfolio of privacy-first products spans software, AI tools, browser extensions, 
              and physical products. Each product is built with our core commitment to user privacy 
              and ethical design.
            </p>
          </AnimatedSection>

          {/* Products Grid */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {products.map((product, index) => {
              const Icon = categoryIcons[product.category] || product.icon;
              return (
                <AnimatedSection key={product.id} delay={index * 80}>
                  <GlowCard className="h-full flex flex-col">
                    <div className="flex items-start justify-between mb-5">
                      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.1)] to-[hsl(var(--gradient-end)/0.1)]">
                        <Icon className="h-7 w-7 text-primary" />
                      </div>
                      <Badge variant="outline" className={statusColors[product.status]}>
                        {product.status}
                      </Badge>
                    </div>
                    
                    <h3 className="text-xl font-semibold text-foreground mb-3">
                      {product.name}
                    </h3>
                    
                    <p className="text-muted-foreground mb-6 leading-relaxed flex-grow">
                      {product.description}
                    </p>
                    
                    <div className="flex items-center justify-between pt-5 border-t border-border">
                      <Badge variant="outline" className="text-xs border-border">
                        {product.category}
                      </Badge>
                      
                      {(product.id === "cookie-yeti" || product.id === "inventory-proof" || product.id === "hoku") && (
                        <Link
                          to={
                            product.id === "cookie-yeti" ? "/cookie-yeti" :
                            product.id === "inventory-proof" ? "/inventory-proof" :
                            product.id === "hoku" ? "/hoku" :
                            `/product/${product.id}/legal`
                          }
                          className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors group"
                        >
                          Learn More
                          <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </Link>
                      )}
                    </div>
                  </GlowCard>
                </AnimatedSection>
              );
            })}

            {/* Placeholder for future products */}
            <AnimatedSection delay={300}>
              <div className="relative h-full min-h-[300px] rounded-2xl border border-dashed border-border bg-gradient-to-br from-secondary/30 to-secondary/10 p-6 flex flex-col items-center justify-center text-center">
                <div className="w-14 h-14 rounded-xl bg-secondary/50 flex items-center justify-center mb-4">
                  <Box className="h-7 w-7 text-muted-foreground" />
                </div>
                <p className="text-foreground font-medium mb-2">More Products Coming</p>
                <p className="text-sm text-muted-foreground max-w-[200px]">
                  We're actively developing new products across multiple categories.
                </p>
              </div>
            </AnimatedSection>
          </div>

          {/* Product Categories Section */}
          <section className="mt-32 border-t border-border pt-16">
            <AnimatedSection>
              <h2 className="text-2xl font-semibold text-foreground mb-12">
                Product Categories
              </h2>
            </AnimatedSection>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  category: "Mobile Apps",
                  description: "iOS and Android applications with privacy-first architecture.",
                  icon: Smartphone,
                },
                {
                  category: "Browser Extensions",
                  description: "Productivity and privacy tools for Chrome, Firefox, Safari, and Edge.",
                  icon: Puzzle,
                },
                {
                  category: "AI Tools",
                  description: "Intelligent automation with transparent, ethical AI practices.",
                  icon: Cpu,
                },
                {
                  category: "Physical Products",
                  description: "Consumer products with optional privacy-respecting companion apps.",
                  icon: Box,
                },
              ].map((item, index) => (
                <AnimatedSection key={item.category} delay={index * 80}>
                  <div className="flex gap-4 p-5 rounded-xl bg-card border border-border transition-all hover:shadow-lg hover:border-border/60">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[hsl(var(--gradient-start)/0.1)] to-[hsl(var(--gradient-end)/0.1)]">
                      <item.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">{item.category}</h3>
                      <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{item.description}</p>
                    </div>
                  </div>
                </AnimatedSection>
              ))}
            </div>
          </section>

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
                . Product-specific legal information is available on each product's dedicated page 
                once launched.
              </p>
            </section>
          </AnimatedSection>
        </div>
      </div>
    </Layout>
  );
}
