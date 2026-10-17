import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import {
  ExternalLink,
  Globe,
  Briefcase,
  Phone,
  MessageCircle,
  Mail,
  Newspaper,
  Wrench,
  Copy,
  Check,
  Instagram,
  Linkedin,
  Music2,
  Plane,
  UtensilsCrossed,
  MapPin,
  ScanLine,
  ParkingCircle,
  ArrowUpRight,
  Cloud,
} from "lucide-react";
import { toast } from "sonner";
import bestlyLogo from "@/assets/bestly-logo.png";
import jaredHeadshot from "@/assets/jared-headshot.png";
import { products as sharedProducts, isExternalHref, type Product } from "@/config/products";
import { InteractiveDotGrid } from "@/components/InteractiveDotGrid";
import { WowButton } from "@/components/wow/WowButton";

interface LinkItem {
  label: string;
  href: string;
  icon?: React.ReactNode;
  image?: string;
  external?: boolean;
}

/** A product's own image, else the Lucide icon config/products.ts already gives it. */
function toLinkItem(p: Product): LinkItem {
  const Icon = p.icon;
  return {
    label: p.name,
    href: p.href,
    image: p.image,
    icon: Icon ? <Icon className="h-5 w-5" /> : undefined,
    external: isExternalHref(p.href),
  };
}

const byId = (id: string) => sharedProducts.find((p) => p.id === id);
const group = (ids: string[]): LinkItem[] =>
  ids.map(byId).filter((p): p is Product => Boolean(p)).map(toLinkItem);

// What Bestly sells, first.
const productLinks: LinkItem[] = [
  { label: "Bestly Cloud", href: "/cloud", icon: <Cloud className="h-5 w-5" /> },
  ...group(["bestly-agent", "bestly-studio", "hoku"]),
];

// Software anyone can download or sign up for.
const appLinks: LinkItem[] = group([
  "cookie-yeti",
  "inventory-proof",
  "parentiq",
  "neckpilot",
  "schoolpilot",
  "hoascope",
  "confesh",
]);

// Built for somebody else.
const clientLinks: LinkItem[] = group([
  "golden-hour-garden",
  "the-shift-shop",
  "purely-hunza",
  "el-dora",
  "captains-log",
]);

const pages: LinkItem[] = [
  { label: "Bestly Website", href: "/", icon: <Globe className="h-5 w-5" /> },
  { label: "Services", href: "/services", icon: <Wrench className="h-5 w-5" /> },
  { label: "Hire Us", href: "/hire", icon: <Briefcase className="h-5 w-5" /> },
  { label: "Contact", href: "/contact", icon: <Phone className="h-5 w-5" /> },
  { label: "Press Kit", href: "/press", icon: <Newspaper className="h-5 w-5" /> },
];

const socials = [
  { label: "Instagram", href: "https://www.instagram.com/bestly_llc/", icon: <Instagram className="h-5 w-5" /> },
  { label: "LinkedIn", href: "https://linkedin.com/in/bestjared", icon: <Linkedin className="h-5 w-5" /> },
];

const favoriteApps = [
  {
    label: "Yuka",
    description: "Scans food and cosmetics and rates what's actually in them.",
    domain: "yuka.io",
    href: "https://yuka.io",
    icon: <ScanLine className="h-5 w-5" />,
  },
  {
    label: "Flighty",
    description: "Tracks every flight in real time, for you and whoever's picking you up.",
    domain: "flighty.com",
    href: "https://flighty.com",
    icon: <Plane className="h-5 w-5" />,
  },
  {
    label: "Too Good To Go",
    description: "Leftover food from local restaurants at a third of the price.",
    domain: "toogoodtogo.com",
    href: "https://www.toogoodtogo.com",
    icon: <UtensilsCrossed className="h-5 w-5" />,
  },
  {
    label: "WeHo Loves Locals",
    description: "Discounts at West Hollywood businesses, for residents only.",
    domain: "weholocals.com",
    href: "https://www.weholocals.com",
    icon: <MapPin className="h-5 w-5" />,
  },
  {
    label: "SpotAngels",
    description: "Finds free and legal street parking before you circle the block.",
    domain: "spotangels.com",
    href: "https://www.spotangels.com/app",
    icon: <ParkingCircle className="h-5 w-5" />,
  },
];

