import { Link } from "react-router-dom";
import { ChevronDown, Puzzle, Smartphone, Droplets, Navigation } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const products = [
  {
    name: "Cookie Yeti",
    description: "Privacy-focused cookie consent handler",
    href: "/cookie-yeti",
    icon: Puzzle,
  },
  {
    name: "InventoryProof",
    description: "AI-powered home inventory documentation",
    href: "/inventory-proof",
    icon: Smartphone,
  },
  {
    name: "HOKU",
    description: "Premium hypochlorous acid skincare",
    href: "/hoku",
    icon: Droplets,
  },
  {
    name: "NeckPilot",
    description: "Posture awareness powered by AirPods",
    href: "/neckpilot",
    icon: Navigation,
  },
];

interface ProductsDropdownProps {
  className?: string;
  isActive?: boolean;
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
            <Link
              to={product.href}
              className="flex items-start gap-3 p-3 cursor-pointer"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary">
                <product.icon className="h-4 w-4 text-foreground" />
              </div>
              <div>
                <p className="font-medium text-foreground">{product.name}</p>
                <p className="text-xs text-muted-foreground">{product.description}</p>
              </div>
            </Link>
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
