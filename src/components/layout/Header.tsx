import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductsDropdown } from "@/components/ProductsDropdown";
import { cn } from "@/lib/utils";
import bestlyLogo from "@/assets/bestly-logo.png";

const navigation = [
  { name: "Home", href: "/" },
  { name: "About", href: "/about" },
  { name: "Services", href: "/services" },
  { name: "Contact", href: "/contact" },
  { name: "Hire Me", href: "/hire" },
];

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const isProductsActive = location.pathname.startsWith("/products") || 
    location.pathname.startsWith("/cookie-yeti") ||
    location.pathname.startsWith("/inventory-proof") ||
    location.pathname.startsWith("/hoku");
  const isHireActive = location.pathname === "/hire";

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-8">
        <div className="flex lg:flex-1">
          <Link to="/" className="-m-1.5 p-1.5 flex items-center gap-2 group">
            <img 
              src={bestlyLogo} 
              alt="Bestly LLC" 
              className="h-8 w-auto rotate-[20deg]" 
            />
            <span className="text-xl font-semibold tracking-tight text-foreground">
              Bestly
            </span>
          </Link>
        </div>

        <div className="flex lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-6 w-6" />
          </Button>
        </div>

        <div className="hidden lg:flex lg:gap-x-8 lg:items-center">
          {navigation.map((item) => (
            <Link
              key={item.name}
              to={item.href}
              className={cn(
                "text-sm font-medium transition-colors hover:text-foreground",
                location.pathname === item.href
                  ? "text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {item.name}
            </Link>
          ))}
          <ProductsDropdown isActive={isProductsActive} />
        </div>

        <div className="hidden lg:flex lg:flex-1 lg:justify-end">
          <Link
            to="/privacy-policy"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Legal
          </Link>
        </div>
      </nav>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="fixed inset-0 bg-background/80 backdrop-blur-sm animate-fade-in"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto bg-background px-6 py-6 sm:max-w-sm sm:ring-1 sm:ring-border animate-slide-in-right">
            <div className="flex items-center justify-between">
              <Link
                to="/"
                className="-m-1.5 p-1.5 flex items-center gap-2"
                onClick={() => setMobileMenuOpen(false)}
              >
                <img
                  src={bestlyLogo}
                  alt="Bestly LLC"
                  className="h-8 w-auto rotate-[20deg]"
                />
                <span className="text-xl font-semibold tracking-tight text-foreground">
                  Bestly LLC
                </span>
              </Link>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close menu"
              >
                <X className="h-6 w-6" />
              </Button>
            </div>
            <div className="mt-6 flow-root">
              <div className="-my-6 divide-y divide-border">
                <div className="space-y-2 py-6">
                  {navigation.map((item) => (
                    <Link
                      key={item.name}
                      to={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={cn(
                        "-mx-3 block rounded-lg px-3 py-2 text-base font-medium transition-colors",
                        location.pathname === item.href
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      {item.name}
                    </Link>
                  ))}
                  <Link
                    to="/products"
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "-mx-3 block rounded-lg px-3 py-2 text-base font-medium transition-colors",
                      isProductsActive
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    Products
                  </Link>
                  <Link
                    to="/services"
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "-mx-3 block rounded-lg px-3 py-2 text-base font-medium transition-colors",
                      location.pathname === "/services"
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    Services
                  </Link>
                  <div className="pl-4 space-y-1">
                    <Link
                      to="/cookie-yeti"
                      onClick={() => setMobileMenuOpen(false)}
                      className="block rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      Cookie Yeti
                    </Link>
                    <Link
                      to="/inventory-proof"
                      onClick={() => setMobileMenuOpen(false)}
                      className="block rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      InventoryProof
                    </Link>
                    <Link
                      to="/hoku"
                      onClick={() => setMobileMenuOpen(false)}
                      className="block rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      HOKU
                    </Link>
                  </div>
                </div>
                <div className="py-6 space-y-2">
                  <Link
                    to="/privacy-policy"
                    onClick={() => setMobileMenuOpen(false)}
                    className="-mx-3 block rounded-lg px-3 py-2 text-base font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    Privacy Policy
                  </Link>
                  <Link
                    to="/terms-of-service"
                    onClick={() => setMobileMenuOpen(false)}
                    className="-mx-3 block rounded-lg px-3 py-2 text-base font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    Terms of Service
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
