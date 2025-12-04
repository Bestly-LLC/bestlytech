import { Layout } from "@/components/layout/Layout";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { 
  Smartphone, 
  Puzzle, 
  Cpu, 
  Box,
  ExternalLink
} from "lucide-react";

type ProductCategory = "App" | "Extension" | "AI Tool" | "Physical Product" | "Device" | "Platform";
type ProductStatus = "Live" | "In Development" | "Coming Soon";

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
    description: "Automatically handles cookie consent pop-ups based on your privacy preferences. No tracking, no data collection.",
    category: "Extension",
    status: "Live",
    icon: Puzzle,
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
  "Live": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  "In Development": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  "Coming Soon": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
};

export default function Products() {
  return (
    <Layout>
      <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8 lg:py-24">
        {/* Page Header */}
        <div className="mb-16 max-w-3xl">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Products & Platforms
          </h1>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
            Our portfolio of privacy-first products spans software, AI tools, browser extensions, 
            and physical products. Each product is built with our core commitment to user privacy 
            and ethical design.
          </p>
        </div>

        {/* Products Grid */}
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => {
            const Icon = categoryIcons[product.category] || product.icon;
            return (
              <div
                key={product.id}
                className="relative rounded-xl border border-border bg-card p-6 shadow-sm transition-all hover:shadow-md"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-secondary">
                    <Icon className="h-6 w-6 text-foreground" />
                  </div>
                  <Badge variant="secondary" className={statusColors[product.status]}>
                    {product.status}
                  </Badge>
                </div>
                
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {product.name}
                </h3>
                
                <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                  {product.description}
                </p>
                
                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <Badge variant="outline" className="text-xs">
                    {product.category}
                  </Badge>
                  
                  {product.status === "Live" && (
                    <Link
                      to={product.id === "cookie-yeti" ? "/cookie-yeti" : `/product/${product.id}/legal`}
                      className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {product.id === "cookie-yeti" ? "View Product" : "Legal Info"}
                      <ExternalLink className="ml-1 h-3 w-3" />
                    </Link>
                  )}
                </div>
              </div>
            );
          })}

          {/* Placeholder for future products */}
          <div className="relative rounded-xl border border-dashed border-border bg-secondary/20 p-6 flex flex-col items-center justify-center min-h-[250px]">
            <div className="text-center">
              <p className="text-muted-foreground font-medium mb-2">More Products Coming</p>
              <p className="text-sm text-muted-foreground">
                We're actively developing new products across multiple categories.
              </p>
            </div>
          </div>
        </div>

        {/* Product Categories Section */}
        <section className="mt-24 border-t border-border pt-16">
          <h2 className="text-2xl font-semibold text-foreground mb-8">
            Product Categories
          </h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
            ].map((item) => (
              <div key={item.category} className="flex gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
                  <item.icon className="h-5 w-5 text-foreground" />
                </div>
                <div>
                  <h3 className="font-medium text-foreground">{item.category}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Legal Notice */}
        <section className="mt-16 p-6 rounded-xl bg-secondary/30 border border-border">
          <h3 className="font-semibold text-foreground mb-2">Product Legal Information</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Each product has its own specific privacy policy and terms of service that supplement 
            our{" "}
            <Link to="/privacy-policy" className="text-foreground underline underline-offset-4 hover:text-primary">
              Master Privacy Policy
            </Link>{" "}
            and{" "}
            <Link to="/terms-of-service" className="text-foreground underline underline-offset-4 hover:text-primary">
              Master Terms of Service
            </Link>
            . Product-specific legal information is available on each product's dedicated page 
            once launched.
          </p>
        </section>
      </div>
    </Layout>
  );
}
