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
          "inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 xl:px-3 2xl:px-4 py-2 text-sm font-medium transition-colors hover:text-foreground hover:bg-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isActive ? "text-foreground" : "text-muted-foreground",
          className
        )}
      >
        Products
        <ChevronDown className="h-4 w-4" />
      </DropdownMenuTrigger>
      {/* z-[70] keeps the open menu above the Talk to Maya pill (z-60).
          The list is longer than a laptop screen. Radix locks page scroll while
          the menu is open, so the menu itself has to scroll: cap it at the
          space Radix says is left below the trigger and let it scroll inside. */}
      <DropdownMenuContent
        align="start"
        collisionPadding={16}
        className="z-[70] w-72 p-0 max-h-[min(40rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto overscroll-contain"
      >
        <div className="p-1">
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
                <p className="font-medium leading-snug text-foreground">{product.name}</p>
                <p className="text-xs text-muted-foreground">{product.description}</p>
              </div>
            </ProductLink>
          </DropdownMenuItem>
        ))}
        </div>
        {/* Pinned to the bottom so "View all" is always in reach; the soft
            fade above it shows there is more to scroll. */}
        <div className="sticky bottom-0 bg-popover">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-t from-popover to-transparent" />
          <DropdownMenuItem asChild>
            <Link
              to="/products"
              className="flex items-center justify-center whitespace-nowrap p-3 text-sm text-muted-foreground hover:text-foreground border-t"
            >
              View all products →
            </Link>
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
