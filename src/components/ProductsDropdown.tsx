import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { products, isExternalHref } from "@/config/products";
import type { Product } from "@/config/products";

interface ProductsDropdownProps {
  className?: string;
  isActive?: boolean;
}

function ProductLink({
  product,
  children,
}: {
  product: Product;
  children: React.ReactNode;
}) {
  const className = "flex items-start gap-3 p-3 cursor-pointer";
  if (isExternalHref(product.href)) {
    return (
      <a
        href={product.href}
        target={product.href.startsWith("http") ? "_blank" : undefined}
        rel="noopener noreferrer"
        className={className}
      >
        {children}
      </a>
    );
  }
  return (
    <Link to={product.href} className={className}>
      {children}
    </Link>
  );
}

export function ProductsDropdown({ className, isActive }: ProductsDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex items-center gap-1 text-sm font-medium transition-colors hover:text-foreground focus:outline-none",
          isActive ? "text-foreground" : "text-muted-foreground",
          className
        )}
      >
        Products
        <ChevronDown className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {products.map((product) => (
          <DropdownMenuItem key={product.name} asChild>
            {/* Products can point at an external brand site; react-router's
                <Link> would treat that as an in-app path. */}
            <ProductLink product={product}>
              {product.image ? (
                <img src={product.image} alt={product.name} className="h-8 w-8 shrink-0 rounded-md" />
              ) : product.icon ? (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary">
                  <product.icon className="h-4 w-4 text-foreground" />
                </div>
              ) : null}
              <div>
                <p className="font-medium text-foreground">{product.name}</p>
                <p className="text-xs text-muted-foreground">{product.description}</p>
              </div>
            </ProductLink>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem asChild>
          <Link
            to="/products"
            className="flex items-center justify-center p-2 text-sm text-muted-foreground hover:text-foreground border-t"
          >
            View all products →
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
