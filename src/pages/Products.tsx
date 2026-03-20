import { SEOHead } from "@/components/SEOHead";
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
  Navigation,
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
  website?: string;
}

const products: Product[] = [
  {
    id: "cookie-yeti",
    name: "Cookie Yeti",
    description: "Dismiss cookie banners instantly. Browse cleaner, faster, and more privately.",
    category: "Extension",
    status: "Coming Soon",
    icon: Puzzle,
  },
  {
    id: "inventory-proof",
    name: "InventoryProof",
    description: "Walk through your home. Get an insurance-ready inventory report in minutes, powered by AI.",
    category: "Platform",
    status: "Active",
    icon: Smartphone,
    website: "https://inventoryproof.com",
  },
  {
    id: "hoku",
    name: "HOKU",
    description: "Pharmaceutical-grade skincare, simplified. A daily facial mist backed by science, not marketing.",
    category: "Physical Product",
    status: "Coming Soon",
    icon: Droplets,
    website: "https://hoku-clean.com",
  },
  {
    id: "neckpilot",
    name: "NeckPilot",
    description: "Posture awareness powered by AirPods. Real-time feedback and gentle alerts when you've been flying too long.",
    category: "App",
    status: "Coming Soon",
    icon: Navigation,
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
    <>
      <SEOHead
        title="What We're Building | Bestly LLC"
        description="Explore our portfolio of privacy-first products including Cookie Yeti, InventoryProof, and HOKU — software, AI tools, and physical products built with privacy at the core."
      />
      
      <div className="relative">
        {/* Background decoration */}
        <div className="absolute inset-0 bg-mesh opacity-30 pointer-events-none" />
        
        <div className="relative mx-auto max-w-7xl px-6 py-16 lg:px-8 lg:py-24">
          {/* Page Header */}
          <AnimatedSection className="mb-20 max-w-3xl">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              What We're <GradientText>Building</GradientText>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
              Every product starts with the same question: how do we make this great without compromising anyone's privacy?
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
                      
                      <div className="flex items-center gap-3">
                        {product.website && (
                          <a
                            href={product.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors group"
                          >
                            Website
                            <ExternalLink className="ml-1 h-3.5 w-3.5" />
                          </a>
                        )}
                        {(product.id === "cookie-yeti" || product.id === "inventory-proof" || product.id === "hoku" || product.id === "neckpilot") && (
                          <Link
                            to={
                              product.id === "cookie-yeti" ? "/cookie-yeti" :
                              product.id === "inventory-proof" ? "/inventory-proof" :
                              product.id === "hoku" ? "/hoku" :
                              product.id === "neckpilot" ? "/neckpilot" :
                              `/product/${product.id}/legal`
                            }
                            className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors group"
                          >
                            Details
                            <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                          </Link>
                        )}
                      </div>
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
                <p className="text-foreground font-medium mb-2">More Coming Soon</p>
                <p className="text-sm text-muted-foreground max-w-[200px]">
                  Something new is always in the works.
                </p>
              </div>
            </AnimatedSection>
          </div>

          {/* Product Categories Section */}
          <section className="mt-32 border-t border-border pt-16">
            <AnimatedSection>
              <h2 className="text-2xl font-semibold text-foreground mb-12">
                Where We Play
              </h2>
            </AnimatedSection>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  category: "Mobile Apps",
                  description: "iOS and Android apps that put you in control.",
                  icon: Smartphone,
                },
                {
                  category: "Browser Extensions",
                  description: "Productivity and privacy tools for every major browser.",
                  icon: Puzzle,
                },
                {
                  category: "AI Tools",
                  description: "Intelligent automation, built transparently.",
                  icon: Cpu,
                },
                {
                  category: "Physical Products",
                  description: "Real goods with privacy-respecting companion apps.",
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
    </>
  );
}