function LinkButton({ item }: { item: LinkItem }) {
  const isExternal = item.external || item.href.startsWith("http");
  const className =
    "group flex min-h-[64px] w-full items-center gap-3 rounded-2xl wow-border border bg-[hsl(var(--wow-ink-elev))] px-5 py-4 transition-all duration-200 wow-ease hover:-translate-y-[1px] hover:border-[hsl(var(--wow-indigo-light))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--wow-indigo-light))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--wow-ink))]";

  const inner = (
    <>
      {item.image ? (
        <img src={item.image} alt="" className="h-8 w-8 rounded-lg object-contain" />
      ) : (
        <span className="wow-text-muted transition-colors group-hover:wow-text-indigo">{item.icon}</span>
      )}
      <span className="flex-1 text-sm font-semibold wow-text-paper">{item.label}</span>
      <ExternalLink className="h-4 w-4 wow-text-muted opacity-60 transition-colors group-hover:wow-text-indigo group-hover:opacity-100" />
    </>
  );

  if (isExternal) {
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer" className={className}>
        {inner}
      </a>
    );
  }
  return (
    <Link to={item.href} className={className}>
      {inner}
    </Link>
  );
}

function AppCard({ app }: { app: (typeof favoriteApps)[number] }) {
  return (
    <a
      href={app.href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start gap-4 rounded-2xl wow-border border bg-[hsl(var(--wow-ink-elev))] p-5 transition-all duration-200 wow-ease hover:-translate-y-[1px] hover:border-[hsl(var(--wow-indigo-light))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--wow-indigo-light))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--wow-ink))]"
    >
      <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--wow-indigo))]/15 wow-text-indigo">
        {app.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-sm font-semibold wow-text-paper">{app.label}</span>
          <ArrowUpRight className="h-3.5 w-3.5 wow-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
        </span>
        <span className="mt-1 block text-[13px] leading-snug wow-text-muted">{app.description}</span>
        <span className="mt-1.5 block text-[11px] uppercase tracking-widest wow-text-muted/70">{app.domain}</span>
      </span>
    </a>
  );
}

