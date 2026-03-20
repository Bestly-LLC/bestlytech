import { ExternalLink, Globe, Briefcase, Phone, Newspaper, Wrench, Instagram, Twitter } from "lucide-react";
import bestlyLogo from "@/assets/bestly-logo.png";
import jaredHeadshot from "@/assets/jared-headshot.png";
import { products as sharedProducts } from "@/config/products";

interface LinkItem {
  label: string;
  href: string;
  icon?: React.ReactNode;
  image?: string;
  external?: boolean;
}

const productLinks: LinkItem[] = sharedProducts.map((p) => ({
  label: p.name,
  href: p.href,
  image: p.image,
  external: p.href.startsWith("http"),
}));

const pages: LinkItem[] = [
  { label: "Bestly Website", href: "/", icon: <Globe className="h-5 w-5" /> },
  { label: "Services", href: "/services", icon: <Wrench className="h-5 w-5" /> },
  { label: "Hire Us", href: "/hire", icon: <Briefcase className="h-5 w-5" /> },
  { label: "Contact", href: "/contact", icon: <Phone className="h-5 w-5" /> },
  { label: "Press Kit", href: "/press", icon: <Newspaper className="h-5 w-5" /> },
];

const socials = [
  { label: "Instagram", href: "#", icon: <Instagram className="h-5 w-5" /> },
  { label: "TikTok", href: "#", icon: <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.75a8.18 8.18 0 004.76 1.52V6.84a4.84 4.84 0 01-1-.15z"/></svg> },
  { label: "LinkedIn", href: "#", icon: <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg> },
  { label: "X / Twitter", href: "#", icon: <Twitter className="h-5 w-5" /> },
];

function LinkButton({ item }: { item: LinkItem }) {
  const isExternal = item.external || item.href.startsWith("http");
  const Tag = isExternal ? "a" : "a";
  const props = isExternal
    ? { href: item.href, target: "_blank", rel: "noopener noreferrer" }
    : { href: item.href };

  return (
    <Tag
      {...props}
      className="group flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-card/80 px-5 py-4 backdrop-blur-sm transition-all duration-200 hover:scale-[1.02] hover:border-primary/40 hover:shadow-[0_0_20px_hsl(var(--primary)/0.15)]"
    >
      {item.image ? (
        <img src={item.image} alt="" className="h-7 w-7 rounded-lg object-contain" />
      ) : (
        <span className="text-muted-foreground group-hover:text-primary transition-colors">{item.icon}</span>
      )}
      <span className="flex-1 text-sm font-semibold text-foreground">{item.label}</span>
      <ExternalLink className="h-4 w-4 text-muted-foreground/50 group-hover:text-primary/60 transition-colors" />
    </Tag>
  );
}

export default function Links() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/40 flex flex-col items-center px-4 py-10">
      {/* Avatar + Info */}
      <div className="flex flex-col items-center gap-3 mb-8">
        <img
          src={jaredHeadshot}
          alt="Jared Best"
          className="h-24 w-24 rounded-full border-2 border-primary/30 object-cover shadow-lg"
        />
        <img src={bestlyLogo} alt="Bestly LLC" className="h-7 w-auto" />
        <p className="text-sm text-muted-foreground">Founder, Bestly LLC</p>
      </div>

      {/* Links */}
      <div className="w-full max-w-md flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground px-1">Products</p>
        {products.map((item) => (
          <LinkButton key={item.label} item={item} />
        ))}

        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground px-1 mt-4">Company</p>
        {pages.map((item) => (
          <LinkButton key={item.label} item={item} />
        ))}
      </div>

      {/* Social row */}
      <div className="flex gap-4 mt-10">
        {socials.map((s) => (
          <a
            key={s.label}
            href={s.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={s.label}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-border/60 bg-card/80 text-muted-foreground transition-all hover:text-primary hover:border-primary/40 hover:shadow-[0_0_16px_hsl(var(--primary)/0.15)]"
          >
            {s.icon}
          </a>
        ))}
      </div>

      <p className="mt-10 text-xs text-muted-foreground/60">© {new Date().getFullYear()} Bestly LLC</p>
    </div>
  );
}
