import { Link } from "react-router-dom";
import bestlyLogo from "@/assets/bestly-logo.png";

const footerNavigation = {
  company: [
    { name: "About", href: "/about" },
    { name: "Products", href: "/products" },
    { name: "Press Kit", href: "/press" },
    { name: "Contact", href: "/contact" },
  ],
  legal: [
    { name: "Privacy Policy", href: "/privacy-policy" },
    { name: "Cookie Yeti Privacy", href: "/privacy" },
    { name: "Terms of Service", href: "/terms-of-service" },
    { name: "Developer Compliance", href: "/developer-compliance" },
  ],
  contact: [
    { name: "support@bestly.tech", href: "mailto:support@bestly.tech" },
    { name: "privacy@bestly.tech", href: "mailto:privacy@bestly.tech" },
  ],
};

export function Footer() {
  return (
    <footer className="border-t border-border bg-secondary/30">
      <div className="mx-auto max-w-7xl px-6 py-12 lg:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2">
              <img src={bestlyLogo} alt="Bestly LLC" className="h-8 w-auto rotate-[20deg]" />
              <span className="text-lg font-semibold text-foreground">
                Bestly LLC
              </span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
              A multi-vertical product studio building privacy-first digital and physical products.
            </p>
            <p className="mt-4 text-sm text-muted-foreground">
              Los Angeles, CA, United States
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-foreground">Company</h3>
            <ul className="mt-4 space-y-3">
              {footerNavigation.company.map((item) => (
                <li key={item.name}>
                  <Link
                    to={item.href}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-foreground">Legal</h3>
            <ul className="mt-4 space-y-3">
              {footerNavigation.legal.map((item) => (
                <li key={item.name}>
                  <Link
                    to={item.href}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-foreground">Contact</h3>
            <ul className="mt-4 space-y-3">
              {footerNavigation.contact.map((item) => (
                <li key={item.name}>
                  <a
                    href={item.href}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {item.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t border-border pt-8">
          <p className="text-sm text-muted-foreground text-center">
            © {new Date().getFullYear()} Bestly LLC. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