export default function Links() {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    const url = "https://www.bestly.tech/links";
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      toast.error("Couldn't copy — copy it from the address bar instead.");
      return;
    }
    setCopied(true);
    toast.success("Link copied.");
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="relative min-h-screen wow-bg-ink">
      {/* Was showing the marketing homepage's <title>. */}
      <Helmet>
        <title>Jared Best — links | Bestly</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <div className="pointer-events-none fixed inset-0" aria-hidden="true">
        <InteractiveDotGrid />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col items-center px-4 py-14 sm:py-20">
        {/* Avatar + identity */}
        <div className="flex flex-col items-center gap-4">
          <img
            src={jaredHeadshot}
            alt="Jared Best"
            className="h-28 w-28 rounded-full border-2 border-[hsl(var(--wow-indigo-light))]/40 object-cover shadow-[0_0_40px_-10px_hsl(var(--wow-indigo-light)/0.5)]"
          />
          <img src={bestlyLogo} alt="" className="h-6 w-auto opacity-90" />
          <div className="text-center">
            <h1 className="font-display text-2xl font-normal tracking-tight wow-text-paper">Jared Best</h1>
            <p className="mt-1 text-sm wow-text-muted">Founder, Bestly LLC · West Hollywood, CA</p>
          </div>

          <button
            type="button"
            onClick={copyLink}
            className="mt-1 inline-flex min-h-[36px] items-center gap-2 rounded-full wow-border border px-4 py-1.5 text-xs wow-text-muted transition-colors hover:wow-text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--wow-indigo-light))]"
          >
            bestly.tech/links
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Primary CTA */}
        <div className="mt-8 w-full max-w-md">
          <WowButton to="/hire" variant="primary" magnetic={false} className="w-full !py-3.5 text-[15px]">
            Book with Bestly
          </WowButton>
        </div>

        {/* Contact row */}
        <div className="mt-3 grid w-full max-w-md grid-cols-3 gap-3">
          <a
            href="tel:+18165007236"
            className="flex min-h-[56px] flex-col items-center justify-center gap-1.5 rounded-2xl wow-border border bg-[hsl(var(--wow-ink-elev))] py-3 text-xs font-medium wow-text-paper transition-colors wow-ease hover:border-[hsl(var(--wow-indigo-light))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--wow-indigo-light))]"
          >
            <Phone className="h-[18px] w-[18px] wow-text-indigo" />
            Call
          </a>
          <a
            href="sms:+18165007236"
            className="flex min-h-[56px] flex-col items-center justify-center gap-1.5 rounded-2xl wow-border border bg-[hsl(var(--wow-ink-elev))] py-3 text-xs font-medium wow-text-paper transition-colors wow-ease hover:border-[hsl(var(--wow-indigo-light))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--wow-indigo-light))]"
          >
            <MessageCircle className="h-[18px] w-[18px] wow-text-indigo" />
            Text
          </a>
          <a
            href="mailto:jared@bestly.tech"
            className="flex min-h-[56px] flex-col items-center justify-center gap-1.5 rounded-2xl wow-border border bg-[hsl(var(--wow-ink-elev))] py-3 text-xs font-medium wow-text-paper transition-colors wow-ease hover:border-[hsl(var(--wow-indigo-light))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--wow-indigo-light))]"
          >
            <Mail className="h-[18px] w-[18px] wow-text-indigo" />
            Email
          </a>
        </div>

        {/* Socials */}
        <div className="mt-5 flex gap-3">
          {socials.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={s.label}
              className="flex h-11 w-11 items-center justify-center rounded-full wow-border border bg-[hsl(var(--wow-ink-elev))] wow-text-muted transition-colors wow-ease hover:wow-text-indigo hover:border-[hsl(var(--wow-indigo-light))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--wow-indigo-light))]"
            >
              {s.icon}
            </a>
          ))}
        </div>

        {/* Products */}
        <div className="mt-12 w-full max-w-md">
          <p className="mb-3 px-1 text-xs font-semibold uppercase tracking-widest wow-text-muted">Products</p>
          <div className="flex flex-col gap-3">
            {productLinks.map((item) => (
              <LinkButton key={item.label} item={item} />
            ))}
          </div>
        </div>

        {/* Apps */}
        <div className="mt-8 w-full max-w-md">
          <p className="mb-3 px-1 text-xs font-semibold uppercase tracking-widest wow-text-muted">Apps</p>
          <div className="flex flex-col gap-3">
            {appLinks.map((item) => (
              <LinkButton key={item.label} item={item} />
            ))}
          </div>
        </div>

        {/* Clients */}
        <div className="mt-8 w-full max-w-md">
          <p className="mb-3 px-1 text-xs font-semibold uppercase tracking-widest wow-text-muted">Clients</p>
          <div className="flex flex-col gap-3">
            {clientLinks.map((item) => (
              <LinkButton key={item.label} item={item} />
            ))}
          </div>
        </div>

        {/* Company */}
        <div className="mt-8 w-full max-w-md">
          <p className="mb-3 px-1 text-xs font-semibold uppercase tracking-widest wow-text-muted">Company</p>
          <div className="flex flex-col gap-3">
            {pages.map((item) => (
              <LinkButton key={item.label} item={item} />
            ))}
          </div>
        </div>

        {/* Favorite apps — personal, so it sits below everything for sale */}
        <div className="mt-12 w-full max-w-md">
          <p className="mb-3 px-1 text-xs font-semibold uppercase tracking-widest wow-text-muted">
            Apps I actually use
          </p>
          <div className="flex flex-col gap-3">
            {favoriteApps.map((app) => (
              <AppCard key={app.label} app={app} />
            ))}
          </div>
        </div>

        {/* Now playing */}
        <div className="mt-8 w-full max-w-md">
          <a
            href="https://soundcloud.com/poolsuite/poolsuite-presents-20-an-hour-of-summer-with-neil-frances"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-4 rounded-2xl wow-border border bg-[hsl(var(--wow-ink-elev))] p-4 transition-all duration-200 wow-ease hover:-translate-y-[1px] hover:border-[hsl(var(--wow-indigo-light))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--wow-indigo-light))]"
          >
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[hsl(var(--wow-indigo))]">
              <Music2 className="h-5 w-5 text-white" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] uppercase tracking-widest wow-text-muted">Now playing</span>
              <span className="mt-0.5 block truncate text-sm font-semibold wow-text-paper">Poolsuite FM</span>
              <span className="block truncate text-[13px] wow-text-muted">An hour of summer with NEIL FRANCES</span>
            </span>
            <ExternalLink className="h-4 w-4 flex-shrink-0 wow-text-muted opacity-60 group-hover:wow-text-indigo group-hover:opacity-100" />
          </a>
        </div>

        {/* Footer */}
        <div className="mt-14 flex w-full max-w-xs flex-col items-center gap-4">
          <div
            aria-hidden="true"
            className="h-px w-full opacity-60"
            style={{
              background:
                "linear-gradient(90deg, #ef4444, #f97316, #eab308, #22c55e, #3b82f6, #8b5cf6)",
            }}
          />
          <p className="text-center text-xs wow-text-muted">Bestly LLC · Built in Los Angeles</p>
          <p className="text-center text-[11px] wow-text-muted/60">© {new Date().getFullYear()} Bestly LLC</p>
        </div>
      </div>
    </div>
  );
}
